import { addDays, clockNow, isDateValid, readTicks, takeMidnight, ticksToTime, timeToTicks, weekday, writeTicks } from './clock';
import { SERVICE_CRITICAL, SERVICE_CTRL_C, SERVICE_TERMINATE, readByte, readVector, readWord, writeByte, writeWord } from './memory';
import { AX, BX, CX, DS, DX, ES, SP, SS, getReg8, setReg8 } from './state';
import type { Key, Machine } from './state';

/**
 * Lo mínimo de DOS. Como en DOSBox, los vectores de DOS apuntan a manejadores en F000 que piden un
 * servicio con FE 38 nnnn: acá se resuelve cada servicio, de una vez, sin código de DOS de por medio.
 */

/**
 * La consola: lo que escribe el programa, como en la pantalla de DOS. 0D vuelve al principio de la
 * línea (lo que sigue pisa lo anterior), 0A baja una línea sin cambiar de columna, 08 retrocede una
 * columna, 09 avanza hasta la siguiente columna múltiplo de 8 y 07 (la campana) no se ve.
 */
export class Output {
  lines: string[] = [];
  private current = '';
  private col = 0;

  writeChar(code: number): void {
    switch (code) {
      case 0x07:
        return;
      case 0x08:
        if (this.col > 0) this.col--;
        return;
      case 0x09:
        do this.put(' ');
        while (this.col % 8 !== 0);
        return;
      case 0x0a:
        this.lines.push(this.current);
        this.current = '';
        return;
      case 0x0d:
        this.col = 0;
        return;
      default:
        this.put(String.fromCharCode(code));
    }
  }

  private put(ch: string): void {
    this.current = this.current.slice(0, this.col).padEnd(this.col) + ch + this.current.slice(this.col + 1);
    this.col++;
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
    this.col = 0;
  }

  /** La línea a medias, para mostrarla mientras el programa espera una tecla ("Nombre: "). */
  get partial(): string {
    return this.current;
  }
}

/** `wait`: no hay tecla; el manejador se repite cuando llegue una. */
export type ServiceResult = 'continue' | 'terminate' | 'wait';

export const TERMINATED = 'Program terminated normally';

/** Números de servicio de DOSBox: el manejador del servicio n está en F000:1000 + n * 20h. */
export const SERVICE_INT10 = 0x18;
export const SERVICE_INT16 = 0x0f;
export const SERVICE_INT1A = 0x12;
export const SERVICE_INT20 = 0x24;
export const SERVICE_INT21 = 0x25;

/** Consultas seguidas sin tecla tras las que la ejecución se pausa a esperar una (ver Keyboard.emptyPolls). */
export const POLLS_BEFORE_WAIT = 100;

function terminate(out: Output): ServiceResult {
  out.writeLine(TERMINATED);
  return 'terminate';
}

/** División por cero mientras el vector 0 sigue siendo el de arranque: lo que hace DOS. */
export function divideOverflow(out: Output): ServiceResult {
  out.writeLine('Divide overflow');
  return terminate(out);
}

/** Ctrl+C en una lectura de DOS: "^C", salto de línea, y DEBUG recupera el control. */
function ctrlC(out: Output): ServiceResult {
  for (const c of '^C\r\n') out.writeChar(c.charCodeAt(0));
  out.flush();
  return 'terminate';
}

// ---------------------------------------------------------------- Teclado

const CF_MASK = 0x0001;
const ZF_MASK = 0x0040;

/**
 * Una bandera al volver de la interrupción. El manejador termina con IRET, que recupera FLAGS de la pila:
 * hay que cambiarla ahí (FLAGS quedó en SS:SP+4, debajo de IP y CS), como hace DOSBox.
 */
function setReturnFlag(m: Machine, mask: number, on: boolean): void {
  const at = (m.regs[SP] + 4) & 0xffff;
  const flags = readWord(m, m.sregs[SS], at);
  writeWord(m, m.sregs[SS], at, on ? flags | mask : flags & ~mask, 'system');
}

const setReturnZF = (m: Machine, zf: boolean) => setReturnFlag(m, ZF_MASK, zf);

/** Una consulta sin tecla. Devuelve true si ya fueron demasiadas y hay que pausar a esperar. */
function emptyPoll(m: Machine): boolean {
  const kb = m.keyboard;
  if (kb.keys.length > 0 || kb.pendingScan !== null) {
    kb.emptyPolls = 0;
    return false;
  }
  kb.emptyPolls++;
  return kb.emptyPolls >= POLLS_BEFORE_WAIT;
}

