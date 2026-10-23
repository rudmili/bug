import { describe, expect, it } from 'vitest';
import { keyFromLine } from './keyboard';
import { createDebugSession } from './session';
import type { DebugView } from './types';

/** Ensambla un programa desde 0100 y escribe después las líneas extra (por ejemplo, un `e`). */
function program(lines: string[], extra: string[] = []) {
  const s = createDebugSession();
  for (const line of ['a', ...lines, '', ...extra]) s.submit(line);
  return s;
}

/** Las líneas de la terminal después del último `from`. */
const tail = (v: DebugView, from: string) => {
  const texts = v.lines.map((l) => l.text);
  return texts.slice(texts.lastIndexOf(from) + 1);
};

const reg = (v: DebugView, name: string) => v.registers.find((r) => r.name === name)?.value;
const flag = (v: DebugView, key: string) => v.flags.find((f) => f.key === key)?.code;

describe('keyboard: teclas', () => {
  it('cada línea es una tecla con su código del teclado estadounidense', () => {
    expect(keyFromLine('a')).toEqual({ ascii: 0x61, scan: 0x1e });
    expect(keyFromLine('A')).toEqual({ ascii: 0x41, scan: 0x1e });
    expect(keyFromLine('?')).toEqual({ ascii: 0x3f, scan: 0x35 });
    expect(keyFromLine('')).toEqual({ ascii: 0x0d, scan: 0x1c });
    expect(keyFromLine('\b')).toEqual({ ascii: 0x08, scan: 0x0e });
    expect(keyFromLine('\x1b')).toEqual({ ascii: 0x1b, scan: 0x01 });
    expect(keyFromLine('\x03')).toEqual({ ascii: 0x03, scan: 0x2e });
    expect(keyFromLine('{Up}')).toEqual({ ascii: 0, scan: 0x48 });
    expect(keyFromLine('{F1}')).toEqual({ ascii: 0, scan: 0x3b });
  });
});

