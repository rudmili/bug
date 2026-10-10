import type { ByteView, MemoryWindowView } from './types';

function byteClass(b: ByteView): string {
  let cls = 'byte';
  if (b.nonZero) cls += ' byte--set';
  if (b.isIp) cls += ' byte--ip';
  if (b.changed) cls += ' byte--hot';
  return cls;
}

export function MemoryWindow({ window: win }: { window: MemoryWindowView }) {
  return (
    <section className="sec sec--mem" data-tab="mem" aria-label={win.title}>
      <header className="sec__head">
        <h2 className="sec__title">{win.title}</h2>
        <span className="sec__meta">
          {win.caption} ·{' '}
          <span className={win.captionHot ? 'sec__meta-value sec__meta-value--hot' : 'sec__meta-value'}>
            {win.captionValue}
          </span>
        </span>
      </header>
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
