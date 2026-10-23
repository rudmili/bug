import { decode } from './decoder';
import type { Instr, MemOperand, Operand } from './decoder';
import {
  addFlags,
  decFlags,
  incFlags,
  logicFlags,
  mask,
  mulFlags,
  resultFlags,
  rotateFlags,
  shiftFlags,
  signBit,
  subFlags,
} from './flags';
import type { RotateKind, ShiftKind, Size } from './flags';
import { toSigned16, toSigned8 } from './hex';
import { readByte, readWord, writeByte, writeWord } from './memory';
import { AX, BP, BX, CS, CX, DI, DS, DX, ES, SI, SP, SS, getReg8, setFlags, setReg8 } from './state';
import type { Machine } from './state';

/**
 * Ejecución de una instrucción. No conoce DOS: ante una interrupción devuelve un aviso y quien
 * llama (commands) decide si la atiende DEBUG o si la despacha por la tabla con raiseInterrupt.
 */
export type StepResult =
  | { kind: 'ok' }
  /** INT n, INT 3, INTO con OF, o interrupción 0 por división. IP ya apunta a la siguiente instrucción. */
  | { kind: 'int'; n: number }
  /** FE 38 nnnn: un manejador pide el servicio nnnn del simulador (como en DOSBox). IP ya apunta a la siguiente. */
  | { kind: 'service'; id: number }
  | { kind: 'halt' }
  /** Opcode no definido: IP no se mueve. */
  | { kind: 'undefined'; byte: number };

/** Desplazamiento efectivo de un operando de memoria. */
export function effectiveOffset(m: Machine, op: MemOperand): number {
  if (op.rm === null) return op.disp;
  const r = m.regs;
  const bases = [
    r[BX] + r[SI], r[BX] + r[DI], r[BP] + r[SI], r[BP] + r[DI],
    r[SI], r[DI], r[BP], r[BX],
  ];
  return (bases[op.rm] + op.disp) & 0xffff;
}

// ---------------------------------------------------------------- Pila

export function push(m: Machine, value: number): void {
  m.regs[SP] = (m.regs[SP] - 2) & 0xffff;
  writeWord(m, m.sregs[SS], m.regs[SP], value, 'stack');
}

export function pop(m: Machine): number {
  const value = readWord(m, m.sregs[SS], m.regs[SP]);
  m.regs[SP] = (m.regs[SP] + 2) & 0xffff;
  return value;
}

// ---------------------------------------------------------------- Operandos

function opSize(op: Operand): Size {
  if (op.kind === 'reg' || op.kind === 'imm') return op.size;
  if (op.kind === 'mem') return op.size === 8 ? 8 : 16;
  return 16;
}

function read(m: Machine, op: Operand): number {
  switch (op.kind) {
    case 'reg':
      return op.size === 8 ? getReg8(m, op.index) : m.regs[op.index];
    case 'sreg':
      return m.sregs[op.index];
    case 'imm':
    case 'const':
      return op.value;
    case 'mem': {
      const off = effectiveOffset(m, op);
      return op.size === 8 ? readByte(m, m.sregs[op.seg], off) : readWord(m, m.sregs[op.seg], off);
    }
    case 'rel':
      return op.target;
    case 'far':
      return op.off;
  }
}

function write(m: Machine, op: Operand, value: number): void {
  switch (op.kind) {
    case 'reg':
      if (op.size === 8) setReg8(m, op.index, value);
      else m.regs[op.index] = value;
      return;
    case 'sreg':
      m.sregs[op.index] = value;
      return;
    case 'mem': {
      const off = effectiveOffset(m, op);
      if (op.size === 8) writeByte(m, m.sregs[op.seg], off, value);
      else writeWord(m, m.sregs[op.seg], off, value);
      return;
    }
    default:
      throw new Error(`Operando de solo lectura: ${op.kind}`);
  }
}

// ---------------------------------------------------------------- Instrucciones

