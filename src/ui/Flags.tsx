import type { FlagCode, FlagView } from '../debug/types';

/** Lo que significa cada código de DEBUG: nombre completo, estado y una línea de explicación. */
const FLAG_HELP: Record<FlagCode, { name: string; state: string; detail: string }> = {
  OV: { name: 'Desbordamiento', state: 'sí', detail: 'El resultado con signo no cabe en el destino.' },
  NV: { name: 'Desbordamiento', state: 'no', detail: 'El resultado con signo cabe en el destino.' },
  DN: { name: 'Dirección', state: 'abajo', detail: 'Las instrucciones de cadena decrementan SI y DI.' },
  UP: { name: 'Dirección', state: 'arriba', detail: 'Las instrucciones de cadena incrementan SI y DI.' },
  EI: { name: 'Interrupciones', state: 'habilitadas', detail: 'El procesador atiende las interrupciones externas.' },
  DI: { name: 'Interrupciones', state: 'deshabilitadas', detail: 'El procesador ignora las interrupciones externas.' },
  NG: { name: 'Signo', state: 'negativo', detail: 'El bit más alto del resultado es 1.' },
  PL: { name: 'Signo', state: 'positivo', detail: 'El bit más alto del resultado es 0.' },
  ZR: { name: 'Cero', state: 'sí', detail: 'El resultado es cero.' },
  NZ: { name: 'Cero', state: 'no', detail: 'El resultado no es cero.' },
  AC: { name: 'Acarreo auxiliar', state: 'sí', detail: 'Hubo acarreo del bit 3 al 4 (aritmética BCD).' },
  NA: { name: 'Acarreo auxiliar', state: 'no', detail: 'No hubo acarreo del bit 3 al 4.' },
  PE: { name: 'Paridad', state: 'par', detail: 'El byte bajo del resultado tiene una cantidad par de bits en 1.' },
  PO: { name: 'Paridad', state: 'impar', detail: 'El byte bajo del resultado tiene una cantidad impar de bits en 1.' },
  CY: { name: 'Acarreo', state: 'sí', detail: 'La operación sin signo llevó o pidió prestado un bit.' },
  NC: { name: 'Acarreo', state: 'no', detail: 'La operación sin signo no llevó ni pidió prestado un bit.' },
};

export function Flags({ flags }: { flags: FlagView[] }) {
  return (
    <section className="sec sec--plain" data-tab="reg" aria-label="Banderas">
      <header className="sec__head">
        <h2 className="sec__title">Banderas</h2>
      </header>
      <div className="flags">
        {flags.map((f) => {
          const help = FLAG_HELP[f.code];
          const tipId = `flag-tip-${f.key}`;
          return (
            // tabIndex: con teclado o con un toque en pantallas táctiles también se abre el popup
            <div
              key={f.key}
              className={f.changed ? 'flag flag--hot' : 'flag'}
              tabIndex={0}
              aria-describedby={tipId}
            >
              <span className="flag__code">{f.code}</span>
              <span className="flag__label">{f.label}</span>
              <span className="tip" id={tipId} role="tooltip">
                <span className="tip__title">
                  {help.name}: <b>{help.state}</b> <span className="tip__code">({f.code})</span>
                </span>
                <span className="tip__detail">{help.detail}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
