import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Program } from './share';

/** Entradas que recorren las flechas ↑ ↓; las más viejas se descartan. */
export const MAX_HISTORY = 500;

/**
 * Lo que sobrevive a una recarga: las líneas que escribió el usuario, en orden.
 * El simulador es determinista, así que al abrir la página se vuelven a ejecutar y la memoria,
 * los registros y la terminal quedan exactamente como estaban. Ocupa poco más que el texto tecleado,
 * en lugar de guardar el megabyte de memoria de la máquina.
 */
interface CommandLogState {
  /** Líneas desde el último `q`, también las vacías (salen del modo ensamblado). Es lo que se vuelve a ejecutar. */
  log: string[];
  /** Líneas no vacías para las flechas, sin cortar en `q`. */
  history: string[];
  /** Hora en que arrancó la máquina de `log` (DebugView.clock): repetir `log` desde ella da la misma hora. */
  clock: string | null;
  /** La sesión informó su hora de arranque: la primera vez, tras `q` o al reiniciar. */
  setClock: (clock: string) => void;
  /** `remember: false` para las teclas que lee un programa: se guardan, pero no van a las flechas. */
  append: (line: string, remember?: boolean) => void;
  /** `q` dejó la máquina en el estado inicial: lo anterior ya no hace falta para reconstruirla. */
  restart: () => void;
  /** Un programa compartido o abierto de un archivo reemplaza la sesión; sus líneas se suman a las flechas. */
  load: (program: Program) => void;
  /** Botón "Reiniciar": olvida todo lo escrito. */
  clear: () => void;
}

export const useCommandLog = create<CommandLogState>()(
  persist(
    (set) => ({
      log: [],
      history: [],
      clock: null,
      setClock: (clock) => set({ clock }),
      append: (line, remember = true) =>
        set((s) => ({
          log: [...s.log, line],
          history: !remember || line.trim() === '' ? s.history : [...s.history, line].slice(-MAX_HISTORY),
        })),
      restart: () => set({ log: [] }),
      load: ({ lines, clock }) =>
        set((s) => ({
          log: lines,
          clock,
          history: [...s.history, ...lines.filter((line) => line.trim() !== '')].slice(-MAX_HISTORY),
        })),
      clear: () => set({ log: [], history: [], clock: null }),
    }),
    {
      name: 'debug8086-commands',
      version: 3,
      // v1 guardaba solo `log`, que también servía de historial; hasta v2 no había reloj
      migrate: (persisted, version) => {
        const { log = [] } = persisted as { log?: string[] };
        if (version < 2) return { log, history: log.filter((line) => line.trim() !== '').slice(-MAX_HISTORY), clock: null };
        return { clock: null, ...(persisted as object) } as Pick<CommandLogState, 'log' | 'history' | 'clock'>;
      },
      // localStorage puede no estar disponible (modo privado, almacenamiento bloqueado): entonces no persiste
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ log: s.log, history: s.history, clock: s.clock }),
    },
  ),
);
