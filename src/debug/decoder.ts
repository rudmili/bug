import { readByte } from './memory';
import { CS, DS, ES, SS } from './state';
import type { Machine } from './state';
import { toSigned8 } from './hex';

/**
 * Decodificador del 8086. Las tablas usan la notación del manual de Intel y las comparte assembler.ts:
 *
 *   Eb/Ew  registro o memoria (ModR/M), byte o palabra   Gb/Gw  registro del campo reg
 *   Zb/Zw  registro en los 3 bits bajos del opcode         Sw     registro de segmento del campo reg
 *   Ib/Iw  inmediato                                       Ibs    byte con extensión de signo a palabra
 *   Jb/Jw  destino relativo                                Ap     puntero lejano inmediato seg:desp
 *   Ob/Ow  memoria directa (desplazamiento de 16 bits)     M/Mp   solo memoria (LEA / LDS, LES, FAR)
 *   AL AX CL DX 1 3 ES CS SS DS operandos fijos
 */

export type Spec =
  | 'Eb' | 'Ew' | 'Gb' | 'Gw' | 'Zb' | 'Zw' | 'Sw'
  | 'Ib' | 'Iw' | 'Ibs' | 'Jb' | 'Jw' | 'Ap' | 'Ob' | 'Ow' | 'M' | 'Mp'
  | 'AL' | 'AX' | 'CL' | 'DX' | '1' | '3' | 'ES' | 'CS' | 'SS' | 'DS';

export type PrefixKind = 'seg' | 'rep' | 'lock';

export interface OpEntry {
  mnem: string;
  ops: readonly Spec[];
  /** Los prefijos se muestran como instrucciones sueltas, igual que en DEBUG. */
  prefix?: PrefixKind;
  /** Para los prefijos de segmento: el registro (ES, CS, SS, DS). */
  sreg?: number;
}

/** Opcode con byte ModR/M cuyo campo reg elige la instrucción. */
export interface GroupEntry {
  group: readonly (OpEntry | null)[];
}

export type Entry = OpEntry | GroupEntry;

export function isGroup(e: Entry): e is GroupEntry {
  return 'group' in e;
}

export const REG8_NAMES = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'] as const;
export const REG16_NAMES = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'] as const;
export const SREG_NAMES = ['ES', 'CS', 'SS', 'DS'] as const;
/** Base de la dirección según el campo r/m (con mod 00 y r/m 110 es dirección directa). */
export const RM_BASES = ['BX+SI', 'BX+DI', 'BP+SI', 'BP+DI', 'SI', 'DI', 'BP', 'BX'] as const;
/** Nombres de los saltos condicionales 70–7F como los muestra DEBUG. */
export const JCC_NAMES = [
  'JO', 'JNO', 'JB', 'JNB', 'JZ', 'JNZ', 'JBE', 'JA',
  'JS', 'JNS', 'JPE', 'JPO', 'JL', 'JGE', 'JLE', 'JG',
] as const;

const ARITH = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'] as const;
const SHIFTS = ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', null, 'SAR'] as const;

function op(mnem: string, ...ops: Spec[]): OpEntry {
  return { mnem, ops };
}

function group(ops: Spec[], names: readonly (string | null)[]): GroupEntry {
  return { group: names.map((n) => (n === null ? null : op(n, ...ops))) };
}

