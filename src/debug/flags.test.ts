import { describe, expect, it } from 'vitest';
import {
  addFlags,
  decFlags,
  flagsText,
  incFlags,
  logicFlags,
  mulFlags,
  parity,
  rotateFlags,
  shiftFlags,
  subFlags,
} from './flags';
import { createMachine } from './state';
import type { Flags } from './state';

function text(changes: Partial<Flags>): string {
  return flagsText({ ...createMachine().flags, ...changes });
}

describe('flags', () => {
  it('paridad del byte bajo', () => {
    expect(parity(0x00)).toBe(true);
    expect(parity(0x07)).toBe(false);
    expect(parity(0xff)).toBe(true);
    expect(parity(0x1ff)).toBe(true);
  });

  it('el estado inicial se lee NV UP EI PL NZ NA PO NC', () => {
    expect(flagsText(createMachine().flags)).toBe('NV UP EI PL NZ NA PO NC');
  });

  it('8 + 3 − 4 = 07', () => {
    const add = addFlags(0x08, 0x03, 0x0b, 8);
    const sub = subFlags(0x0b, 0x04, 0x07, 8);
    expect(text({ ...add, ...sub })).toBe('NV UP EI PL NZ NA PO NC');
  });

  it('8 + 3 − C = FF', () => {
    expect(text(subFlags(0x0b, 0x0c, -1, 8))).toBe('NV UP EI NG NZ AC PE CY');
  });

  it('A − A = 00', () => {
    expect(text(subFlags(0x0a, 0x0a, 0, 8))).toBe('NV UP EI PL ZR NA PE NC');
  });

  it('A + A = 14', () => {
    expect(text(addFlags(0x0a, 0x0a, 0x14, 8))).toBe('NV UP EI PL NZ AC PE NC');
  });

  it('desbordamiento con signo', () => {
    expect(addFlags(0x7f, 0x01, 0x80, 8).OF).toBe(true);
    expect(subFlags(0x80, 0x01, 0x7f, 8).OF).toBe(true);
    expect(addFlags(0xffff, 0x0001, 0x10000, 16)).toMatchObject({ CF: true, ZF: true, OF: false });
  });

  it('INC y DEC no tocan CF', () => {
    expect(incFlags(0xff, 8)).not.toHaveProperty('CF');
    expect(incFlags(0xff, 8).ZF).toBe(true);
    expect(decFlags(0x01, 16)).toMatchObject({ ZF: true });
    expect(decFlags(0x01, 16)).not.toHaveProperty('CF');
  });

  it('lógicas limpian CF y OF', () => {
    expect(logicFlags(0, 16)).toMatchObject({ CF: false, OF: false, ZF: true, PF: true });
  });

  it('MUL FFFF × FFFF da OV y CY', () => {
    expect(mulFlags(false, 0xfffe, 0x0001, 16)).toMatchObject({ OF: true, CF: true });
  });

  it('IMUL 4 × −1 da NV NG PE NC sin tocar ZF ni AF', () => {
    const f = mulFlags(true, 0xff, 0xfc, 8);
    expect(f).not.toHaveProperty('ZF');
    expect(f).not.toHaveProperty('AF');
    expect(text(f)).toBe('NV UP EI NG NZ NA PE NC');
  });

  it('SHR A0 → 50 da OV PL NZ NA PE NC', () => {
    expect(text(shiftFlags('SHR', 0xa0, 0x50, false, 8))).toBe('OV UP EI PL NZ NA PE NC');
  });

  it('SHL y SAR', () => {
    expect(shiftFlags('SHL', 0x40, 0x80, false, 8).OF).toBe(true);
    expect(shiftFlags('SAR', 0x80, 0xc0, false, 8).OF).toBe(false);
  });

  it('rotaciones de A0', () => {
    expect(rotateFlags('ROL', 0x41, true, 8)).toEqual({ CF: true, OF: true });
    expect(rotateFlags('ROR', 0x50, false, 8)).toEqual({ CF: false, OF: true });
    expect(rotateFlags('RCL', 0x40, true, 8)).toEqual({ CF: true, OF: true });
    expect(rotateFlags('RCR', 0x50, false, 8)).toEqual({ CF: false, OF: true });
  });
});
