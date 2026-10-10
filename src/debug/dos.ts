import { readByte } from './memory';
import { DS, DX, getReg8 } from './state';
import type { Machine } from './state';

/** Lo mínimo de DOS: cada INT se resuelve completa en un solo paso, sin entrar a código de DOS. */

/** Salida de texto del programa. 0D se descarta y 0A corta la línea. */
export class Output {
  lines: string[] = [];
  private current = '';

  writeChar(code: number): void {
    if (code === 0x0d) return;
    if (code === 0x0a) {
      this.lines.push(this.current);
      this.current = '';
      return;
    }
    this.current += String.fromCharCode(code);
  }

  /** Línea completa propia de DEBUG: si el programa dejó texto a medias, empieza en una línea nueva. */
  writeLine(text: string): void {
    this.flush();
    this.lines.push(text);
  }

  /** Pasa a `lines` el texto pendiente sin salto de línea. */
  flush(): void {
    if (this.current !== '') {
      this.lines.push(this.current);
      this.current = '';
    }
  }
}

export type InterruptResult = 'continue' | 'terminate' | 'break';

export const TERMINATED = 'Program terminated normally';

function terminate(out: Output): InterruptResult {
  out.writeLine(TERMINATED);
  return 'terminate';
}

export function handleInterrupt(m: Machine, n: number, out: Output): InterruptResult {
  switch (n) {
    case 0x00:
      out.writeLine('Divide overflow');
      return terminate(out);
    case 0x03:
      return 'break';
    case 0x20:
      return terminate(out);
    case 0x21: {
      const ah = getReg8(m, 4);
      if (ah === 0x02) {
        out.writeChar(getReg8(m, 2));
      } else if (ah === 0x09) {
        // Una cadena sin $ se corta al dar la vuelta al segmento
        for (let i = 0; i < 0x10000; i++) {
          const c = readByte(m, m.sregs[DS], m.regs[DX] + i);
          if (c === 0x24) break;
          out.writeChar(c);
        }
      } else if (ah === 0x4c) {
        return terminate(out);
      }
      return 'continue';
    }
    default:
      return 'continue';
  }
}