function buildTable(): (Entry | null)[] {
  const t: (Entry | null)[] = new Array(256).fill(null);

  ARITH.forEach((mnem, i) => {
    const b = i * 8;
    t[b] = op(mnem, 'Eb', 'Gb');
    t[b + 1] = op(mnem, 'Ew', 'Gw');
    t[b + 2] = op(mnem, 'Gb', 'Eb');
    t[b + 3] = op(mnem, 'Gw', 'Ew');
    t[b + 4] = op(mnem, 'AL', 'Ib');
    t[b + 5] = op(mnem, 'AX', 'Iw');
  });
  t[0x06] = op('PUSH', 'ES');
  t[0x07] = op('POP', 'ES');
  t[0x0e] = op('PUSH', 'CS');
  t[0x16] = op('PUSH', 'SS');
  t[0x17] = op('POP', 'SS');
  t[0x1e] = op('PUSH', 'DS');
  t[0x1f] = op('POP', 'DS');
  t[0x26] = { mnem: 'ES:', ops: [], prefix: 'seg', sreg: ES };
  t[0x2e] = { mnem: 'CS:', ops: [], prefix: 'seg', sreg: CS };
  t[0x36] = { mnem: 'SS:', ops: [], prefix: 'seg', sreg: SS };
  t[0x3e] = { mnem: 'DS:', ops: [], prefix: 'seg', sreg: DS };
  t[0x27] = op('DAA');
  t[0x2f] = op('DAS');
  t[0x37] = op('AAA');
  t[0x3f] = op('AAS');
  for (let r = 0; r < 8; r++) {
    t[0x40 + r] = op('INC', 'Zw');
    t[0x48 + r] = op('DEC', 'Zw');
    t[0x50 + r] = op('PUSH', 'Zw');
    t[0x58 + r] = op('POP', 'Zw');
    t[0xb0 + r] = op('MOV', 'Zb', 'Ib');
    t[0xb8 + r] = op('MOV', 'Zw', 'Iw');
  }
  JCC_NAMES.forEach((mnem, i) => {
    t[0x70 + i] = op(mnem, 'Jb');
  });
  t[0x80] = group(['Eb', 'Ib'], ARITH);
  t[0x81] = group(['Ew', 'Iw'], ARITH);
  t[0x82] = group(['Eb', 'Ib'], ARITH);
  t[0x83] = group(['Ew', 'Ibs'], ARITH);
  t[0x84] = op('TEST', 'Eb', 'Gb');
  t[0x85] = op('TEST', 'Ew', 'Gw');
  t[0x86] = op('XCHG', 'Eb', 'Gb');
  t[0x87] = op('XCHG', 'Ew', 'Gw');
  t[0x88] = op('MOV', 'Eb', 'Gb');
  t[0x89] = op('MOV', 'Ew', 'Gw');
  t[0x8a] = op('MOV', 'Gb', 'Eb');
  t[0x8b] = op('MOV', 'Gw', 'Ew');
  t[0x8c] = op('MOV', 'Ew', 'Sw');
  t[0x8d] = op('LEA', 'Gw', 'M');
  t[0x8e] = op('MOV', 'Sw', 'Ew');
  t[0x8f] = group(['Ew'], ['POP', null, null, null, null, null, null, null]);
  t[0x90] = op('NOP');
  for (let r = 1; r < 8; r++) t[0x90 + r] = op('XCHG', 'AX', 'Zw');
  t[0x98] = op('CBW');
  t[0x99] = op('CWD');
  t[0x9a] = op('CALL', 'Ap');
  t[0x9b] = op('WAIT');
  t[0x9c] = op('PUSHF');
  t[0x9d] = op('POPF');
  t[0x9e] = op('SAHF');
  t[0x9f] = op('LAHF');
  t[0xa0] = op('MOV', 'AL', 'Ob');
  t[0xa1] = op('MOV', 'AX', 'Ow');
  t[0xa2] = op('MOV', 'Ob', 'AL');
  t[0xa3] = op('MOV', 'Ow', 'AX');
  t[0xa4] = op('MOVSB');
  t[0xa5] = op('MOVSW');
  t[0xa6] = op('CMPSB');
  t[0xa7] = op('CMPSW');
  t[0xa8] = op('TEST', 'AL', 'Ib');
  t[0xa9] = op('TEST', 'AX', 'Iw');
  t[0xaa] = op('STOSB');
  t[0xab] = op('STOSW');
  t[0xac] = op('LODSB');
  t[0xad] = op('LODSW');
  t[0xae] = op('SCASB');
  t[0xaf] = op('SCASW');
  t[0xc2] = op('RET', 'Iw');
  t[0xc3] = op('RET');
  t[0xc4] = op('LES', 'Gw', 'Mp');
  t[0xc5] = op('LDS', 'Gw', 'Mp');
  t[0xc6] = group(['Eb', 'Ib'], ['MOV', null, null, null, null, null, null, null]);
  t[0xc7] = group(['Ew', 'Iw'], ['MOV', null, null, null, null, null, null, null]);
  t[0xca] = op('RETF', 'Iw');
  t[0xcb] = op('RETF');
  t[0xcc] = op('INT', '3');
  t[0xcd] = op('INT', 'Ib');
  t[0xce] = op('INTO');
  t[0xcf] = op('IRET');
  t[0xd0] = group(['Eb', '1'], SHIFTS);
  t[0xd1] = group(['Ew', '1'], SHIFTS);
  t[0xd2] = group(['Eb', 'CL'], SHIFTS);
  t[0xd3] = group(['Ew', 'CL'], SHIFTS);
  t[0xd4] = op('AAM', 'Ib');
  t[0xd5] = op('AAD', 'Ib');
  t[0xd7] = op('XLAT');
  t[0xe0] = op('LOOPNZ', 'Jb');
  t[0xe1] = op('LOOPZ', 'Jb');
  t[0xe2] = op('LOOP', 'Jb');
  t[0xe3] = op('JCXZ', 'Jb');
  t[0xe4] = op('IN', 'AL', 'Ib');
  t[0xe5] = op('IN', 'AX', 'Ib');
  t[0xe6] = op('OUT', 'Ib', 'AL');
  t[0xe7] = op('OUT', 'Ib', 'AX');
  t[0xe8] = op('CALL', 'Jw');
  t[0xe9] = op('JMP', 'Jw');
  t[0xea] = op('JMP', 'Ap');
  t[0xeb] = op('JMP', 'Jb');
  t[0xec] = op('IN', 'AL', 'DX');
  t[0xed] = op('IN', 'AX', 'DX');
  t[0xee] = op('OUT', 'DX', 'AL');
  t[0xef] = op('OUT', 'DX', 'AX');
  t[0xf0] = { mnem: 'LOCK', ops: [], prefix: 'lock' };
  t[0xf2] = { mnem: 'REPNZ', ops: [], prefix: 'rep' };
  t[0xf3] = { mnem: 'REPZ', ops: [], prefix: 'rep' };
  t[0xf4] = op('HLT');
  t[0xf5] = op('CMC');
  t[0xf6] = {
    group: [op('TEST', 'Eb', 'Ib'), null, op('NOT', 'Eb'), op('NEG', 'Eb'), op('MUL', 'Eb'), op('IMUL', 'Eb'), op('DIV', 'Eb'), op('IDIV', 'Eb')],
  };
  t[0xf7] = {
    group: [op('TEST', 'Ew', 'Iw'), null, op('NOT', 'Ew'), op('NEG', 'Ew'), op('MUL', 'Ew'), op('IMUL', 'Ew'), op('DIV', 'Ew'), op('IDIV', 'Ew')],
  };
  t[0xf8] = op('CLC');
  t[0xf9] = op('STC');
  t[0xfa] = op('CLI');
  t[0xfb] = op('STI');
  t[0xfc] = op('CLD');
  t[0xfd] = op('STD');
  t[0xfe] = { group: [op('INC', 'Eb'), op('DEC', 'Eb'), null, null, null, null, null, null] };
  t[0xff] = {
    group: [
      op('INC', 'Ew'), op('DEC', 'Ew'), op('CALL', 'Ew'), op('CALL FAR', 'Mp'),
      op('JMP', 'Ew'), op('JMP FAR', 'Mp'), op('PUSH', 'Ew'), null,
    ],
  };
  return t;
}

