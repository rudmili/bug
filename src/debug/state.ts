/** Estado de la máquina 8086: registros, banderas y memoria. */

/** Registros generales en orden de codificación. */
export const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'] as const;
/** Mitades de 8 bits en orden de codificación. */
export const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'] as const;
/** Registros de segmento en orden de codificación. */
export const SREG = ['ES', 'CS', 'SS', 'DS'] as const;

export type Reg16Name = (typeof REG16)[number];
export type Reg8Name = (typeof REG8)[number];
export type SregName = (typeof SREG)[number];

export const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
export const ES = 0, CS = 1, SS = 2, DS = 3;

export interface Flags {
  CF: boolean;
  PF: boolean;
  AF: boolean;
  ZF: boolean;
  SF: boolean;
  TF: boolean;
  IF: boolean;
  DF: boolean;
  OF: boolean;
}

export type FlagName = keyof Flags;

/** Quién escribió en memoria: una instrucción (data), la pila (PUSH, CALL, INT), `a` (code) o `e` (edit). */
export type WriteKind = 'data' | 'stack' | 'code' | 'edit';

export interface WriteRecord {
  /** Dirección física. */
  addr: number;
  /** Valor anterior. */
  old: number;
  kind: WriteKind;
}

export const MEMORY_SIZE = 0x100000;

export interface Machine {
  /** AX CX DX BX SP BP SI DI */
  regs: Uint16Array;
  /** ES CS SS DS */
  sregs: Uint16Array;
  ip: number;
  flags: Flags;
  /** 1 MB de memoria física. Se accede con las funciones de memory.ts. */
  mem: Uint8Array;
  /** Escrituras desde la última vez que se vació. */
  writes: WriteRecord[];
}

export const INITIAL_SEGMENT = 0x0dab;

export function createMachine(): Machine {
  const sregs = new Uint16Array(4).fill(INITIAL_SEGMENT);
  const regs = new Uint16Array(8);
  regs[SP] = 0xfffe;
  return {
    regs,
    sregs,
    ip: 0x0100,
    flags: { CF: false, PF: false, AF: false, ZF: false, SF: true, TF: false, IF: true, DF: false, OF: false },
    mem: new Uint8Array(MEMORY_SIZE),
    writes: [],
  };
}

export function getReg8(m: Machine, index: number): number {
  const word = m.regs[index & 3];
  return index < 4 ? word & 0xff : word >> 8;
}

export function setReg8(m: Machine, index: number, value: number): void {
  const i = index & 3;
  value &= 0xff;
  m.regs[i] = index < 4 ? (m.regs[i] & 0xff00) | value : (m.regs[i] & 0x00ff) | (value << 8);
}

export function setFlags(m: Machine, changes: Partial<Flags>): void {
  Object.assign(m.flags, changes);
}

/** Copia de registros y banderas, para comparar después de un comando. */
export interface Snapshot {
  regs: Uint16Array;
  sregs: Uint16Array;
  ip: number;
  flags: Flags;
}

export function snapshot(m: Machine): Snapshot {
  return { regs: m.regs.slice(), sregs: m.sregs.slice(), ip: m.ip, flags: { ...m.flags } };
}
