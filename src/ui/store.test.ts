import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_HISTORY, useCommandLog } from './store';

describe('registro de comandos', () => {
  beforeEach(() => useCommandLog.getState().clear());

  it('guarda todas las líneas y deja fuera del historial las vacías', () => {
    const { append } = useCommandLog.getState();
    for (const line of ['a', 'mov ax,1', '', 'r']) append(line);
    expect(useCommandLog.getState().log).toEqual(['a', 'mov ax,1', '', 'r']);
    expect(useCommandLog.getState().history).toEqual(['a', 'mov ax,1', 'r']);
  });

  it('restart olvida lo que se vuelve a ejecutar pero conserva las flechas', () => {
    const { append, restart } = useCommandLog.getState();
    append('r ax');
    append('1234');
    append('q');
    restart();
    append('r');
    expect(useCommandLog.getState().log).toEqual(['r']);
    expect(useCommandLog.getState().history).toEqual(['r ax', '1234', 'q', 'r']);
  });

  it('el historial conserva solo las últimas MAX_HISTORY entradas', () => {
    const { append } = useCommandLog.getState();
    for (let i = 0; i <= MAX_HISTORY; i++) append(`r ${i}`);
    const { history } = useCommandLog.getState();
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]).toBe('r 1');
  });

  it('clear borra todo', () => {
    useCommandLog.getState().append('r');
    useCommandLog.getState().clear();
    expect(useCommandLog.getState()).toMatchObject({ log: [], history: [] });
  });
});