/** Tabla de los 256 opcodes. null: no definido en el 8086. */
export const OPCODES: readonly (Entry | null)[] = buildTable();

// ---------------------------------------------------------------- Instrucción decodificada

export type Operand =
  | { kind: 'reg'; size: 8 | 16; index: number }
  | { kind: 'sreg'; index: number }
  /** `signed`: byte con extensión de signo (83 /x), DEBUG lo muestra como +03 o −01. */
  | { kind: 'imm'; size: 8 | 16; value: number; signed?: boolean }
  /** El 1 de los desplazamientos y el 3 de INT 3: se muestran sin relleno. */
  | { kind: 'const'; value: number }
  /** rm null: dirección directa. seg: registro de segmento efectivo. */
  | { kind: 'mem'; size: 8 | 16 | 32; rm: number | null; disp: number; dispSize: 0 | 8 | 16; seg: number }
  | { kind: 'rel'; target: number }
  | { kind: 'far'; seg: number; off: number };

export type MemOperand = Extract<Operand, { kind: 'mem' }>;

export interface Instr {
  mnem: string;
  operands: Operand[];
  /** Tamaño en bytes. */
  length: number;
  bytes: number[];
  prefix?: PrefixKind;
  /** Para prefijos de segmento. */
  sreg?: number;
  /** Opcode no definido en el 8086: se muestra como DB, o como ??? si es un campo vacío de un grupo. */
  undefined?: boolean;
}

function undefinedInstr(byte: number): Instr {
  return {
    mnem: 'DB',
    operands: [{ kind: 'imm', size: 8, value: byte }],
    length: 1,
    bytes: [byte],
    undefined: true,
  };
}

/**
 * Decodifica la instrucción en cs:ip.
 * `segOverride` lo usa executor cuando la instrucción viene después de un prefijo de segmento.
 */