const JCC: Record<string, (m: Machine) => boolean> = {
  JO: (m) => m.flags.OF,
  JNO: (m) => !m.flags.OF,
  JB: (m) => m.flags.CF,
  JNB: (m) => !m.flags.CF,
  JZ: (m) => m.flags.ZF,
  JNZ: (m) => !m.flags.ZF,
  JBE: (m) => m.flags.CF || m.flags.ZF,
  JA: (m) => !m.flags.CF && !m.flags.ZF,
  JS: (m) => m.flags.SF,
  JNS: (m) => !m.flags.SF,
  JPE: (m) => m.flags.PF,
  JPO: (m) => !m.flags.PF,
  JL: (m) => m.flags.SF !== m.flags.OF,
  JGE: (m) => m.flags.SF === m.flags.OF,
  JLE: (m) => m.flags.ZF || m.flags.SF !== m.flags.OF,
  JG: (m) => !m.flags.ZF && m.flags.SF === m.flags.OF,
};

function flagsWord(m: Machine): number {
  const f = m.flags;
  return (
    0xf002 |
    (f.CF ? 0x0001 : 0) | (f.PF ? 0x0004 : 0) | (f.AF ? 0x0010 : 0) | (f.ZF ? 0x0040 : 0) |
    (f.SF ? 0x0080 : 0) | (f.TF ? 0x0100 : 0) | (f.IF ? 0x0200 : 0) | (f.DF ? 0x0400 : 0) | (f.OF ? 0x0800 : 0)
  );
}

/** Interrupción como en el 8086: apila FLAGS, CS e IP, apaga IF y TF, y salta al vector de 0000:n*4. */
export function raiseInterrupt(m: Machine, n: number): void {
  push(m, flagsWord(m));
  push(m, m.sregs[CS]);
  push(m, m.ip);
  setFlags(m, { IF: false, TF: false });
  m.ip = readWord(m, 0, n * 4);
  m.sregs[CS] = readWord(m, 0, n * 4 + 2);
}

/** IRET: vuelve de una interrupción. */
export function returnFromInterrupt(m: Machine): void {
  m.ip = pop(m);
  m.sregs[CS] = pop(m);
  setFlagsWord(m, pop(m));
}

function setFlagsWord(m: Machine, w: number): void {
  setFlags(m, {
    CF: (w & 0x0001) !== 0, PF: (w & 0x0004) !== 0, AF: (w & 0x0010) !== 0, ZF: (w & 0x0040) !== 0,
    SF: (w & 0x0080) !== 0, TF: (w & 0x0100) !== 0, IF: (w & 0x0200) !== 0, DF: (w & 0x0400) !== 0,
    OF: (w & 0x0800) !== 0,
  });
}

function arith(m: Machine, mnem: string, dst: Operand, src: Operand): void {
  const size = opSize(dst);
  const a = read(m, dst);
  const b = read(m, src) & mask(size);
  const carry = m.flags.CF ? 1 : 0;
  let result: number;
  switch (mnem) {
    case 'ADD':
    case 'ADC': {
      const raw = a + b + (mnem === 'ADC' ? carry : 0);
      setFlags(m, addFlags(a, b, raw, size));
      result = raw;
      break;
    }
    case 'SUB':
    case 'SBB':
    case 'CMP': {
      const raw = a - b - (mnem === 'SBB' ? carry : 0);
      setFlags(m, subFlags(a, b, raw, size));
      if (mnem === 'CMP') return;
      result = raw;
      break;
    }
    case 'AND':
    case 'TEST':
      result = a & b;
      setFlags(m, logicFlags(result, size));
      if (mnem === 'TEST') return;
      break;
    case 'OR':
      result = a | b;
      setFlags(m, logicFlags(result, size));
      break;
    default: // XOR
      result = a ^ b;
      setFlags(m, logicFlags(result, size));
      break;
  }
  write(m, dst, result & mask(size));
}

