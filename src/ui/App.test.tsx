// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugSession } from '../debug/session';
import { App } from './App';
import { useCommandLog } from './store';

function setup() {
  const user = userEvent.setup();
  const utils = render(<App createSession={createDebugSession} />);
  const input = () => screen.getByLabelText<HTMLInputElement>('Comando de DEBUG');
  const output = () => screen.getByLabelText('Salida de DEBUG');
  /** Escribe cada línea en la terminal y pulsa Enter. */
  const type = async (...lines: string[]) => {
    for (const line of lines) await user.type(input(), `${line}{Enter}`);
  };
  const register = (name: string) => screen.getByText(name, { selector: '.reg__name' }).nextElementSibling?.textContent;
  return { user, input, output, type, register, ...utils };
}

beforeEach(() => {
  useCommandLog.getState().clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('con la terminal vacía muestra la guía de comandos', () => {
    const { output } = setup();
    expect(within(output()).getByText('DEBUG 8086')).toBeTruthy();
  });

  it('ejecuta un comando y muestra la salida', async () => {
    const { output, type } = setup();
    await type('r');
    expect(within(output()).getByText('-r')).toBeTruthy();
    // Sin normalizar: los dos espacios entre registros son parte del formato de DEBUG
    expect(within(output()).getByText(/^AX=0000 {2}BX=0000/, { normalizer: (text) => text })).toBeTruthy();
  });

  it('el modo ensamblado cambia el prompt y una línea vacía sale', async () => {
    const { type } = setup();
    await type('a');
    expect(screen.getByText('073F:0100')).toBeTruthy();
    await type('mov ax,1234', '');
    expect(screen.getByText('-', { selector: 'label' })).toBeTruthy();
  });

  it('las flechas recorren lo escrito sin las líneas vacías', async () => {
    const { user, input, type } = setup();
    await type('a', 'nop', '', 'd 100');
    await user.keyboard('{ArrowUp}');
    expect(input().value).toBe('d 100');
    await user.keyboard('{ArrowUp}');
    expect(input().value).toBe('nop');
    await user.keyboard('{ArrowDown}');
    expect(input().value).toBe('d 100');
    await user.keyboard('{ArrowDown}');
    expect(input().value).toBe('');
  });

  it('al recargar la página vuelve al mismo estado', async () => {
    const first = setup();
    await first.type('r ax', '1234', 'r');
    first.unmount();

    const second = setup();
    expect(second.register('AX')).toBe('1234');
    expect(within(second.output()).getAllByText('-r')).toHaveLength(1);
  });

  it('q olvida lo guardado para reconstruir la máquina pero no el historial', async () => {
    const { user, input, type } = setup();
    await type('r ax', '1234', 'q');
    expect(useCommandLog.getState().log).toEqual([]);
    await user.keyboard('{ArrowUp}');
    expect(input().value).toBe('q');
  });

  it('Reiniciar pide confirmación y deja la máquina como al abrir', async () => {
    const { user, output, type, register } = setup();
    const reset = screen.getByRole('button', { name: /Reiniciar/ });
    expect(reset).toHaveProperty('disabled', true);
    await type('r ax', '1234');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(reset);
    expect(confirm).toHaveBeenCalledOnce();
    expect(register('AX')).toBe('1234');

    confirm.mockReturnValueOnce(true);
    await user.click(reset);
    expect(register('AX')).toBe('0000');
    expect(within(output()).getByText('DEBUG 8086')).toBeTruthy();
    expect(useCommandLog.getState()).toMatchObject({ log: [], history: [] });
  });

  it('las pestañas del panel marcan la sección activa', async () => {
    const { user } = setup();
    const memory = screen.getByRole('button', { name: 'Memoria' });
    await user.click(memory);
    expect(memory.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Estado de la máquina').dataset.active).toBe('mem');
  });
});
