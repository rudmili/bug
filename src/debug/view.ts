import { FLAG_CODES } from './flags';
import { hex2, hex4, toSigned16 } from './hex';
import { phys, readWord } from './memory';
import { CS, DS, INITIAL_SP, REG16, SP, SREG, SS } from './state';
import type { Machine, Snapshot, WriteRecord } from './state';
import type {
  DebugView,
  FlagKey,
  FlagView,
  MemoryRowView,
  RegisterName,
  RegisterView,
  StackRowView,
  StackViewModel,
  TerminalLine,
} from './types';

/** Arma el DebugView que dibuja la interfaz. Siempre devuelve objetos nuevos: el React Compiler compara por identidad. */

/** Lo que la vista recuerda entre comandos. */
export interface ViewState {
  /** Desplazamiento de la primera fila de la ventana de código. */
  codeStart: number;
  /** Desplazamiento en DS al que mira la ventana de datos. */
  dataAnchor: number;
  dataHot: boolean;
  changedRegs: ReadonlySet<RegisterName>;
  changedFlags: ReadonlySet<FlagKey>;
  /** Direcciones físicas escritas por el último comando que modificó la máquina. */
  hotBytes: ReadonlySet<number>;
}

export function createViewState(): ViewState {
  return {
    codeStart: 0x100,
    dataAnchor: 0x200,
    dataHot: false,
    changedRegs: new Set(),
    changedFlags: new Set(),
    hotBytes: new Set(),
  };
}

const REGISTER_ORDER: RegisterName[] = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'DS', 'ES', 'SS', 'CS', 'IP'];
const FLAG_ORDER: FlagKey[] = ['OF', 'DF', 'IF', 'SF', 'ZF', 'AF', 'PF', 'CF'];
const FLAG_LABELS: Record<FlagKey, string> = {
  OF: 'Desb.',
  DF: 'Direc.',
  IF: 'Interr.',
  SF: 'Signo',
  ZF: 'Cero',
  AF: 'Aux.',
  PF: 'Paridad',
  CF: 'Acarreo',
};

const ROWS = 8;
/** La pila vacía empieza en el SP inicial y puede crecer hasta el principio del segmento, pisando el PSP. */
const STACK_START = INITIAL_SP;
const STACK_LIMIT = 0x0000;

function registerValue(s: Pick<Snapshot, 'regs' | 'sregs' | 'ip'>, name: RegisterName): number {
  if (name === 'IP') return s.ip;
  const r = REG16.indexOf(name as (typeof REG16)[number]);
  return r >= 0 ? s.regs[r] : s.sregs[SREG.indexOf(name as (typeof SREG)[number])];
}

function memoryRows(m: Machine, seg: number, start: number, hot: ReadonlySet<number>): MemoryRowView[] {
  const ip = phys(m.sregs[CS], m.ip);
  return Array.from({ length: ROWS }, (_, r) => {
    const row = (start + r * 16) & 0xffff;
    return {
      address: hex4(row),
      bytes: Array.from({ length: 16 }, (_, i) => {
        const addr = phys(seg, row + i);
        const value = m.mem[addr];
        return { value: hex2(value), nonZero: value !== 0, changed: hot.has(addr), isIp: addr === ip };
      }),
    };
  });
}

function stackView(m: Machine): StackViewModel {
  const sp = m.regs[SP];
  const ss = m.sregs[SS];
  const rows: StackRowView[] = [];
  const row = (address: number, isSp: boolean, note: string): StackRowView => ({
    address: hex4(address),
    value: hex4(readWord(m, ss, address)),
    isSp,
    note,
  });

  // Hasta 4 palabras apiladas por encima de SP, de mayor a menor dirección
  for (let k = 4; k >= 1; k--) {
    const address = sp + k * 2;
    if (address <= STACK_START) rows.push(row(address, false, ''));
  }
  const atTop = sp === STACK_START && readWord(m, ss, sp) === 0;
  rows.push(row(sp, true, atTop ? 'tope · retorno a DOS' : ''));
  for (let k = 1; k <= 3; k++) {
    rows.push(row((sp - k * 2) & 0xffff, false, k === 1 ? 'libre · próximo push' : 'libre'));
  }

  const total = STACK_START - STACK_LIMIT;
  const used = Math.min(Math.max(toSigned16(STACK_START - sp), 0), total);
  return {
    pointer: `SS:SP ${hex4(ss)}:${hex4(sp)}`,
    rows,
    start: hex4(STACK_START),
    limit: hex4(STACK_LIMIT),
    usedBytes: used,
    totalBytes: total,
    position: total === 0 ? 0 : used / total,
  };
}

export interface BuildInput {
  machine: Machine;
  /** Registros y banderas antes del comando. */
  prev: Snapshot;
  /** Escrituras en memoria del comando. */
  writes: readonly WriteRecord[];
  /** Dirección que mostró `d` o editó `e`. */
  dataFocus?: number;
  lines: TerminalLine[];
  prompt: string;
  state: ViewState;
}

export function buildView(input: BuildInput): { view: DebugView; state: ViewState } {
  const { machine: m, prev, writes, state } = input;

  const changedRegs = new Set(REGISTER_ORDER.filter((n) => registerValue(m, n) !== registerValue(prev, n)));
  const changedFlags = new Set(FLAG_ORDER.filter((k) => m.flags[k] !== prev.flags[k]));
  const modified = changedRegs.size > 0 || changedFlags.size > 0 || writes.length > 0;

  // Ventana de datos: la última escritura de una instrucción (no de pila), o lo último que se vio con d o e
  const ds = m.sregs[DS];
  const lastData = writes.findLast((w) => w.kind === 'data');
  let dataAnchor = state.dataAnchor;
  let dataHot = modified ? false : state.dataHot;
  if (lastData) {
    dataAnchor = (lastData.addr - ds * 16) & 0xffff;
    dataHot = true;
  } else if (input.dataFocus !== undefined) {
    dataAnchor = input.dataFocus;
    dataHot = false;
  }

  // Ventana de código: se mueve solo cuando IP queda fuera
  let codeStart = state.codeStart;
  const ip = m.ip;
  if (((ip - codeStart) & 0xffff) >= ROWS * 16) codeStart = ip & 0xfff0;

  const next: ViewState = modified
    ? { codeStart, dataAnchor, dataHot, changedRegs, changedFlags, hotBytes: new Set(writes.map((w) => w.addr)) }
    : { ...state, codeStart, dataAnchor, dataHot };

  const registers: RegisterView[] = REGISTER_ORDER.map((name) => ({
    name,
    value: hex4(registerValue(m, name)),
    changed: next.changedRegs.has(name),
  }));
  const flags: FlagView[] = FLAG_ORDER.map((key) => ({
    key,
    code: FLAG_CODES[key][m.flags[key] ? 1 : 0],
    label: FLAG_LABELS[key],
    changed: next.changedFlags.has(key),
  }));

  const view: DebugView = {
    lines: input.lines,
    prompt: input.prompt,
    registers,
    flags,
    code: {
      title: 'Memoria · código',
      caption: 'sigue a CS:IP',
      captionValue: hex4(ip),
      captionHot: false,
      rows: memoryRows(m, m.sregs[CS], codeStart, next.hotBytes),
    },
    data: {
      title: 'Memoria · datos',
      caption: 'última escritura',
      captionValue: `[${hex4(dataAnchor)}]`,
      captionHot: dataHot,
      rows: memoryRows(m, ds, dataAnchor & 0xfff0, next.hotBytes),
    },
    stack: stackView(m),
    // Lo marca session cuando la línea fue `q`
    restarted: false,
  };
  return { view, state: next };
}

