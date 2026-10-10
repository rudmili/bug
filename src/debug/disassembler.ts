import { REG16_NAMES, REG8_NAMES, RM_BASES, SREG_NAMES } from './decoder';
import type { Instr, Operand } from './decoder';
import { hex2, hex4, toSigned8 } from './hex';

/** Texto de las instrucciones tal como lo muestra DEBUG. */

/** Instrucciones cuyo operando de memoria es siempre palabra: DEBUG no le agrega WORD PTR. */
const IMPLICIT_WORD = new Set(['PUSH', 'POP', 'CALL', 'JMP']);
const SHIFTS = new Set(['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR']);

function memText(op: Extract<Operand, { kind: 'mem' }>): string {
  if (op.rm === null) return `[${hex4(op.disp)}]`;
  const base = RM_BASES[op.rm];
  if (op.dispSize === 0) return `[${base}]`;
  if (op.dispSize === 8) {
    const d = toSigned8(op.disp);
    return `[${base}${d < 0 ? '-' : '+'}${hex2(Math.abs(d))}]`;
  }
  return `[${base}+${hex4(op.disp)}]`;
}

function operandText(op: Operand): string {
  switch (op.kind) {
    case 'reg':
      return op.size === 8 ? REG8_NAMES[op.index] : REG16_NAMES[op.index];
    case 'sreg':
      return SREG_NAMES[op.index];
    case 'imm':
      if (op.signed) {
        const v = toSigned8(op.value);
        return `${v < 0 ? '-' : '+'}${hex2(Math.abs(v))}`;
      }
      return op.size === 8 ? hex2(op.value) : hex4(op.value);
    case 'const':
      return String(op.value);
    case 'mem':
      return memText(op);
    case 'rel':
      return hex4(op.target);
    case 'far':
      return `${hex4(op.seg)}:${hex4(op.off)}`;
  }
}

/** BYTE PTR o WORD PTR solo cuando ningún operando es un registro que fije el tamaño. */
function needsPtr(instr: Instr): boolean {
  const mem = instr.operands.find((o) => o.kind === 'mem');
  if (!mem || mem.size === 32 || IMPLICIT_WORD.has(instr.mnem)) return false;
  if (instr.mnem === 'LEA') return false;
  const sizing = instr.operands.filter((o) => {
    if (o.kind === 'sreg') return true;
    // En los desplazamientos, CL es la cantidad: no fija el tamaño
    return o.kind === 'reg' && !SHIFTS.has(instr.mnem);
  });
  return sizing.length === 0;
}

/** "MOV     AH,08": mnemónico rellenado a 8 columnas y operandos separados por coma sin espacio. */
export function format(instr: Instr): string {
  let mnem = instr.mnem;
  let operands = instr.operands;
  let far = false;
  if (mnem.endsWith(' FAR')) {
    mnem = mnem.slice(0, -4);
    far = true;
  }
  // AAM y AAD llevan 0A como base: DEBUG no la muestra
  if ((mnem === 'AAM' || mnem === 'AAD') && operands[0]?.kind === 'imm' && operands[0].value === 0x0a) {
    operands = [];
  }
  if (operands.length === 0) return mnem;

  const ptr = needsPtr(instr);
  const texts = operands.map((op) => {
    let text = operandText(op);
    if (op.kind === 'mem') {
      if (far) text = `FAR ${text}`;
      else if (ptr) text = `${op.size === 8 ? 'BYTE' : 'WORD'} PTR ${text}`;
    }
    return text;
  });
  return `${mnem.padEnd(8)}${texts.join(',')}`;
}

/** "0DAB:0100 C3            RET": dirección, bytes rellenados a 14 columnas e instrucción. */
export function formatLine(seg: number, off: number, instr: Instr): string {
  const bytes = instr.bytes.map(hex2).join('');
  return `${hex4(seg)}:${hex4(off)} ${bytes.padEnd(14)}${format(instr)}`;
}
