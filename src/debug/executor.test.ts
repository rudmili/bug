import { describe, expect, it } from 'vitest';
import { step } from './executor';
import { flagsText } from './flags';
import { bootMachine, phys, readByte } from './memory';
import { AX, BX, CX, DI, DX, SI, SP } from './state';
import type { Machine } from './state';

function load(bytes: number[], at = 0x100): Machine {
  const m = bootMachine();
  m.mem.set(bytes, phys(0x073f, at));
  return m;
}

function run(bytes: number[], steps: number): Machine {
  const m = load(bytes);
  for (let i = 0; i < steps; i++) expect(step(m)).toEqual({ kind: 'ok' });
  return m;
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

describe('executor: casos de aceptación', () => {
  const add8 = [0xb4, 0x08, 0x80, 0xc4, 0x03];

  it('mov ah,8 / add ah,3 / sub ah,4', () => {
    const m = run([...add8, 0x80, 0xec, 0x04], 3);
    expect(hex(m.regs[AX])).toBe('0700');
    expect(hex(m.ip)).toBe('0108');
    expect(flagsText(m.flags)).toBe('NV UP EI PL NZ NA PO NC');
  });

  it('tras el primer t, AX=0800 y banderas sin cambios', () => {
    const m = run(add8, 1);
    expect(hex(m.regs[AX])).toBe('0800');
    expect(hex(m.ip)).toBe('0102');
    expect(flagsText(m.flags)).toBe('NV UP EI PL NZ NA PO NC');
  });

  it('mov ah,8 / add ah,3 / sub ah,c', () => {
    const m = run([...add8, 0x80, 0xec, 0x0c], 3);
    expect(hex(m.regs[AX])).toBe('FF00');
    expect(flagsText(m.flags)).toBe('NV UP EI NG NZ AC PE CY');
  });

  it('mov ah,a / sub ah,a', () => {
    const m = run([0xb4, 0x0a, 0x80, 0xec, 0x0a], 2);
    expect(hex(m.regs[AX])).toBe('0000');
    expect(flagsText(m.flags)).toBe('NV UP EI PL ZR NA PE NC');
  });

  it('mov ah,a / add ah,a', () => {
    const m = run([0xb4, 0x0a, 0x80, 0xc4, 0x0a], 2);
    expect(hex(m.regs[AX])).toBe('1400');
    expect(flagsText(m.flags)).toBe('NV UP EI PL NZ AC PE NC');
  });

  it('suma en memoria', () => {
    const m = run([
      0xb8, 0x08, 0x00, // mov ax,8
      0xa3, 0x00, 0x02, // mov [0200],ax
      0xb8, 0x03, 0x00, // mov ax,3
      0xa3, 0x03, 0x02, // mov [0203],ax
      0xa1, 0x00, 0x02, // mov ax,[0200]
      0x03, 0x06, 0x03, 0x02, // add ax,[0203]
      0xa3, 0x05, 0x02, // mov [0205],ax
    ], 7);
    expect(hex(m.regs[AX])).toBe('000B');
    expect(hex(m.ip)).toBe('0116');
    const bytes = Array.from({ length: 7 }, (_, i) => readByte(m, 0x073f, 0x200 + i));
    expect(bytes).toEqual([0x08, 0x00, 0x00, 0x03, 0x00, 0x0b, 0x00]);
  });

  it('mul cx', () => {
    const m = run([0xb8, 0xff, 0xff, 0xb9, 0xff, 0xff, 0xf7, 0xe1], 3);
    expect(hex(m.regs[AX])).toBe('0001');
    expect(hex(m.regs[DX])).toBe('FFFE');
    expect(m.flags).toMatchObject({ OF: true, CF: true });
  });

  it('imul cl', () => {
    const m = run([0xb8, 0x04, 0x00, 0xb9, 0xff, 0xff, 0xf6, 0xe9], 3);
    expect(hex(m.regs[AX])).toBe('FFFC');
    expect(hex(m.regs[DX])).toBe('0000');
    expect(flagsText(m.flags)).toBe('NV UP EI NG NZ NA PE NC');
  });

  it('div bl', () => {
    const m = run([0xb8, 0x07, 0x00, 0xb3, 0x03, 0xf6, 0xf3], 3);
    expect(hex(m.regs[AX])).toBe('0102');
  });

  it('idiv bl', () => {
    const m = run([0xb8, 0x1c, 0x00, 0xb3, 0xff, 0xf6, 0xfb], 3);
    expect(hex(m.regs[AX])).toBe('00E4');
  });

  it.each([
    ['shr', 0xe8, '0050', 'OV UP EI PL NZ NA PE NC'],
    ['rol', 0xc0, '0041', null],
    ['ror', 0xc8, '0050', null],
    ['rcl', 0xd0, '0040', null],
    ['rcr', 0xd8, '0050', null],
  ])('mov al,a0 / %s al,1', (_name, modrm, ax, flags) => {
    const m = run([0xb0, 0xa0, 0xd0, modrm as number], 2);
    expect(hex(m.regs[AX])).toBe(ax);
    expect(m.flags.OF).toBe(true);
    if (flags) expect(flagsText(m.flags)).toBe(flags);
  });

  it('rol y rcl dejan CY, ror y rcr dejan NC', () => {
    expect(run([0xb0, 0xa0, 0xd0, 0xc0], 2).flags.CF).toBe(true);
    expect(run([0xb0, 0xa0, 0xd0, 0xc8], 2).flags.CF).toBe(false);
    expect(run([0xb0, 0xa0, 0xd0, 0xd0], 2).flags.CF).toBe(true);
    expect(run([0xb0, 0xa0, 0xd0, 0xd8], 2).flags.CF).toBe(false);
  });

  it('pila: PUSH resta y escribe, POP lee y suma', () => {
    const m = load([
      0xb8, 0xd6, 0xd5, // mov ax,d5d6
      0xbb, 0xd4, 0xd3, // mov bx,d3d4
      0xb9, 0xd2, 0xd1, // mov cx,d1d2
      0xff, 0x36, 0x00, 0x11, // push [1100]
      0x50, 0x53, 0x51, // push ax, bx, cx
      0x58, 0x5b, 0x59, 0x5a, // pop ax, bx, cx, dx
      0xcd, 0x20, // int 20
    ]);
    m.mem.set([0xd8, 0xd7], phys(0x073f, 0x1100));
    for (let i = 0; i < 7; i++) step(m);
    expect(hex(m.regs[SP])).toBe('00F5');
    for (let i = 0; i < 4; i++) step(m);
    expect([AX, BX, CX, DX].map((r) => hex(m.regs[r]))).toEqual(['D1D2', 'D3D4', 'D5D6', 'D7D8']);
    expect(hex(m.regs[SP])).toBe('00FD');
    expect(step(m)).toEqual({ kind: 'int', n: 0x20 });
    expect(m.writes.every((w) => w.kind === 'stack')).toBe(true);
  });
});

describe('executor: otros', () => {
  it('RET con la pila inicial salta a 0000, al INT 20 del PSP', () => {
    const m = load([0xc3]);
    expect(step(m)).toEqual({ kind: 'ok' });
    expect(m.ip).toBe(0);
    expect(step(m)).toEqual({ kind: 'int', n: 0x20 });
  });

  it('división por cero y cociente que no cabe dan interrupción 0', () => {
    expect(step(run([0xb3, 0x00, 0xf6, 0xf3], 1))).toEqual({ kind: 'int', n: 0 });
    expect(step(run([0xb8, 0x00, 0x10, 0xb3, 0x02, 0xf6, 0xf3], 2))).toEqual({ kind: 'int', n: 0 });
  });

  it('LOOP no toca banderas y JCXZ salta con CX en cero', () => {
    const m = run([0xb9, 0x02, 0x00, 0xe2, 0xfe], 1);
    const flags = { ...m.flags };
    step(m);
    expect(m.ip).toBe(0x103);
    step(m);
    expect(m.ip).toBe(0x105);
    expect(m.flags).toEqual(flags);
    const j = run([0xe3, 0x10], 1);
    expect(j.ip).toBe(0x112);
  });

  it('INT 21 devuelve la interrupción con IP en la siguiente', () => {
    const m = load([0xcd, 0x21]);
    expect(step(m)).toEqual({ kind: 'int', n: 0x21 });
    expect(m.ip).toBe(0x102);
  });

  it('IN devuelve FF, OUT se ignora y HLT detiene', () => {
    const m = run([0xe4, 0x60, 0xe6, 0x60], 2);
    expect(m.regs[AX] & 0xff).toBe(0xff);
    expect(step(load([0xf4]))).toEqual({ kind: 'halt' });
  });

  it('opcode no definido no avanza IP', () => {
    const m = load([0x0f]);
    expect(step(m)).toEqual({ kind: 'undefined', byte: 0x0f });
    expect(m.ip).toBe(0x100);
  });

  it('REP MOVSB copia CX bytes y el prefijo de segmento cambia el origen', () => {
    const m = run([
      0xbe, 0x00, 0x02, // mov si,200
      0xbf, 0x00, 0x03, // mov di,300
      0xb9, 0x03, 0x00, // mov cx,3
      0xf3, 0xa4, // rep movsb
    ], 3);
    m.mem.set([1, 2, 3], phys(0x073f, 0x200));
    expect(step(m)).toEqual({ kind: 'ok' });
    expect([0, 1, 2].map((i) => readByte(m, 0x073f, 0x300 + i))).toEqual([1, 2, 3]);
    expect(m.regs[CX]).toBe(0);
    expect(m.regs[SI]).toBe(0x203);
    expect(m.regs[DI]).toBe(0x303);
  });

  it('CALL apila la vuelta y RET la recupera', () => {
    const m = load([0xe8, 0x01, 0x00, 0x90, 0xc3]);
    step(m);
    expect(m.ip).toBe(0x104);
    expect(m.regs[SP]).toBe(0x00fb);
    step(m);
    expect(m.ip).toBe(0x103);
    expect(m.regs[SP]).toBe(0x00fd);
  });
});
