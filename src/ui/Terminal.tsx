import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, SubmitEvent } from 'react';
import type { TerminalLine } from '../debug/types';
import { TerminalHint } from './TerminalHint';
import { announcement } from './announcement';

interface TerminalProps {
  lines: TerminalLine[];
  prompt: string;
  /** Se llama con la línea tal cual, también cuando está vacía (una línea vacía sale del modo ensamblado). */
  onSubmit: (line: string) => void;
  /** Líneas ya escritas que recorren las flechas ↑ ↓ (vienen del registro persistido). */
  history: string[];
  /** Contenido que flota sobre la salida (la versión y el enlace al repositorio). */
  children?: ReactNode;
}

export function Terminal({ lines, prompt, onSubmit, history, children }: TerminalProps) {
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
    onSubmit(value);
    setCursor(null);
    setValue('');
  }

  // Flechas arriba y abajo recorren lo ya escrito
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
  function focusInput() {
    if (window.getSelection()?.toString()) return;
    inputRef.current?.focus();
  }

  return (
    <main className="term" onClick={focusInput}>
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
      </p>
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
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="a, u, r, t, d, e, g, q"
          aria-label="Comando de DEBUG"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
      </form>
    </main>
  );
}
