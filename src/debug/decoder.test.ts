import { describe, expect, it } from 'vitest';
import { OPCODES, decode, isGroup } from './decoder';
import { bootMachine, phys } from './memory';
import { DS, ES, SS } from './state';

function at(bytes: number[], ip = 0x100) {
  const m = bootMachine();
  m.mem.set(bytes, phys(0x0dab, ip));
  return decode(m, 0x0dab, ip);
}

describe('decoder', () => {
  it('exporta las 256 entradas, con huecos para los opcodes no definidos', () => {
    expect(OPCODES).toHaveLength(256);
    expect(OPCODES[0x0f]).toBeNull();
    expect(OPCODES[0x60]).toBeNull();
    const g = OPCODES[0x80];
    expect(g && isGroup(g) && g.group[5]?.mnem).toBe('SUB');
  });

  it('decodifica RET del estado inicial', () => {
    const i = decode(bootMachine(), 0x0dab, 0x100);
    expect(i).toMatchObject({ mnem: 'RET', operands: [], length: 1, bytes: [0xc3] });
  });

  it('00 00 es ADD [BX+SI],AL', () => {
    expect(at([0x00, 0x00])).toMatchObject({
      mnem: 'ADD',
      length: 2,
      operands: [
        { kind: 'mem', size: 8, rm: 0, disp: 0, dispSize: 0, seg: DS },
        { kind: 'reg', size: 8, index: 0 },
      ],
    });
  });

  it('MOV con registro embebido e inmediato', () => {
    expect(at([0xb4, 0x08])).toMatchObject({ mnem: 'MOV', operands: [{ kind: 'reg', size: 8, index: 4 }, { kind: 'imm', value: 8 }] });
    expect(at([0xb8, 0x08, 0x00])).toMatchObject({ length: 3, operands: [{ kind: 'reg', size: 16, index: 0 }, { kind: 'imm', size: 16, value: 8 }] });
  });

  it('grupos 80 y 83', () => {
    expect(at([0x80, 0xc4, 0x03])).toMatchObject({ mnem: 'ADD', operands: [{ kind: 'reg', size: 8, index: 4 }, { kind: 'imm', size: 8, value: 3 }] });
    expect(at([0x80, 0xec, 0x0c])).toMatchObject({ mnem: 'SUB' });
    expect(at([0x83, 0xc3, 0xff])).toMatchObject({ mnem: 'ADD', operands: [{ kind: 'reg', index: 3 }, { kind: 'imm', size: 16, value: 0xffff, signed: true }] });
  });

  it('memoria directa, con desplazamiento e inmediato', () => {
    expect(at([0xa3, 0x00, 0x02])).toMatchObject({ mnem: 'MOV', operands: [{ kind: 'mem', size: 16, rm: null, disp: 0x200 }, { kind: 'reg', index: 0 }] });
    expect(at([0x88, 0x26, 0x00, 0x20])).toMatchObject({ length: 4, operands: [{ kind: 'mem', size: 8, rm: null, disp: 0x2000 }, { kind: 'reg', size: 8, index: 4 }] });
    expect(at([0xc6, 0x06, 0x00, 0x20, 0x08])).toMatchObject({ length: 5, operands: [{ kind: 'mem', size: 8, disp: 0x2000 }, { kind: 'imm', value: 8 }] });
    expect(at([0x8b, 0x46, 0xfc])).toMatchObject({ operands: [{ kind: 'reg' }, { kind: 'mem', rm: 6, disp: 0xfffc, dispSize: 8, seg: SS }] });
    expect(at([0x8b, 0x87, 0x34, 0x12])).toMatchObject({ operands: [{ kind: 'reg' }, { kind: 'mem', rm: 7, disp: 0x1234, dispSize: 16, seg: DS }] });
  });

  it('respeta el prefijo de segmento que le pasa executor', () => {
    const m = bootMachine();
    m.mem.set([0x8b, 0x07], phys(0x0dab, 0x100));
    expect(decode(m, 0x0dab, 0x100, ES).operands[1]).toMatchObject({ kind: 'mem', seg: ES });
  });

  it('los prefijos son instrucciones de un byte', () => {
    expect(at([0x26, 0x8b, 0x07])).toMatchObject({ mnem: 'ES:', length: 1, prefix: 'seg', sreg: ES });
    expect(at([0xf3, 0xa4])).toMatchObject({ mnem: 'REPZ', length: 1, prefix: 'rep' });
  });

  it('saltos con destino absoluto', () => {
    expect(at([0xeb, 0x2e])).toMatchObject({ mnem: 'JMP', operands: [{ kind: 'rel', target: 0x130 }] });
    expect(at([0x75, 0xfb], 0x13b)).toMatchObject({ mnem: 'JNZ', operands: [{ kind: 'rel', target: 0x138 }] });
    expect(at([0xe2, 0xfc], 0x13a)).toMatchObject({ mnem: 'LOOP', operands: [{ kind: 'rel', target: 0x138 }] });
    expect(at([0xe8, 0xfd, 0xff])).toMatchObject({ mnem: 'CALL', operands: [{ kind: 'rel', target: 0x100 }] });
    expect(at([0xea, 0x00, 0x01, 0xab, 0x0d])).toMatchObject({ mnem: 'JMP', operands: [{ kind: 'far', seg: 0x0dab, off: 0x100 }] });
  });

  it('grupos F6/F7, D0 y FF', () => {
    expect(at([0xf7, 0xe1])).toMatchObject({ mnem: 'MUL', operands: [{ kind: 'reg', size: 16, index: 1 }] });
    expect(at([0xf6, 0xe9])).toMatchObject({ mnem: 'IMUL', operands: [{ kind: 'reg', size: 8, index: 1 }] });
    expect(at([0xf6, 0xf3])).toMatchObject({ mnem: 'DIV', operands: [{ kind: 'reg', size: 8, index: 3 }] });
    expect(at([0xd0, 0xe8])).toMatchObject({ mnem: 'SHR', operands: [{ kind: 'reg', size: 8, index: 0 }, { kind: 'const', value: 1 }] });
    expect(at([0xff, 0x36, 0x00, 0x11])).toMatchObject({ mnem: 'PUSH', operands: [{ kind: 'mem', size: 16, disp: 0x1100 }] });
    expect(at([0xcd, 0x21])).toMatchObject({ mnem: 'INT', operands: [{ kind: 'imm', value: 0x21 }] });
  });

  it('un opcode no definido es DB de un byte', () => {
    expect(at([0x0f, 0x00])).toMatchObject({ mnem: 'DB', length: 1, undefined: true, operands: [{ kind: 'imm', value: 0x0f }] });
    expect(at([0xf6, 0xc8])).toMatchObject({ mnem: 'DB', length: 1 });
    expect(at([0x8d, 0xc0])).toMatchObject({ mnem: 'DB', length: 1 });
  });
});
