import { describe, expect, it } from 'vitest';
import { linesFromText, sessionText, shareUrl, sharedLines } from './share';

describe('share', () => {
  const program = ['a 100', 'mov dx,102', '', 'e 102 "¡Hola, año!" 0d 0a "$"', 'g'];

  it('el enlace lleva las líneas en el hash y se vuelven a leer iguales', () => {
    const url = shareUrl('https://bug.mikell.com.ar/', program);
    expect(url).toMatch(/^https:\/\/bug\.mikell\.com\.ar\/#p=[\w-]+$/);
    expect(sharedLines(new URL(url).hash)).toEqual(program);
  });

  it('sin programa o con datos dañados no hay líneas', () => {
    expect(sharedLines('')).toBeNull();
    expect(sharedLines('#otra-cosa')).toBeNull();
    expect(sharedLines('#p=@@@')).toBeNull();
    // Bytes que no son UTF-8 válido
    expect(sharedLines('#p=_w')).toBeNull();
  });

  it('el archivo de sesión conserva las líneas vacías', () => {
    const text = sessionText(program);
    expect(text).toBe('a 100\nmov dx,102\n\ne 102 "¡Hola, año!" 0d 0a "$"\ng\n');
    expect(linesFromText(text)).toEqual(program);
  });

  it('acepta archivos con saltos de Windows y sin salto final', () => {
    expect(linesFromText('a\r\nnop\r\n\r\ng')).toEqual(['a', 'nop', '', 'g']);
    expect(linesFromText('')).toEqual([]);
  });
});
