import { useRef } from 'react';

interface ResetButtonProps {
  /** Sin nada escrito no hay qué reiniciar. */
  disabled: boolean;
  onReset: () => void;
}

/** Botón flotante de la terminal: vuelve la máquina al estado inicial y olvida los comandos guardados. */
export function ResetButton({ disabled, onReset }: ResetButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Borra memoria, registros y lo guardado para la próxima visita: se pide confirmación.
  // <dialog> modal atrapa el foco, se cierra con Escape y devuelve el foco al botón.
  function open() {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.returnValue = '';
    dialog.showModal();
  }

  return (
    <>
      <button
        type="button"
        className="reset"
        disabled={disabled}
        onClick={open}
        title="Reiniciar la máquina y borrar los comandos guardados"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
        Reiniciar
      </button>
      <dialog
        ref={dialogRef}
        className="confirm"
        aria-labelledby="reset-title"
        aria-describedby="reset-detail"
        onClose={(e) => {
          if (e.currentTarget.returnValue === 'reset') onReset();
        }}
      >
        <form method="dialog">
          <h2 id="reset-title" className="confirm__title">
            ¿Reiniciar la máquina?
          </h2>
          <p id="reset-detail" className="confirm__text">
            Se borran la memoria, los registros y los comandos guardados.
          </p>
          <div className="confirm__actions">
            <button value="cancel" className="confirm__button" autoFocus>
              Cancelar
            </button>
            <button value="reset" className="confirm__button confirm__button--danger">
              Reiniciar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
