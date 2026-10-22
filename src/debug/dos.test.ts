import { describe, expect, it } from 'vitest';
import { Output, TERMINATED, handleInterrupt } from './dos';
import { bootMachine, phys } from './memory';
import { AX, DX } from './state';

describe('dos', () => {
  it('INT 20 termina el programa', () => {
    const out = new Output();
    expect(handleInterrupt(bootMachine(), 0x20, out)).toBe('terminate');
    expect(out.lines).toEqual([TERMINATED]);
  });

  it('INT 21 AH=02 escribe DL', () => {
    const m = bootMachine();
    m.regs[AX] = 0x0200;
    m.regs[DX] = 0x0041;
    const out = new Output();
    expect(handleInterrupt(m, 0x21, out)).toBe('continue');
    out.flush();
    expect(out.lines).toEqual(['A']);
  });

  it('INT 21 AH=09 escribe hasta $; 0D se descarta y 0A corta la línea', () => {
    const m = bootMachine();
    const text = [...'hola'].map((c) => c.charCodeAt(0));
    m.mem.set([...text, 0x0d, 0x0a, ...text, 0x24, 0x41], phys(0x073f, 0x102));
    m.regs[AX] = 0x0900;
    m.regs[DX] = 0x0102;
    const out = new Output();
    handleInterrupt(m, 0x21, out);
    handleInterrupt(m, 0x20, out);
    expect(out.lines).toEqual(['hola', 'hola', TERMINATED]);
  });

  it('INT 21 AH=4C termina y otras funciones se ignoran', () => {
    const m = bootMachine();
    m.regs[AX] = 0x4c00;
    expect(handleInterrupt(m, 0x21, new Output())).toBe('terminate');
    m.regs[AX] = 0x3000;
    expect(handleInterrupt(m, 0x21, new Output())).toBe('continue');
  });

  it('INT 0 imprime Divide overflow y termina', () => {
    const out = new Output();
    expect(handleInterrupt(bootMachine(), 0, out)).toBe('terminate');
    expect(out.lines).toEqual(['Divide overflow', TERMINATED]);
  });

  it('INT 3 detiene g y las demás se ignoran', () => {
    expect(handleInterrupt(bootMachine(), 3, new Output())).toBe('break');
    expect(handleInterrupt(bootMachine(), 0x10, new Output())).toBe('continue');
  });
});
