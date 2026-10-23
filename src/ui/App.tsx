import { useEffect, useState } from 'react';
import './tokens.css';
import './debug-ui.css';
import type { DebugView } from '../debug/types';
import type { SessionClient } from './client';
import { ConfirmDialog } from './ConfirmDialog';
import { Terminal } from './Terminal';
import { StatePanel } from './StatePanel';
import { AppInfo } from './AppInfo';
import { Tools } from './Tools';
import { sessionText, shareUrl } from './share';
import { useCommandLog } from './store';

/** Lo que espera confirmación porque borra la sesión actual. */
type Pending = { kind: 'reset' } | { kind: 'load'; lines: string[]; from: 'link' | 'file' };

/** Textos del diálogo según qué se confirma. */
const CONFIRM: Record<'reset' | 'link' | 'file', { title: string; detail: string; confirmLabel: string }> = {
  reset: {
    title: '¿Reiniciar la máquina?',
    detail: 'Se borran la memoria, los registros y los comandos guardados.',
    confirmLabel: 'Reiniciar',
  },
  link: {
    title: '¿Abrir el programa compartido?',
    detail: 'Reemplaza la sesión actual: la memoria, los registros y los comandos guardados.',
    confirmLabel: 'Abrir',
  },
  file: {
    title: '¿Abrir el archivo?',
    detail: 'Reemplaza la sesión actual: la memoria, los registros y los comandos guardados.',
    confirmLabel: 'Abrir',
  },
};

/** Cuánto se ve el aviso de "Enlace copiado". */
const STATUS_MS = 2500;

interface AppProps {
  /**
   * La sesión ya creada:
   *   - con la lógica real, en un worker:   createWorkerClient()
   *   - para ver el diseño:                 createLocalClient(createMockSession)   (mock.ts)
   */
  client: SessionClient;
  /** Programa recibido en un enlace (#p=…) que espera confirmación porque ya había una sesión guardada. */
  shared?: string[] | null;
}

export function App({ client, shared = null }: AppProps) {
  const history = useCommandLog((s) => s.history);
  const hasProgram = useCommandLog((s) => s.log.length > 0);
  const empty = useCommandLog((s) => s.log.length === 0 && s.history.length === 0);
  const [view, setView] = useState<DebugView | null>(null);
  // Un comando a la vez: mientras corre (un `g` largo) la línea queda en solo lectura
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState('');
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
        if (shared) setPending({ kind: 'load', lines: shared, from: 'link' });
      },
      (error: unknown) => current && setFailure(error),
    );
    return () => {
      current = false;
    };
  }, [client, shared]);

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

  function load(lines: string[]) {
    useCommandLog.getState().load(lines);
    return run(() => client.start(lines));
  }

  function confirm(confirmed: boolean) {
    const action = pending;
    setPending(null);
    if (!confirmed || !action) return;
    if (action.kind === 'reset') {
      useCommandLog.getState().clear();
      void run(() => client.reset());
    } else {
      void load(action.lines);
    }
  }

  function notify(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus((current) => (current === message ? '' : current)), STATUS_MS);
  }

  async function share() {
    const url = shareUrl(`${location.origin}${location.pathname}`, useCommandLog.getState().log);
    try {
      // En el móvil, el menú de compartir del sistema; en el escritorio, al portapapeles
      if (navigator.share) {
        await navigator.share({ title: 'Programa para DEBUG 8086', url });
      } else {
        await navigator.clipboard.writeText(url);
        notify('Enlace copiado');
      }
    } catch (error) {
      // Cerrar el menú de compartir no es un error
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('No se pudo copiar el enlace');
    }
  }

  function save() {
    const blob = new Blob([sessionText(useCommandLog.getState().log)], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'debug-8086.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function open(lines: string[]) {
    if (useCommandLog.getState().log.length === 0) void load(lines);
    else setPending({ kind: 'load', lines, from: 'file' });
  }

  // El primer arranque tarda lo que el worker en cargar: la página queda con el fondo de la terminal
  if (!view) return <div className="app" aria-busy="true" />;

  const dialog = CONFIRM[pending?.kind === 'load' ? pending.from : 'reset'];

  return (
    <div className="app">
      {/* Título de la página para lectores de pantalla y buscadores; la terminal ya lo deja claro a la vista */}
      <h1 className="sr-only">Simulador DEBUG 8086</h1>
      <StatePanel view={view} />
      <Terminal lines={view.lines} prompt={view.prompt} history={history} busy={busy} onSubmit={submit}>
        <AppInfo className="info--float" />
        <Tools
          hasProgram={hasProgram}
          canReset={!empty}
          status={status}
          onShare={share}
          onSave={save}
          onOpen={open}
          onReset={() => setPending({ kind: 'reset' })}
        />
      </Terminal>
      <ConfirmDialog open={pending !== null} onClose={confirm} {...dialog} />
    </div>
  );
}
