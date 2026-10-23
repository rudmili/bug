import { createDebugSession } from './session';
import type { DebugSession, DebugView, MemoryTarget, MemoryWindowName } from './types';

/**
 * Protocolo para usar la sesión desde otro hilo (worker.ts). Un `g` largo o la repetición de los
 * comandos guardados al abrir la página corren fuera del hilo de la interfaz y no la congelan.
 */

export type SessionRequest =
  /** Sesión nueva con estas líneas ya ejecutadas: así se recupera todo tras recargar. */
  | { id: number; type: 'start'; lines: string[] }
  | { id: number; type: 'submit'; line: string }
  /** Sesión nueva, como al abrir sin nada guardado. */
  | { id: number; type: 'reset' }
  | { id: number; type: 'window'; window: MemoryWindowName; to: MemoryTarget };

export interface SessionResponse {
  id: number;
  /** null solo en `window`, cuando la dirección no es válida. */
  view: DebugView | null;
}

/** Atiende los pedidos en orden; cada respuesta lleva el id del pedido. */
export function createSessionHost(createSession: () => DebugSession = createDebugSession) {
  let session = createSession();
  return {
    handle(request: SessionRequest): SessionResponse {
      switch (request.type) {
        case 'start': {
          session = createSession();
          let view = session.getView();
          for (const line of request.lines) view = session.submit(line);
          return { id: request.id, view };
        }
        case 'submit':
          return { id: request.id, view: session.submit(request.line) };
        case 'reset':
          session = createSession();
          return { id: request.id, view: session.getView() };
        case 'window':
          return { id: request.id, view: session.moveWindow(request.window, request.to) };
      }
    },
  };
}
