import { describe, expect, it, vi } from 'vitest';
import { MAX_LINES, createDebugSession } from './session';
import type { DebugView } from './types';

// Simula un bug del simulador: la línea "boom" hace fallar a commands.run
vi.mock('./commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('./commands')>();
  return {
    ...original,
    run: (...args: Parameters<typeof original.run>) => {
      if (args[2] === 'boom') throw new Error('falla de prueba');
      return original.run(...args);
    },
  };
});

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
      ['output', 'AX=0000  BX=0000  CX=0000  DX=0000  SP=00FD  BP=0000  SI=0000  DI=0000'],
      ['output', 'DS=073F  ES=073F  SS=073F  CS=073F  IP=0100   NV UP EI PL NZ NA PO NC'],
      ['output', '073F:0100 0000          ADD     [BX+SI],AL                  DS:0000=CD'],
    ]);
    expect(s.getView()).toBe(v);
  });

  it('los errores son de tipo error y los ids crecen', () => {
    const s = createDebugSession();
    s.submit('a');
    const v = s.submit('-r');
    expect(v.lines.slice(-2)).toEqual([
      { id: 1, kind: 'command', text: '073F:0100 -r' },
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
    expect(v.lines.slice(0, 3).map((l) => l.text)).toEqual(['-a 0100', '073F:0100 jmp 130', '073F:0102 ']);
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

  it('solo q marca la vista como reiniciada', () => {
    const s = createDebugSession();
    expect(s.getView().restarted).toBe(false);
    expect(s.submit('r').restarted).toBe(false);
    expect(s.submit('clear').restarted).toBe(false);
    expect(s.submit('q').restarted).toBe(true);
    expect(s.submit('r').restarted).toBe(false);
  });

  it('q dentro de a es una instrucción inválida, no un reinicio', () => {
    const s = createDebugSession();
    s.submit('a');
    const v = s.submit('q');
    expect(v.restarted).toBe(false);
    expect(v.lines.at(-1)?.kind).toBe('error');
  });

  it('un fallo interno se muestra en la terminal y la sesión sigue funcionando', () => {
    const s = createDebugSession();
    s.submit('r ax');
    s.submit('1234');
    const v = s.submit('boom');
    expect(v.lines.slice(-2).map((l) => [l.kind, l.text])).toEqual([
      ['command', '-boom'],
      ['error', 'Error interno del simulador: falla de prueba'],
    ]);
    expect(s.submit('r').registers[0].value).toBe('1234');
  });

  it('conserva como máximo MAX_LINES líneas', () => {
    const s = createDebugSession();
    for (let i = 0; i < MAX_LINES; i++) s.submit('r');
    expect(s.getView().lines).toHaveLength(MAX_LINES);
  });
});

describe('session: clear', () => {
  it('vacía la terminal y conserva la máquina', () => {
    const s = createDebugSession();
    s.submit('r ax');
    s.submit('1234');
    const v = s.submit('clear');
    expect(v.lines).toEqual([]);
    expect(v.prompt).toBe('-');
    expect(v.registers.find((r) => r.name === 'AX')?.value).toBe('1234');
  });

  it('con argumentos es un error y no borra nada', () => {
    const s = createDebugSession();
    s.submit('r');
    const v = s.submit('clear x');
    expect(v.lines.at(-1)).toMatchObject({ kind: 'error', text: '       ^ Error' });
  });
});

describe('session: repetir el registro de comandos', () => {
  // La interfaz guarda solo las líneas escritas y las vuelve a ejecutar al recargar la página
  it('las mismas líneas reproducen exactamente la misma vista', () => {
    const log = ['a', 'mov ax,1234', 'mov [200],ax', 'int 3', '', 'e 210 "Hola"', 'g', 'clear', 'r bx', 'ff', 't =100 2', 'd 200 l 20'];
    // Con la misma hora de arranque, que también se guarda
    const first = createDebugSession('2026-10-22T10:00:00.00');
    const second = createDebugSession('2026-10-22T10:00:00.00');
    for (const line of log) first.submit(line);
    for (const line of log) second.submit(line);
    expect(second.getView()).toEqual(first.getView());
  });
});

describe('session: navegar la memoria', () => {
  const rows = (v: DebugView, w: 'code' | 'data') => v[w].rows.map((r) => r.address);

  it('las páginas avanzan y retroceden, dando la vuelta al segmento, y la ventana queda fija', () => {
    const s = createDebugSession();
    let v = s.moveWindow('code', { by: 0x80 })!;
    expect(rows(v, 'code')[0]).toBe('0180');
    expect(v.code).toMatchObject({ pinned: true, caption: 'fija', captionValue: '0180' });
    v = s.moveWindow('code', { by: -0x200 })!;
    expect(rows(v, 'code')[0]).toBe('FF80');
    v = s.moveWindow('data', { by: -0x40 })!;
    expect(rows(v, 'data')[0]).toBe('01C0');
    expect(v.data).toMatchObject({ pinned: true, caption: 'fija', captionValue: '[01C0]' });
  });

  it('fijada, la ventana de código no sigue a IP; al pedir seguir vuelve a CS:IP', () => {
    const s = createDebugSession();
    s.submit('a 300');
    s.submit('nop');
    s.submit('');
    s.moveWindow('code', { address: '1000' });
    let v = s.submit('t =300');
    expect(rows(v, 'code')[0]).toBe('1000');
    v = s.moveWindow('code', { follow: true })!;
    expect(rows(v, 'code')[0]).toBe('0300');
    expect(v.code).toMatchObject({ pinned: false, caption: 'sigue a CS:IP', captionValue: '0301' });
  });

  it('fijada, la ventana de datos no sigue al programa, pero d o e la sueltan y la mueven', () => {
    const s = createDebugSession();
    s.submit('a');
    s.submit('mov byte [2000],1');
    s.submit('');
    s.moveWindow('data', { address: '500' });
    let v = s.submit('t');
    expect(v.data.captionValue).toBe('[0500]');
    v = s.submit('d 900 l 1');
    expect(v.data).toMatchObject({ pinned: false, captionValue: '[0900]' });
  });

  it('la ventana de datos acepta otro segmento; la de código, solo CS', () => {
    const s = createDebugSession();
    s.submit('e 1000:20 aa');
    const v = s.moveWindow('data', { address: '1000:25' })!;
    expect(v.data.captionValue).toBe('[1000:0025]');
    expect(v.data.rows[0].bytes[0]).toMatchObject({ value: 'AA' });
    expect(s.moveWindow('data', { address: 'ds:25' })!.data.captionValue).toBe('[0025]');
    expect(s.moveWindow('code', { address: 'es:100' })).not.toBeNull();
    expect(s.moveWindow('code', { address: '1000:100' })).toBeNull();
  });

  it('una dirección inválida no cambia nada', () => {
    const s = createDebugSession();
    const before = s.getView();
    for (const address of ['', 'xyz', '1 2', '10000', 'zz:100']) expect(s.moveWindow('data', { address })).toBeNull();
    expect(s.getView()).toBe(before);
  });

  it('moverse conserva los resaltados del último comando', () => {
    const s = createDebugSession();
    s.submit('r ax');
    s.submit('1234');
    const v = s.moveWindow('data', { by: 0x80 })!;
    expect(v.registers.find((r) => r.name === 'AX')?.changed).toBe(true);
  });

  it('q vuelve las ventanas al modo automático', () => {
    const s = createDebugSession();
    s.moveWindow('code', { by: 0x80 });
    s.moveWindow('data', { by: 0x80 });
    const v = s.submit('q');
    expect([v.code.pinned, v.data.pinned]).toEqual([false, false]);
  });
});
