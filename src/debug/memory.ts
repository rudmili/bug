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

/** Máquina inicial con INT 20 en 0DAB:0000 y RET en 0DAB:0100. */
export function bootMachine(): Machine {
  const m = createMachine();
  m.mem[phys(INITIAL_SEGMENT, 0x0000)] = 0xcd;
  m.mem[phys(INITIAL_SEGMENT, 0x0001)] = 0x20;
  m.mem[phys(INITIAL_SEGMENT, 0x0100)] = 0xc3;
  return m;
}
