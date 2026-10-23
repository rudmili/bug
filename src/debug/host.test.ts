import { describe, expect, it } from 'vitest';
import { createSessionHost } from './host';

describe('host', () => {
  it('start repite las líneas en una sesión nueva', () => {
    const host = createSessionHost();
    host.handle({ id: 0, type: 'submit', line: 'r bx' });
    host.handle({ id: 1, type: 'submit', line: '5' });
    const { id, view } = host.handle({ id: 2, type: 'start', lines: ['r ax', '1234'] });
    expect(id).toBe(2);
    expect(view.registers.find((r) => r.name === 'AX')?.value).toBe('1234');
    expect(view.registers.find((r) => r.name === 'BX')?.value).toBe('0000');
  });

  it('submit sigue la sesión y reset la vuelve al estado inicial', () => {
    const host = createSessionHost();
    host.handle({ id: 0, type: 'start', lines: [] });
    expect(host.handle({ id: 1, type: 'submit', line: 'r' }).view.lines).toHaveLength(4);
    const { id, view } = host.handle({ id: 2, type: 'reset' });
    expect(id).toBe(2);
    expect(view.lines).toEqual([]);
  });
});
