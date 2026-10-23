import { describe, expect, it } from 'vitest';
import { programFromText, sessionText, shareUrl, sharedProgram } from './share';

describe('share', () => {
  const lines = ['a 100', 'mov dx,102', '', 'e 102 "¡Hola, año!" 0d 0a "$"', 'g'];
  const program = { lines, clock: '2026-10-22T23:18:45.32' };

  it('el enlace lleva las líneas y la hora de arranque en el hash y se vuelven a leer iguales', () => {
    const url = shareUrl('https://bug.mikell.com.ar/', program);
    expect(url).toMatch(/^https:\/\/bug\.mikell\.com\.ar\/#p=[\w-]+&t=2026-10-22T23:18:45\.32$/);
    expect(sharedProgram(new URL(url).hash)).toEqual(program);
  });

  it('un enlace de antes del reloj no trae hora', () => {
    const url = shareUrl('https://bug.mikell.com.ar/', { lines, clock: null });
    expect(url).toMatch(/^https:\/\/bug\.mikell\.com\.ar\/#p=[\w-]+$/);
    expect(sharedProgram(new URL(url).hash)).toEqual({ lines, clock: null });
  });

  it('sin programa o con datos dañados no hay programa', () => {
    expect(sharedProgram('')).toBeNull();
    expect(sharedProgram('#otra-cosa')).toBeNull();
    expect(sharedProgram('#p=@@@')).toBeNull();
    // Bytes que no son UTF-8 válido
    expect(sharedProgram('#p=_w')).toBeNull();
  });

  it('el archivo de sesión empieza con la hora y conserva las líneas vacías', () => {
    const text = sessionText(program);
    expect(text).toBe('@reloj 2026-10-22T23:18:45.32\na 100\nmov dx,102\n\ne 102 "¡Hola, año!" 0d 0a "$"\ng\n');
    expect(programFromText(text)).toEqual(program);
  });

  it('acepta archivos sin hora, con saltos de Windows y sin salto final', () => {
    expect(programFromText('a\r\nnop\r\n\r\ng')).toEqual({ lines: ['a', 'nop', '', 'g'], clock: null });
    expect(programFromText('')).toEqual({ lines: [], clock: null });
  });
});