function shift(m: Machine, mnem: string, dst: Operand, countOp: Operand): void {
  const size = opSize(dst);
  const count = read(m, countOp) & 0xff;
  if (count === 0) return;
  const msk = mask(size);
  const sign = signBit(size);
  const original = read(m, dst);
  let value = original;
  let cf = m.flags.CF;
  for (let i = 0; i < count; i++) {
    switch (mnem) {
      case 'SHL':
        cf = (value & sign) !== 0;
        value = (value << 1) & msk;
        break;
      case 'SHR':
        cf = (value & 1) !== 0;
        value >>= 1;
        break;
      case 'SAR':
        cf = (value & 1) !== 0;
        value = (value >> 1) | (value & sign);
        break;
      case 'ROL':
        cf = (value & sign) !== 0;
        value = ((value << 1) | (cf ? 1 : 0)) & msk;
        break;
      case 'ROR':
        cf = (value & 1) !== 0;
        value = (value >> 1) | (cf ? sign : 0);
        break;
      case 'RCL': {
        const out = (value & sign) !== 0;
        value = ((value << 1) | (cf ? 1 : 0)) & msk;
        cf = out;
        break;
      }
      case 'RCR': {
        const out = (value & 1) !== 0;
        value = (value >> 1) | (cf ? sign : 0);
        cf = out;
        break;
      }
    }
  }
  if (mnem === 'SHL' || mnem === 'SHR' || mnem === 'SAR') {
    setFlags(m, shiftFlags(mnem as ShiftKind, original, value, cf, size));
  } else {
    setFlags(m, rotateFlags(mnem as RotateKind, value, cf, size));
  }
  write(m, dst, value);
}

/** MUL, IMUL, DIV, IDIV. Devuelve false si la división falla (interrupción 0). */
function mulDiv(m: Machine, mnem: string, src: Operand): boolean {
  const size = opSize(src);
  const b = read(m, src);
  if (mnem === 'MUL' || mnem === 'IMUL') {
    const signed = mnem === 'IMUL';
    if (size === 8) {
      const al = getReg8(m, 0);
      const r = signed ? toSigned8(al) * toSigned8(b) : al * b;
      m.regs[AX] = r & 0xffff;
      setFlags(m, mulFlags(signed, (r >> 8) & 0xff, r & 0xff, 8));
    } else {
      const ax = m.regs[AX];
      const r = signed ? BigInt(toSigned16(ax)) * BigInt(toSigned16(b)) : BigInt(ax) * BigInt(b);
      const u = Number(BigInt.asUintN(32, r));
      m.regs[AX] = u & 0xffff;
      m.regs[DX] = u >>> 16;
      setFlags(m, mulFlags(signed, u >>> 16, u & 0xffff, 16));
    }
    return true;
  }

  if (b === 0) return false;
  const signed = mnem === 'IDIV';
  if (size === 8) {
    const ax = m.regs[AX];
    const dividend = signed ? toSigned16(ax) : ax;
    const divisor = signed ? toSigned8(b) : b;
    const q = Math.trunc(dividend / divisor);
    const r = dividend - q * divisor;
    if (signed ? q < -128 || q > 127 : q > 0xff) return false;
    setReg8(m, 0, q);
    setReg8(m, 4, r);
  } else {
    const u = ((m.regs[DX] << 16) | m.regs[AX]) >>> 0;
    const dividend = signed ? u | 0 : u;
    const divisor = signed ? toSigned16(b) : b;
    const q = Math.trunc(dividend / divisor);
    const r = dividend - q * divisor;
    if (signed ? q < -32768 || q > 32767 : q > 0xffff) return false;
    m.regs[AX] = q & 0xffff;
    m.regs[DX] = r & 0xffff;
  }
  return true;
}

