import { OPCODES, REG16_NAMES, REG8_NAMES, SREG_NAMES, isGroup } from './decoder';
import type { OpEntry, Spec } from './decoder';

/**
 * Ensamblador con la sintaxis de DEBUG: números hexadecimales sin prefijo ni sufijo,
 * sin etiquetas, destinos de salto como dirección absoluta.
 *
 * Usa las mismas tablas que decoder.ts. Entre las codificaciones posibles elige la más corta
 * y, a igual tamaño, la primera de la tabla: así coincide con las que elige DEBUG.
 */

export type AssembleResult = { ok: true; bytes: number[] } | { ok: false; column: number };

/** Error con la columna (0 = primer carácter de la línea) donde se detectó. */
class AsmError extends Error {
  column: number;
  constructor(column: number) {
    super(`Error en la columna ${column}`);
    this.column = column;
  }
}

// ---------------------------------------------------------------- Operandos

type ParsedOperand =
  | { k: 'reg'; size: 8 | 16; index: number; col: number }
  | { k: 'sreg'; index: number; col: number }
  | { k: 'imm'; value: number; col: number }
  | { k: 'far'; seg: number; off: number; col: number }
  | { k: 'mem'; size: 8 | 16 | null; far: boolean; rm: number | null; disp: number; seg: number | null; col: number };

type Distance = 'short' | 'near' | null;

const HEX = /^[0-9a-f]+$/i;

function parseNumber(text: string, col: number): number {
  if (!HEX.test(text)) throw new AsmError(col);
  const value = parseInt(text, 16);
  if (value > 0xffff) throw new AsmError(col);
  return value;
}

function registerOf(word: string, col: number): ParsedOperand | null {
  const upper = word.toUpperCase();
  const r8 = (REG8_NAMES as readonly string[]).indexOf(upper);
  if (r8 >= 0) return { k: 'reg', size: 8, index: r8, col };
  const r16 = (REG16_NAMES as readonly string[]).indexOf(upper);
  if (r16 >= 0) return { k: 'reg', size: 16, index: r16, col };
  const s = (SREG_NAMES as readonly string[]).indexOf(upper);
  if (s >= 0) return { k: 'sreg', index: s, col };
  return null;
}

/** Contenido de los corchetes: registros base e índice y desplazamiento. */
function parseMemory(inner: string, col: number): { rm: number | null; disp: number } {
  let base: 'BX' | 'BP' | null = null;
  let index: 'SI' | 'DI' | null = null;
  let disp = 0;
  const term = /\s*([+-]?)\s*([0-9a-z]+)\s*/giy;
  let pos = 0;
  while (pos < inner.length) {
    term.lastIndex = pos;
    const match = term.exec(inner);
    if (!match || (pos > 0 && match[1] === '')) throw new AsmError(col + pos);
    const word = match[2].toUpperCase();
    const wordCol = col + match.index + match[0].indexOf(match[2]);
    if (registerOf(word, wordCol)) {
      if (match[1] === '-') throw new AsmError(wordCol);
      if ((word === 'BX' || word === 'BP') && base === null) base = word;
      else if ((word === 'SI' || word === 'DI') && index === null) index = word;
      else throw new AsmError(wordCol);
    } else {
      const n = parseNumber(match[2], wordCol);
      disp += match[1] === '-' ? -n : n;
    }
    pos = term.lastIndex;
  }
  const RM: Record<string, number> = { 'BX+SI': 0, 'BX+DI': 1, 'BP+SI': 2, 'BP+DI': 3, SI: 4, DI: 5, BP: 6, BX: 7 };
  const key = [base, index].filter(Boolean).join('+');
  return { rm: key === '' ? null : RM[key], disp: disp & 0xffff };
}

