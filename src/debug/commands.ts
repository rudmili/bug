import { assemble } from './assembler';
import { SREG_NAMES, decode } from './decoder';
import type { Instr } from './decoder';
import { formatLine } from './disassembler';
import { Output, handleInterrupt } from './dos';
import { effectiveOffset, step } from './executor';
import { flagsText } from './flags';
import { hex2, hex4, parseHex } from './hex';
import { readByte, readWord, writeByte } from './memory';
import { CS, DS, REG16, SREG } from './state';
import type { Machine } from './state';

/** Los comandos de DEBUG: analizan una línea, la ejecutan contra la máquina y devuelven qué imprimir. */

export type Mode = 'command' | 'assemble' | 'register' | 'edit';

export interface Address {
  seg: number;
  off: number;
}

/** Estado de la sesión de DEBUG que no es parte de la máquina. */
export interface CommandState {
  mode: Mode;
  /** Próxima dirección de `a`. */
  asmAddr: Address;
  /** Próxima dirección de `u`; null hasta el primer `u` (arranca en CS:IP). */
  unasmAddr: Address | null;
  /** Próxima dirección de `d`; null hasta el primer `d` (arranca en DS:0100). */
  dumpAddr: Address | null;
  /** Dirección del byte que se edita con `e` interactivo. */
  editAddr: Address;
  /** Registro que se edita con `r <registro>`. */
  editReg: RegisterName | null;
  /** Primera dirección después del último byte ensamblado con `a`. */
  asmLimit: number;
}

export type RegisterName = (typeof REGISTER_NAMES)[number];

const REGISTER_NAMES = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'DS', 'ES', 'SS', 'CS', 'IP'] as const;

export interface OutLine {
  kind: 'output' | 'error';
  text: string;
}

export interface RunResult {
  output: OutLine[];
  /** `q`: la sesión vuelve al estado inicial. */
  reset?: boolean;
  /** Desplazamiento en DS que muestra `d` o edita `e`: la ventana de datos se mueve ahí. */
  dataFocus?: number;
}

/** Límite de `g` para no congelar la pestaña. */
export const MAX_STEPS = 1_000_000;

export function createCommandState(m: Machine): CommandState {
  return {
    mode: 'command',
    asmAddr: { seg: m.sregs[CS], off: 0x100 },
    unasmAddr: null,
    dumpAddr: null,
    editAddr: { seg: m.sregs[DS], off: 0 },
    editReg: null,
    asmLimit: 0x101,
  };
}

export function promptFor(m: Machine, state: CommandState): string {
  switch (state.mode) {
    case 'command':
      return '-';
    case 'assemble':
      return `${hex4(state.asmAddr.seg)}:${hex4(state.asmAddr.off)} `;
    case 'register':
      return ':';
    case 'edit': {
      const { seg, off } = state.editAddr;
      return `${hex4(seg)}:${hex4(off)}  ${hex2(readByte(m, seg, off))}.`;
    }
  }
}

// ---------------------------------------------------------------- Errores y argumentos

class CommandError extends Error {
  column: number;
  constructor(column: number) {
    super(`Error en la columna ${column}`);
    this.column = column;
  }
}

/** "^ Error" bajo la columna del problema, contando el prompt. */
function errorLine(prompt: string, column: number): OutLine {
  return { kind: 'error', text: `${' '.repeat(prompt.length + column)}^ Error` };
}

interface Token {
  text: string;
  col: number;
}

/** Separa por espacios y comas; `=` va como token propio. */
function tokenize(text: string, col: number): Token[] {
  const tokens: Token[] = [];
  const re = /=|[^\s,=]+/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    tokens.push({ text: match[0], col: col + match.index });
  }
  return tokens;
}

function hexValue(token: Token, max = 0xffff): number {
  const n = parseHex(token.text);
  if (n === null || n > max) throw new CommandError(token.col);
  return n;
}

/** Dirección con segmento opcional: "100", "cs:100", "0dab:100". */
function parseAddress(m: Machine, token: Token, defaultSeg: number): Address {
  const colon = token.text.indexOf(':');
  if (colon < 0) return { seg: m.sregs[defaultSeg], off: hexValue(token) };
  const segText = token.text.slice(0, colon).toUpperCase();
  const sreg = (SREG_NAMES as readonly string[]).indexOf(segText);
  const seg = sreg >= 0 ? m.sregs[sreg] : hexValue({ text: segText, col: token.col });
  return { seg, off: hexValue({ text: token.text.slice(colon + 1), col: token.col + colon + 1 }) };
}

