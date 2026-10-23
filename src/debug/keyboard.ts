import type { Key } from './state';

/**
 * Teclas para los programas que leen el teclado (INT 21 y INT 16). La interfaz manda cada tecla
 * como una línea: un carácter, '' para Enter, o el nombre de una tecla sin carácter entre llaves.
 * Así quedan en el registro de comandos y se repiten igual al recargar.
 */

/** Código de tecla del teclado estadounidense de DOSBox para cada carácter (sin Shift y con Shift). */
const SCAN_ROWS: [scan: number, keys: string][] = [
  [0x02, '1!'], [0x03, '2@'], [0x04, '3#'], [0x05, '4$'], [0x06, '5%'], [0x07, '6^'], [0x08, '7&'],
  [0x09, '8*'], [0x0a, '9('], [0x0b, '0)'], [0x0c, '-_'], [0x0d, '=+'],
  [0x10, 'qQ'], [0x11, 'wW'], [0x12, 'eE'], [0x13, 'rR'], [0x14, 'tT'], [0x15, 'yY'], [0x16, 'uU'],
  [0x17, 'iI'], [0x18, 'oO'], [0x19, 'pP'], [0x1a, '[{'], [0x1b, ']}'],
  [0x1e, 'aA'], [0x1f, 'sS'], [0x20, 'dD'], [0x21, 'fF'], [0x22, 'gG'], [0x23, 'hH'], [0x24, 'jJ'],
  [0x25, 'kK'], [0x26, 'lL'], [0x27, ';:'], [0x28, '\'"'], [0x29, '`~'], [0x2b, '\\|'],
  [0x2c, 'zZ'], [0x2d, 'xX'], [0x2e, 'cC'], [0x2f, 'vV'], [0x30, 'bB'], [0x31, 'nN'], [0x32, 'mM'],
  [0x33, ',<'], [0x34, '.>'], [0x35, '/?'], [0x39, ' '],
];

const SCAN = new Map<number, number>([
  ...SCAN_ROWS.flatMap(([scan, keys]) => [...keys].map((c): [number, number] => [c.charCodeAt(0), scan])),
  [0x08, 0x0e], // Backspace
  [0x09, 0x0f], // Tab
  [0x0d, 0x1c], // Enter
  [0x1b, 0x01], // Escape
]);

/** Teclas sin carácter: el BIOS las entrega con ASCII 00 y su código de tecla. */
export const NAMED_KEYS: Record<string, number> = {
  Home: 0x47, Up: 0x48, PgUp: 0x49, Left: 0x4b, Right: 0x4d, End: 0x4f, Down: 0x50, PgDn: 0x51, Ins: 0x52, Del: 0x53,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
};

/** Código de tecla de un carácter. Ctrl+letra (01 a 1A) es la tecla de la letra; lo que no está en el teclado, 00. */
function scanFor(ascii: number): number {
  if (ascii >= 0x01 && ascii <= 0x1a && !SCAN.has(ascii)) return SCAN.get(ascii + 0x60) ?? 0;
  return SCAN.get(ascii) ?? 0;
}

/** La tecla que representa una línea recibida mientras el programa espera teclado. */
export function keyFromLine(line: string): Key {
  if (line === '') return { ascii: 0x0d, scan: 0x1c };
  const named = /^\{(\w+)\}$/.exec(line);
  if (named && named[1] in NAMED_KEYS) return { ascii: 0, scan: NAMED_KEYS[named[1]] };
  const ascii = line.charCodeAt(0) & 0xff;
  return { ascii, scan: scanFor(ascii) };
}
