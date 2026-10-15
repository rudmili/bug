import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Lo que sobrevive a una recarga: las líneas que escribió el usuario, en orden.
 * El simulador es determinista, así que al abrir la página se vuelven a ejecutar y la memoria,
 * los registros y la terminal quedan exactamente como estaban. Ocupa poco más que el texto tecleado,
 * en lugar de guardar el megabyte de memoria de la máquina.
 */
interface CommandLogState {
  /** Todas las líneas enviadas, también las vacías (salen del modo ensamblado). */
  log: string[];
  append: (line: string) => void;
  /** Botón "Reiniciar": olvida todo lo escrito. */
  clear: () => void;
}

export const useCommandLog = create<CommandLogState>()(
  persist(
    (set) => ({
      log: [],
      append: (line) => set((s) => ({ log: [...s.log, line] })),
      clear: () => set({ log: [] }),
    }),
    {
      name: 'debug8086-commands',
      version: 1,
      // localStorage puede no estar disponible (modo privado, almacenamiento bloqueado): entonces no persiste
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ log: s.log }),
    },
  ),
);
