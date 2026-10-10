import type { CSSProperties } from 'react';
import type { StackViewModel } from '../debug/types';

export function StackView({ stack }: { stack: StackViewModel }) {
  return (
    <section className="sec sec--stack" data-tab="pila" aria-label="Pila">
      <header className="sec__head">
        <h2 className="sec__title">Pila</h2>
        <span className="sec__meta">
          <span className="sec__meta-value">{stack.pointer}</span>
        </span>
      </header>
      <div className="stack__rows">
        {stack.rows.map((row) => (
          <div key={row.address} className={row.isSp ? 'stack__row stack__row--sp' : 'stack__row'}>
            <span className="stack__tag">{row.isSp ? 'SP' : ''}</span>
            <span className="stack__addr">{row.address}</span>
            <span className="stack__value">{row.value}</span>
            <span className="stack__note">{row.note}</span>
          </div>
        ))}
      </div>
      <div className="stack__range">
        <div className="stack__bar">
          {/* --pos lo consume .stack__mark en debug-ui.css */}
          <div className="stack__mark" style={{ '--pos': stack.position } as CSSProperties} />
        </div>
        <div className="stack__legend">
          <span>
            inicio <b>{stack.start}</b>
          </span>
          <span>
            <b>
              {stack.usedBytes}/{stack.totalBytes}
            </b>{' '}
            bytes
          </span>
          <span>
            límite <b>{stack.limit}</b>
          </span>
        </div>
      </div>
    </section>
  );
}
