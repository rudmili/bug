import type { RegisterName, RegisterView } from '../debug/types';

/** Nombre completo de cada registro y, si se puede direccionar por mitades, el nombre de cada una. */
const REG_HELP: Record<RegisterName, { name: string; halves?: [string, string] }> = {
  AX: { name: 'Acumulador', halves: ['AH', 'AL'] },
  BX: { name: 'Base', halves: ['BH', 'BL'] },
  CX: { name: 'Contador', halves: ['CH', 'CL'] },
  DX: { name: 'Datos', halves: ['DH', 'DL'] },
  SP: { name: 'Puntero de pila' },
  BP: { name: 'Puntero base' },
  SI: { name: 'Índice fuente' },
  DI: { name: 'Índice destino' },
  DS: { name: 'Segmento de datos' },
  ES: { name: 'Segmento extra' },
  SS: { name: 'Segmento de pila' },
  CS: { name: 'Segmento de código' },
  IP: { name: 'Puntero de instrucción' },
};

/** Dónde están los datos: en qué mitades hay algo distinto de cero. */
function whereData(high: string, low: string, [h, l]: [string, string]): string {
  const inHigh = high !== '00';
  const inLow = low !== '00';
  if (inHigh && inLow) return `Hay datos en las dos partes, ${h} y ${l}.`;
  if (inHigh) return `Los datos están en la parte alta, ${h}.`;
  if (inLow) return `Los datos están en la parte baja, ${l}.`;
  return 'Vacío: las dos partes valen 00.';
}

export function Registers({ registers }: { registers: RegisterView[] }) {
  return (
    <section className="sec sec--plain" data-tab="reg" aria-label="Registros">
      <header className="sec__head">
        <h2 className="sec__title">Registros</h2>
      </header>
      <div className="regs">
        {registers.map((r) => {
          const help = REG_HELP[r.name];
          // Sin nombre propio para cada mitad (SP, SI, DS…) se habla de byte alto y bajo
          const halves: [string, string] = help.halves ?? ['Byte alto', 'Byte bajo'];
          const high = r.value.slice(0, 2);
          const low = r.value.slice(2);
          const tipId = `reg-tip-${r.name}`;
          return (
            // tabIndex: con teclado o con un toque en pantallas táctiles también se abre el popup
            <div
              key={r.name}
              className={r.changed ? 'reg reg--hot' : 'reg'}
              tabIndex={0}
              aria-describedby={tipId}
            >
              <span className="reg__name">{r.name}</span>
              <span className="reg__value">{r.value}</span>
              <span className="tip" id={tipId} role="tooltip">
                <span className="tip__title">
                  {help.name} <span className="tip__code">({r.name} = {r.value})</span>
                </span>
                <span className="tip__bytes">
                  <span className={high !== '00' ? 'tip__byte tip__byte--set' : 'tip__byte'}>
                    <span className="tip__byte-name">{halves[0]}</span>
                    <span className="tip__byte-value">{high}</span>
                  </span>
                  <span className={low !== '00' ? 'tip__byte tip__byte--set' : 'tip__byte'}>
                    <span className="tip__byte-name">{halves[1]}</span>
                    <span className="tip__byte-value">{low}</span>
                  </span>
                </span>
                <span className="tip__detail">{whereData(high, low, halves)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
