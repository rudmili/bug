import type { FlagView } from './types';

export function Flags({ flags }: { flags: FlagView[] }) {
  return (
    <section className="sec sec--plain" data-tab="reg" aria-label="Banderas">
      <header className="sec__head">
        <h2 className="sec__title">Banderas</h2>
      </header>
      <div className="flags">
        {flags.map((f) => (
          <div key={f.key} className={f.changed ? 'flag flag--hot' : 'flag'}>
            <span className="flag__code">{f.code}</span>
            <span className="flag__label">{f.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
