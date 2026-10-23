import { describe, expect, it } from 'vitest';
import { Output, SERVICE_INT20, SERVICE_INT21, TERMINATED, divideOverflow, runService } from './dos';
import { SERVICE_CRITICAL, SERVICE_CTRL_C, bootMachine, phys, readVector } from './memory';
import { AX, BX, DS, DX, ES } from './state';

describe('dos', () => {
  it('INT 20 termina el programa', () => {
    const out = new Output();
    expect(runService(bootMachine(), SERVICE_INT20, out)).toBe('terminate');
    expect(out.lines).toEqual([TERMINATED]);
  });

  it('INT 21 AH=02 escribe DL', () => {
    const m = bootMachine();
    m.regs[AX] = 0x0200;
    m.regs[DX] = 0x0041;
    const out = new Output();
    expect(runService(m, SERVICE_INT21, out)).toBe('continue');
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
    runService(m, SERVICE_INT21, out);
    runService(m, SERVICE_INT20, out);
    expect(out.lines).toEqual(['hola', 'hola', TERMINATED]);
  });

  it('INT 21 AH=4C y AH=00 terminan; otras funciones se ignoran', () => {
    const m = bootMachine();
    m.regs[AX] = 0x4c00;
    expect(runService(m, SERVICE_INT21, new Output())).toBe('terminate');
    m.regs[AX] = 0x0000;
    expect(runService(m, SERVICE_INT21, new Output())).toBe('terminate');
    m.regs[AX] = 0x3000;
    expect(runService(m, SERVICE_INT21, new Output())).toBe('continue');
  });

  it('INT 21 AH=25 instala un manejador y AH=35 lo devuelve', () => {
    const m = bootMachine();
    m.regs[AX] = 0x2560;
    m.sregs[DS] = 0x1234;
    m.regs[DX] = 0x0100;
    runService(m, SERVICE_INT21, new Output());
    expect(readVector(m, 0x60)).toEqual({ seg: 0x1234, off: 0x0100 });
    expect(m.writes.every((w) => w.kind === 'system')).toBe(true);

    m.regs[AX] = 0x3521;
    runService(m, SERVICE_INT21, new Output());
    expect([m.sregs[ES], m.regs[BX]]).toEqual([0xf000, 0x14a0]);
  });

  it('Ctrl+C corta sin "Program terminated normally" y el error crítico responde Fail', () => {
    const out = new Output();
    expect(runService(bootMachine(), SERVICE_CTRL_C, out)).toBe('terminate');
    expect(out.lines).toEqual(['^C']);
    const m = bootMachine();
    expect(runService(m, SERVICE_CRITICAL, new Output())).toBe('continue');
    expect(m.regs[AX] & 0xff).toBe(3);
  });

  it('un servicio sin implementar no hace nada, como el manejador vacío', () => {
    expect(runService(bootMachine(), 0x03, new Output())).toBe('continue');
  });

  it('la división por cero imprime Divide overflow y termina', () => {
    const out = new Output();
    expect(divideOverflow(out)).toBe('terminate');
    expect(out.lines).toEqual(['Divide overflow', TERMINATED]);
  });
});