function stringOp(m: Machine, mnem: string, segOverride: number | null): void {
  const size: Size = mnem.endsWith('B') ? 8 : 16;
  const delta = (m.flags.DF ? -1 : 1) * (size === 8 ? 1 : 2);
  const srcSeg = m.sregs[segOverride ?? DS];
  const es = m.sregs[ES];
  const rd = (seg: number, off: number) => (size === 8 ? readByte(m, seg, off) : readWord(m, seg, off));
  const wr = (seg: number, off: number, v: number) => (size === 8 ? writeByte(m, seg, off, v) : writeWord(m, seg, off, v));
  const acc = size === 8 ? getReg8(m, 0) : m.regs[AX];
  const base = mnem.slice(0, -1);
  switch (base) {
    case 'MOVS':
      wr(es, m.regs[DI], rd(srcSeg, m.regs[SI]));
      break;
    case 'CMPS': {
      const a = rd(srcSeg, m.regs[SI]);
      const b = rd(es, m.regs[DI]);
      setFlags(m, subFlags(a, b, a - b, size));
      break;
    }
    case 'STOS':
      wr(es, m.regs[DI], acc);
      break;
    case 'LODS': {
      const v = rd(srcSeg, m.regs[SI]);
      if (size === 8) setReg8(m, 0, v);
      else m.regs[AX] = v;
      break;
    }
    case 'SCAS': {
      const b = rd(es, m.regs[DI]);
      setFlags(m, subFlags(acc, b, acc - b, size));
      break;
    }
  }
  if (base === 'MOVS' || base === 'CMPS' || base === 'LODS') m.regs[SI] = (m.regs[SI] + delta) & 0xffff;
  if (base !== 'LODS') m.regs[DI] = (m.regs[DI] + delta) & 0xffff;
}

function farMem(m: Machine, op: Operand): { off: number; seg: number } {
  const mem = op as MemOperand;
  const off = effectiveOffset(m, mem);
  const seg = m.sregs[mem.seg];
  return { off: readWord(m, seg, off), seg: readWord(m, seg, off + 2) };
}

const STRING_OPS = new Set(['MOVSB', 'MOVSW', 'CMPSB', 'CMPSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW', 'SCASB', 'SCASW']);

/**
 * Ejecuta una instrucción ya decodificada. IP ya apunta a la siguiente.
 * `rep`: prefijo REPZ/REPNZ previo, para las instrucciones de cadena.
 */
