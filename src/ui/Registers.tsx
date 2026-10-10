import type { RegisterView } from '../debug/types';

export function Registers({ registers }: { registers: RegisterView[] }) {
  return (
    <section className="sec sec--plain" data-tab="reg" aria-label="Registros">
      <header className="sec__head">
        <h2 className="sec__title">Registros</h2>
      </header>
      <div className="regs">
        {registers.map((r) => (
          <div key={r.name} className={r.changed ? 'reg reg--hot' : 'reg'}>
            <span className="reg__name">{r.name}</span>
            <span className="reg__value">{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
