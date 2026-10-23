import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_PER_SECOND, TICKS_PER_DAY, advanceClock, formatClock, parseClock, readTicks, weekday, writeTicks } from './clock';
import { Output, SERVICE_INT1A, SERVICE_INT21, runService } from './dos';
import { bootMachine } from './memory';
import { createDebugSession } from './session';
import { AX, CX, DX } from './state';
import type { Machine } from './state';
import type { DebugView } from './types';

const BOOT = '2026-10-22T23:18:45.32';
const boot = (text = BOOT) => bootMachine(parseClock(text)!);

/** Pide un servicio con AX, CX y DX dados; devuelve los registros después. */
function call(m: Machine, service: number, ax: number, cx = 0, dx = 0) {
  m.regs[AX] = ax;
  m.regs[CX] = cx;
  m.regs[DX] = dx;
  runService(m, service, new Output());
  return { ax: m.regs[AX], cx: m.regs[CX], dx: m.regs[DX] };
}

/** Las instrucciones que hacen falta para un tick, redondeado hacia arriba. */
const TICK = Math.ceil((65536 * INSTRUCTIONS_PER_SECOND) / 1193182);

/** Unas 260.000 instrucciones (4 veces 65536 vueltas de LOOP): un poco más de un tick. */
const WAIT = ['a', 'mov cx,0', 'mov dx,4', 'loop 106', 'dec dx', 'jnz 106'];

/** 31/12/2026 en el último tick del día. */
function lastTick(): Machine {
  const m = boot('2026-12-31T23:59:59.00');
  writeTicks(m, TICKS_PER_DAY - 1);
  return m;
}

const reg = (v: DebugView, name: string) => v.registers.find((r) => r.name === name)?.value;

describe('clock: hora de arranque', () => {
  it('se guarda y se vuelve a leer igual; lo que no es una hora válida no se acepta', () => {
    expect(formatClock(parseClock(BOOT)!)).toBe(BOOT);
    expect(parseClock('2026-02-30T10:00:00.00')).toBeNull();
    expect(parseClock('1979-12-31T10:00:00.00')).toBeNull();
    expect(parseClock('2026-10-22 23:18:45')).toBeNull();
  });

  it('los ticks del BIOS en 0040:006C salen de la hora, como en DOSBox', () => {
    expect(readTicks(boot())).toBe(1527987);
    expect(readTicks(boot('2026-10-22T00:00:00.00'))).toBe(0);
  });

  it('el día de la semana sale con la fórmula de DOSBox (0 = domingo)', () => {
    expect(weekday(2026, 10, 22)).toBe(4);
    expect(weekday(1980, 1, 1)).toBe(2);
    expect(weekday(2000, 2, 29)).toBe(2);
  });
});

describe('clock: INT 21', () => {
  it('AH=2A devuelve la fecha y el día de la semana', () => {
    expect(call(boot(), SERVICE_INT21, 0x2a00)).toEqual({ ax: 0x2a04, cx: 2026, dx: 0x0a16 });
  });

  it('AH=2C devuelve la hora; las centésimas salen de los ticks, de a ~5,5', () => {
    expect(call(boot(), SERVICE_INT21, 0x2c00)).toEqual({ ax: 0x2c00, cx: 0x1712, dx: 0x2d1d });
  });

  it('AH=2B cambia la fecha si es válida (AL=00); si no, AL=FF', () => {
    const m = boot();
    expect(call(m, SERVICE_INT21, 0x2b00, 2000, 0x021d).ax & 0xff).toBe(0x00);
    expect(call(m, SERVICE_INT21, 0x2a00)).toEqual({ ax: 0x2a02, cx: 2000, dx: 0x021d });
    expect(call(m, SERVICE_INT21, 0x2b00, 2001, 0x021d).ax & 0xff).toBe(0xff);
    expect(call(m, SERVICE_INT21, 0x2b00, 1979, 0x0101).ax & 0xff).toBe(0xff);
    expect(call(m, SERVICE_INT21, 0x2a00).cx).toBe(2000);
  });

  it('AH=2D cambia la hora si es válida (AL=00); si no, AL=FF', () => {
    const m = boot();
    expect(call(m, SERVICE_INT21, 0x2d00, 0x0102, 0x0300).ax & 0xff).toBe(0x00);
    // Pasar a ticks y volver pierde unas centésimas, como en DOSBox: 01:02:02.95
    expect(call(m, SERVICE_INT21, 0x2c00)).toMatchObject({ cx: 0x0102, dx: 0x025f });
    expect(call(m, SERVICE_INT21, 0x2d00, 0x1800, 0x0000).ax & 0xff).toBe(0xff);
    expect(call(m, SERVICE_INT21, 0x2d00, 0x0000, 0x0064).ax & 0xff).toBe(0xff);
  });
});

