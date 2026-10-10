/**
 * Contrato entre la lógica (el simulador) y la interfaz.
 *
 * La interfaz no sabe nada del 8086: solo dibuja un DebugView.
 * La lógica no sabe nada de React: solo produce un DebugView después de cada línea.
 * Todos los valores numéricos llegan ya formateados en hexadecimal y en mayúsculas.
 */

export type RegisterName =
  | 'AX' | 'BX' | 'CX' | 'DX'
  | 'SP' | 'BP' | 'SI' | 'DI'
  | 'DS' | 'ES' | 'SS' | 'CS'
  | 'IP';

export interface RegisterView {
  name: RegisterName;
  /** Cuatro dígitos hexadecimales, por ejemplo "FF00". */
  value: string;
  /** Cambió con el último comando que modificó la máquina. */
  changed: boolean;
}

export type FlagKey = 'OF' | 'DF' | 'IF' | 'SF' | 'ZF' | 'AF' | 'PF' | 'CF';

export interface FlagView {
  key: FlagKey;
  /** Las dos letras de DEBUG según el estado actual: "NV" u "OV", "PL" o "NG", etc. */
  code: string;
  /** Nombre corto en español: "Signo", "Cero", "Acarreo"… */
  label: string;
  changed: boolean;
}

export interface ByteView {
  /** Dos dígitos hexadecimales. */
  value: string;
  nonZero: boolean;
  /** Escrito por el último comando que modificó la máquina. */
  changed: boolean;
  /** Es el byte al que apunta CS:IP. */
  isIp: boolean;
}

export interface MemoryRowView {
  /** Desplazamiento de la fila, cuatro dígitos: "0100". */
  address: string;
  /** Siempre 16 bytes. */
  bytes: ByteView[];
}

export interface MemoryWindowView {
  /** "Memoria · código" o "Memoria · datos". */
  title: string;
  /** Texto a la derecha del título: "sigue a CS:IP" o "última escritura". */
  caption: string;
  /** Valor que acompaña al texto: "0100" o "[2000]". */
  captionValue: string;
  /** Pinta captionValue en ámbar (se usa cuando hubo una escritura en el último comando). */
  captionHot: boolean;
  /** Siempre 8 filas (128 bytes). En móvil la interfaz muestra solo las 4 primeras. */
  rows: MemoryRowView[];
}

export interface StackRowView {
  address: string;
  /** Palabra de 16 bits en esa dirección: "0000". */
  value: string;
  /** Es la posición a la que apunta SS:SP. */
  isSp: boolean;
  /** "tope · retorno a DOS", "libre · próximo push", "libre", o vacío. */
  note: string;
}

export interface StackViewModel {
  /** "SS:SP 0DAB:FFFE". */
  pointer: string;
  /** De la dirección más alta a la más baja: los valores apilados visibles, SP y las posiciones libres siguientes. */
  rows: StackRowView[];
  /** Dirección donde empieza la pila vacía: "FFFE". */
  start: string;
  /** Primera dirección libre después del programa: hasta ahí puede crecer la pila. */
  limit: string;
  usedBytes: number;
  totalBytes: number;
  /** Posición de SP dentro del rango, de 0 (inicio) a 1 (límite). */
  position: number;
}

export type TerminalLineKind = 'command' | 'output' | 'error';

export interface TerminalLine {
  /** Identificador estable y creciente; se usa como key de React. */
  id: number;
  /** command: lo que escribió el usuario, con su prompt. output: respuesta de DEBUG. error: la línea "^ Error". */
  kind: TerminalLineKind;
  text: string;
}

export interface DebugView {
  lines: TerminalLine[];
  /** Prompt del campo de entrada: "-" en modo comando, "0DAB:0102 " al ensamblar, ":" al editar un registro. */
  prompt: string;
  registers: RegisterView[];
  flags: FlagView[];
  code: MemoryWindowView;
  data: MemoryWindowView;
  stack: StackViewModel;
}

/** Lo único que la interfaz necesita de la lógica. */
export interface DebugSession {
  getView(): DebugView;
  /** Procesa una línea tal como la escribió el usuario (puede ser vacía) y devuelve el nuevo estado. */
  submit(line: string): DebugView;
}
