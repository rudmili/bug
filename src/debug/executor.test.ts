import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { step } from './executor';
import { flagsText } from './flags';
import { bootMachine, phys, readByte } from './memory';
import { AX, BX, CS, CX, DI, DS, DX, ES, SI, SP, getReg8 } from './state';
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

/** Ensambla las líneas desde 0100, como `a 100`. */
function program(...lines: string[]): Machine {
  const m = bootMachine();
  let off = 0x100;
  for (const line of lines) {
    const r = assemble(line, off);
    if (!r.ok) throw new Error(`No se pudo ensamblar: ${line}`);
    m.mem.set(r.bytes, phys(0x073f, off));
    off += r.bytes.length;
  }
  return m;
}

/** Ensambla y ejecuta todas las líneas. */
function exec(...lines: string[]): Machine {
  const m = program(...lines);
  for (let i = 0; i < lines.length; i++) expect(step(m)).toEqual({ kind: 'ok' });
  return m;
}

const al = (m: Machine) => getReg8(m, 0);
const ah = (m: Machine) => getReg8(m, 4);
const text = (m: Machine, off: number, s: string) => m.mem.set([...s].map((c) => c.charCodeAt(0)), phys(0x073f, off));

describe('executor: aritmética y lógica', () => {
  it('ADC y SBB suman y restan el acarreo', () => {
    expect(al(exec('stc', 'mov al,5', 'adc al,1'))).toBe(7);
    expect(al(exec('mov al,7', 'stc', 'sbb al,2'))).toBe(4);
  });

  it('CMP y TEST solo cambian las banderas', () => {
    const m = exec('mov ax,5', 'cmp ax,5');
    expect(m.regs[AX]).toBe(5);
    expect(m.flags.ZF).toBe(true);
    const t = exec('mov al,80', 'test al,80');
    expect(al(t)).toBe(0x80);
    expect(t.flags).toMatchObject({ ZF: false, SF: true, CF: false, OF: false });
  });

  it('NEG pone CF con un valor distinto de cero, y NOT invierte los bits', () => {
    const m = exec('mov al,1', 'neg al');
    expect(al(m)).toBe(0xff);
    expect(m.flags.CF).toBe(true);
    expect(al(exec('mov al,ff', 'not al'))).toBe(0);
  });

  it('XCHG intercambia, CBW y CWD extienden el signo', () => {
    const m = exec('mov ax,1', 'mov bx,2', 'xchg ax,bx');
    expect([m.regs[AX], m.regs[BX]]).toEqual([2, 1]);
    const c = exec('mov al,80', 'cbw', 'cwd');
    expect(hex(c.regs[AX])).toBe('FF80');
    expect(hex(c.regs[DX])).toBe('FFFF');
  });

  it('DAA y DAS corrigen sumas y restas BCD', () => {
    const add = exec('mov al,15', 'add al,27', 'daa');
    expect(al(add)).toBe(0x42);
    expect(add.flags.CF).toBe(false);
    expect(al(exec('mov al,42', 'sub al,27', 'das'))).toBe(0x15);
  });

  it('AAA y AAS ajustan el BCD desempaquetado', () => {
    const add = exec('mov ax,9', 'add al,3', 'aaa');
    expect(hex(add.regs[AX])).toBe('0102');
    expect(add.flags.CF).toBe(true);
    const sub = exec('mov ax,102', 'sub al,3', 'aas');
    expect(hex(sub.regs[AX])).toBe('0009');
    expect(sub.flags.CF).toBe(true);
  });

  it('AAM y AAD pasan entre binario y dos dígitos', () => {
    const m = exec('mov al,2b', 'aam');
    expect([ah(m), al(m)]).toEqual([4, 3]);
    expect(hex(exec('mov ax,403', 'aad').regs[AX])).toBe('002B');
  });

  it('AAM con base cero da la interrupción de división', () => {
    expect(step(load([0xd4, 0x00]))).toEqual({ kind: 'int', n: 0 });
  });

  it('INTO solo interrumpe con desbordamiento', () => {
    const m = program('mov al,7f', 'add al,1', 'into');
    step(m);
    step(m);
    expect(step(m)).toEqual({ kind: 'int', n: 4 });
    expect(step(load([0xce]))).toEqual({ kind: 'ok' });
  });
});