/** Saca la próxima tecla del buffer del BIOS, o null si no hay. */
function takeKey(m: Machine): Key | null {
  const key = m.keyboard.keys.shift() ?? null;
  if (key) m.keyboard.emptyPolls = 0;
  return key;
}

/** Lectura de un carácter de DOS: una tecla extendida llega en dos lecturas, 00 y después su código. */
function takeChar(m: Machine): number | null {
  const kb = m.keyboard;
  if (kb.pendingScan !== null) {
    const scan = kb.pendingScan;
    kb.pendingScan = null;
    return scan;
  }
  const key = takeKey(m);
  if (!key) return null;
  if (key.ascii === 0) kb.pendingScan = key.scan;
  return key.ascii;
}

/** INT 21 AH=01, 07 y 08: espera un carácter. 01 lo muestra; 01 y 08 cortan el programa con Ctrl+C. */
function readChar(m: Machine, out: Output, echo: boolean, ctrlCBreaks: boolean): ServiceResult {
  const c = takeChar(m);
  if (c === null) return 'wait';
  if (c === 0x03 && ctrlCBreaks) return ctrlC(out);
  if (echo) out.writeChar(c);
  setReg8(m, 0, c);
  return 'continue';
}

/**
 * INT 21 AH=0A: lee una línea al buffer de DS:DX ([DX] = máximo, [DX+1] = cantidad leída, desde DX+2
 * los caracteres y un 0D). Se escribe de a una tecla con eco: Backspace borra, Enter termina y lo que
 * no entra se ignora, como en DOS.
 */
function readLine(m: Machine, out: Output): ServiceResult {
  const kb = m.keyboard;
  const seg = m.sregs[DS];
  const buffer = m.regs[DX];
  const max = readByte(m, seg, buffer);
  if (max === 0) return 'continue';
  kb.lineLength ??= 0;
  for (;;) {
    const c = takeChar(m);
    if (c === null) return 'wait';
    if (c === 0x03) {
      kb.lineLength = null;
      return ctrlC(out);
    }
    if (c === 0x0d) {
      writeByte(m, seg, buffer + 2 + kb.lineLength, 0x0d, 'system');
      writeByte(m, seg, buffer + 1, kb.lineLength, 'system');
      out.writeChar(0x0d);
      kb.lineLength = null;
      return 'continue';
    }
    if (c === 0x08) {
      if (kb.lineLength > 0) {
        kb.lineLength--;
        for (const e of [0x08, 0x20, 0x08]) out.writeChar(e);
      }
      continue;
    }
    // Las teclas extendidas no escriben nada (DOS las usa para editar con la plantilla)
    if (c === 0x00) {
      kb.pendingScan = null;
      continue;
    }
    if (kb.lineLength < max - 1) {
      writeByte(m, seg, buffer + 2 + kb.lineLength, c, 'system');
      kb.lineLength++;
      out.writeChar(c);
    }
  }
}

function int21Keyboard(m: Machine, out: Output, ah: number): ServiceResult | null {
  const kb = m.keyboard;
  switch (ah) {
    case 0x01:
      return readChar(m, out, true, true);
    case 0x07:
      return readChar(m, out, false, false);
    case 0x08:
      return readChar(m, out, false, true);
    case 0x0a:
      return readLine(m, out);
    case 0x06: {
      // DL=FF lee sin esperar (ZF=1 si no hay tecla); con otro DL escribe ese carácter
      const dl = getReg8(m, 2);
      if (dl !== 0xff) {
        out.writeChar(dl);
        setReg8(m, 0, dl);
        return 'continue';
      }
      if (emptyPoll(m)) return 'wait';
      const c = takeChar(m);
      setReg8(m, 0, c ?? 0);
      setReturnZF(m, c === null);
      return 'continue';
    }
    case 0x0b:
      if (emptyPoll(m)) return 'wait';
      setReg8(m, 0, kb.keys.length > 0 || kb.pendingScan !== null ? 0xff : 0x00);
      return 'continue';
    case 0x0c: {
      // Vacía el buffer y llama a la función de AL. Si espera una tecla, al reanudar no lo vuelve a vaciar
      if (!kb.flushed) {
        kb.keys = [];
        kb.pendingScan = null;
        kb.flushed = true;
      }
      const al = getReg8(m, 0);
      // Con otra función solo vacía, y DOSBox deja AL=00
      if (![0x01, 0x06, 0x07, 0x08, 0x0a].includes(al)) {
        kb.flushed = false;
        setReg8(m, 0, 0);
        return 'continue';
      }
      const result = int21Keyboard(m, out, al)!;
      if (result !== 'wait') kb.flushed = false;
      return result;
    }
    default:
      return null;
  }
}