function execute(m: Machine, instr: Instr, rep: string | null, segOverride: number | null): StepResult {
  const [a, b] = instr.operands;
  const mnem = instr.mnem;

  if (STRING_OPS.has(mnem)) {
    if (rep === null) {
      stringOp(m, mnem, segOverride);
      return { kind: 'ok' };
    }
    const compares = mnem.startsWith('CMPS') || mnem.startsWith('SCAS');
    while (m.regs[CX] !== 0) {
      stringOp(m, mnem, segOverride);
      m.regs[CX] = (m.regs[CX] - 1) & 0xffff;
      if (compares && (rep === 'REPZ' ? !m.flags.ZF : m.flags.ZF)) break;
    }
    return { kind: 'ok' };
  }

  if (mnem in JCC) {
    if (JCC[mnem](m)) m.ip = read(m, a);
    return { kind: 'ok' };
  }

  switch (mnem) {
    case 'MOV':
      write(m, a, read(m, b));
      break;
    case 'ADD': case 'ADC': case 'SUB': case 'SBB': case 'CMP':
    case 'AND': case 'OR': case 'XOR': case 'TEST':
      arith(m, mnem, a, b);
      break;
    case 'INC':
    case 'DEC': {
      const size = opSize(a);
      const v = read(m, a);
      setFlags(m, mnem === 'INC' ? incFlags(v, size) : decFlags(v, size));
      write(m, a, (v + (mnem === 'INC' ? 1 : -1)) & mask(size));
      break;
    }
    case 'NOT':
      write(m, a, ~read(m, a) & mask(opSize(a)));
      break;
    case 'NEG': {
      const size = opSize(a);
      const v = read(m, a);
      setFlags(m, subFlags(0, v, -v, size));
      write(m, a, -v & mask(size));
      break;
    }
    case 'ROL': case 'ROR': case 'RCL': case 'RCR': case 'SHL': case 'SHR': case 'SAR':
      shift(m, mnem, a, b);
      break;
    case 'MUL': case 'IMUL': case 'DIV': case 'IDIV':
      if (!mulDiv(m, mnem, a)) return { kind: 'int', n: 0 };
      break;
    case 'XCHG': {
      const va = read(m, a);
      write(m, a, read(m, b));
      write(m, b, va);
      break;
    }
    case 'LEA':
      write(m, a, effectiveOffset(m, b as MemOperand));
      break;
    case 'LDS':
    case 'LES': {
      const p = farMem(m, b);
      write(m, a, p.off);
      m.sregs[mnem === 'LDS' ? DS : ES] = p.seg;
      break;
    }
    case 'PUSH':
      // PUSH SP en el 8086 apila el valor ya decrementado
      if (a.kind === 'reg' && a.index === SP) push(m, (m.regs[SP] - 2) & 0xffff);
      else push(m, read(m, a));
      break;
    case 'POP':
      write(m, a, pop(m));
      break;
    case 'PUSHF':
      push(m, flagsWord(m));
      break;
    case 'POPF':
      setFlagsWord(m, pop(m));
      break;
    case 'LAHF':
      setReg8(m, 4, flagsWord(m) & 0xff);
      break;
    case 'SAHF':
      setFlagsWord(m, (flagsWord(m) & 0xff00) | getReg8(m, 4));
      break;
    case 'CBW':
      m.regs[AX] = toSigned8(getReg8(m, 0)) & 0xffff;
      break;
    case 'CWD':
      m.regs[DX] = m.regs[AX] & 0x8000 ? 0xffff : 0;
      break;
    case 'XLAT':
      setReg8(m, 0, readByte(m, m.sregs[segOverride ?? DS], (m.regs[BX] + getReg8(m, 0)) & 0xffff));
      break;
    case 'JMP':
      if (a.kind === 'far') {
        m.sregs[CS] = a.seg;
        m.ip = a.off;
      } else {
        m.ip = read(m, a);
      }
      break;
    case 'JMP FAR': {
      const p = farMem(m, a);
      m.sregs[CS] = p.seg;
      m.ip = p.off;
      break;
    }
    case 'CALL': {
      const target = a.kind === 'far' ? a.off : read(m, a);
      if (a.kind === 'far') {
        push(m, m.sregs[CS]);
        m.sregs[CS] = a.seg;
      }
      push(m, m.ip);
      m.ip = target;
      break;
    }
    case 'CALL FAR': {
      const p = farMem(m, a);
      push(m, m.sregs[CS]);
      push(m, m.ip);
      m.sregs[CS] = p.seg;
      m.ip = p.off;
      break;
    }
    case 'RET':
      m.ip = pop(m);
      if (a) m.regs[SP] = (m.regs[SP] + read(m, a)) & 0xffff;
      break;
    case 'RETF':
      m.ip = pop(m);
      m.sregs[CS] = pop(m);
      if (a) m.regs[SP] = (m.regs[SP] + read(m, a)) & 0xffff;
      break;
    case 'IRET':
      returnFromInterrupt(m);
      break;
    case 'LOOP':
    case 'LOOPZ':
    case 'LOOPNZ': {
      m.regs[CX] = (m.regs[CX] - 1) & 0xffff;
      const extra = mnem === 'LOOPZ' ? m.flags.ZF : mnem === 'LOOPNZ' ? !m.flags.ZF : true;
      if (m.regs[CX] !== 0 && extra) m.ip = read(m, a);
      break;
    }
    case 'JCXZ':
      if (m.regs[CX] === 0) m.ip = read(m, a);
      break;
    case 'INT':
      return { kind: 'int', n: read(m, a) };
    case 'INTO':
      if (m.flags.OF) return { kind: 'int', n: 4 };
      break;
    case 'IN':
      if (opSize(a) === 8) setReg8(m, 0, 0xff);
      else m.regs[AX] = 0xffff;
      break;
    case 'OUT':
      break;
    case 'HLT':
      return { kind: 'halt' };
    case 'CLC': m.flags.CF = false; break;
    case 'STC': m.flags.CF = true; break;
    case 'CMC': m.flags.CF = !m.flags.CF; break;
    case 'CLD': m.flags.DF = false; break;
    case 'STD': m.flags.DF = true; break;
    case 'CLI': m.flags.IF = false; break;
    case 'STI': m.flags.IF = true; break;
    case 'NOP':
    case 'WAIT':
      break;
    case 'DAA':
    case 'DAS': {
      let al = getReg8(m, 0);
      const oldAl = al;
      const oldCf = m.flags.CF;
      const add = mnem === 'DAA';
      let af = false;
      let cf = false;
      if ((al & 0x0f) > 9 || m.flags.AF) {
        al = add ? al + 6 : al - 6;
        af = true;
      }
      if (oldAl > 0x99 || oldCf) {
        al = add ? al + 0x60 : al - 0x60;
        cf = true;
      }
      setReg8(m, 0, al);
      setFlags(m, { AF: af, CF: cf, ...resultFlags(al, 8) });
      break;
    }
    case 'AAA':
    case 'AAS': {
      if ((getReg8(m, 0) & 0x0f) > 9 || m.flags.AF) {
        const add = mnem === 'AAA';
        m.regs[AX] = (m.regs[AX] + (add ? 0x106 : -0x106)) & 0xffff;
        setFlags(m, { AF: true, CF: true });
      } else {
        setFlags(m, { AF: false, CF: false });
      }
      setReg8(m, 0, getReg8(m, 0) & 0x0f);
      break;
    }
    case 'AAM': {
      const base = read(m, a);
      if (base === 0) return { kind: 'int', n: 0 };
      const al = getReg8(m, 0);
      setReg8(m, 4, Math.floor(al / base));
      setReg8(m, 0, al % base);
      setFlags(m, resultFlags(getReg8(m, 0), 8));
      break;
    }
    case 'AAD': {
      const al = (getReg8(m, 4) * read(m, a) + getReg8(m, 0)) & 0xff;
      m.regs[AX] = al;
      setFlags(m, resultFlags(al, 8));
      break;
    }
    default:
      throw new Error(`Instrucción sin implementar: ${mnem}`);
  }
  return { kind: 'ok' };
}

/** Decodifica la instrucción en CS:IP, la ejecuta y deja IP en la siguiente. Los prefijos se ejecutan junto con su instrucción. */
export function step(m: Machine): StepResult {
  let segOverride: number | null = null;
  let rep: string | null = null;
  // Un máximo de prefijos evita un bucle infinito con memoria llena de prefijos
  for (let i = 0; i < 16; i++) {
    const instr = decode(m, m.sregs[CS], m.ip, segOverride);
    if (instr.undefined) {
      if (instr.bytes[0] === 0xfe && instr.bytes[1] === 0x38) {
        const id = readWord(m, m.sregs[CS], m.ip + 2);
        m.ip = (m.ip + 4) & 0xffff;
        return { kind: 'service', id };
      }
      return { kind: 'undefined', byte: instr.bytes[0] };
    }
    m.ip = (m.ip + instr.length) & 0xffff;
    if (instr.prefix === 'seg') segOverride = instr.sreg ?? null;
    else if (instr.prefix === 'rep') rep = instr.mnem;
    else if (instr.prefix !== 'lock') return execute(m, instr, rep, segOverride);
  }
  return { kind: 'ok' };
}
