import { describe, expect, it } from 'vitest';
import type { TerminalLine } from '../debug/types';
import { announcement } from './announcement';

let id = 0;
const cmd = (text: string): TerminalLine => ({ id: id++, kind: 'command', text });
const out = (text: string): TerminalLine => ({ id: id++, kind: 'output', text });
const err = (text: string): TerminalLine => ({ id: id++, kind: 'error', text });

describe('announcement', () => {
  it('sin salida no anuncia nada', () => {
    expect(announcement([])).toBe('');
    expect(announcement([cmd('-a'), cmd('073F:0100 nop')])).toBe('');
  });

  it('lee entera una respuesta corta, solo la del último comando', () => {
    expect(announcement([cmd('-u 100 100'), out('x'), cmd('-r ax'), out('AX 0000')])).toBe('AX 0000');
  });

  it('el ^ Error se lee como Error, sin la columna', () => {
    expect(announcement([cmd('-zz'), err(' ^ Error')])).toBe('Error');
  });

  it('una salida larga se resume con la cantidad y la última línea', () => {
    const lines = [cmd('-g'), ...Array.from({ length: 7 }, () => out('hola')), out('Program terminated normally')];
    expect(announcement(lines)).toBe('8 líneas. La última: Program terminated normally');
  });
});
