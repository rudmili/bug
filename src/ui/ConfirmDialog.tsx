import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  detail: string;
  /** Texto del botón que confirma. El otro siempre es "Cancelar". */
  confirmLabel: string;
  /** Se llama al cerrarse, con true solo si se eligió confirmar (Escape y Cancelar dan false). */
  onClose: (confirmed: boolean) => void;
}

/**
 * Confirmación antes de algo que borra la sesión. <dialog> modal: atrapa el foco, se cierra con
 * Escape y devuelve el foco a donde estaba.
 */
export function ConfirmDialog({ open, title, detail, confirmLabel, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  // showModal() solo existe como método: se sincroniza con la prop
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
      onClose={(e) => onClose(e.currentTarget.returnValue === 'confirm')}
    >
      <form method="dialog">
        <h2 id={`${id}-title`} className="confirm__title">
          {title}
        </h2>
        <p id={`${id}-detail`} className="confirm__text">
          {detail}
        </p>
        <div className="confirm__actions">
          <button value="cancel" className="confirm__button" autoFocus>
            Cancelar
          </button>
          <button value="confirm" className="confirm__button confirm__button--danger">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