describe('keyboard: INT 21', () => {
  it('AH=01 espera una tecla, la muestra y el programa sigue donde estaba', () => {
    const s = program(['mov ah,1', 'int 21', 'mov dl,al', 'mov ah,2', 'int 21', 'int 20']);
    let v = s.submit('g');
    expect(v.waiting).toBe(true);
    expect(v.prompt).toBe('');
    v = s.submit('x');
    expect(v.waiting).toBe(false);
    expect(tail(v, '-g')).toEqual(['xx', 'Program terminated normally']);
  });

  it('mientras espera muestra la línea a medias y no repite las teclas como comandos', () => {
    const s = program(
      ['mov dx,200', 'mov ah,9', 'int 21', 'mov ah,1', 'int 21', 'mov ah,1', 'int 21', 'int 20'],
      ['e 200 "Clave: $"'],
    );
    let v = s.submit('g');
    expect(v.lines.at(-1)?.text).toBe('Clave: ');
    const id = v.lines.at(-1)?.id;
    v = s.submit('o');
    expect(v.lines.at(-1)).toMatchObject({ id, text: 'Clave: o' });
    v = s.submit('k');
    expect(tail(v, '-g')).toEqual(['Clave: ok', 'Program terminated normally']);
  });

  it('AH=08 no muestra la tecla y corta con Ctrl+C; AH=07 devuelve Ctrl+C como un carácter', () => {
    const s = program(['mov ah,8', 'int 21', 'int 20']);
    s.submit('g');
    expect(tail(s.submit('z'), '-g')).toEqual(['Program terminated normally']);

    const c = program(['mov ah,8', 'int 21', 'int 20']);
    c.submit('g');
    const v = c.submit('\x03');
    expect(tail(v, '-g')).toEqual(['^C']);
    expect(v.waiting).toBe(false);

    const raw = program(['mov ah,7', 'int 21', 'int 3']);
    raw.submit('g');
    expect(reg(raw.submit('\x03'), 'AX')).toBe('0703');
  });

  it('una tecla extendida llega en dos lecturas: 00 y su código', () => {
    const s = program(['mov ah,8', 'int 21', 'mov bl,al', 'mov ah,8', 'int 21', 'int 3']);
    s.submit('g');
    const v = s.submit('{Up}');
    expect(reg(v, 'BX')).toBe('0000');
    expect(reg(v, 'AX')).toBe('0848');
  });

  it('AH=0A lee una línea con eco, Backspace borra y lo que no entra se ignora', () => {
    // Buffer en 200: máximo 4 (3 caracteres y el 0D)
    const s = program(['mov dx,200', 'mov ah,a', 'int 21', 'int 3'], ['e 200 4']);
    s.submit('g');
    for (const key of ['a', 'b', '\b', 'c', 'd', 'e', 'f']) expect(s.submit(key).waiting).toBe(true);
    expect(s.submit('').waiting).toBe(false);
    expect(s.submit('d 200 l 6').lines.at(-1)?.text).toMatch(/^073F:0200 {2}04 03 61 63 64 0D/);
  });

  it('AH=0A con Enter vuelve al principio de la línea: lo que se escribe después la pisa', () => {
    const s = program(['mov dx,200', 'mov ah,a', 'int 21', 'mov dl,58', 'mov ah,2', 'int 21', 'int 20'], ['e 200 10']);
    s.submit('g');
    for (const key of ['h', 'o', 'l', 'a']) s.submit(key);
    expect(tail(s.submit(''), '-g')).toEqual(['Xola', 'Program terminated normally']);
  });

  it('AH=0B y AH=06 consultan sin esperar; AH=06 con DL=FF devuelve ZF', () => {
    const s = program(['mov ah,b', 'int 21', 'mov bl,al', 'mov ah,6', 'mov dl,ff', 'int 21', 'int 3']);
    const v = s.submit('g');
    expect(v.waiting).toBe(false);
    expect(reg(v, 'BX')).toBe('0000');
    expect(flag(v, 'ZF')).toBe('ZR');
  });

  it('un bucle que consulta sin parar se pausa a esperar la tecla', () => {
    const s = program(['mov ah,b', 'int 21', 'or al,al', 'jz 100', 'mov ah,8', 'int 21', 'int 3']);
    expect(s.submit('g').waiting).toBe(true);
    const v = s.submit('q');
    expect(v.waiting).toBe(false);
    expect(reg(v, 'AX')).toBe('0871');
  });

  it('AH=0C vacía el buffer una sola vez aunque espere la tecla', () => {
    const s = program(['mov ax,c08', 'int 21', 'int 3']);
    s.submit('g');
    expect(reg(s.submit('w'), 'AX')).toBe('0C77');
  });
});

describe('keyboard: INT 16', () => {
  it('AH=00 devuelve el código de tecla y el ASCII', () => {
    const s = program(['mov ah,0', 'int 16', 'int 3']);
    s.submit('g');
    expect(reg(s.submit('a'), 'AX')).toBe('1E61');
  });

  it('AH=01 mira sin sacar y deja ZF; AH=05 mete una tecla', () => {
    const s = program(['mov cx,1c0d', 'mov ah,5', 'int 16', 'mov ah,1', 'int 16', 'int 3']);
    const v = s.submit('g');
    expect(reg(v, 'AX')).toBe('1C0D');
    expect(flag(v, 'ZF')).toBe('NZ');
  });
});

describe('keyboard: t y repetición', () => {
  it('t sobre el INT espera la tecla y después termina ese paso y los que faltan', () => {
    const s = program(['mov ah,1', 'int 21', 'mov bl,al']);
    s.submit('t');
    expect(s.submit('t 2').waiting).toBe(true);
    const v = s.submit('k');
    expect(v.waiting).toBe(false);
    expect(reg(v, 'BX')).toBe('006B');
    expect(tail(v, '-t 2').filter((t) => t.startsWith('AX='))).toHaveLength(2);
  });

  it('las teclas guardadas reproducen la misma vista', () => {
    const log = ['a', 'mov ah,1', 'int 21', 'int 20', '', 'g', 'x'];
    // La misma hora de arranque: la vista la incluye
    const a = createDebugSession('2026-10-22T10:00:00.00');
    const b = createDebugSession('2026-10-22T10:00:00.00');
    for (const line of log) a.submit(line);
    for (const line of log) b.submit(line);
    expect(b.getView()).toEqual(a.getView());
  });
});