function parseOperand(raw: string, rawCol: number): { op: ParsedOperand; distance: Distance } {
  let text = raw.trimEnd();
  let c = rawCol;
  const skip = (n: number) => {
    const rest = text.slice(n);
    c += n + (rest.length - rest.trimStart().length);
    text = rest.trimStart();
  };
  skip(0);
  const col = c;

  let size: 8 | 16 | null = null;
  let far = false;
  let distance: Distance = null;
  for (;;) {
    const kw = /^(byte|word|dword|far|near|short)\b\s*(ptr\b)?/i.exec(text);
    if (!kw) break;
    const word = kw[1].toLowerCase();
    if (word === 'byte') size = 8;
    else if (word === 'word') size = 16;
    else if (word === 'far' || word === 'dword') far = true;
    else distance = word as Distance;
    skip(kw[0].length);
  }

  let seg: number | null = null;
  const override = /^(es|cs|ss|ds)\s*:/i.exec(text);
  if (override && !/^(es|cs|ss|ds)\s*:\s*[0-9a-f]+$/i.test(text)) {
    seg = SREG_NAMES.indexOf(override[1].toUpperCase() as (typeof SREG_NAMES)[number]);
    skip(override[0].length);
  }

  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close < 0) throw new AsmError(c + text.length);
    if (text.slice(close + 1).trim() !== '') throw new AsmError(c + close + 1);
    const { rm, disp } = parseMemory(text.slice(1, close), c + 1);
    return { op: { k: 'mem', size, far, rm, disp, seg, col }, distance };
  }
  if (seg !== null || size !== null) throw new AsmError(c);

  const reg = registerOf(text, c);
  if (reg) return { op: reg, distance };

  const farPtr = /^([0-9a-f]+)\s*:\s*([0-9a-f]+)$/i.exec(text);
  if (farPtr) {
    return { op: { k: 'far', seg: parseNumber(farPtr[1], c), off: parseNumber(farPtr[2], c), col }, distance };
  }

  const imm = /^([+-]?)\s*([0-9a-z]+)$/i.exec(text);
  if (!imm) throw new AsmError(c);
  const n = parseNumber(imm[2], c + text.indexOf(imm[2]));
  return { op: { k: 'imm', value: imm[1] === '-' ? -n : n, col }, distance };
}

/** Divide por comas fuera de comillas, conservando la columna de cada parte. */
function splitOperands(text: string, col: number): { text: string; col: number }[] {
  const parts: { text: string; col: number }[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',' || i === text.length) {
      parts.push({ text: text.slice(start, i), col: col + start });
      start = i + 1;
    }
  }
  return parts;
}

// ---------------------------------------------------------------- DB y DW

function assembleData(text: string, col: number, word: boolean): number[] {
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === ',') {
      i++;
    } else if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new AsmError(col + text.length);
      for (const c of text.slice(i + 1, end)) bytes.push(c.charCodeAt(0) & 0xff);
      i = end + 1;
    } else {
      const m = /^[0-9a-z]+/i.exec(text.slice(i));
      if (!m) throw new AsmError(col + i);
      const n = parseNumber(m[0], col + i);
      if (word) bytes.push(n & 0xff, n >> 8);
      else if (n > 0xff) throw new AsmError(col + i);
      else bytes.push(n);
      i += m[0].length;
    }
  }
  if (bytes.length === 0) throw new AsmError(col + text.length);
  return bytes;
}

// ---------------------------------------------------------------- Selección de codificación

const ALIASES: Record<string, string> = {
  JE: 'JZ', JNE: 'JNZ', JC: 'JB', JNAE: 'JB', JNC: 'JNB', JAE: 'JNB', JNA: 'JBE', JNBE: 'JA',
  JP: 'JPE', JNP: 'JPO', JNGE: 'JL', JNL: 'JGE', JNG: 'JLE', JNLE: 'JG',
  LOOPE: 'LOOPZ', LOOPNE: 'LOOPNZ', SAL: 'SHL', RETN: 'RET',
};

const PREFIXES: Record<string, number> = {
  LOCK: 0xf0, REP: 0xf3, REPE: 0xf3, REPZ: 0xf3, REPNE: 0xf2, REPNZ: 0xf2,
  'ES:': 0x26, 'CS:': 0x2e, 'SS:': 0x36, 'DS:': 0x3e,
};

/** Operandos de memoria sin tamaño que se aceptan porque la instrucción solo admite palabra. */
const IMPLICIT_WORD = new Set(['PUSH', 'POP', 'CALL', 'JMP']);
const SHIFTS = new Set(['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR']);

interface Candidate {
  opcode: number;
  /** Campo reg fijo para los grupos. */
  group: number | null;
  entry: OpEntry;
}

/** Todas las codificaciones de la tabla. 82 es un alias de 80 que DEBUG no genera. */
const CANDIDATES: Candidate[] = OPCODES.flatMap((entry, opcode): Candidate[] => {
  if (entry === null || opcode === 0x82) return [];
  if (isGroup(entry)) {
    return entry.group.flatMap((e, reg) => (e === null ? [] : [{ opcode, group: reg, entry: e }]));
  }
  return entry.prefix ? [] : [{ opcode, group: null, entry }];
});

const KNOWN = new Set([...CANDIDATES.map((c) => c.entry.mnem.split(' ')[0]), ...Object.keys(ALIASES), 'DB', 'DW']);

function fitsByte(v: number): boolean {
  return v >= -0x80 && v <= 0xff;
}

function fitsWord(v: number): boolean {
  return v >= -0x8000 && v <= 0xffff;
}

function isSignExtendedByte(v: number): boolean {
  const w = v & 0xffff;
  return w <= 0x7f || w >= 0xff80;
}

