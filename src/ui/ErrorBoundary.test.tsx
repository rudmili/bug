// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { useCommandLog } from './store';

function Broken(): never {
  throw new Error('falla de prueba');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('muestra el error en lugar de una página en blanco y permite borrar lo guardado', async () => {
    // React informa el error por consola aunque lo atrape el boundary
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useCommandLog.getState().append('r');
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('falla de prueba');

    await userEvent.click(screen.getByRole('button', { name: /Borrar los comandos guardados/ }));
    expect(useCommandLog.getState().log).toEqual([]);
  });
});
