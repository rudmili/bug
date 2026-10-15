const COMMANDS = [
  { cmd: 'a', desc: 'Ensambla instrucciones' },
  { cmd: 'u', desc: 'Desensambla la memoria' },
  { cmd: 't', desc: 'Ejecuta paso a paso' },
  { cmd: 'g', desc: 'Ejecuta hasta el final' },
  { cmd: 'r', desc: 'Muestra o cambia registros' },
  { cmd: 'd', desc: 'Muestra la memoria' },
  { cmd: 'e', desc: 'Escribe en memoria' },
  { cmd: 'q', desc: 'Reinicia la máquina' },
  { cmd: 'man', desc: 'Explica un comando' },
  { cmd: 'clear', desc: 'Limpia la terminal' },
];

/** Guía de comandos que ocupa la terminal mientras no hay nada escrito. */
export function TerminalHint() {
  return (
    <div className="hint">
      <div className="hint__head">
        <p className="hint__title">DEBUG 8086</p>
        <p className="hint__lead">Escribe un comando en la línea de abajo y pulsa Enter.</p>
      </div>
      <dl className="hint__cmds">
        {COMMANDS.map(({ cmd, desc }) => (
          <div key={cmd} className="hint__cmd">
            <dt className="hint__key">{cmd}</dt>
            <dd className="hint__desc">{desc}</dd>
          </div>
        ))}
      </dl>
      <p className="hint__foot">
        Los números van en hexadecimal. Las flechas ↑ ↓ recorren lo que ya escribiste.
        <br />
        Para empezar, prueba <code className="hint__key">a 100</code>. Para saber qué hace un comando,{' '}
        <code className="hint__key">man a</code>.
      </p>
    </div>
  );
}