function matches(spec: Spec, op: ParsedOperand, sized: boolean): boolean {
  switch (spec) {
    case 'Eb':
    case 'Ew': {
      const size = spec === 'Eb' ? 8 : 16;
      if (op.k === 'reg') return op.size === size;
      return op.k === 'mem' && !op.far && (op.size === size || (op.size === null && sized));
    }
    case 'Gb': case 'Zb': return op.k === 'reg' && op.size === 8;
    case 'Gw': case 'Zw': return op.k === 'reg' && op.size === 16;
    case 'Sw': return op.k === 'sreg';
    case 'ES': case 'CS': case 'SS': case 'DS': return op.k === 'sreg' && SREG_NAMES[op.index] === spec;
    case 'AL': return op.k === 'reg' && op.size === 8 && op.index === 0;
    case 'CL': return op.k === 'reg' && op.size === 8 && op.index === 1;
    case 'AX': return op.k === 'reg' && op.size === 16 && op.index === 0;
    case 'DX': return op.k === 'reg' && op.size === 16 && op.index === 2;
    case 'Ib': return op.k === 'imm' && fitsByte(op.value);
    case 'Iw': return op.k === 'imm' && fitsWord(op.value);
    case 'Ibs': return op.k === 'imm' && fitsWord(op.value) && isSignExtendedByte(op.value);
    case '1': return op.k === 'imm' && op.value === 1;
    case '3': return op.k === 'imm' && op.value === 3;
    case 'Ob': case 'Ow': {
      const size = spec === 'Ob' ? 8 : 16;
      return op.k === 'mem' && !op.far && op.rm === null && (op.size === size || (op.size === null && sized));
    }
    case 'M': return op.k === 'mem' && !op.far;
    case 'Mp': return op.k === 'mem';
    case 'Jb': case 'Jw': return op.k === 'imm' && fitsWord(op.value);
    case 'Ap': return op.k === 'far';
  }
}

function modrmBytes(reg: number, op: ParsedOperand): number[] {
  if (op.k === 'reg') return [0xc0 | (reg << 3) | op.index];
  if (op.k !== 'mem') throw new Error('modrm sin operando de memoria');
  const lo = op.disp & 0xff;
  const hi = op.disp >> 8;
  if (op.rm === null) return [(reg << 3) | 6, lo, hi];
  const signed = op.disp >= 0x8000 ? op.disp - 0x10000 : op.disp;
  if (op.disp === 0 && op.rm !== 6) return [(reg << 3) | op.rm];
  if (signed >= -128 && signed <= 127) return [0x40 | (reg << 3) | op.rm, lo];
  return [0x80 | (reg << 3) | op.rm, lo, hi];
}

/** Bytes de una codificación en `addr`, o null si un salto corto no llega al destino. */
function encode(c: Candidate, ops: ParsedOperand[], addr: number): number[] | null {
  const specs = c.entry.ops;
  const bytes = [c.opcode];
  const eIndex = specs.findIndex((s) => s === 'Eb' || s === 'Ew' || s === 'M' || s === 'Mp');
  const gIndex = specs.findIndex((s) => s === 'Gb' || s === 'Gw' || s === 'Sw');
  if (eIndex >= 0) {
    const reg = c.group ?? (gIndex >= 0 ? (ops[gIndex] as { index: number }).index : 0);
    bytes.push(...modrmBytes(reg, ops[eIndex]));
  } else if (c.group !== null) {
    throw new Error('grupo sin operando r/m');
  }
  // Registro dentro del opcode (40+r, 90+r, B0+r…): cada registro tiene su propio candidato en la tabla
  const zIndex = specs.findIndex((s) => s === 'Zb' || s === 'Zw');
  if (zIndex >= 0 && (ops[zIndex] as { index: number }).index !== (c.opcode & 7)) return null;

  for (let i = 0; i < specs.length; i++) {
    const op = ops[i];
    switch (specs[i]) {
      case 'Ib':
        bytes.push((op as { value: number }).value & 0xff);
        break;
      case 'Ibs':
        bytes.push((op as { value: number }).value & 0xff);
        break;
      case 'Iw': {
        const v = (op as { value: number }).value & 0xffff;
        bytes.push(v & 0xff, v >> 8);
        break;
      }
      case 'Ob':
      case 'Ow': {
        const d = (op as { disp: number }).disp;
        bytes.push(d & 0xff, d >> 8);
        break;
      }
      case 'Ap': {
        const f = op as { seg: number; off: number };
        bytes.push(f.off & 0xff, f.off >> 8, f.seg & 0xff, f.seg >> 8);
        break;
      }
      case 'Jb': {
        const rel = (((op as { value: number }).value - (addr + bytes.length + 1)) & 0xffff);
        const signed = rel >= 0x8000 ? rel - 0x10000 : rel;
        if (signed < -128 || signed > 127) return null;
        bytes.push(signed & 0xff);
        break;
      }
      case 'Jw': {
        const rel = ((op as { value: number }).value - (addr + bytes.length + 2)) & 0xffff;
        bytes.push(rel & 0xff, rel >> 8);
        break;
      }
    }
  }
  return bytes;
}

