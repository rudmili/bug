import { assemble } from './assembler';
import { SREG_NAMES, decode } from './decoder';
import type { Instr } from './decoder';
import { formatLine } from './disassembler';
import { Output, handleInterrupt } from './dos';
import { effectiveOffset, step } from './executor';
import { flagsText } from './flags';
import { hex2, hex4, parseHex } from './hex';
import { manual } from './manual';
import { readByte, readWord, writeByte } from './memory';
import { CS, DS, REG16, SREG, isRegisterName, readRegister, writeRegister } from './state';
import type { Machine } from './state';
import type { RegisterName } from './types';

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
}

export interface OutLine {
  kind: 'output' | 'error';
  text: string;
}

export interface RunResult {
  output: OutLine[];
  /** `q`: la sesión vuelve al estado inicial. */
  reset?: boolean;
  /** `clear`: borra la terminal sin tocar la máquina. */
  clear?: boolean;
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

/** Dirección con segmento opcional: "100", "cs:100", "073f:100". */
function parseAddress(m: Machine, token: Token, defaultSeg: number): Address {
  const colon = token.text.indexOf(':');
  if (colon < 0) return { seg: m.sregs[defaultSeg], off: hexValue(token) };
  const segText = token.text.slice(0, colon).toUpperCase();
  const sreg = (SREG_NAMES as readonly string[]).indexOf(segText);
  const seg = sreg >= 0 ? m.sregs[sreg] : hexValue({ text: segText, col: token.col });
  return { seg, off: hexValue({ text: token.text.slice(colon + 1), col: token.col + colon + 1 }) };
}

/** Dirección escrita fuera de un comando (el campo "ir a" de las ventanas de memoria), o null si no es válida. */
export function addressFromText(m: Machine, text: string, defaultSeg: number): Address | null {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  try {
    return parseAddress(m, { text: trimmed, col: 0 }, defaultSeg);
  } catch (e) {
    if (e instanceof CommandError) return null;
    throw e;
  }
}

/** Rango al principio de los argumentos: "inicio fin" o "inicio L longitud". Devuelve el desplazamiento final incluido y cuántos tokens usó. */
function leadingRange(m: Machine, tokens: Token[], defaultSeg: number, missingCol: number): { start: Address; end: number; used: number } {
  if (!tokens[0]) throw new CommandError(missingCol);
  const start = parseAddress(m, tokens[0], defaultSeg);
  const second = tokens[1];
  if (!second) throw new CommandError(tokens[0].col + tokens[0].text.length);
  if (/^l/i.test(second.text)) {
    const rest = second.text.slice(1);
    const lengthToken = rest !== '' ? { text: rest, col: second.col + 1 } : tokens[2];
    if (!lengthToken) throw new CommandError(second.col + 1);
    const length = hexValue(lengthToken);
    if (length === 0 || start.off + length - 1 > 0xffff) throw new CommandError(lengthToken.col);
    return { start, end: start.off + length - 1, used: rest !== '' ? 2 : 3 };
  }
  const end = hexValue(second);
  if (end < start.off) throw new CommandError(second.col);
  return { start, end, used: 2 };
}

/** Rango de `u` y `d`: "inicio", "inicio fin" o "inicio L longitud". Devuelve el desplazamiento final incluido. */
function parseRange(m: Machine, tokens: Token[], defaultSeg: number, defaultLength: number): { start: Address; end: number } {
  if (tokens.length === 1) {
    const start = parseAddress(m, tokens[0], defaultSeg);
    return { start, end: Math.min(start.off + defaultLength - 1, 0xffff) };
  }
  const { start, end, used } = leadingRange(m, tokens, defaultSeg, 0);
  if (tokens.length > used) throw new CommandError(tokens[used].col);
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
const NOTE_END = 70;

/** Volcado de tres líneas de `r` y `t`, con el espaciado del DEBUG de MS-DOS: dos espacios entre registros y tres antes de las banderas. */
export function registerDump(m: Machine): string[] {
  const r = m.regs;
  const s = m.sregs;
  const line1 = (['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI'] as const)
    .map((name) => `${name}=${hex4(r[REG16.indexOf(name)])}`)
    .join('  ');
  const line2 =
    (['DS', 'ES', 'SS', 'CS'] as const).map((name) => `${name}=${hex4(s[SREG.indexOf(name)])}`).join('  ') +
    `  IP=${hex4(m.ip)}   ${flagsText(m.flags)}`;
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

/** Instrucciones que `p` ejecuta enteras: sigue hasta que la ejecución vuelve a la instrucción siguiente. */
const PROCEED = new Set(['CALL', 'CALL FAR', 'LOOP', 'LOOPZ', 'LOOPNZ']);

/** La instrucción en CS:IP sin sus prefijos, y cuántos bytes ocupa con ellos. */
function instructionAt(m: Machine): { instr: Instr; length: number } {
  let length = 0;
  for (let i = 0; i < 16; i++) {
    const instr = decode(m, m.sregs[CS], (m.ip + length) & 0xffff);
    length += instr.length;
    if (!instr.prefix) return { instr, length };
  }
  return { instr: decode(m, m.sregs[CS], m.ip), length };
}

/** Un paso de `p`: como `t`, salvo que una llamada o un LOOP se ejecutan hasta volver a la siguiente instrucción. */
function proceedOne(m: Machine, output: Output, lines: OutLine[]): RunEnd {
  const { instr, length } = instructionAt(m);
  if (!PROCEED.has(instr.mnem)) return runOne(m, output, lines).end;
  const seg = m.sregs[CS];
  const back = (m.ip + length) & 0xffff;
  for (let i = 0; i < MAX_STEPS; i++) {
    const { end, brk } = runOne(m, output, lines);
    if (end !== 'step' || brk) return end;
    if (m.sregs[CS] === seg && m.ip === back) return 'step';
  }
  output.writeLine(`Ejecución detenida tras ${MAX_STEPS.toLocaleString('es')} instrucciones`);
  return 'step';
}

/** `t` y `p`: ejecutan `cantidad` pasos y muestran los registros después de cada uno. */
function trace(m: Machine, tokens: Token[], proceed = false): OutLine[] {
  const rest = takeStart(m, tokens);
  if (rest.length > 1) throw new CommandError(rest[1].col);
  const count = rest[0] ? hexValue(rest[0]) : 1;
  if (count === 0) throw new CommandError(rest[0].col);
  const lines: OutLine[] = [];
  const output = new Output();
  for (let i = 0; i < count; i++) {
    const end = proceed ? proceedOne(m, output, lines) : runOne(m, output, lines).end;
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

// ---------------------------------------------------------------- Memoria y aritmética

/** Rango y lista de bytes de `f` y `s`: "f 200 l 10 41 42", "s 100 1ff 'Hola'". */
function rangeAndList(m: Machine, line: string, tokens: Token[], missingCol: number): { start: Address; end: number; bytes: number[] } {
  const { start, end, used } = leadingRange(m, tokens, DS, missingCol);
  const listToken = tokens[used];
  if (!listToken) throw new CommandError(line.length);
  return { start, end, bytes: parseByteList(line.slice(listToken.col), listToken.col) };
}

/** Rango y dirección de destino de `m` y `c`. */
function rangeAndAddress(m: Machine, line: string, tokens: Token[], missingCol: number): { start: Address; end: number; dest: Address } {
  const { start, end, used } = leadingRange(m, tokens, DS, missingCol);
  const destToken = tokens[used];
  if (!destToken) throw new CommandError(line.length);
  if (tokens.length > used + 1) throw new CommandError(tokens[used + 1].col);
  return { start, end, dest: parseAddress(m, destToken, DS) };
}

/** `f`: llena el rango repitiendo la lista. */
function fill(m: Machine, line: string, tokens: Token[], missingCol: number): RunResult {
  const { start, end, bytes } = rangeAndList(m, line, tokens, missingCol);
  for (let off = start.off, i = 0; off <= end; off++, i++) writeByte(m, start.seg, off, bytes[i % bytes.length], 'edit');
  return { output: [], dataFocus: start.off };
}

/** `m`: copia el rango al destino. Lee todo antes de escribir, así un destino que se superpone sale bien. */
function move(m: Machine, line: string, tokens: Token[], missingCol: number): RunResult {
  const { start, end, dest } = rangeAndAddress(m, line, tokens, missingCol);
  const bytes = Array.from({ length: end - start.off + 1 }, (_, i) => readByte(m, start.seg, start.off + i));
  bytes.forEach((b, i) => writeByte(m, dest.seg, dest.off + i, b, 'edit'));
  return { output: [], dataFocus: dest.off };
}

/** `c`: una línea por cada byte distinto, "073F:0100  41  42  073F:0200". */
function compare(m: Machine, line: string, tokens: Token[], missingCol: number): OutLine[] {
  const { start, end, dest } = rangeAndAddress(m, line, tokens, missingCol);
  const at = (seg: number, off: number) => `${hex4(seg)}:${hex4(off & 0xffff)}`;
  const lines: OutLine[] = [];
  for (let i = 0; i <= end - start.off; i++) {
    const a = readByte(m, start.seg, start.off + i);
    const b = readByte(m, dest.seg, dest.off + i);
    if (a !== b) lines.push(out(`${at(start.seg, start.off + i)}  ${hex2(a)}  ${hex2(b)}  ${at(dest.seg, dest.off + i)}`));
  }
  return lines;
}

/** `s`: la dirección de cada aparición de la lista que entra entera en el rango. */
function search(m: Machine, line: string, tokens: Token[], missingCol: number): OutLine[] {
  const { start, end, bytes } = rangeAndList(m, line, tokens, missingCol);
  const lines: OutLine[] = [];
  for (let off = start.off; off + bytes.length - 1 <= end; off++) {
    if (bytes.every((b, i) => readByte(m, start.seg, off + i) === b)) lines.push(out(`${hex4(start.seg)}:${hex4(off)}`));
  }
  return lines;
}

/** `h`: suma y resta de dos números de 16 bits, "0008  0002". */
function hexArith(tokens: Token[], missingCol: number): OutLine[] {
  if (tokens.length < 2) throw new CommandError(tokens[0] ? tokens[0].col + tokens[0].text.length : missingCol);
  if (tokens.length > 2) throw new CommandError(tokens[2].col);
  const [a, b] = tokens.map((t) => hexValue(t));
  return [out(`${hex4((a + b) & 0xffff)}  ${hex4((a - b) & 0xffff)}`)];
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
    writeRegister(m, name, hexValue(tokens[0]));
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
  // `man` no es de DEBUG: es la ayuda del simulador. DEBUG no tiene comandos de varias letras, así que no choca
  if (/^man(\s|$)/i.test(text)) {
    const { ok, lines } = manual(text.slice(3));
    return { output: lines.map((l) => (ok ? out(l) : { kind: 'error', text: l })) };
  }
  // `clear`, como en Linux: limpia la pantalla y conserva memoria y registros (a diferencia de `q`)
  if (/^clear(\s|$)/i.test(text)) {
    const extra = tokenize(text.slice(5), lead + 5);
    if (extra.length > 0) throw new CommandError(extra[0].col);
    return { output: [], clear: true };
  }
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
      if (!isRegisterName(name)) throw new CommandError(tokens[0].col);
      state.editReg = name;
      state.mode = 'register';
      return { output: [out(`${name} ${hex4(readRegister(m, name))}`)] };
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
    case 'p':
      return { output: trace(m, tokens, true) };
    case 'h':
      return { output: hexArith(tokens, argsCol + argsText.length) };
    case 'f':
      return fill(m, line, tokens, argsCol + argsText.length);
    case 'm':
      return move(m, line, tokens, argsCol + argsText.length);
    case 'c':
      return { output: compare(m, line, tokens, argsCol + argsText.length) };
    case 's':
      return { output: search(m, line, tokens, argsCol + argsText.length) };
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
