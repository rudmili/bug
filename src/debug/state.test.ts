import { describe, expect, it } from 'vitest';
import { AX, CS, SP, createMachine, getReg8, setReg8, snapshot } from './state';

describe('state', () => {
  it('arranca con el estado de DOSBox-X', () => {
    const m = createMachine();
    expect([...m.sregs]).toEqual([0x0dab, 0x0dab, 0x0dab, 0x0dab]);
    expect(m.ip).toBe(0x100);
    expect(m.regs[SP]).toBe(0xfffe);
    expect(m.regs[AX]).toBe(0);
    expect(m.flags).toMatchObject({ IF: true, SF: true, CF: false, ZF: false, OF: false });
  });

  it('escribir una mitad no altera la otra', () => {
    const m = createMachine();
    setReg8(m, 4, 0x08); // AH
    expect(m.regs[AX]).toBe(0x0800);
    setReg8(m, 0, 0xff); // AL
    expect(m.regs[AX]).toBe(0x08ff);
    expect(getReg8(m, 4)).toBe(0x08);
    expect(getReg8(m, 0)).toBe(0xff);
    setReg8(m, 7, 0x12); // BH
    expect(m.regs[3]).toBe(0x1200);
  });

  it('snapshot es una copia independiente', () => {
    const m = createMachine();
    const s = snapshot(m);
    m.regs[AX] = 1;
    m.sregs[CS] = 2;
    m.flags.CF = true;
    expect(s.regs[AX]).toBe(0);
    expect(s.sregs[CS]).toBe(0x0dab);
    expect(s.flags.CF).toBe(false);
  });
});