function assembleInstruction(mnemText: string, mnemCol: number, rest: string, restCol: number, addr: number): number[] {
  let mnem = mnemText.toUpperCase();
  mnem = ALIASES[mnem] ?? mnem;
  if (!KNOWN.has(mnem)) throw new AsmError(mnemCol);

  if (mnem === 'DB' || mnem === 'DW') return assembleData(rest, restCol, mnem === 'DW');

  const parts = rest.trim() === '' ? [] : splitOperands(rest, restCol);
  const parsed = parts.map((p) => parseOperand(p.text, p.col));
  let ops = parsed.map((p) => p.op);
  // AAM y AAD sin operando trabajan en base 10, como en DEBUG: D4 0A y D5 0A
  if ((mnem === 'AAM' || mnem === 'AAD') && ops.length === 0) ops = [{ k: 'imm', value: 0x0a, col: restCol }];
  const distance = parsed.find((p) => p.distance)?.distance ?? null;

  const mems = ops.filter((o) => o.k === 'mem');
  if (mems.length > 1) throw new AsmError(mems[1].col);

  // XCHG es conmutativa: XCHG BX,AX usa la forma corta igual que XCHG AX,BX
  if (mnem === 'XCHG' && ops.length === 2 && ops[1].k === 'reg' && ops[1].size === 16 && ops[1].index === 0) {
    ops = [ops[1], ops[0]];
    // XCHG AX,AX es el mismo byte que NOP
    if (ops[1].k === 'reg' && ops[1].size === 16 && ops[1].index === 0) return [0x90];
  }

  const far = mems.some((m) => m.k === 'mem' && m.far);
  const fullMnem = far && (mnem === 'CALL' || mnem === 'JMP') ? `${mnem} FAR` : mnem;
  // Un operando de memoria sin tamaño necesita un registro que lo fije
  const sized =
    IMPLICIT_WORD.has(mnem) ||
    ops.some((o) => o.k === 'sreg' || (o.k === 'reg' && !SHIFTS.has(mnem)));

  let best: number[] | null = null;
  for (const c of CANDIDATES) {
    if (c.entry.mnem !== fullMnem || c.entry.ops.length !== ops.length) continue;
    if (!c.entry.ops.every((spec, i) => matches(spec, ops[i], sized))) continue;
    if (distance === 'short' && c.entry.ops.includes('Jw')) continue;
    if (distance === 'near' && c.entry.ops.includes('Jb')) continue;
    const segPrefix = mems.find((m) => m.k === 'mem' && m.seg !== null);
    const prefix = segPrefix && segPrefix.k === 'mem' && segPrefix.seg !== null ? [0x26 + segPrefix.seg * 8] : [];
    const bytes = encode(c, ops, (addr + prefix.length) & 0xffff);
    if (bytes === null) continue;
    const full = [...prefix, ...bytes];
    if (best === null || full.length < best.length) best = full;
  }
  if (best === null) {
    const last = ops[ops.length - 1];
    throw new AsmError(last ? last.col : mnemCol + mnemText.length);
  }
  return best;
}

/** Ensambla una línea en la dirección `addr` (desplazamiento dentro de CS). */
export function assemble(text: string, addr: number): AssembleResult {
  try {
    const bytes: number[] = [];
    let col = 0;
    let rest = text;
    for (;;) {
      const lead = rest.length - rest.trimStart().length;
      col += lead;
      rest = rest.slice(lead);
      const word = /^[a-z]+:?/i.exec(rest);
      if (!word) throw new AsmError(col);
      const upper = word[0].toUpperCase();
      const after = rest.slice(word[0].length);
      if (upper in PREFIXES && (upper.endsWith(':') || after.trim() !== '' || upper === 'LOCK' || upper.startsWith('REP'))) {
        bytes.push(PREFIXES[upper]);
        col += word[0].length;
        rest = after;
        if (rest.trim() === '') return { ok: true, bytes };
        continue;
      }
      if (upper.endsWith(':')) throw new AsmError(col);
      bytes.push(...assembleInstruction(word[0], col, after, col + word[0].length, (addr + bytes.length) & 0xffff));
      return { ok: true, bytes };
    }
  } catch (e) {
    if (e instanceof AsmError) return { ok: false, column: e.column };
    throw e;
  }
}
