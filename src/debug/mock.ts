import type {
  ByteView,
  DebugSession,
  DebugView,
  FlagView,
  MemoryRowView,
  RegisterView,
  TerminalLine,
} from './types';

/**
 * Sesión falsa para trabajar en la interfaz sin la lógica.
 * Muestra un estado fijo (el de la traza con AX=FF00) y repite cada línea escrita.
 */

const REGISTERS: RegisterView[] = [
  { name: 'AX', value: 'FF00', changed: true },
  { name: 'BX', value: '0000', changed: false },
  { name: 'CX', value: '0000', changed: false },
  { name: 'DX', value: '0000', changed: false },
  { name: 'SP', value: '00FD', changed: false },
  { name: 'BP', value: '0000', changed: false },
  { name: 'SI', value: '0000', changed: false },
  { name: 'DI', value: '0000', changed: false },
  { name: 'DS', value: '073F', changed: false },
  { name: 'ES', value: '073F', changed: false },
  { name: 'SS', value: '073F', changed: false },
  { name: 'CS', value: '073F', changed: false },
  { name: 'IP', value: '0108', changed: true },
];

const FLAGS: FlagView[] = [
  { key: 'OF', code: 'NV', label: 'Desb.', changed: false },
  { key: 'DF', code: 'UP', label: 'Direc.', changed: false },
  { key: 'IF', code: 'EI', label: 'Interr.', changed: false },
  { key: 'SF', code: 'NG', label: 'Signo', changed: false },
  { key: 'ZF', code: 'NZ', label: 'Cero', changed: false },
  { key: 'AF', code: 'AC', label: 'Aux.', changed: true },
  { key: 'PF', code: 'PE', label: 'Paridad', changed: true },
  { key: 'CF', code: 'CY', label: 'Acarreo', changed: true },
];

const PROGRAM = [0xb4, 0x08, 0x80, 0xc4, 0x03, 0x80, 0xec, 0x0c, 0x88, 0x26, 0x00, 0x20];

function rows(start: number, fill: (offset: number) => ByteView): MemoryRowView[] {
  return Array.from({ length: 8 }, (_, r) => {
    const base = start + r * 16;
    return {
      address: base.toString(16).toUpperCase().padStart(4, '0'),
      bytes: Array.from({ length: 16 }, (_, i) => fill(base + i)),
    };
  });
}

function byte(value: number, extra: Partial<ByteView> = {}): ByteView {
  return {
    value: value.toString(16).toUpperCase().padStart(2, '0'),
    nonZero: value !== 0,
    changed: false,
    isIp: false,
    ...extra,
  };
}

function baseView(lines: TerminalLine[]): DebugView {
  return {
    lines,
    prompt: '-',
    registers: REGISTERS,
    flags: FLAGS,
    code: {
      title: 'Memoria · código',
      caption: 'sigue a CS:IP',
      captionValue: '0100',
      captionHot: false,
      pinned: false,
      rows: rows(0x100, (o) => byte(PROGRAM[o - 0x100] ?? 0, { isIp: o === 0x108 })),
    },
    data: {
      title: 'Memoria · datos',
      caption: 'última escritura',
      captionValue: '[2000]',
      captionHot: false,
      pinned: false,
      rows: rows(0x2000, () => byte(0)),
    },
    stack: {
      pointer: 'SS:SP 073F:00FD',
      rows: [
        { address: '00FD', value: '0000', isSp: true, note: 'tope · retorno a DOS' },
        { address: '00FB', value: '0000', isSp: false, note: 'libre · próximo push' },
        { address: '00F9', value: '0000', isSp: false, note: 'libre' },
        { address: '00F7', value: '0000', isSp: false, note: 'libre' },
      ],
      start: '00FD',
      limit: '0000',
      usedBytes: 0,
      totalBytes: 0xfd,
      position: 0,
    },
    restarted: false,
    waiting: false,
  };
}

export function createMockSession(): DebugSession {
  let nextId = 0;
  let view = baseView([
    { id: nextId++, kind: 'command', text: '-r' },
    { id: nextId++, kind: 'output', text: 'AX=FF00  BX=0000  CX=0000  DX=0000  SP=00FD  BP=0000  SI=0000  DI=0000' },
    { id: nextId++, kind: 'output', text: 'DS=073F  ES=073F  SS=073F  CS=073F  IP=0108   NV UP EI NG NZ AC PE CY' },
    { id: nextId++, kind: 'output', text: '073F:0108 88260020      MOV     [2000],AH                   DS:2000=00' },
  ]);

  return {
    getView: () => view,
    submit(line) {
      view = { ...view, lines: [...view.lines, { id: nextId++, kind: 'command', text: view.prompt + line }] };
      return view;
    },
    // El diseño fijo no tiene más memoria que mostrar
    moveWindow: () => view,
  };
}
