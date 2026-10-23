/**
 * Programas compartidos y archivos de sesión. Un programa es la lista de líneas que se escribieron
 * desde el último `q` y la hora en que arrancó la máquina: volver a ejecutarlas desde esa hora
 * reconstruye la máquina, igual que al recargar la página.
 */
export interface Program {
  lines: string[];
  /** Hora de arranque (DebugView.clock); null en los programas guardados antes de que hubiera reloj. */
  clock: string | null;
}

/** Prefijo del hash: https://bug.mikell.com.ar/#p=…&t=… */
const HASH_KEY = '#p=';
const CLOCK_KEY = '&t=';
/** Primera línea del archivo de sesión con la hora de arranque. DEBUG no tiene un comando @. */
const CLOCK_LINE = '@reloj ';

function toBase64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Enlace que abre el simulador con este programa. Va en el hash: el servidor nunca lo recibe. */
export function shareUrl(base: string, { lines, clock }: Program): string {
  return `${base}${HASH_KEY}${toBase64Url(lines.join('\n'))}${clock ? CLOCK_KEY + clock : ''}`;
}

/** El programa de un hash `#p=…&t=…`, o null si no hay programa o está dañado. */
export function sharedProgram(hash: string): Program | null {
  if (!hash.startsWith(HASH_KEY)) return null;
  const [data, clock = null] = hash.slice(HASH_KEY.length).split(CLOCK_KEY);
  try {
    return { lines: fromBase64Url(data).split('\n'), clock };
  } catch {
    return null;
  }
}

/**
 * Texto del archivo que se descarga: la hora de arranque y una línea por renglón, también las vacías
 * (salen del modo ensamblado).
 */
export function sessionText({ lines, clock }: Program): string {
  return [...(clock ? [CLOCK_LINE + clock] : []), ...lines].map((line) => `${line}\n`).join('');
}

/** El programa de un archivo de sesión, con saltos de Windows o de Unix. */
export function programFromText(text: string): Program {
  const lines = text.split(/\r?\n/);
  // El salto final de la última línea no es una línea vacía más
  if (lines[lines.length - 1] === '') lines.pop();
  const clock = lines[0]?.startsWith(CLOCK_LINE) ? lines.shift()!.slice(CLOCK_LINE.length) : null;
  return { lines, clock };
}