/** INT 16h, el teclado del BIOS: AX = código de tecla y ASCII. */
function int16(m: Machine): ServiceResult {
  const ah = getReg8(m, 4);
  const kb = m.keyboard;
  const word = (key: Key) => (key.scan << 8) | key.ascii;
  switch (ah) {
    case 0x00:
    case 0x10: {
      const key = takeKey(m);
      if (!key) return 'wait';
      m.regs[0] = word(key);
      return 'continue';
    }
    case 0x01:
    case 0x11: {
      // Mira sin sacar: ZF=1 si no hay tecla
      if (emptyPoll(m)) return 'wait';
      const key = kb.keys[0];
      if (key) m.regs[0] = word(key);
      setReturnZF(m, !key);
      return 'continue';
    }
    case 0x02:
    case 0x12:
      // Ninguna tecla de cambio (Shift, Ctrl, Alt) apretada
      setReg8(m, 0, 0);
      if (ah === 0x12) setReg8(m, 4, 0);
      return 'continue';
    case 0x05:
      // Mete CX en el buffer como si se hubiera pulsado
      kb.keys.push({ ascii: m.regs[1] & 0xff, scan: m.regs[1] >> 8 });
      setReg8(m, 0, 0);
      return 'continue';
    default:
      return 'continue';
  }
}

// ---------------------------------------------------------------- INT 10

/**
 * INT 10h, el video del BIOS. Solo AH=0E, escribir un carácter como en una teletipo, que es lo que
 * tiene sentido en una terminal de texto; las demás (modos, cursor, colores, píxeles) no hacen nada.
 */
function int10(m: Machine, out: Output): ServiceResult {
  if (getReg8(m, 4) === 0x0e) out.writeChar(getReg8(m, 0));
  return 'continue';
}

// ---------------------------------------------------------------- Reloj

const bcd = (n: number) => (Math.floor(n / 10) << 4) | n % 10;

/** INT 1Ah, el reloj del BIOS: los ticks desde medianoche y el reloj de tiempo real (en BCD). */
function int1a(m: Machine): ServiceResult {
  switch (getReg8(m, 4)) {
    case 0x00: {
      // CX:DX = ticks; AL = cuántas veces pasó la medianoche desde la última lectura, y la marca se borra
      const ticks = readTicks(m);
      setReg8(m, 0, takeMidnight(m));
      m.regs[CX] = ticks >>> 16;
      m.regs[DX] = ticks & 0xffff;
      return 'continue';
    }
    case 0x01:
      writeTicks(m, ((m.regs[CX] << 16) | m.regs[DX]) >>> 0);
      return 'continue';
    case 0x02: {
      // Hora: CH horas, CL minutos, DH segundos, DL=0 (sin horario de verano)
      const t = clockNow(m);
      m.regs[CX] = (bcd(t.hour) << 8) | bcd(t.minute);
      m.regs[DX] = bcd(t.second) << 8;
      setReturnFlag(m, CF_MASK, false);
      return 'continue';
    }
    case 0x04: {
      // Fecha: CH siglo, CL año, DH mes, DL día
      const t = clockNow(m);
      m.regs[CX] = (bcd(Math.floor(t.year / 100)) << 8) | bcd(t.year % 100);
      m.regs[DX] = (bcd(t.month) << 8) | bcd(t.day);
      setReturnFlag(m, CF_MASK, false);
      return 'continue';
    }
    default:
      return 'continue';
  }
}

/** Antes de dar la fecha o la hora, DOS lee los ticks con INT 1A: si pasó la medianoche, avanza su fecha. */
function dosTicks(m: Machine): { ticks: number; midnight: number } {
  const midnight = takeMidnight(m);
  if (midnight) addDays(m.clock, midnight);
  return { ticks: readTicks(m), midnight };
}