/** Rango: "inicio", "inicio fin" o "inicio L longitud". Devuelve el desplazamiento final incluido. */
function parseRange(m: Machine, tokens: Token[], defaultSeg: number, defaultLength: number): { start: Address; end: number } {
  const start = parseAddress(m, tokens[0], defaultSeg);
  if (tokens.length === 1) return { start, end: Math.min(start.off + defaultLength - 1, 0xffff) };
  let lengthToken: Token | null = null;
  let endToken: Token | null = null;
  if (/^l/i.test(tokens[1].text)) {
    const rest = tokens[1].text.slice(1);
    lengthToken = rest !== '' ? { text: rest, col: tokens[1].col + 1 } : (tokens[2] ?? null);
    if (lengthToken === null) throw new CommandError(tokens[1].col + 1);
    const used = rest !== '' ? 2 : 3;
    if (tokens.length > used) throw new CommandError(tokens[used].col);
  } else {
    endToken = tokens[1];
    if (tokens.length > 2) throw new CommandError(tokens[2].col);
  }
  if (lengthToken) {
    const length = hexValue(lengthToken);
    if (length === 0 || start.off + length - 1 > 0xffff) throw new CommandError(lengthToken.col);
    return { start, end: start.off + length - 1 };
  }
  const end = hexValue(endToken!);
  if (end < start.off) throw new CommandError(endToken!.col);
  return { start, end };
}

/** Bytes de una lista de `e`: hexadecimales y cadenas entre comillas, separados por espacios o comas. */
function parseByteList(text: string, col: number): number[] {
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === ',') {
      i++;
    } else if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new CommandError(col + text.length);
      for (const c of text.slice(i + 1, end)) bytes.push(c.charCodeAt(0) & 0xff);
      i = end + 1;
    } else {
      const word = /^[^\s,'"]+/.exec(text.slice(i))![0];
      bytes.push(hexValue({ text: word, col: col + i }, 0xff));
      i += word.length;
    }
  }
  return bytes;
}

// ---------------------------------------------------------------- Salidas

function out(text: string): OutLine {
  return { kind: 'output', text };
}

/** Nota "DS:2000=00" de la tercera línea del volcado: el valor del operando de memoria. */
function memoryNote(m: Machine, instr: Instr): string {
  if (instr.mnem === 'LEA') return '';
  const mem = instr.operands.find((o) => o.kind === 'mem');
  if (!mem || mem.kind !== 'mem') return '';
  const off = effectiveOffset(m, mem);
  const seg = m.sregs[mem.seg];
  const value = mem.size === 8 ? hex2(readByte(m, seg, off)) : hex4(readWord(m, seg, off));
  return `${SREG_NAMES[mem.seg]}:${hex4(off)}=${value}`;
}

/** Columna donde termina la nota de memoria (alineada a la derecha). */
const NOTE_END = 71;

/** Volcado de tres líneas de `r` y `t`. */
export function registerDump(m: Machine): string[] {
  const r = m.regs;
  const s = m.sregs;
  const line1 = (['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI'] as const)
    .map((name) => `${name}=${hex4(r[REG16.indexOf(name)])}`)
    .join(' ');
  const line2 =
    (['DS', 'ES', 'SS', 'CS'] as const).map((name) => `${name}=${hex4(s[SREG.indexOf(name)])}`).join(' ') +
    ` IP=${hex4(m.ip)} ${flagsText(m.flags)}`;
  const instr = decode(m, s[CS], m.ip);
  let line3 = formatLine(s[CS], m.ip, instr);
  const note = memoryNote(m, instr);
  if (note) line3 = line3.padEnd(Math.max(NOTE_END - note.length, line3.length + 1)) + note;
  return [line1, line2, line3];
}

