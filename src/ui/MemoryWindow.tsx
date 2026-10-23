import { useState } from 'react';
import type { KeyboardEvent, SubmitEvent } from 'react';
import type { ByteView, MemoryTarget, MemoryWindowView } from '../debug/types';

function byteClass(b: ByteView): string {
  let cls = 'byte';
  if (b.nonZero) cls += ' byte--set';
  if (b.isIp) cls += ' byte--ip';
  if (b.changed) cls += ' byte--hot';
  return cls;
}

/** Una página es lo que se ve: en móvil 4 filas (40h bytes, ver .mem__row), si no las 8 (80h). */
function pageSize(): number {
  return window.matchMedia?.('(max-width: 767.98px)').matches ? 0x40 : 0x80;
}

interface MemoryWindowProps {
  id: string;
  window: MemoryWindowView;
  /** Mueve la ventana; resuelve false si la dirección escrita no es válida. */
  onMove: (to: MemoryTarget) => Promise<boolean>;
}

export function MemoryWindow({ id, window: win, onMove }: MemoryWindowProps) {
  const [address, setAddress] = useState('');
  const [invalid, setInvalid] = useState(false);

  function page(direction: 1 | -1) {
    void onMove({ by: direction * pageSize() });
  }

  async function go(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (address.trim() === '') return;
    const ok = await onMove({ address });
    setInvalid(!ok);
    if (ok) setAddress('');
  }

  // Con el foco en la ventana (sus botones o el campo), RePág y AvPág cambian de página
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
    event.preventDefault();
    page(event.key === 'PageUp' ? -1 : 1);
  }

  return (
    <section id={id} className="sec sec--mem" data-tab="mem" aria-label={win.title} onKeyDown={handleKeyDown}>
      <header className="sec__head">
        <h2 className="sec__title">{win.title}</h2>
        <span className="sec__meta">
          {win.caption} ·{' '}
          <span className={win.captionHot ? 'sec__meta-value sec__meta-value--hot' : 'sec__meta-value'}>
            {win.captionValue}
          </span>
        </span>
      </header>
      <div className="memnav">
        <button type="button" className="memnav__btn" aria-label={`Página anterior, ${win.title}`} title="Página anterior (RePág)" onClick={() => page(-1)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button type="button" className="memnav__btn" aria-label={`Página siguiente, ${win.title}`} title="Página siguiente (AvPág)" onClick={() => page(1)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <form className="memnav__go" onSubmit={go}>
          <input
            className="memnav__input"
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setInvalid(false);
            }}
            placeholder="ir a…"
            aria-label={`Ir a una dirección, ${win.title}`}
            aria-invalid={invalid}
            title={invalid ? 'Dirección no válida' : 'Dirección en hexadecimal, por ejemplo 200'}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </form>
        {/* Movida a mano, la ventana queda fija: este botón la devuelve al modo automático */}
        {win.pinned && (
          <button type="button" className="memnav__follow" onClick={() => void onMove({ follow: true })}>
            Seguir
          </button>
        )}
        <span className="sr-only" role="status">
          {invalid ? 'Dirección no válida' : ''}
        </span>
      </div>
      <div className="mem">
        {win.rows.map((row) => (
          <div key={row.address} className="mem__row">
            <span className="mem__addr">{row.address}</span>
            {row.bytes.map((b, i) => (
              <span key={i} className={byteClass(b)}>
                {b.value}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
