import { useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { linesFromText } from './share';

interface ToolsProps {
  /** Hay algo para compartir o guardar: líneas desde el último `q`. */
  hasProgram: boolean;
  /** Hay algo para reiniciar: líneas guardadas o historial. */
  canReset: boolean;
  /** Aviso breve tras una acción ("Enlace copiado"); también lo oye el lector de pantalla. */
  status: string;
  onShare: () => void;
  onSave: () => void;
  onOpen: (lines: string[]) => void;
  onReset: () => void;
}

function Tool({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="tool" disabled={disabled} onClick={onClick} title={label}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {/* En móvil solo se ve el ícono; el texto sigue siendo el nombre del botón */}
      <span className="tool__label">{label}</span>
    </button>
  );
}

/** Botones que flotan sobre la terminal, justo encima de la línea de comandos. */
export function Tools({ hasProgram, canReset, status, onShare, onSave, onOpen, onReset }: ToolsProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Vaciar el campo permite volver a elegir el mismo archivo
    event.target.value = '';
    if (file) onOpen(linesFromText(await file.text()));
  }

  return (
    <div className="tools">
      <p className="tools__status" role="status">
        {status}
      </p>
      <Tool label="Compartir" disabled={!hasProgram} onClick={onShare}>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
        <path d="M16 6l-4-4-4 4" />
        <path d="M12 2v13" />
      </Tool>
      <Tool label="Guardar" disabled={!hasProgram} onClick={onSave}>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </Tool>
      <Tool label="Abrir" onClick={() => fileRef.current?.click()}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </Tool>
      <Tool label="Reiniciar" disabled={!canReset} onClick={onReset}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </Tool>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        className="tools__file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFile}
      />
    </div>
  );
}
