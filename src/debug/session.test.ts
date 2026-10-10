import { describe, expect, it } from 'vitest';
import { MAX_LINES, createDebugSession } from './session';

describe('session', () => {
  it('arranca vacía con prompt de comando', () => {
    const v = createDebugSession().getView();
    expect(v.lines).toEqual([]);
    expect(v.prompt).toBe('-');
  });

  it('agrega la línea con su prompt y la salida', () => {
    const s = createDebugSession();
    const v = s.submit('r');
    expect(v.lines.map((l) => [l.kind, l.text])).toEqual([
      ['command', '-r'],
      ['output', 'AX=0000 BX=0000 CX=0000 DX=0000 SP=FFFE BP=0000 SI=0000 DI=0000'],
      ['output', 'DS=0DAB ES=0DAB SS=0DAB CS=0DAB IP=0100 NV UP EI NG NZ NA PO NC'],
      ['output', '0DAB:0100 C3            RET'],
    ]);
    expect(s.getView()).toBe(v);
  });

  it('los errores son de tipo error y los ids crecen', () => {
    const s = createDebugSession();
    s.submit('a');
    const v = s.submit('-r');
    expect(v.lines.slice(-2)).toEqual([
      { id: 1, kind: 'command', text: '0DAB:0100 -r' },
      { id: 2, kind: 'error', text: '          ^ Error' },
    ]);
  });

  it('programa del saludo completo', () => {
    const s = createDebugSession();
    for (const line of ['a 0100', 'jmp 130', '', 'e 102 "que tengas un feliz dia!" 0d 0a "$"', 'a 130',
      'mov bx,7', 'mov dx,102', 'mov ah,9', 'int 21', 'dec bx', 'jnz 138', 'int 20', '']) {
      s.submit(line);
    }
    const before = s.getView().lines.length;
    const v = s.submit('g');
    expect(v.lines.slice(before).map((l) => l.text)).toEqual([
      '-g',
      ...Array(7).fill('que tengas un feliz dia!'),
      'Program terminated normally',
    ]);
    expect(v.lines.slice(0, 3).map((l) => l.text)).toEqual(['-a 0100', '0DAB:0100 jmp 130', '0DAB:0102 ']);
  });

  it('q vuelve todo al estado inicial y limpia la terminal', () => {
    const s = createDebugSession();
    s.submit('r ax');
    s.submit('1234');
    const v = s.submit('q');
    expect(v.lines).toEqual([]);
    expect(v.registers[0]).toEqual({ name: 'AX', value: '0000', changed: false });
    expect(s.submit('r').lines[0].id).toBeGreaterThan(2);
  });

  it('conserva como máximo MAX_LINES líneas', () => {
    const s = createDebugSession();
    for (let i = 0; i < MAX_LINES; i++) s.submit('r');
    expect(s.getView().lines).toHaveLength(MAX_LINES);
  });
});
