import { useEffect, useState } from 'react';
import './tokens.css';
import './debug-ui.css';
import type { DebugView } from '../debug/types';
import type { SessionClient } from './client';
import { Terminal } from './Terminal';
import { StatePanel } from './StatePanel';
import { AppInfo } from './AppInfo';
import { ResetButton } from './ResetButton';
import { useCommandLog } from './store';

/**
 * Composición de la pantalla. Recibe la sesión ya creada:
 *   - con la lógica real, en un worker:   <App client={createWorkerClient()} />
 *   - para ver el diseño:                 <App client={createLocalClient(createMockSession)} />   (mock.ts)
 */
export function App({ client }: { client: SessionClient }) {
  const history = useCommandLog((s) => s.history);
  const empty = useCommandLog((s) => s.log.length === 0 && s.history.length === 0);
  const [view, setView] = useState<DebugView | null>(null);
  // Un comando a la vez: mientras corre (un `g` largo) la línea queda en solo lectura
  const [busy, setBusy] = useState(true);
  // Un fallo del hilo del simulador llega al ErrorBoundary en lugar de dejar la línea bloqueada
  const [failure, setFailure] = useState<unknown>(null);
  if (failure) throw failure;

  // Al abrir, la sesión vuelve a ejecutar las líneas guardadas: así se recupera todo tras recargar.
  // En StrictMode corre dos veces; la segunda crea otra sesión igual y es la que queda.
  useEffect(() => {
    let current = true;
    client.start(useCommandLog.getState().log).then(
      (next) => {
        if (!current) return;
        setView(next);
        setBusy(false);
      },
      (error: unknown) => current && setFailure(error),
    );
    return () => {
      current = false;
    };
  }, [client]);

  async function run(task: () => Promise<DebugView>) {
    setBusy(true);
    try {
      setView(await task());
    } catch (error) {
      setFailure(error);
    }
    setBusy(false);
  }

  function submit(line: string) {
    const store = useCommandLog.getState();
    store.append(line);
    return run(async () => {
      const next = await client.submit(line);
      // Tras `q` solo hace falta guardar lo que venga después; las flechas conservan lo anterior
      if (next.restarted) store.restart();
      return next;
    });
  }

  function reset() {
    useCommandLog.getState().clear();
    return run(() => client.reset());
  }

  // El primer arranque tarda lo que el worker en cargar: la página queda con el fondo de la terminal
  if (!view) return <div className="app" aria-busy="true" />;

  return (
    <div className="app">
      {/* Título de la página para lectores de pantalla y buscadores; la terminal ya lo deja claro a la vista */}
      <h1 className="sr-only">Simulador DEBUG 8086</h1>
      <StatePanel view={view} />
      <Terminal lines={view.lines} prompt={view.prompt} history={history} busy={busy} onSubmit={submit}>
        <AppInfo className="info--float" />
        <ResetButton disabled={empty} onReset={reset} />
      </Terminal>
    </div>
  );
}