/** Una línea de `d`: dirección, 16 bytes con guion en el medio y columna ASCII. Los bytes fuera del rango quedan en blanco. */
function dumpLine(m: Machine, seg: number, row: number, from: number, to: number): string {
  let hex = '';
  let ascii = '';
  for (let i = 0; i < 16; i++) {
    const off = row + i;
    const inside = off >= from && off <= to;
    const b = inside ? readByte(m, seg, off) : 0;
    hex += inside ? hex2(b) : '  ';
    if (i < 15) hex += i === 7 ? (inside && off + 1 <= to ? '-' : ' ') : ' ';
    ascii += inside ? (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.') : ' ';
  }
  return `${hex4(seg)}:${hex4(row)}  ${hex}   ${ascii}`.trimEnd();
}

// ---------------------------------------------------------------- Ejecución

type RunEnd = 'step' | 'terminated' | 'stopped';

/** Ejecuta una instrucción resolviendo las interrupciones con dos.ts. */
function runOne(m: Machine, output: Output, lines: OutLine[]): { end: RunEnd; brk: boolean } {
  const at = { seg: m.sregs[CS], off: m.ip };
  const result = step(m);
  switch (result.kind) {
    case 'ok':
      return { end: 'step', brk: false };
    case 'int': {
      const r = handleInterrupt(m, result.n, output);
      if (r === 'terminate') return { end: 'terminated', brk: false };
      return { end: 'step', brk: r === 'break' };
    }
    case 'halt':
      return { end: 'step', brk: true };
    case 'undefined':
      output.flush();
      lines.push(...output.lines.map(out));
      output.lines = [];
      lines.push(out(`Opcode no definido (${hex2(result.byte)}) en ${hex4(at.seg)}:${hex4(at.off)}: ejecución detenida`));
      return { end: 'stopped', brk: true };
  }
}

function drain(output: Output, lines: OutLine[]): void {
  output.flush();
  lines.push(...output.lines.map(out));
  output.lines = [];
}

/** `=dirección` al principio de los argumentos de `t` y `g`. */
function takeStart(m: Machine, tokens: Token[]): Token[] {
  if (tokens[0]?.text !== '=') return tokens;
  if (!tokens[1]) throw new CommandError(tokens[0].col + 1);
  const addr = parseAddress(m, tokens[1], CS);
  m.sregs[CS] = addr.seg;
  m.ip = addr.off;
  return tokens.slice(2);
}

function trace(m: Machine, tokens: Token[]): OutLine[] {
  const rest = takeStart(m, tokens);
  if (rest.length > 1) throw new CommandError(rest[1].col);
  const count = rest[0] ? hexValue(rest[0]) : 1;
  if (count === 0) throw new CommandError(rest[0].col);
  const lines: OutLine[] = [];
  const output = new Output();
  for (let i = 0; i < count; i++) {
    const { end } = runOne(m, output, lines);
    drain(output, lines);
    if (end === 'terminated' || end === 'stopped') break;
    lines.push(...registerDump(m).map(out));
  }
  return lines;
}

function go(m: Machine, tokens: Token[]): OutLine[] {
  const rest = takeStart(m, tokens);
  const breakpoints = new Set(rest.map((t) => parseAddress(m, t, CS)).map((a) => a.seg * 0x10000 + a.off));
  const lines: OutLine[] = [];
  const output = new Output();
  for (let i = 0; i < MAX_STEPS; i++) {
    const { end, brk } = runOne(m, output, lines);
    if (end === 'terminated' || end === 'stopped') {
      drain(output, lines);
      return lines;
    }
    if (brk || breakpoints.has(m.sregs[CS] * 0x10000 + m.ip)) {
      drain(output, lines);
      lines.push(...registerDump(m).map(out));
      return lines;
    }
  }
  drain(output, lines);
  lines.push(out(`Ejecución detenida tras ${MAX_STEPS.toLocaleString('es')} instrucciones`));
  lines.push(...registerDump(m).map(out));
  return lines;
}

function unassemble(m: Machine, state: CommandState, tokens: Token[]): OutLine[] {
  let start: Address;
  let end: number;
  if (tokens.length === 0) {
    start = state.unasmAddr ?? { seg: m.sregs[CS], off: m.ip };
    end = Math.min(start.off + 0x1f, 0xffff);
  } else {
    ({ start, end } = parseRange(m, tokens, CS, 0x20));
  }
  const lines: OutLine[] = [];
  let off = start.off;
  // Nunca corta una instrucción: imprime toda instrucción que empiece dentro del rango
  while (off <= end) {
    const instr = decode(m, start.seg, off);
    lines.push(out(formatLine(start.seg, off, instr)));
    off += instr.length;
    if (off > 0xffff) break;
  }
  state.unasmAddr = { seg: start.seg, off: off & 0xffff };
  return lines;
}

function dump(m: Machine, state: CommandState, tokens: Token[]): { lines: OutLine[]; focus: number } {
  let start: Address;
  let end: number;
  if (tokens.length === 0) {
    start = state.dumpAddr ?? { seg: m.sregs[DS], off: 0x100 };
    end = Math.min(start.off + 0x7f, 0xffff);
  } else {
    ({ start, end } = parseRange(m, tokens, DS, 0x80));
  }
  const lines: OutLine[] = [];
  for (let row = start.off & 0xfff0; row <= end; row += 16) {
    lines.push(out(dumpLine(m, start.seg, row, start.off, end)));
  }
  state.dumpAddr = { seg: start.seg, off: (end + 1) & 0xffff };
  return { lines, focus: start.off };
}

// ---------------------------------------------------------------- Modos

function runAssemble(m: Machine, state: CommandState, line: string, prompt: string): RunResult {
  if (line.trim() === '') {
    state.mode = 'command';
    return { output: [] };
  }
  const result = assemble(line, state.asmAddr.off);
  if (!result.ok) return { output: [errorLine(prompt, result.column)] };
  const { seg, off } = state.asmAddr;
  result.bytes.forEach((b, i) => writeByte(m, seg, off + i, b, 'code'));
  const next = off + result.bytes.length;
  state.asmAddr = { seg, off: next & 0xffff };
  state.asmLimit = Math.max(state.asmLimit, next);
  return { output: [] };
}

function runRegister(m: Machine, state: CommandState, line: string, prompt: string): RunResult {
  const name = state.editReg!;
  const tokens = tokenize(line, 0);
  if (tokens.length === 0) {
    state.mode = 'command';
    return { output: [] };
  }
  try {
    if (tokens.length > 1) throw new CommandError(tokens[1].col);
    const value = hexValue(tokens[0]);
    if (name === 'IP') m.ip = value;
    else if (REG16.includes(name as (typeof REG16)[number])) m.regs[REG16.indexOf(name as (typeof REG16)[number])] = value;
    else m.sregs[SREG.indexOf(name as (typeof SREG)[number])] = value;
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    state.mode = 'command';
    return { output: [errorLine(prompt, e.column)] };
  }
  state.mode = 'command';
  return { output: [] };
}

function runEdit(m: Machine, state: CommandState, line: string, prompt: string): RunResult {
  if (line.trim() === '') {
    state.mode = 'command';
    return { output: [] };
  }
  let bytes: number[];
  try {
    bytes = parseByteList(line, 0);
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    return { output: [errorLine(prompt, e.column)] };
  }
  const { seg, off } = state.editAddr;
  bytes.forEach((b, i) => writeByte(m, seg, off + i, b, 'edit'));
  state.editAddr = { seg, off: (off + bytes.length) & 0xffff };
  return { output: [], dataFocus: off };
}

function runCommand(m: Machine, state: CommandState, line: string): RunResult {
  const lead = line.length - line.trimStart().length;
  const text = line.trimStart();
  if (text === '') return { output: [] };
  const cmd = text[0].toLowerCase();
  const argsCol = lead + 1;
  const argsText = text.slice(1);
  const tokens = tokenize(argsText, argsCol);

  switch (cmd) {
    case 'a': {
      if (tokens.length > 1) throw new CommandError(tokens[1].col);
      if (tokens[0]) state.asmAddr = parseAddress(m, tokens[0], CS);
      state.mode = 'assemble';
      return { output: [] };
    }
    case 'u':
      return { output: unassemble(m, state, tokens) };
    case 'r': {
      if (tokens.length === 0) return { output: registerDump(m).map(out) };
      if (tokens.length > 1) throw new CommandError(tokens[1].col);
      const name = tokens[0].text.toUpperCase() === 'PC' ? 'IP' : tokens[0].text.toUpperCase();
      if (!(REGISTER_NAMES as readonly string[]).includes(name)) throw new CommandError(tokens[0].col);
      const reg = name as RegisterName;
      const value =
        reg === 'IP' ? m.ip
          : REG16.includes(reg as (typeof REG16)[number]) ? m.regs[REG16.indexOf(reg as (typeof REG16)[number])]
            : m.sregs[SREG.indexOf(reg as (typeof SREG)[number])];
      state.editReg = reg;
      state.mode = 'register';
      return { output: [out(`${reg} ${hex4(value)}`)] };
    }
    case 't':
      return { output: trace(m, tokens) };
    case 'g':
      return { output: go(m, tokens) };
    case 'd': {
      const { lines, focus } = dump(m, state, tokens);
      return { output: lines, dataFocus: focus };
    }
    case 'e': {
      if (tokens.length === 0) throw new CommandError(argsCol + argsText.length);
      const addr = parseAddress(m, tokens[0], DS);
      const listCol = tokens[0].col + tokens[0].text.length;
      const list = line.slice(listCol);
      if (list.trim() === '') {
        state.editAddr = addr;
        state.mode = 'edit';
        return { output: [], dataFocus: addr.off };
      }
      const bytes = parseByteList(list, listCol);
      bytes.forEach((b, i) => writeByte(m, addr.seg, addr.off + i, b, 'edit'));
      return { output: [], dataFocus: addr.off };
    }
    case 'q':
      if (tokens.length > 0) throw new CommandError(tokens[0].col);
      return { output: [], reset: true };
    default:
      throw new CommandError(lead);
  }
}

/** Procesa una línea en el modo actual. `prompt` es el que tenía delante, para ubicar el "^ Error". */
export function run(m: Machine, state: CommandState, line: string): RunResult {
  const prompt = promptFor(m, state);
  switch (state.mode) {
    case 'assemble':
      return runAssemble(m, state, line, prompt);
    case 'register':
      return runRegister(m, state, line, prompt);
    case 'edit':
      return runEdit(m, state, line, prompt);
    case 'command':
      try {
        return runCommand(m, state, line);
      } catch (e) {
        if (e instanceof CommandError) return { output: [errorLine(prompt, e.column)] };
        throw e;
      }
  }
}