describe('executor: banderas y transferencias', () => {
  it('CLC, STC, CMC, CLD, STD, CLI y STI', () => {
    expect(exec('stc', 'cmc', 'std', 'cli').flags).toMatchObject({ CF: false, DF: true, IF: false });
    expect(exec('clc', 'stc', 'cld', 'sti', 'nop').flags).toMatchObject({ CF: true, DF: false, IF: true });
  });

  it('LAHF, SAHF, PUSHF y POPF', () => {
    expect(ah(exec('stc', 'lahf')) & 1).toBe(1);
    expect(exec('mov ah,0', 'stc', 'sahf').flags.CF).toBe(false);
    expect(exec('stc', 'pushf', 'clc', 'popf').flags.CF).toBe(true);
  });

  it('XLAT lee la tabla en DS:BX+AL', () => {
    const m = program('mov bx,200', 'mov al,2', 'xlat');
    text(m, 0x200, 'ABC');
    for (let i = 0; i < 3; i++) step(m);
    expect(al(m)).toBe(0x43);
  });

  it('LDS y LES cargan un puntero lejano', () => {
    const m = program('les di,[304]', 'lds si,[300]');
    m.mem.set([0x34, 0x12, 0x78, 0x56, 0xcd, 0xab, 0x00, 0x20], phys(0x073f, 0x300));
    step(m);
    expect([hex(m.regs[DI]), hex(m.sregs[ES])]).toEqual(['ABCD', '2000']);
    step(m);
    expect([hex(m.regs[SI]), hex(m.sregs[DS])]).toEqual(['1234', '5678']);
  });

  it('JMP a registro y JMP lejano por memoria', () => {
    expect(exec('mov bx,200', 'jmp bx').ip).toBe(0x200);
    const m = program('jmp far [300]');
    m.mem.set([0x00, 0x04, 0x00, 0x10], phys(0x073f, 0x300));
    step(m);
    expect([hex(m.sregs[CS]), hex(m.ip)]).toEqual(['1000', '0400']);
  });

  it('CALL lejano directo y RETF', () => {
    const m = program('call 073f:200');
    m.mem.set([0xcb], phys(0x073f, 0x200)); // retf
    step(m);
    expect([hex(m.ip), hex(m.regs[SP])]).toEqual(['0200', '00F9']);
    step(m);
    expect([hex(m.sregs[CS]), hex(m.ip), hex(m.regs[SP])]).toEqual(['073F', '0105', '00FD']);
  });

  it('CALL lejano por memoria y RET con descarte de pila', () => {
    const m = program('call far [300]');
    m.mem.set([0x00, 0x02, 0x3f, 0x07], phys(0x073f, 0x300));
    m.mem.set([0xc2, 0x02, 0x00], phys(0x073f, 0x200)); // ret 2
    step(m);
    expect(hex(m.ip)).toBe('0200');
    step(m);
    // RET cercano saca solo IP; el 2 descarta además el CS apilado
    expect([hex(m.ip), hex(m.regs[SP])]).toEqual(['0104', '00FD']);
  });

  it('IRET recupera IP, CS y las banderas', () => {
    const m = exec('mov ax,1', 'push ax', 'push cs', 'mov ax,200', 'push ax', 'iret');
    expect([hex(m.ip), hex(m.regs[SP]), m.flags.CF]).toEqual(['0200', '00FD', true]);
  });

  it('LOOPZ sigue mientras ZF y LOOPNZ mientras no', () => {
    const z = exec('mov cx,3', 'cmp ax,ax', 'loopz 100');
    expect([z.regs[CX], hex(z.ip)]).toEqual([2, '0100']);
    const nz = exec('mov cx,3', 'cmp ax,ax', 'loopnz 100');
    expect([nz.regs[CX], hex(nz.ip)]).toEqual([2, '0107']);
  });
});

describe('executor: cadenas', () => {
  it('MOVSW avanza de a dos y con DF retrocede', () => {
    const m = program('mov si,200', 'mov di,300', 'movsw', 'std', 'movsb');
    text(m, 0x200, 'ABC');
    for (let i = 0; i < 3; i++) step(m);
    expect([readByte(m, 0x073f, 0x300), readByte(m, 0x073f, 0x301)]).toEqual([0x41, 0x42]);
    expect([hex(m.regs[SI]), hex(m.regs[DI])]).toEqual(['0202', '0302']);
    step(m);
    step(m);
    expect(readByte(m, 0x073f, 0x302)).toBe(0x43);
    expect([hex(m.regs[SI]), hex(m.regs[DI])]).toEqual(['0201', '0301']);
  });

  it('REP STOSB llena CX bytes y LODSW lee una palabra', () => {
    const m = program('mov al,7', 'mov di,400', 'mov cx,3', 'rep stosb', 'mov si,400', 'lodsw');
    for (let i = 0; i < 6; i++) step(m);
    expect([0, 1, 2, 3].map((i) => readByte(m, 0x073f, 0x400 + i))).toEqual([7, 7, 7, 0]);
    expect([m.regs[CX], hex(m.regs[DI])]).toEqual([0, '0403']);
    expect([hex(m.regs[AX]), hex(m.regs[SI])]).toEqual(['0707', '0402']);
  });

  it('REPNZ SCASB busca un byte y REPZ CMPSB se detiene en la primera diferencia', () => {
    const scan = program('mov di,300', 'mov al,43', 'mov cx,4', 'repnz scasb');
    text(scan, 0x300, 'ABCD');
    for (let i = 0; i < 4; i++) step(scan);
    expect([hex(scan.regs[DI]), scan.regs[CX], scan.flags.ZF]).toEqual(['0303', 1, true]);

    const cmp = program('mov si,200', 'mov di,300', 'mov cx,2', 'repz cmpsb');
    text(cmp, 0x200, 'AB');
    text(cmp, 0x300, 'AC');
    for (let i = 0; i < 4; i++) step(cmp);
    expect([cmp.regs[CX], cmp.flags.ZF, hex(cmp.regs[SI])]).toEqual([0, false, '0202']);
  });
});
