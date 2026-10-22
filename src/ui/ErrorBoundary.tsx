import { Component } from 'react';
import type { ReactNode } from 'react';
import { useCommandLog } from './store';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Último recurso si la interfaz falla al dibujarse: en lugar de una página en blanco, explica qué pasó
 * y permite empezar de cero. Los comandos guardados se vuelven a ejecutar en cada carga, así que si
 * son la causa, sin borrarlos el fallo se repetiría siempre.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <p className="crash__title">^ Error interno del simulador</p>
        <p className="crash__detail">{error.message}</p>
        <button
          type="button"
          className="crash__button"
          onClick={() => {
            useCommandLog.getState().clear();
            window.location.reload();
          }}
        >
          Borrar los comandos guardados y recargar
        </button>
      </main>
    );
  }
}
