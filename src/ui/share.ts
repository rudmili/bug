/**
 * Programas compartidos y archivos de sesión. Un programa es la lista de líneas que se escribieron
 * desde el último `q`: volver a ejecutarlas reconstruye la máquina, igual que al recargar la página.
 */

/** Prefijo del hash: https://bug.mikell.com.ar/#p=… */
const HASH_KEY = '#p=';

function toBase64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Enlace que abre el simulador con estas líneas. Van en el hash: el servidor nunca las recibe. */
export function shareUrl(base: string, lines: string[]): string {
  return `${base}${HASH_KEY}${toBase64Url(lines.join('\n'))}`;
}

/** Las líneas de un hash `#p=…`, o null si no hay programa o está dañado. */
export function sharedLines(hash: string): string[] | null {
  if (!hash.startsWith(HASH_KEY)) return null;
  try {
    return fromBase64Url(hash.slice(HASH_KEY.length)).split('\n');
  } catch {
    return null;
  }
}

/** Texto del archivo que se descarga: una línea por renglón, también las vacías (salen del modo ensamblado). */
export function sessionText(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/** Líneas de un archivo de sesión, con saltos de Windows o de Unix. */
export function linesFromText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  // El salto final de la última línea no es una línea vacía más
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
