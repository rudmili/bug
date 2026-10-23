import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  append: (line: string) => void;
  /** `q` dejó la máquina en el estado inicial: lo anterior ya no hace falta para reconstruirla. */
  restart: () => void;
  /** Un programa compartido o abierto de un archivo reemplaza la sesión; sus líneas se suman a las flechas. */
  load: (lines: string[]) => void;
  /** Botón "Reiniciar": olvida todo lo escrito. */
  clear: () => void;
}

export const useCommandLog = create<CommandLogState>()(
  persist(
    (set) => ({
      log: [],
      history: [],
      append: (line) =>
        set((s) => ({
          log: [...s.log, line],
          history: line.trim() === '' ? s.history : [...s.history, line].slice(-MAX_HISTORY),
        })),
      restart: () => set({ log: [] }),
      load: (lines) =>
        set((s) => ({
          log: lines,
          history: [...s.history, ...lines.filter((line) => line.trim() !== '')].slice(-MAX_HISTORY),
        })),
      clear: () => set({ log: [], history: [] }),
    }),
    {
      name: 'debug8086-commands',
      version: 2,
      // v1 guardaba solo `log`, que también servía de historial
      migrate: (persisted, version) => {
        const { log = [] } = persisted as { log?: string[] };
        if (version < 2) return { log, history: log.filter((line) => line.trim() !== '').slice(-MAX_HISTORY) };
        return persisted as Pick<CommandLogState, 'log' | 'history'>;
      },
      // localStorage puede no estar disponible (modo privado, almacenamiento bloqueado): entonces no persiste
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ log: s.log, history: s.history }),
    },
  ),
);