export function decode(m: Machine, cs: number, ip: number, segOverride: number | null = null): Instr {
  let pos = ip;
  const bytes: number[] = [];
  const next = (): number => {
    const b = readByte(m, cs, pos);
    pos = (pos + 1) & 0xffff;
    bytes.push(b);
    return b;
  };
  const nextWord = (): number => {
    const lo = next();
    return lo | (next() << 8);
  };

  const opcode = next();
  let entry = OPCODES[opcode];
  if (entry === null) return undefinedInstr(opcode);

  let modrm: number | null = null;
  // Un grupo sin instrucción para ese campo reg: DEBUG muestra "???" con el operando (FE38 = ??? [BX+SI])
  let invalid = false;
  if (isGroup(entry)) {
    modrm = next();
    const sub: OpEntry | null = entry.group[(modrm >> 3) & 7];
    invalid = sub === null;
    entry = sub ?? { mnem: '???', ops: ['Eb'] };
  }
  if (entry.prefix) {
    return { mnem: entry.mnem, operands: [], length: 1, bytes, prefix: entry.prefix, sreg: entry.sreg };
  }

  const needsModrm = entry.ops.some((s) => s === 'Eb' || s === 'Ew' || s === 'Gb' || s === 'Gw' || s === 'Sw' || s === 'M' || s === 'Mp');
  if (needsModrm && modrm === null) modrm = next();

  const mod = modrm === null ? 0 : modrm >> 6;
  const reg = modrm === null ? 0 : (modrm >> 3) & 7;
  const rm = modrm === null ? 0 : modrm & 7;

  // El operando de memoria se lee una sola vez, en el orden de los bytes (desplazamiento antes que inmediato)
  let memOperand: MemOperand | null = null;
  const readRm = (size: 8 | 16 | 32): Operand => {
    if (mod === 3) return { kind: 'reg', size: size === 8 ? 8 : 16, index: rm };
    if (memOperand) return { ...memOperand, size };
    let disp = 0;
    let dispSize: 0 | 8 | 16 = 0;
    let base: number | null = rm;
    if (mod === 0 && rm === 6) {
      base = null;
      disp = nextWord();
      dispSize = 16;
    } else if (mod === 1) {
      disp = toSigned8(next()) & 0xffff;
      dispSize = 8;
    } else if (mod === 2) {
      disp = nextWord();
      dispSize = 16;
    }
    const usesBp = base === 2 || base === 3 || base === 6;
    memOperand = { kind: 'mem', size, rm: base, disp, dispSize, seg: segOverride ?? (usesBp ? SS : DS) };
    return memOperand;
  };

  const operands: Operand[] = [];
  for (const spec of entry.ops) {
    switch (spec) {
      case 'Eb': operands.push(readRm(8)); break;
      case 'Ew': operands.push(readRm(16)); break;
      case 'M':
      case 'Mp':
        if (mod === 3) return undefinedInstr(opcode);
        operands.push(readRm(spec === 'Mp' ? 32 : 16));
        break;
      case 'Gb': operands.push({ kind: 'reg', size: 8, index: reg }); break;
      case 'Gw': operands.push({ kind: 'reg', size: 16, index: reg }); break;
      case 'Sw': operands.push({ kind: 'sreg', index: reg & 3 }); break;
      case 'Zb': operands.push({ kind: 'reg', size: 8, index: opcode & 7 }); break;
      case 'Zw': operands.push({ kind: 'reg', size: 16, index: opcode & 7 }); break;
      case 'Ib': operands.push({ kind: 'imm', size: 8, value: next() }); break;
      case 'Iw': operands.push({ kind: 'imm', size: 16, value: nextWord() }); break;
      case 'Ibs': operands.push({ kind: 'imm', size: 16, value: toSigned8(next()) & 0xffff, signed: true }); break;
      case 'Jb': {
        const rel = toSigned8(next());
        operands.push({ kind: 'rel', target: (pos + rel) & 0xffff });
        break;
      }
      case 'Jw': {
        const rel = nextWord();
        operands.push({ kind: 'rel', target: (pos + rel) & 0xffff });
        break;
      }
      case 'Ap': {
        const off = nextWord();
        operands.push({ kind: 'far', seg: nextWord(), off });
        break;
      }
      case 'Ob':
      case 'Ow':
        operands.push({ kind: 'mem', size: spec === 'Ob' ? 8 : 16, rm: null, disp: nextWord(), dispSize: 16, seg: segOverride ?? DS });
        break;
      case 'AL': operands.push({ kind: 'reg', size: 8, index: 0 }); break;
      case 'CL': operands.push({ kind: 'reg', size: 8, index: 1 }); break;
      case 'AX': operands.push({ kind: 'reg', size: 16, index: 0 }); break;
      case 'DX': operands.push({ kind: 'reg', size: 16, index: 2 }); break;
      case '1': operands.push({ kind: 'const', value: 1 }); break;
      case '3': operands.push({ kind: 'const', value: 3 }); break;
      case 'ES': operands.push({ kind: 'sreg', index: ES }); break;
      case 'CS': operands.push({ kind: 'sreg', index: CS }); break;
      case 'SS': operands.push({ kind: 'sreg', index: SS }); break;
      case 'DS': operands.push({ kind: 'sreg', index: DS }); break;
    }
  }

  return invalid
    ? { mnem: entry.mnem, operands, length: bytes.length, bytes, undefined: true }
    : { mnem: entry.mnem, operands, length: bytes.length, bytes };
}
