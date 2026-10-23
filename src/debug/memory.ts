import { hostClock, startClock } from './clock';
import type { DateTime } from './clock';
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

// ---------------------------------------------------------------- Interrupciones

/** Manejador vacío de DOSBox (solo IRET): el destino de casi todos los vectores. */
const DEFAULT_HANDLER = 'F000:1060';

/**
 * Tabla de vectores de DOSBox, copiada de `d 0:0 l 400`. Los vectores 00h a 77h que no figuran
 * apuntan a DEFAULT_HANDLER; los que figuran como null y todos desde 78h valen 0000:0000.
 */
const VECTORS: Record<number, string | null> = {
  0x01: '0070:0008', 0x02: '0070:0008', 0x03: '0070:0008', 0x04: '0070:0008',
  // BIOS
  0x08: 'F000:FEA5', 0x09: 'F000:E987', 0x0a: 'F000:FF55', 0x0e: 'F000:1080',
  0x10: 'F000:1300', 0x11: 'F000:1100', 0x12: 'F000:1120', 0x13: 'F000:1140',
  0x14: 'F000:11A0', 0x15: 'F000:11C0', 0x16: 'F000:11E0', 0x17: 'F000:1220',
  0x18: 'F000:12C0', 0x19: 'F000:12C0', 0x1a: 'F000:1240', 0x1c: 'F000:1260',
  0x1d: 'F000:F0A4', 0x1f: 'C000:0500',
  // DOS; 22h a 24h son los manejadores del propio DEBUG (fin de programa, Ctrl+C y error crítico)
  0x20: 'F000:1480', 0x21: 'F000:14A0', 0x22: '01A3:034F', 0x23: '01A3:038A', 0x24: '01A3:0317',
  0x25: 'F000:14C0', 0x26: 'F000:14E0', 0x27: 'F000:1500', 0x28: 'F000:1520', 0x29: 'F000:1540',
  0x2a: 'F000:15C0', 0x2f: 'F000:15A0',
  // Drivers del mouse y de memoria expandida, y tablas de la placa de video
  0x33: 'C7FF:0010', 0x41: 'F000:1160', 0x43: 'C000:1700', 0x46: 'F000:1180', 0x4b: 'F000:1600',
  0x60: null, 0x61: null, 0x62: null, 0x63: null, 0x64: null, 0x65: null, 0x67: 'CB41:0004',
  0x70: 'F000:1280', 0x71: 'F000:12A0', 0x72: null, 0x73: null,
  0x74: 'F000:1420', 0x75: null, 0x76: null, 0x77: null,
};

/** Destino de cada vector al arrancar, como [segmento, desplazamiento]. */
export const BOOT_VECTORS: readonly (readonly [seg: number, off: number])[] = Array.from({ length: 256 }, (_, n) => {
  const text = n in VECTORS ? VECTORS[n] : n < 0x78 ? DEFAULT_HANDLER : null;
  if (text === null) return [0, 0] as const;
  const [seg, off] = text.split(':').map((part) => parseInt(part, 16));
  return [seg, off] as const;
});

/** Servicios del simulador que no tienen número en DOSBox: los de DEBUG para 22h, 23h y 24h. */
export const SERVICE_TERMINATE = 0x80;
export const SERVICE_CTRL_C = 0x81;
export const SERVICE_CRITICAL = 0x82;

/**
 * Código de los manejadores. DOSBox resuelve sus servicios con la instrucción FE 38 nnnn, que llama
 * al emulador con el servicio nnnn; el manejador del servicio n está en F000:1000 + n * 20h.
 * Los de F000:1xxx se arman solos; acá van los que tienen otra forma, copiados de `u` en DOSBox.
 */
const HANDLER_CODE: Record<string, string> = {
  // INT 21h: habilita las interrupciones, llama al servicio 25h y vuelve
  'F000:14A0': 'FB FE 38 25 00 CF CB 51',
  // Fuera de F000:1xxx: rutinas del BIOS, de DOS y de drivers. Basta con que vuelvan
  'F000:FEA5': 'CF', 'F000:E987': 'CF', 'F000:FF55': 'CF', 'F000:F0A4': 'CF',
  '0070:0008': 'CF', 'C7FF:0010': 'CF', 'CB41:0004': 'CF',
  // DEBUG: en la máquina real son rutinas suyas; acá, servicios del simulador
  '01A3:034F': `FE 38 ${SERVICE_TERMINATE.toString(16)} 00 CF`,
  '01A3:038A': `FE 38 ${SERVICE_CTRL_C.toString(16)} 00 CF`,
  '01A3:0317': `FE 38 ${SERVICE_CRITICAL.toString(16)} 00 CF`,
};

/** Las tablas de letras (1Fh y 43h) son datos, no código. */
const DATA_VECTORS = new Set([0x1f, 0x43]);

function writeBytes(m: Machine, seg: number, off: number, bytes: string): void {
  bytes.split(' ').forEach((b, i) => {
    m.mem[phys(seg, off + i)] = parseInt(b, 16);
  });
}

/** Segmento y desplazamiento al que apunta ahora el vector n. */
export function readVector(m: Machine, n: number): { seg: number; off: number } {
  return { off: readWord(m, 0, n * 4), seg: readWord(m, 0, n * 4 + 2) };
}

/** El vector sigue apuntando a donde apuntaba al arrancar: nadie instaló un manejador propio. */
export function isBootVector(m: Machine, n: number): boolean {
  const { seg, off } = readVector(m, n);
  return seg === BOOT_VECTORS[n][0] && off === BOOT_VECTORS[n][1];
}

// ---------------------------------------------------------------- Arranque

/**
 * Máquina inicial: la tabla de vectores y sus manejadores, el PSP en 073F:0000 y ceros desde 0100, salvo
 * los restos de DOS. El reloj arranca en `start`, como DOSBox con la hora de la PC.
 */
export function bootMachine(start: DateTime = hostClock()): Machine {
  const m = createMachine();
  startClock(m, start);
  BOOT_VECTORS.forEach(([seg, off], n) => {
    const at = phys(0, n * 4);
    m.mem.set([off & 0xff, off >> 8, seg & 0xff, seg >> 8], at);
    if ((seg === 0 && off === 0) || DATA_VECTORS.has(n)) return;
    const key = `${seg.toString(16).toUpperCase().padStart(4, '0')}:${off.toString(16).toUpperCase().padStart(4, '0')}`;
    const service = (off - 0x1000) / 0x20;
    writeBytes(m, seg, off, HANDLER_CODE[key] ?? `FE 38 ${service.toString(16)} 00 CF`);
  });
  for (const [offset, bytes] of BOOT_MEMORY) writeBytes(m, INITIAL_SEGMENT, offset, bytes);
  return m;
}
