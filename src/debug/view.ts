import { addressFromText } from './commands';
import { FLAG_CODES } from './flags';
import { hex2, hex4, toSigned16 } from './hex';
import { phys, readWord } from './memory';
import { CS, DS, INITIAL_SP, REGISTER_NAMES, SP, SS, readRegister } from './state';
import type { Machine, Snapshot, WriteRecord } from './state';
import type {
  DebugView,
  FlagKey,
  FlagView,
  MemoryRowView,
  MemoryTarget,
  MemoryWindowName,
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
  /** Desplazamiento al que mira la ventana de datos. */
  dataAnchor: number;
  dataHot: boolean;
  /** Ventanas movidas a mano: no siguen a CS:IP ni a las escrituras. */
  codePinned: boolean;
  dataPinned: boolean;
  /** Segmento de la ventana de datos si se eligió otro con "ir a" (es:200); null es DS. */
  dataSeg: number | null;
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
    codePinned: false,
    dataPinned: false,
    dataSeg: null,
    changedRegs: new Set(),
    changedFlags: new Set(),
    hotBytes: new Set(),
  };
}

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
  /** El programa espera una tecla. */
  waiting?: boolean;
  /** Hora de arranque de la sesión (DebugView.clock). */
  clock?: string;
}

export function buildView(input: BuildInput): { view: DebugView; state: ViewState } {
  const { machine: m, prev, writes, state } = input;

  const changedRegs = new Set(REGISTER_NAMES.filter((n) => readRegister(m, n) !== readRegister(prev, n)));
  const changedFlags = new Set(FLAG_ORDER.filter((k) => m.flags[k] !== prev.flags[k]));
  const modified = changedRegs.size > 0 || changedFlags.size > 0 || writes.length > 0;

  // Ventana de datos: la última escritura de una instrucción (no de pila), o lo último que se vio con d o e.
  // Fijada a mano no sigue al programa, pero un d o un e la mueven y la vuelven a soltar
  const ds = m.sregs[DS];
  const lastData = writes.findLast((w) => w.kind === 'data');
  let { dataAnchor, dataPinned, dataSeg } = state;
  let dataHot = modified ? false : state.dataHot;
  if (input.dataFocus !== undefined) {
    dataAnchor = input.dataFocus;
    dataHot = false;
    dataPinned = false;
    dataSeg = null;
  } else if (lastData && !dataPinned) {
    dataAnchor = (lastData.addr - ds * 16) & 0xffff;
    dataHot = true;
  }

  // Ventana de código: se mueve solo cuando IP queda fuera, y no si está fijada
  let codeStart = state.codeStart;
  const ip = m.ip;
  if (!state.codePinned && ((ip - codeStart) & 0xffff) >= ROWS * 16) codeStart = ip & 0xfff0;

  const windows = { codeStart, dataAnchor, dataHot, dataPinned, dataSeg };
  const next: ViewState = modified
    ? { ...state, ...windows, changedRegs, changedFlags, hotBytes: new Set(writes.map((w) => w.addr)) }
    : { ...state, ...windows };
  const dataSegment = next.dataSeg ?? ds;

  const registers: RegisterView[] = REGISTER_NAMES.map((name) => ({
    name,
    value: hex4(readRegister(m, name)),
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
      caption: next.codePinned ? 'fija' : 'sigue a CS:IP',
      captionValue: hex4(next.codePinned ? codeStart : ip),
      captionHot: false,
      pinned: next.codePinned,
      rows: memoryRows(m, m.sregs[CS], codeStart, next.hotBytes),
    },
    data: {
      title: 'Memoria · datos',
      caption: next.dataPinned ? 'fija' : 'última escritura',
      // En otro segmento se muestra completo: [1234:0200]
      captionValue: `[${next.dataSeg === null ? '' : `${hex4(next.dataSeg)}:`}${hex4(dataAnchor)}]`,
      captionHot: dataHot,
      pinned: next.dataPinned,
      rows: memoryRows(m, dataSegment, dataAnchor & 0xfff0, next.hotBytes),
    },
    stack: stackView(m),
    // Lo marca session cuando la línea fue `q`
    restarted: false,
    waiting: input.waiting ?? false,
    clock: input.clock ?? '',
  };
  return { view, state: next };
}


/**
 * Mueve una ventana de memoria a pedido de la interfaz: una página, una dirección o de vuelta al
 * modo automático. Movida a mano queda fija. null si la dirección no es válida.
 * La ventana de código siempre mira CS; la de datos admite otro segmento ("es:200").
 */
export function moveWindow(m: Machine, state: ViewState, window: MemoryWindowName, to: MemoryTarget): ViewState | null {
  if (window === 'code') {
    if ('follow' in to) {
      // Vuelve a mostrar CS:IP desde su fila, como al seguir la ejecución
      return { ...state, codePinned: false, codeStart: m.ip & 0xfff0 };
    }
    if ('by' in to) return { ...state, codePinned: true, codeStart: (state.codeStart + to.by) & 0xfff0 };
    const addr = addressFromText(m, to.address, CS);
    if (!addr || addr.seg !== m.sregs[CS]) return null;
    return { ...state, codePinned: true, codeStart: addr.off & 0xfff0 };
  }
  if ('follow' in to) return { ...state, dataPinned: false, dataSeg: null };
  if ('by' in to) return { ...state, dataPinned: true, dataAnchor: ((state.dataAnchor & 0xfff0) + to.by) & 0xffff };
  const addr = addressFromText(m, to.address, DS);
  if (!addr) return null;
  return { ...state, dataPinned: true, dataAnchor: addr.off, dataSeg: addr.seg === m.sregs[DS] ? null : addr.seg };
}
