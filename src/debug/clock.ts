import type { Machine } from './state';

/**
 * El reloj, como en DOSBox: al arrancar toma la fecha y la hora de la PC, y desde ahí el temporizador
 * suma un tick (18,2 por segundo) en 0040:006C. Acá el tiempo no corre solo: avanza con las
 * instrucciones ejecutadas, a la velocidad por defecto de DOSBox (cycles=3000, 3000 instrucciones por
 * milisegundo). Así, repetir los mismos comandos con la misma hora de arranque da siempre lo mismo.
 */

/** Fecha y hora local, como las da DOS. */
export interface DateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hundredths: number;
}

/** Frecuencia del PIT: el temporizador hace un tick cada 65536 de sus pulsos. */
const PIT_TICK_RATE = 1193182;
/** Ticks en un día: el contador vuelve a 0 a medianoche. */
export const TICKS_PER_DAY = 0x1800b0;
/** Instrucciones por segundo: cycles=3000 de DOSBox. */
export const INSTRUCTIONS_PER_SECOND = 3_000_000;
/** Cada instrucción suma PIT_TICK_RATE; un tick son TICK_PERIOD (sin redondeos: 1 tick ≈ 164.777 instrucciones). */
const TICK_PERIOD = 65536 * INSTRUCTIONS_PER_SECOND;

/** Contador de ticks desde medianoche (4 bytes) y marca de medianoche del BIOS. */
const TIMER = 0x0040 * 16 + 0x006c;
const MIDNIGHT = 0x0040 * 16 + 0x0070;

const MONTH_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  return month === 2 && year % 4 === 0 ? 29 : MONTH_DAYS[month];
}

/** Fechas que acepta DOS: de 1980 a 2099. */
export function isDateValid(year: number, month: number, day: number): boolean {
  return year >= 1980 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Día de la semana (0 = domingo), con la fórmula de DOSBox. */
export function weekday(year: number, month: number, day: number): number {
  const a = Math.trunc((14 - month) / 12);
  const y = year - a;
  const m = month + 12 * a - 2;
  return (day + y + Math.trunc(y / 4) - Math.trunc(y / 100) + Math.trunc(y / 400) + Math.trunc((31 * m) / 12)) % 7;
}

// ---------------------------------------------------------------- Texto

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** La hora de arranque como se guarda con los comandos: 2026-10-22T23:18:45.32 (hora local). */
export function formatClock(t: DateTime): string {
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}.${pad(t.hundredths)}`;
}

/** Lee una hora guardada con formatClock; null si no es válida. */
export function parseClock(text: string): DateTime | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d\d)$/.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second, hundredths] = match.slice(1).map(Number);
  if (!isDateValid(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second, hundredths };
}

/** La fecha y la hora de la PC, como las toma DOSBox al arrancar. */
export function hostClock(now = new Date()): DateTime {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    hundredths: Math.floor(now.getMilliseconds() / 10),
  };
}

// ---------------------------------------------------------------- Ticks

export function readTicks(m: Machine): number {
  return (m.mem[TIMER] | (m.mem[TIMER + 1] << 8) | (m.mem[TIMER + 2] << 16) | (m.mem[TIMER + 3] << 24)) >>> 0;
}

export function writeTicks(m: Machine, ticks: number): void {
  for (let i = 0; i < 4; i++) m.mem[TIMER + i] = (ticks >>> (8 * i)) & 0xff;
}

/** La hora de un contador de ticks, como la calcula DOSBox en INT 21 AH=2C (las centésimas van de a ~5,5). */
export function ticksToTime(ticks: number): Pick<DateTime, 'hour' | 'minute' | 'second' | 'hundredths'> {
  let time = Math.floor((100 / (PIT_TICK_RATE / 65536)) * ticks);
  const hundredths = time % 100;
  time = Math.floor(time / 100);
  const second = time % 60;
  time = Math.floor(time / 60);
  return { hour: Math.floor(time / 60) % 24, minute: time % 60, second, hundredths };
}

/** Los ticks de una hora, como DOSBox al arrancar (y en INT 21 AH=2D). */
export function timeToTicks(hour: number, minute: number, second: number, hundredths: number): number {
  const ms = ((hour * 60 + minute) * 60 + second) * 1000 + hundredths * 10;
  return Math.floor(ms * (PIT_TICK_RATE / 65536 / 1000));
}

/** Lee y borra la marca de medianoche, como INT 1A AH=00. */
export function takeMidnight(m: Machine): number {
  const passed = m.mem[MIDNIGHT];
  m.mem[MIDNIGHT] = 0;
  return passed;
}

/** Suma días a una fecha: DOS lo hace con la suya al ver la marca de medianoche. */
export function addDays(date: Pick<DateTime, 'year' | 'month' | 'day'>, days: number): void {
  date.day += days;
  while (date.day > daysInMonth(date.year, date.month)) {
    date.day -= daysInMonth(date.year, date.month);
    if (++date.month > 12) {
      date.month = 1;
      date.year++;
    }
  }
}

// ---------------------------------------------------------------- Máquina

/** Pone el reloj en una fecha y hora: la fecha de DOS y los ticks del BIOS. */
export function startClock(m: Machine, t: DateTime): void {
  m.clock = { year: t.year, month: t.month, day: t.day, pulses: 0, pending: false };
  writeTicks(m, timeToTicks(t.hour, t.minute, t.second, t.hundredths));
  m.mem[MIDNIGHT] = 0;
}

/**
 * Una instrucción más. Cuando se completa un tick, el temporizador lo suma en 0040:006C, salvo con IF=0:
 * como la interrupción del temporizador, queda pendiente hasta que IF vuelva a 1 (y no se acumulan).
 */
export function advanceClock(m: Machine): void {
  const clock = m.clock;
  clock.pulses += PIT_TICK_RATE;
  if (clock.pulses >= TICK_PERIOD) {
    clock.pulses -= TICK_PERIOD;
    clock.pending = true;
  }
  if (!clock.pending || !m.flags.IF) return;
  clock.pending = false;
  let ticks = readTicks(m) + 1;
  if (ticks >= TICKS_PER_DAY) {
    m.mem[MIDNIGHT] = (m.mem[MIDNIGHT] + 1) & 0xff;
    ticks = 0;
  }
  writeTicks(m, ticks);
}

/** La fecha y la hora que marca el reloj ahora, sin consumir la marca de medianoche. */
export function clockNow(m: Machine): DateTime {
  const date = { year: m.clock.year, month: m.clock.month, day: m.clock.day };
  addDays(date, m.mem[MIDNIGHT]);
  return { ...date, ...ticksToTime(readTicks(m)) };
}
