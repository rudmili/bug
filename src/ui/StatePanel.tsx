import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { DebugView, MemoryTarget, MemoryWindowName } from '../debug/types';
import { Registers } from './Registers';
import { Flags } from './Flags';
import { MemoryWindow } from './MemoryWindow';
import { StackView } from './StackView';
import { AppInfo } from './AppInfo';

type Tab = 'reg' | 'mem' | 'pila';

/** Cada pestaña y las secciones que muestra en móvil (sus ids van en aria-controls). */
const TABS: { id: Tab; label: string; controls: string }[] = [
  { id: 'reg', label: 'Registros', controls: 'sec-regs sec-flags' },
  { id: 'mem', label: 'Memoria', controls: 'sec-code sec-data' },
  { id: 'pila', label: 'Pila', controls: 'sec-stack' },
];

type PanelView = Pick<DebugView, 'registers' | 'flags' | 'code' | 'data' | 'stack'>;

/** Elementos con popup (registros y banderas). */
const TIP_TARGET = '.reg, .flag';

/**
 * Escape oculta el popup abierto aunque el foco esté en la terminal (WCAG 1.4.13), hasta que el
 * cursor y el foco se van de ese registro o bandera.
 */
function useDismissableTips(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    function hide(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || !el) return;
      for (const target of el.querySelectorAll<HTMLElement>(TIP_TARGET)) {
        if (target.matches(':hover') || target === document.activeElement) target.dataset.tipHidden = '';
      }
    }
    function restore(event: Event) {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip-hidden]');
      const next = (event as FocusEvent | PointerEvent).relatedTarget as Node | null;
      if (!target || target.contains(next)) return;
      // Sigue oculto mientras quede el otro: el foco al irse el cursor, o el cursor al irse el foco
      const stays = event.type === 'pointerout' ? target === document.activeElement : target.matches(':hover');
      if (!stays) delete target.dataset.tipHidden;
    }
    document.addEventListener('keydown', hide);
    el.addEventListener('pointerout', restore);
    el.addEventListener('focusout', restore);
    return () => {
      document.removeEventListener('keydown', hide);
      el.removeEventListener('pointerout', restore);
      el.removeEventListener('focusout', restore);
    };
  }, [panel]);
}

/**
 * Panel de estado. El mismo marcado sirve para los tres diseños; el CSS decide:
 *  - móvil: pestañas, una sección a la vez (según data-active)
 *  - md: franja de dos columnas, todo visible
 *  - lg en adelante: columna flotante sobre la terminal
 */
interface StatePanelProps {
  view: PanelView;
  /** Mueve una ventana de memoria; resuelve false si la dirección no es válida. */
  onMoveWindow: (window: MemoryWindowName, to: MemoryTarget) => Promise<boolean>;
}

export function StatePanel({ view, onMoveWindow }: StatePanelProps) {
  const [tab, setTab] = useState<Tab>('reg');
  const panelRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  useDismissableTips(panelRef);

  // Patrón de pestañas de WAI-ARIA: las flechas, Inicio y Fin mueven el foco y activan la pestaña
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      event.key === 'ArrowRight' ? (i + 1) % TABS.length
        : event.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
          : event.key === 'Home' ? 0
            : event.key === 'End' ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current.get(TABS[next].id)?.focus();
  }

  return (
    <aside className="panel" data-active={tab} aria-label="Estado de la máquina" ref={panelRef}>
      <div className="panel__tabs">
        <div className="panel__tablist" role="tablist" aria-label="Secciones del panel" onKeyDown={handleKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(node) => {
                if (node) tabRefs.current.set(t.id, node);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              className="panel__tab"
              aria-selected={tab === t.id}
              aria-controls={t.controls}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <AppInfo className="info--tabs" />
      </div>
      <div className="panel__col panel__col--a">
        <Registers registers={view.registers} />
        <Flags flags={view.flags} />
        <StackView stack={view.stack} />
      </div>
      <div className="panel__col panel__col--b">
        <MemoryWindow id="sec-code" window={view.code} onMove={(to) => onMoveWindow('code', to)} />
        <MemoryWindow id="sec-data" window={view.data} onMove={(to) => onMoveWindow('data', to)} />
      </div>
    </aside>
  );
}