/** INT 21 AH=2A a 2D: la fecha y la hora de DOS, como en DOSBox. */
function int21Clock(m: Machine, ah: number): ServiceResult | null {
  switch (ah) {
    case 0x2a: {
      // CX año, DH mes, DL día, AL día de la semana (0 = domingo)
      dosTicks(m);
      const { year, month, day } = m.clock;
      setReg8(m, 0, weekday(year, month, day));
      m.regs[CX] = year;
      m.regs[DX] = (month << 8) | day;
      return 'continue';
    }
    case 0x2b: {
      const year = m.regs[CX];
      const month = getReg8(m, 6);
      const day = getReg8(m, 2);
      if (!isDateValid(year, month, day)) {
        setReg8(m, 0, 0xff);
        return 'continue';
      }
      Object.assign(m.clock, { year, month, day });
      setReg8(m, 0, 0);
      return 'continue';
    }
    case 0x2c: {
      // CH horas, CL minutos, DH segundos, DL centésimas; AL queda con lo que devolvió INT 1A
      const { ticks, midnight } = dosTicks(m);
      const t = ticksToTime(ticks);
      m.regs[AX] = 0x2c00 | midnight;
      m.regs[CX] = (t.hour << 8) | t.minute;
      m.regs[DX] = (t.second << 8) | t.hundredths;
      return 'continue';
    }
    case 0x2d: {
      const hour = getReg8(m, 5);
      const minute = getReg8(m, 1);
      const second = getReg8(m, 6);
      const hundredths = getReg8(m, 2);
      if (hour > 23 || minute > 59 || second > 59 || hundredths > 99) {
        setReg8(m, 0, 0xff);
        return 'continue';
      }
      writeTicks(m, timeToTicks(hour, minute, second, hundredths));
      setReg8(m, 0, 0);
      return 'continue';
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- INT 21

function int21(m: Machine, out: Output): ServiceResult {
  const ah = getReg8(m, 4);
  const al = getReg8(m, 0);
  const handled = int21Keyboard(m, out, ah) ?? int21Clock(m, ah);
  if (handled !== null) return handled;
  switch (ah) {
    case 0x00:
    case 0x4c:
      return terminate(out);
    case 0x02: {
      // Como en DOSBox, AL queda con el carácter escrito (un tab, como el espacio en que se convierte)
      const dl = getReg8(m, 2);
      out.writeChar(dl);
      setReg8(m, 0, dl === 0x09 ? 0x20 : dl);
      return 'continue';
    }
    case 0x09:
      // Una cadena sin $ se corta al dar la vuelta al segmento
      for (let i = 0; i < 0x10000; i++) {
        const c = readByte(m, m.sregs[DS], m.regs[DX] + i);
        if (c === 0x24) break;
        out.writeChar(c);
      }
      // Como en DOSBox, AL queda con el último carácter leído: el $
      setReg8(m, 0, 0x24);
      return 'continue';
    case 0x25:
      // Instala DS:DX como manejador de la interrupción AL
      writeWord(m, 0, al * 4, m.regs[DX], 'system');
      writeWord(m, 0, al * 4 + 2, m.sregs[DS], 'system');
      return 'continue';
    case 0x35: {
      // Devuelve en ES:BX el manejador de la interrupción AL
      const { seg, off } = readVector(m, al);
      m.sregs[ES] = seg;
      m.regs[BX] = off;
      return 'continue';
    }
    default:
      return 'continue';
  }
}

/** Atiende el servicio que pidió un manejador. Los que no conoce no hacen nada, como el manejador vacío. */
export function runService(m: Machine, id: number, out: Output): ServiceResult {
  switch (id) {
    case SERVICE_INT10:
      return int10(m, out);
    case SERVICE_INT16:
      return int16(m);
    case SERVICE_INT1A:
      return int1a(m);
    case SERVICE_INT20:
    case SERVICE_TERMINATE:
      return terminate(out);
    case SERVICE_INT21:
      return int21(m, out);
    case SERVICE_CTRL_C:
      // Ctrl+C corta el programa y vuelve a DEBUG, sin "Program terminated normally"
      return ctrlC(out);
    case SERVICE_CRITICAL:
      // Error crítico de disco: "Fail"
      setReg8(m, 0, 3);
      return 'continue';
    default:
      return 'continue';
  }
}
