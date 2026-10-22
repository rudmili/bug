import { describe, expect, it } from 'vitest';
import { createCommandState, run } from './commands';
import { bootMachine, clearWrites } from './memory';
import { snapshot } from './state';
import type { DebugView } from './types';
import { buildView, createViewState } from './view';

/** Mismo ciclo que session.ts, sin historial. */
function harness() {
  const m = bootMachine();
  const cmd = createCommandState(m);
  let state = createViewState();
  const build = (prev = snapshot(m), dataFocus?: number): DebugView => {
    const r = buildView({ machine: m, prev, writes: m.writes, dataFocus, lines: [], prompt: '-', state });
    state = r.state;
    return r.view;
  };
  const submit = (...lines: string[]): DebugView => {
    let view = build();
    for (const line of lines) {
      const prev = snapshot(m);
      clearWrites(m);
      const r = run(m, cmd, line);
      view = build(prev, r.dataFocus);
    }
    return view;
  };
  return { m, submit, initial: build() };
}

const hot = (v: DebugView) => v.registers.filter((r) => r.changed).map((r) => r.name);
const hotFlags = (v: DebugView) => v.flags.filter((f) => f.changed).map((f) => f.key);

describe('view', () => {
  it('estado inicial', () => {
    const v = harness().initial;
    expect(v.registers.map((r) => `${r.name}=${r.value}`).join(' ')).toBe(
      'AX=0000 BX=0000 CX=0000 DX=0000 SP=00FD BP=0000 SI=0000 DI=0000 DS=073F ES=073F SS=073F CS=073F IP=0100',
    );
    expect(hot(v)).toEqual([]);
    expect(v.flags.map((f) => f.code).join(' ')).toBe('NV UP EI PL NZ NA PO NC');
    expect(v.flags.map((f) => f.label)).toEqual(['Desb.', 'Direc.', 'Interr.', 'Signo', 'Cero', 'Aux.', 'Paridad', 'Acarreo']);
    expect(v.code.rows).toHaveLength(8);
    expect(v.code.rows[0].address).toBe('0100');
    expect(v.code.rows[0].bytes[0]).toEqual({ value: '00', nonZero: false, changed: false, isIp: true });
    expect(v.code.captionValue).toBe('0100');
    expect(v.data.rows[0].address).toBe('0200');
    expect(v.data.captionValue).toBe('[0200]');
    expect(v.data.captionHot).toBe(false);
  });

  it('pila inicial', () => {
    const s = harness().initial.stack;
    expect(s.pointer).toBe('SS:SP 073F:00FD');
    expect(s.rows).toEqual([
      { address: '00FD', value: '0000', isSp: true, note: 'tope · retorno a DOS' },
      { address: '00FB', value: '0000', isSp: false, note: 'libre · próximo push' },
      { address: '00F9', value: '0000', isSp: false, note: 'libre' },
      { address: '00F7', value: '0000', isSp: false, note: 'libre' },
    ]);
    expect(s).toMatchObject({ start: '00FD', limit: '0000', usedBytes: 0, totalBytes: 0xfd, position: 0 });
  });

  it('resalta lo que cambió y lo conserva en comandos que no modifican la máquina', () => {
    const h = harness();
    let v = h.submit('a', 'mov ah,8', 'sub ah,c', '');
    // Cada línea de a es un comando: quedan resaltados los bytes del último (sub ah,c)
    expect(v.code.rows[0].bytes.slice(0, 6).map((b) => b.changed)).toEqual([false, false, true, true, true, false]);
    v = h.submit('t');
    expect(hot(v)).toEqual(['AX', 'IP']);
    expect(hotFlags(v)).toEqual([]);
    expect(v.code.rows[0].bytes.some((b) => b.changed)).toBe(false);
    v = h.submit('u');
    expect(hot(v)).toEqual(['AX', 'IP']);
    v = h.submit('t');
    expect(hotFlags(v)).toEqual(['SF', 'AF', 'PF', 'CF']);
    v = h.submit('xyz');
    expect(hotFlags(v)).toEqual(['SF', 'AF', 'PF', 'CF']);
  });

  it('la ventana de datos sigue la última escritura de una instrucción', () => {
    const h = harness();
    h.submit('a', 'mov ah,8', 'mov [2000],ah', 'push ax', '');
    let v = h.submit('t 2');
    expect(v.data.captionValue).toBe('[2000]');
    expect(v.data.captionHot).toBe(true);
    expect(v.data.rows[0].address).toBe('2000');
    expect(v.data.rows[0].bytes[0]).toMatchObject({ value: '08', changed: true });
    v = h.submit('t');
    // PUSH escribe en la pila: la ventana de datos no se mueve
    expect(v.data.captionValue).toBe('[2000]');
    expect(v.data.captionHot).toBe(false);
    expect(v.stack.rows.map((r) => [r.address, r.isSp])).toEqual([
      ['00FD', false], ['00FB', true], ['00F9', false], ['00F7', false], ['00F5', false],
    ]);
    expect(v.stack.rows[1].value).toBe('0800');
    expect(v.stack.usedBytes).toBe(2);
  });

  it('d y e mueven la ventana de datos sin marcarla', () => {
    const h = harness();
    let v = h.submit('d 345');
    expect(v.data.captionValue).toBe('[0345]');
    expect(v.data.rows[0].address).toBe('0340');
    expect(v.data.captionHot).toBe(false);
    v = h.submit('e 1100 69');
    expect(v.data.captionValue).toBe('[1100]');
    expect(v.data.rows[0].bytes[0]).toMatchObject({ value: '69', changed: true });
  });

  it('la ventana de código se mueve solo cuando IP sale', () => {
    const h = harness();
    let v = h.submit('r ip', '17f');
    expect(v.code.rows[0].address).toBe('0100');
    expect(v.code.rows[7].bytes[15].isIp).toBe(true);
    v = h.submit('r ip', '180');
    expect(v.code.rows[0].address).toBe('0180');
    v = h.submit('r ip', '100');
    expect(v.code.rows[0].address).toBe('0100');
  });

  it('la pila puede crecer hasta el principio del segmento, sin importar el programa', () => {
    const h = harness();
    const v = h.submit('a', 'mov ax,1', 'int 20', '');
    expect(v.stack.limit).toBe('0000');
    expect(v.stack.totalBytes).toBe(0xfd);
  });

  it('cada vista es un objeto nuevo', () => {
    const h = harness();
    const a = h.submit('u');
    const b = h.submit('u');
    expect(a).not.toBe(b);
    expect(a.registers).not.toBe(b.registers);
  });
});
