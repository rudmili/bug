import { createSessionHost } from '../debug/host';
import type { SessionRequest, SessionResponse } from '../debug/host';
import type { DebugSession, DebugView } from '../debug/types';

/** Lo que la interfaz le pide a la sesión. Asíncrono: la sesión puede correr en otro hilo. */
export interface SessionClient {
  /** Sesión nueva con las líneas guardadas ya ejecutadas. */
  start(lines: string[]): Promise<DebugView>;
  submit(line: string): Promise<DebugView>;
  reset(): Promise<DebugView>;
}

/** Omit que se reparte sobre cada variante de la unión (Omit sobre la unión entera perdería los campos propios). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** Un pedido sin el id, que lo pone el cliente. */
type Request = WithoutId<SessionRequest>;

function clientFor(send: (request: SessionRequest) => void) {
  let nextId = 0;
  const pending = new Map<number, { resolve: (view: DebugView) => void; reject: (error: unknown) => void }>();
  const call = (request: Request) =>
    new Promise<DebugView>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ ...request, id } as SessionRequest);
    });
  const client: SessionClient = {
    start: (lines) => call({ type: 'start', lines }),
    submit: (line) => call({ type: 'submit', line }),
    reset: () => call({ type: 'reset' }),
  };
  return {
    client,
    receive(response: SessionResponse) {
      pending.get(response.id)?.resolve(response.view);
      pending.delete(response.id);
    },
    fail(error: unknown) {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
    },
  };
}

/** La sesión en un Web Worker: un `g` largo no congela la página. */
export function createWorkerClient(): SessionClient {
  const worker = new Worker(new URL('../debug/worker.ts', import.meta.url), { type: 'module' });
  const { client, receive, fail } = clientFor((request) => worker.postMessage(request));
  worker.onmessage = (event: MessageEvent<SessionResponse>) => receive(event.data);
  worker.onerror = (event) => fail(new Error(event.message || 'El hilo del simulador dejó de responder'));
  return client;
}

/**
 * La sesión en el mismo hilo, con la misma interfaz. Para los tests y para ver el diseño:
 *   createLocalClient(createMockSession)   (mock.ts)
 */
export function createLocalClient(createSession: () => DebugSession): SessionClient {
  const host = createSessionHost(createSession);
  const { client, receive } = clientFor((request) => {
    // Asíncrono como el worker, para que la interfaz se comporte igual con los dos
    queueMicrotask(() => receive(host.handle(request)));
  });
  return client;
}
