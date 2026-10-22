import { describe, expect, it } from 'vitest';
import { bootMachine, clearWrites, phys, readByte, readWord, writeByte, writeWord } from './memory';

describe('memory', () => {
  it('calcula la dirección física', () => {
    expect(phys(0x0dab, 0x0100)).toBe(0x0dbb0);
    expect(phys(0xffff, 0x0010)).toBe(0x00000);
    expect(phys(0x1000, 0x10000)).toBe(0x10000);
  });

  it('arranca con el PSP de DOSBox en 073F:0000 y ceros desde 0100', () => {
    const m = bootMachine();
    expect(readWord(m, 0x073f, 0)).toBe(0x20cd);
    expect([0x50, 0x51, 0x52].map((off) => readByte(m, 0x073f, off))).toEqual([0xcd, 0x21, 0xcb]);
    expect(readByte(m, 0x073f, 0x5c)).toBe(0);
    expect(readByte(m, 0x073f, 0x5d)).toBe(0x20);
    expect(readWord(m, 0x073f, 0x80)).toBe(0x0d00);
    expect(readByte(m, 0x073f, 0x100)).toBe(0);
    expect(readWord(m, 0x073f, 0x11c)).toBe(0x0034);
  });

  it('las palabras son little endian y dan la vuelta en 16 bits', () => {
    const m = bootMachine();
    writeWord(m, 0x0dab, 0x0200, 0x1234);
    expect(readByte(m, 0x0dab, 0x0200)).toBe(0x34);
    expect(readByte(m, 0x0dab, 0x0201)).toBe(0x12);
    writeWord(m, 0x2000, 0xffff, 0xabcd);
    expect(readByte(m, 0x2000, 0xffff)).toBe(0xcd);
    expect(readByte(m, 0x2000, 0x0000)).toBe(0xab);
    expect(readWord(m, 0x2000, 0xffff)).toBe(0xabcd);
  });

  it('registra las escrituras con su valor anterior', () => {
    const m = bootMachine();
    clearWrites(m);
    writeByte(m, 0x073f, 0x11c, 0x90, 'code');
    expect(m.writes).toEqual([{ addr: phys(0x073f, 0x11c), old: 0x34, kind: 'code' }]);
    clearWrites(m);
    expect(m.writes).toEqual([]);
  });
});
