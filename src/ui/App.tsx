import { useState } from 'react';
import './tokens.css';
import './debug-ui.css';
import type { DebugSession } from '../debug/types';
import { Terminal } from './Terminal';
import { StatePanel } from './StatePanel';

/**
 * Composición de la pantalla. Recibe la sesión ya creada:
 *   - con la lógica real:   <App session={createDebugSession()} />
 *   - para ver el diseño:   <App session={createMockSession()} />   (mock.ts)
 */
export function App({ session }: { session: DebugSession }) {
  const [view, setView] = useState(() => session.getView());

  return (
    <div className="app">
      <StatePanel view={view} />
      <Terminal lines={view.lines} prompt={view.prompt} onSubmit={(line) => setView(session.submit(line))} />
    </div>
  );
}
