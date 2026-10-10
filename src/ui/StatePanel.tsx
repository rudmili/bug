import { useState } from 'react';
import type { DebugView } from '../debug/types';
import { Registers } from './Registers';
import { Flags } from './Flags';
import { MemoryWindow } from './MemoryWindow';
import { StackView } from './StackView';

type Tab = 'reg' | 'mem' | 'pila';

const TABS: { id: Tab; label: string }[] = [
  { id: 'reg', label: 'Registros' },
  { id: 'mem', label: 'Memoria' },
  { id: 'pila', label: 'Pila' },
];

type PanelView = Pick<DebugView, 'registers' | 'flags' | 'code' | 'data' | 'stack'>;

/**
 * Panel de estado. El mismo marcado sirve para los tres diseños; el CSS decide:
 *  - móvil: pestañas, una sección a la vez (según data-active)
 *  - md: franja de dos columnas, todo visible
 *  - lg en adelante: columna flotante sobre la terminal
 */
export function StatePanel({ view }: { view: PanelView }) {
  const [tab, setTab] = useState<Tab>('reg');

  return (
    <aside className="panel" data-active={tab} aria-label="Estado de la máquina">
      <div className="panel__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="panel__tab"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel__col panel__col--a">
        <Registers registers={view.registers} />
        <Flags flags={view.flags} />
        <StackView stack={view.stack} />
      </div>
      <div className="panel__col panel__col--b">
        <MemoryWindow window={view.code} />
        <MemoryWindow window={view.data} />
      </div>
    </aside>
  );
}
