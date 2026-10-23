import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode, SubmitEvent } from 'react';
import type { TerminalLine } from '../debug/types';
import { TerminalHint } from './TerminalHint';
import { announcement } from './announcement';

/** Botones para la pantalla táctil: los comandos de ejecución, sin abrir el teclado. */
const QUICK = ['t', 'p', 'g', 'r'];

/**
 * Teclas sin carácter mientras el programa espera teclado, como las manda la terminal a la sesión:
 * '' es Enter, los caracteres de control van tal cual y el resto por su nombre entre llaves.
 */
const SPECIAL_KEYS: Record<string, string> = {
  Enter: '', Backspace: '\b', Tab: '\t', Escape: '\x1b',
  ArrowUp: '{Up}', ArrowDown: '{Down}', ArrowLeft: '{Left}', ArrowRight: '{Right}',
  Home: '{Home}', End: '{End}', PageUp: '{PgUp}', PageDown: '{PgDn}', Insert: '{Ins}', Delete: '{Del}',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`F${i + 1}`, `{F${i + 1}}`])),
};

/** La tecla de un evento que no escribe un carácter (Enter, flechas, Ctrl+letra…); null si escribe uno. */
function specialKey(event: KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key in SPECIAL_KEYS) return SPECIAL_KEYS[event.key];
  // Ctrl+A a Ctrl+Z son los códigos 01 a 1A; Ctrl+C corta el programa
  if (event.ctrlKey && !event.altKey && /^[a-z]$/i.test(event.key)) return String.fromCharCode(event.key.toLowerCase().charCodeAt(0) - 0x60);
  return null;
}

interface TerminalProps {
  lines: TerminalLine[];
  prompt: string;
  /** Se llama con la línea tal cual, también cuando está vacía (una línea vacía sale del modo ensamblado). */
  onSubmit: (line: string) => void;
  /** Líneas ya escritas que recorren las flechas ↑ ↓ (vienen del registro persistido). */
  history: string[];
  /** Hay un comando corriendo: como en DEBUG, no se escribe ni se envía hasta que termina. La línea queda en solo lectura, que a diferencia de disabled conserva el foco. */
  busy: boolean;
  /** El programa espera una tecla: cada tecla se envía al pulsarla, sin Enter, y no va al historial. */
  waiting: boolean;
  /** Contenido que flota sobre la salida (la versión y el enlace al repositorio). */
  children?: ReactNode;
}

export function Terminal({ lines, prompt, onSubmit, history, busy, waiting, children }: TerminalProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mantiene a la vista la última línea
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // Esperando una tecla, Enter ya se envió desde handleKeyDown
    if (busy || waiting) return;
    onSubmit(value);
    setCursor(null);
    setValue('');
  }

  // Los caracteres que se escriben van al programa apenas aparecen en el campo (también desde el teclado del móvil)
  function handleChange(text: string) {
    if (!waiting) {
      setValue(text);
      return;
    }
    for (const ch of text) onSubmit(ch);
    setValue('');
  }

  // Flechas arriba y abajo recorren lo ya escrito; si el programa espera una tecla, las teclas especiales van a él
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (waiting) {
      const key = specialKey(event);
      if (key === null) return;
      event.preventDefault();
      onSubmit(key);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (history.length === 0) return;
    event.preventDefault();
    let next: number | null;
    if (event.key === 'ArrowUp') {
      next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
    } else {
      next = cursor === null || cursor >= history.length - 1 ? null : cursor + 1;
    }
    setCursor(next);
    setValue(next === null ? '' : history[next]);
  }

  // Un clic en cualquier parte de la terminal lleva el foco al campo, salvo que se esté seleccionando texto
  // o se haya tocado un botón (en el móvil, el foco en el campo abre el teclado)
  function focusInput(event: MouseEvent<HTMLElement>) {
    if (window.getSelection()?.toString()) return;
    if ((event.target as Element).closest('button, a, input, dialog')) return;
    inputRef.current?.focus();
  }

  return (
    <main className="term" onClick={focusInput} aria-busy={busy}>
      {children}
      {/* tabIndex: la salida se puede desplazar con el teclado */}
      <div className="term__out" ref={outRef} role="region" aria-label="Salida de DEBUG" tabIndex={0}>
        {/* Con la terminal vacía (al abrir y tras `q`) se muestra la guía de comandos */}
        {lines.length === 0 && <TerminalHint />}
        {lines.map((line) => (
          <div key={line.id} className={`term__line term__line--${line.kind}`}>
            {line.text === '' ? ' ' : line.text}
          </div>
        ))}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement(lines)}
        {waiting && ' El programa espera una tecla.'}
      </p>
      {/* Solo con pantalla táctil (ver .quick). Fuera del modo comando, una letra sería otra cosa */}
      <div className="quick" role="group" aria-label="Comandos rápidos">
        {QUICK.map((cmd) => (
          <button key={cmd} type="button" className="quick__cmd" disabled={busy || prompt !== '-'} onClick={() => onSubmit(cmd)}>
            {cmd}
          </button>
        ))}
      </div>
      <form className="term__input-row" onSubmit={handleSubmit}>
        <label className="term__prompt" htmlFor="debug-cmd">
          {prompt}
        </label>
        <input
          id="debug-cmd"
          ref={inputRef}
          className="term__input"
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={waiting ? 'El programa espera una tecla (Ctrl+C lo corta)' : 'a, u, t, p, g, r, d, e, q'}
          aria-label="Comando de DEBUG"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={busy && !waiting}
          autoFocus
        />
        {/* Solo aparece si el comando tarda (ver .term__busy): los rápidos no parpadean */}
        <span className="term__busy" aria-hidden="true">
          Ejecutando…
        </span>
      </form>
    </main>
  );
}
