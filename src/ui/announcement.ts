import type { TerminalLine } from '../debug/types';

/** Respuestas de hasta estas líneas se leen enteras; las más largas, resumidas. */
const MAX_SPOKEN = 4;

/**
 * Lo que anuncia el lector de pantalla después de cada comando. Toda la salida en una región viva
 * leería cientos de líneas tras un `g`; así se lee la respuesta corta, o cuántas líneas hay y la última.
 */
export function announcement(lines: TerminalLine[]): string {
  let start = lines.length;
  while (start > 0 && lines[start - 1].kind !== 'command') start--;
  // "^ Error" solo tiene sentido a la vista, debajo de la columna
  const answer = lines.slice(start).map((l) => (l.kind === 'error' && l.text.trim() === '^ Error' ? 'Error' : l.text.trim()));
  if (answer.length <= MAX_SPOKEN) return answer.join('. ');
  return `${answer.length} líneas. La última: ${answer[answer.length - 1]}`;
}
