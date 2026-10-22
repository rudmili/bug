import { INITIAL_SEGMENT, MEMORY_SIZE, createMachine } from './state';
import type { Machine, WriteKind } from './state';

/** Dirección física: segmento * 16 + desplazamiento, con el desplazamiento dando la vuelta en 16 bits. */
export function phys(seg: number, off: number): number {
  return ((seg & 0xffff) * 16 + (off & 0xffff)) % MEMORY_SIZE;
}

export function readByte(m: Machine, seg: number, off: number): number {
  return m.mem[phys(seg, off)];
}

export function readWord(m: Machine, seg: number, off: number): number {
  return readByte(m, seg, off) | (readByte(m, seg, off + 1) << 8);
}

export function writeByte(m: Machine, seg: number, off: number, value: number, kind: WriteKind = 'data'): void {
  const addr = phys(seg, off);
  m.writes.push({ addr, old: m.mem[addr], kind });
  m.mem[addr] = value & 0xff;
}

export function writeWord(m: Machine, seg: number, off: number, value: number, kind: WriteKind = 'data'): void {
  writeByte(m, seg, off, value, kind);
  writeByte(m, seg, off + 1, value >> 8, kind);
}

export function clearWrites(m: Machine): void {
  m.writes = [];
}

/**
 * Contenido inicial del segmento de DEBUG, copiado de `d 0 ff` y `d 100 17f` en DOSBox, como
 * [desplazamiento, bytes]. El resto de la memoria está en cero.
 */
const BOOT_MEMORY: [offset: number, bytes: string][] = [
  // PSP: INT 20, tope de memoria, vectores guardados, tabla de archivos, versión de DOS 5.00, INT 21 + RETF,
  // dos FCB vacíos (unidad 0 y nombre en blanco) y la línea de comandos vacía en 0080
  [0x0000, 'CD 20 3E A7 00 EA FD FF AD DE 4F 03 A3 01 8A 03'],
  [0x0010, 'A3 01 17 03 A3 01 92 01 01 01 01 00 02 FF FF FF'],
  [0x0020, 'FF FF FF FF FF FF FF FF FF FF FF FF'],
  [0x0032, '14 00 18 00 3F 07 FF FF FF FF'],
  [0x0040, '05'],
  [0x0050, 'CD 21 CB'],
  [0x005d, '20 20 20 20 20 20 20 20 20 20 20'],
  [0x006d, '20 20 20 20 20 20 20 20 20 20 20'],
  [0x0081, '0D'],
  // Restos que deja DOS después del programa
  [0x011c, '34 00 2E 07'],
];

/** Máquina inicial: el PSP en 073F:0000 y ceros desde 0100, salvo los restos de DOS. */
export function bootMachine(): Machine {
  const m = createMachine();
  for (const [offset, bytes] of BOOT_MEMORY) {
    bytes.split(' ').forEach((b, i) => {
      m.mem[phys(INITIAL_SEGMENT, offset + i)] = parseInt(b, 16);
    });
  }
  return m;
}
