import type { RegisterName } from './types';

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

/** Quién escribió en memoria: una instrucción (data), la pila (PUSH, CALL, INT), `a` (code), `e` (edit) o un servicio de DOS (system). */
export type WriteKind = 'data' | 'stack' | 'code' | 'edit' | 'system';

export interface WriteRecord {
  /** Dirección física. */
  addr: number;
  /** Valor anterior. */
  old: number;
  kind: WriteKind;
}

export const MEMORY_SIZE = 0x100000;

/** Una tecla como la entrega el BIOS: código ASCII (0 en las teclas extendidas) y código de tecla. */
export interface Key {
  ascii: number;
  scan: number;
}

/** El teclado: lo que el programa todavía no leyó y el estado de las lecturas en curso. */
export interface Keyboard {
  /** Teclas pulsadas que el programa todavía no leyó. */
  keys: Key[];
  /** Código de tecla pendiente: DOS entrega una tecla extendida en dos lecturas, primero 00 y después el código. */
  pendingScan: number | null;
  /** Caracteres ya escritos en el buffer de INT 21 AH=0A, mientras se edita la línea; null si no hay ninguna en curso. */
  lineLength: number | null;
  /** Consultas seguidas sin tecla (AH=0B, AH=06, INT 16 AH=01): muchas pausan la ejecución a esperar una. */
  emptyPolls: number;
  /** AH=0C ya vació el buffer: al reanudar tras esperar una tecla no lo vuelve a vaciar. */
  flushed: boolean;
}

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
  keyboard: Keyboard;
}

/** Segmento donde DOS carga a DEBUG en DOSBox (CS, DS, SS y ES). */
export const INITIAL_SEGMENT = 0x073f;
/** SP inicial: DEBUG deja la pila dentro del PSP, debajo del programa. */
export const INITIAL_SP = 0x00fd;

export function createMachine(): Machine {
  const sregs = new Uint16Array(4).fill(INITIAL_SEGMENT);
  const regs = new Uint16Array(8);
  regs[SP] = INITIAL_SP;
  return {
    regs,
    sregs,
    ip: 0x0100,
    flags: { CF: false, PF: false, AF: false, ZF: false, SF: false, TF: false, IF: true, DF: false, OF: false },
    mem: new Uint8Array(MEMORY_SIZE),
    writes: [],
    keyboard: { keys: [], pendingScan: null, lineLength: null, emptyPolls: 0, flushed: false },
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

/** Los trece registros que se nombran en `r`, en el orden en que los muestra el panel. */
export const REGISTER_NAMES: readonly RegisterName[] = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'DS', 'ES', 'SS', 'CS', 'IP'];

export function isRegisterName(name: string): name is RegisterName {
  return (REGISTER_NAMES as readonly string[]).includes(name);
}

/** Valor de un registro por su nombre, en la máquina o en una copia. */
export function readRegister(s: Pick<Snapshot, 'regs' | 'sregs' | 'ip'>, name: RegisterName): number {
  if (name === 'IP') return s.ip;
  const r = (REG16 as readonly string[]).indexOf(name);
  return r >= 0 ? s.regs[r] : s.sregs[(SREG as readonly string[]).indexOf(name)];
}

export function writeRegister(m: Machine, name: RegisterName, value: number): void {
  if (name === 'IP') {
    m.ip = value;
    return;
  }
  const r = (REG16 as readonly string[]).indexOf(name);
  if (r >= 0) m.regs[r] = value;
  else m.sregs[(SREG as readonly string[]).indexOf(name)] = value;
}
