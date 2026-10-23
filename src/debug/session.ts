import { createCommandState, promptFor, run } from './commands';
import type { CommandState, RunResult } from './commands';
import { bootMachine, clearWrites } from './memory';
import { snapshot } from './state';
import type { Machine } from './state';
import type { DebugSession, DebugView, MemoryTarget, MemoryWindowName, TerminalLine } from './types';
import { buildView, createViewState, moveWindow } from './view';
import type { ViewState } from './view';

/** Punto de entrada de la lógica: implementa el contrato que consume la interfaz. */

/** Líneas que se conservan en la terminal; un programa que imprime sin parar no debe llenar el DOM. */
export const MAX_LINES = 2000;

export function createDebugSession(): DebugSession {
  let machine: Machine;
  let commands: CommandState;
  let viewState: ViewState;
  let lines: TerminalLine[];
  let view: DebugView;
  // Los ids siguen creciendo después de q para que React no reutilice keys
  let nextId = 0;

  function reset(): void {
    machine = bootMachine();
    commands = createCommandState(machine);
    viewState = createViewState();
    lines = [];
    view = render(snapshot(machine), undefined);
  }

  /** `writes` por defecto: las del último comando. Sin escrituras, la vista conserva los resaltados que tenía. */
  function render(prev: ReturnType<typeof snapshot>, dataFocus: number | undefined, writes = machine.writes): DebugView {
    const built = buildView({
      machine,
      prev,
      writes,
      dataFocus,
      lines,
      prompt: promptFor(machine, commands),
      state: viewState,
    });
    viewState = built.state;
    return built.view;
  }

  reset();

  return {
    getView: () => view,
    submit(line: string): DebugView {
      const echo: TerminalLine = { id: nextId++, kind: 'command', text: promptFor(machine, commands) + line };
      const prev = snapshot(machine);
      clearWrites(machine);
      let result: RunResult;
      try {
        result = run(machine, commands, line);
      } catch (e) {
        // Un fallo del simulador no debe dejar la página en blanco: se avisa en la terminal y se sigue
        const message = e instanceof Error ? e.message : String(e);
        result = { output: [{ kind: 'error', text: `Error interno del simulador: ${message}` }] };
      }
      if (result.reset) {
        reset();
        view = { ...view, restarted: true };
        return view;
      }
      const added = result.output.map((o): TerminalLine => ({ id: nextId++, kind: o.kind, text: o.text }));
      // `clear` deja la terminal vacía (vuelve a verse la guía de comandos), sin el eco de la línea
      lines = result.clear ? [] : [...lines, echo, ...added].slice(-MAX_LINES);
      view = render(prev, result.dataFocus);
      return view;
    },
    moveWindow(window: MemoryWindowName, to: MemoryTarget): DebugView | null {
      const moved = moveWindow(machine, viewState, window, to);
      if (!moved) return null;
      viewState = moved;
      // Nada cambió en la máquina: sin escrituras ni diferencias, los resaltados del último comando siguen
      view = render(snapshot(machine), undefined, []);
      return view;
    },
  };
}
