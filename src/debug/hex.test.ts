import { describe, expect, it } from 'vitest';
import { hex2, hex4, parseHex, toSigned16, toSigned8 } from './hex';

describe('hex', () => {
  it('formatea con relleno y mayúsculas', () => {
    expect(hex2(0xa)).toBe('0A');
    expect(hex2(0x1ff)).toBe('FF');
    expect(hex4(0xdab)).toBe('0DAB');
    expect(hex4(-1)).toBe('FFFF');
  });

  it('lee hexadecimal sin distinguir mayúsculas', () => {
    expect(parseHex('ffFF')).toBe(0xffff);
    expect(parseHex('0100')).toBe(0x100);
    expect(parseHex('')).toBeNull();
    expect(parseHex('12g')).toBeNull();
    expect(parseHex('-1')).toBeNull();
  });

  it('convierte a con signo', () => {
    expect(toSigned8(0xff)).toBe(-1);
    expect(toSigned8(0x7f)).toBe(127);
    expect(toSigned16(0x8000)).toBe(-32768);
    expect(toSigned16(0x0004)).toBe(4);
  });
});
