import { createSessionHost } from './host';
import type { SessionRequest, SessionResponse } from './host';

/** Hilo del simulador: recibe pedidos de src/ui/client.ts y responde con la vista nueva. */

// El proyecto compila con la lib DOM, donde self es Window: estas son las dos partes del worker que se usan
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SessionRequest>) => void) | null;
  postMessage(response: SessionResponse): void;
};

const host = createSessionHost();

scope.onmessage = (event) => {
  scope.postMessage(host.handle(event.data));
};
