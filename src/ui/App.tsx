import { useState } from 'react';
import './tokens.css';
import './debug-ui.css';
import type { DebugSession } from '../debug/types';
import { Terminal } from './Terminal';
import { StatePanel } from './StatePanel';
import { AppInfo } from './AppInfo';
import { ResetButton } from './ResetButton';
import { useCommandLog } from './store';

type CreateSession = () => DebugSession;

/** Sesión nueva con las líneas guardadas ya ejecutadas: así se recupera todo tras recargar. */
function restore(createSession: CreateSession, log: string[]): DebugSession {
  const session = createSession();
  try {
    for (const line of log) session.submit(line);
    return session;
  } catch {
    // Un registro que ya no se puede reproducir (por ejemplo, de otra versión) no debe dejar la página en blanco
    useCommandLog.getState().clear();
    return createSession();
  }
}

/**
 * Composición de la pantalla. Recibe cómo crear la sesión:
 *   - con la lógica real:   <App createSession={createDebugSession} />
 *   - para ver el diseño:   <App createSession={createMockSession} />   (mock.ts)
 */
export function App({ createSession }: { createSession: CreateSession }) {
  const log = useCommandLog((s) => s.log);
  // El inicializador puede correr dos veces en StrictMode: es puro (sesión nueva y repetición), así que no importa
  const [session, setSession] = useState(() => restore(createSession, useCommandLog.getState().log));
  const [view, setView] = useState(() => session.getView());
  // Las flechas recorren lo escrito, sin las líneas vacías
  const history = log.filter((line) => line.trim() !== '');

  function submit(line: string) {
    useCommandLog.getState().append(line);
    setView(session.submit(line));
  }

  function reset() {
    useCommandLog.getState().clear();
    const fresh = createSession();
    setSession(fresh);
    setView(fresh.getView());
  }

  return (
    <div className="app">
      {/* Título de la página para lectores de pantalla y buscadores; la terminal ya lo deja claro a la vista */}
      <h1 className="sr-only">Simulador DEBUG 8086</h1>
      <StatePanel view={view} />
      <Terminal lines={view.lines} prompt={view.prompt} history={history} onSubmit={submit}>
        <AppInfo className="info--float" />
        <ResetButton disabled={log.length === 0} onReset={reset} />
      </Terminal>
    </div>
  );
}
