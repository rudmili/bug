/** Utilidades hexadecimales. DEBUG imprime en mayúsculas y lee sin distinguir mayúsculas. */

export function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

/** Número hexadecimal sin prefijo ni sufijo. Devuelve null si el texto no es hexadecimal. */
export function parseHex(text: string): number | null {
  if (!/^[0-9a-f]+$/i.test(text)) return null;
  return parseInt(text, 16);
}

export function toSigned8(n: number): number {
  n &= 0xff;
  return n & 0x80 ? n - 0x100 : n;
}

export function toSigned16(n: number): number {
  n &= 0xffff;
  return n & 0x8000 ? n - 0x10000 : n;
}
