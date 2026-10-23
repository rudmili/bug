// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugSession } from '../debug/session';
import type { DebugView } from '../debug/types';
import { App } from './App';
import { createLocalClient } from './client';
import type { SessionClient } from './client';
import { sharedLines } from './share';
import { useCommandLog } from './store';

// jsdom no implementa los diálogos modales: lo justo para <dialog> con <form method="dialog"> y Escape
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, value?: string) {
    if (value !== undefined) this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (form.getAttribute('method') !== 'dialog') return;
    event.preventDefault();
    form.closest('dialog')?.close((event.submitter as HTMLButtonElement | null)?.value ?? '');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelector<HTMLDialogElement>('dialog[open]')?.close();
  });
});

/** Monta la aplicación y espera a que la sesión arranque (vuelve a ejecutar lo guardado). */
async function setup(client: SessionClient = createLocalClient(createDebugSession), shared: string[] | null = null) {
  const user = userEvent.setup();
  const utils = render(<App client={client} shared={shared} />);
  await screen.findByLabelText('Comando de DEBUG');
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
  it('con la terminal vacía muestra la guía de comandos', async () => {
    const { output } = await setup();
    expect(within(output()).getByText('DEBUG 8086')).toBeTruthy();
  });

  it('ejecuta un comando y muestra la salida', async () => {
    const { output, type } = await setup();
    await type('r');
    expect(within(output()).getByText('-r')).toBeTruthy();
    // Sin normalizar: los dos espacios entre registros son parte del formato de DEBUG
    expect(within(output()).getByText(/^AX=0000 {2}BX=0000/, { normalizer: (text) => text })).toBeTruthy();
  });

  it('el modo ensamblado cambia el prompt y una línea vacía sale', async () => {
    const { type } = await setup();
    await type('a');
    expect(screen.getByText('073F:0100')).toBeTruthy();
    await type('mov ax,1234', '');
    expect(screen.getByText('-', { selector: 'label' })).toBeTruthy();
  });

  it('las flechas recorren lo escrito sin las líneas vacías', async () => {
    const { user, input, type } = await setup();
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
    const first = await setup();
    await first.type('r ax', '1234', 'r');
    first.unmount();

    const second = await setup();
    expect(second.register('AX')).toBe('1234');
    expect(within(second.output()).getAllByText('-r')).toHaveLength(1);
  });

  it('q olvida lo guardado para reconstruir la máquina pero no el historial', async () => {
    const { user, input, type } = await setup();
    await type('r ax', '1234', 'q');
    expect(useCommandLog.getState().log).toEqual([]);
    await user.keyboard('{ArrowUp}');
    expect(input().value).toBe('q');
  });

  it('Reiniciar pide confirmación en un diálogo y deja la máquina como al abrir', async () => {
    const { user, output, type, register } = await setup();
    const reset = screen.getByRole('button', { name: /Reiniciar/ });
    expect(reset).toHaveProperty('disabled', true);
    await type('r ax', '1234');

    await user.click(reset);
    const dialog = screen.getByRole('dialog', { name: '¿Reiniciar la máquina?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(register('AX')).toBe('1234');

    await user.click(reset);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reiniciar' }));
    expect(register('AX')).toBe('0000');
    expect(within(output()).getByText('DEBUG 8086')).toBeTruthy();
    expect(useCommandLog.getState()).toMatchObject({ log: [], history: [] });
  });

  it('Escape cierra el diálogo sin reiniciar', async () => {
    const { user, type, register } = await setup();
    await type('r ax', '1234');
    await user.click(screen.getByRole('button', { name: /Reiniciar/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(register('AX')).toBe('1234');
  });

  it('las pestañas siguen el patrón de WAI-ARIA', async () => {
    const { user } = await setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Registros', 'Memoria', 'Pila']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[1].getAttribute('aria-controls')).toBe('sec-code sec-data');

    await user.click(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Estado de la máquina').dataset.active).toBe('mem');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(tabs[2]);
    await user.keyboard('{Home}{ArrowLeft}');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  });

  it('Escape oculta el popup del registro con foco hasta que el foco se va', async () => {
    const { user } = await setup();
    const ax = screen.getByText('AX', { selector: '.reg__name' }).parentElement!;
    ax.focus();
    await user.keyboard('{Escape}');
    expect(ax.dataset.tipHidden).toBe('');
    await user.tab();
    expect(ax.dataset.tipHidden).toBeUndefined();
  });

  it('mientras un comando corre, la línea queda en solo lectura y conserva el foco', async () => {
    const local = createLocalClient(createDebugSession);
    let finish: (() => void) | undefined;
    const slow: SessionClient = {
      ...local,
      submit: (line) =>
        new Promise<DebugView>((resolve) => {
          finish = () => void local.submit(line).then(resolve);
        }),
    };
    const { user, input, output } = await setup(slow);
    await user.type(input(), 'r{Enter}');
    expect(input().readOnly).toBe(true);
    expect(document.activeElement).toBe(input());
    // Como en DEBUG durante un `g`: no se escribe ni se envía nada hasta que termina
    await user.type(input(), 'u{Enter}');
    expect(input().value).toBe('');
    expect(useCommandLog.getState().log).toEqual(['r']);

    finish!();
    await within(output()).findByText('-r');
    expect(input().readOnly).toBe(false);
  });

  it('el lector de pantalla oye la respuesta del último comando', async () => {
    const { type } = await setup();
    await type('r ax');
    expect(document.querySelector('[aria-live]')?.textContent).toBe('AX 0000');
  });
});

describe('App: compartir, guardar y abrir', () => {
  it('Compartir copia un enlace con las líneas desde el último q', async () => {
    // userEvent.setup() reemplaza navigator.clipboard por un portapapeles de prueba
    const { user, type } = await setup();
    const share = screen.getByRole('button', { name: 'Compartir' });
    expect(share).toHaveProperty('disabled', true);

    await type('r ax', '1234', 'q', 'r bx', '5');
    await user.click(share);
    const url = new URL(await navigator.clipboard.readText());
    expect(sharedLines(url.hash)).toEqual(['r bx', '5']);
    expect(screen.getByText('Enlace copiado').getAttribute('role')).toBe('status');
  });

  it('Guardar descarga las líneas como texto', async () => {
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return 'blob:sesion';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, type } = await setup();
    await type('a', 'nop', '');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(click).toHaveBeenCalledOnce();
    expect(await saved!.text()).toBe('a\nnop\n\n');
  });

  it('Abrir carga un archivo directamente si no hay sesión', async () => {
    const { user, register } = await setup();
    // Con saltos de Windows, como lo guardaría el Bloc de notas
    const file = new File(['r ax\r\n1234\r\n'], 'programa.txt', { type: 'text/plain' });
    await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, file);
    await screen.findByText('-r ax');
    expect(register('AX')).toBe('1234');
    expect(useCommandLog.getState().log).toEqual(['r ax', '1234']);
  });

  it('Abrir pregunta antes de reemplazar una sesión', async () => {
    const { user, type, register } = await setup();
    await type('r bx', '5');
    const file = new File(['r ax\n1234\n'], 'programa.txt');
    await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, file);
    const dialog = await screen.findByRole('dialog', { name: '¿Abrir el archivo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Abrir' }));
    await screen.findByText('-r ax');
    expect([register('AX'), register('BX')]).toEqual(['1234', '0000']);
  });

  it('un programa compartido con una sesión guardada espera confirmación', async () => {
    useCommandLog.getState().load(['r bx', '5']);
    const { user, register } = await setup(undefined, ['r ax', '1234']);
    expect(register('BX')).toBe('0005');
    const dialog = await screen.findByRole('dialog', { name: '¿Abrir el programa compartido?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(register('BX')).toBe('0005');
    expect(useCommandLog.getState().log).toEqual(['r bx', '5']);
  });
});

describe('App: comandos rápidos', () => {
  it('t, p, g y r se envían con un toque, solo en el modo comando', async () => {
    const { user, output, type } = await setup();
    const quick = within(screen.getByRole('group', { name: 'Comandos rápidos' }));
    expect(quick.getAllByRole('button').map((b) => b.textContent)).toEqual(['t', 'p', 'g', 'r']);
    await user.click(quick.getByRole('button', { name: 'r' }));
    expect(within(output()).getByText('-r')).toBeTruthy();

    await type('a');
    expect(quick.getByRole('button', { name: 't' })).toHaveProperty('disabled', true);
  });
});

describe('App: navegar la memoria', () => {
  const memoryWindow = (name: string) => within(screen.getByRole('region', { name }));
  const firstRow = (name: string) =>
    screen.getByRole('region', { name }).querySelector('.mem__addr')?.textContent;

  it('las flechas cambian de página y Seguir vuelve a CS:IP', async () => {
    const { user } = await setup();
    const code = memoryWindow('Memoria · código');
    expect(code.queryByRole('button', { name: 'Seguir' })).toBeNull();

    await user.click(code.getByRole('button', { name: /Página siguiente/ }));
    await waitFor(() => expect(firstRow('Memoria · código')).toBe('0180'));
    await user.click(code.getByRole('button', { name: /Página anterior/ }));
    await user.click(code.getByRole('button', { name: /Página anterior/ }));
    await waitFor(() => expect(firstRow('Memoria · código')).toBe('0080'));

    await user.click(code.getByRole('button', { name: 'Seguir' }));
    await waitFor(() => expect(firstRow('Memoria · código')).toBe('0100'));
    expect(code.queryByRole('button', { name: 'Seguir' })).toBeNull();
  });

  it('RePág y AvPág cambian de página con el foco en la ventana', async () => {
    const { user } = await setup();
    memoryWindow('Memoria · datos').getByRole('button', { name: /Página siguiente/ }).focus();
    await user.keyboard('{PageDown}');
    await waitFor(() => expect(firstRow('Memoria · datos')).toBe('0280'));
    await user.keyboard('{PageUp}{PageUp}');
    await waitFor(() => expect(firstRow('Memoria · datos')).toBe('0180'));
  });

  it('ir a una dirección; una inválida se marca y no mueve la ventana', async () => {
    const { user } = await setup();
    const input = memoryWindow('Memoria · datos').getByRole('textbox', { name: /Ir a una dirección/ });
    await user.type(input, 'zz{Enter}');
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(firstRow('Memoria · datos')).toBe('0200');

    await user.clear(input);
    await user.type(input, 'ds:1234{Enter}');
    await waitFor(() => expect(firstRow('Memoria · datos')).toBe('1230'));
    expect(input).toHaveProperty('value', '');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
});

describe('App: un programa que lee el teclado', () => {
  it('cada tecla llega al programa sin Enter, se ve su eco y no va a las flechas', async () => {
    const { user, input, output, type } = await setup();
    await type('a', 'mov ah,1', 'int 21', 'mov ah,1', 'int 21', 'int 20', '', 'g');
    await waitFor(() => expect(input().placeholder).toMatch(/espera una tecla/));
    expect(screen.getByText('', { selector: 'label' })).toBeTruthy();

    await user.keyboard('o');
    await waitFor(() => expect(within(output()).getByText('o')).toBeTruthy());
    expect(input().value).toBe('');
    await user.keyboard('k');
    await within(output()).findByText('Program terminated normally');
    expect(within(output()).getByText('ok')).toBeTruthy();

    expect(useCommandLog.getState().log.slice(-3)).toEqual(['g', 'o', 'k']);
    expect(useCommandLog.getState().history.at(-1)).toBe('g');
  });

  it('Enter, las flechas y Ctrl+C se mandan como teclas', async () => {
    const { user, input, output, type } = await setup();
    await type('a', 'mov ah,8', 'int 21', 'mov ah,8', 'int 21', 'mov ah,8', 'int 21', 'int 20', '', 'g');
    await waitFor(() => expect(input().placeholder).toMatch(/espera una tecla/));
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Control>}c{/Control}');
    await within(output()).findByText('^C');
    expect(useCommandLog.getState().log.slice(-2)).toEqual(['{Up}', '\x03']);
    expect(input().placeholder).not.toMatch(/espera una tecla/);
  });
});