describe('clock: el tiempo avanza con las instrucciones', () => {
  it('un tick cada ~164.777 instrucciones (cycles=3000 de DOSBox)', () => {
    const m = boot('2026-10-22T00:00:00.00');
    for (let i = 0; i < TICK - 1; i++) advanceClock(m);
    expect(readTicks(m)).toBe(0);
    advanceClock(m);
    expect(readTicks(m)).toBe(1);
  });

  it('con IF=0 el tick espera a que IF vuelva a 1, y no se acumulan', () => {
    const m = boot('2026-10-22T00:00:00.00');
    m.flags.IF = false;
    for (let i = 0; i < TICK * 3; i++) advanceClock(m);
    expect(readTicks(m)).toBe(0);
    m.flags.IF = true;
    advanceClock(m);
    expect(readTicks(m)).toBe(1);
  });

  it('a medianoche el contador vuelve a 0 y DOS avanza la fecha al leerla', () => {
    const m = lastTick();
    for (let i = 0; i < TICK; i++) advanceClock(m);
    expect(readTicks(m)).toBe(0);
    expect(call(m, SERVICE_INT21, 0x2a00)).toEqual({ ax: 0x2a05, cx: 2027, dx: 0x0101 });
  });

  it('un g largo hace correr el reloj', () => {
    const s = createDebugSession('2026-10-22T10:00:00.00');
    for (const line of [...WAIT, 'mov ah,2c', 'int 21', 'int 3', '', 'g']) s.submit(line);
    const time = s.getView();
    expect(reg(time, 'CX')).toBe('0A00');
    expect(reg(time, 'DX')).not.toBe('0000');
  });
});

describe('clock: INT 1A', () => {
  it('AH=00 da los ticks y la marca de medianoche, que se borra al leerla', () => {
    const m = lastTick();
    for (let i = 0; i < TICK; i++) advanceClock(m);
    expect(call(m, SERVICE_INT1A, 0x0000)).toEqual({ ax: 0x0001, cx: 0, dx: 0 });
    expect(call(m, SERVICE_INT1A, 0x0000).ax).toBe(0x0000);
    // DOS ya no ve la medianoche: la fecha queda como estaba, igual que en DOS
    expect(call(m, SERVICE_INT21, 0x2a00).cx).toBe(2026);
  });

  it('AH=01 pone los ticks', () => {
    const m = boot();
    call(m, SERVICE_INT1A, 0x0100, 0x0012, 0x3456);
    expect(readTicks(m)).toBe(0x123456);
  });

  it('AH=02 y AH=04 leen el reloj de tiempo real en BCD', () => {
    const m = boot();
    expect(call(m, SERVICE_INT1A, 0x0200)).toMatchObject({ cx: 0x2318, dx: 0x4500 });
    expect(call(m, SERVICE_INT1A, 0x0400)).toMatchObject({ cx: 0x2026, dx: 0x1022 });
  });
});

describe('clock: sesión', () => {
  it('la vista informa la hora de arranque; la misma hora repite la misma ejecución', () => {
    const log = ['a', 'mov ah,2c', 'int 21', 'int 3', '', 'g'];
    const a = createDebugSession(BOOT);
    const b = createDebugSession(BOOT);
    for (const line of log) a.submit(line);
    for (const line of log) b.submit(line);
    expect(a.getView().clock).toBe(BOOT);
    expect(b.getView()).toEqual(a.getView());
  });

  it('sin hora válida arranca con la hora de la PC', () => {
    expect(parseClock(createDebugSession('basura').getView().clock)).not.toBeNull();
  });

  it('q arranca otra máquina a la hora que marcaba el reloj', () => {
    const s = createDebugSession('2026-10-22T10:00:00.00');
    for (const line of [...WAIT, 'int 3', '', 'g']) s.submit(line);
    const view = s.submit('q');
    expect(view.restarted).toBe(true);
    expect(view.clock).toMatch(/^2026-10-22T10:00:00\.\d\d$/);
    expect(view.clock).not.toBe('2026-10-22T10:00:00.00');
  });
});
