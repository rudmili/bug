interface ResetButtonProps {
  /** Sin nada escrito no hay qué reiniciar. */
  disabled: boolean;
  onReset: () => void;
}

/** Botón flotante de la terminal: vuelve la máquina al estado inicial y olvida los comandos guardados. */
export function ResetButton({ disabled, onReset }: ResetButtonProps) {
  function handleClick() {
    // Borra memoria, registros y lo guardado para la próxima visita: se pide confirmación
    if (window.confirm('¿Reiniciar la máquina? Se borran la memoria, los registros y los comandos guardados.')) {
      onReset();
    }
  }

  return (
    <button
      type="button"
      className="reset"
      disabled={disabled}
      onClick={handleClick}
      title="Reiniciar la máquina y borrar los comandos guardados"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
      Reiniciar
    </button>
  );
}
