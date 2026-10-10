import type { Flags } from './state';

/** Cálculo de banderas. Funciones puras: reciben operandos, resultado y tamaño, devuelven las banderas que cambian. */

export type Size = 8 | 16;

export function mask(size: Size): number {
  return size === 8 ? 0xff : 0xffff;
}

export function signBit(size: Size): number {
  return size === 8 ? 0x80 : 0x8000;
}

/** 1 si el byte bajo tiene cantidad par de bits en 1. */
export function parity(value: number): boolean {
  let v = value & 0xff;
  v ^= v >> 4;
  v ^= v >> 2;
  v ^= v >> 1;
  return (v & 1) === 0;
}

/** PF, ZF y SF a partir del resultado. */
export function resultFlags(result: number, size: Size): Pick<Flags, 'PF' | 'ZF' | 'SF'> {
  const r = result & mask(size);
  return { PF: parity(r), ZF: r === 0, SF: (r & signBit(size)) !== 0 };
}

/** ADD y ADC. `raw` es la suma sin recortar (a + b + acarreo). */
export function addFlags(a: number, b: number, raw: number, size: Size): Partial<Flags> {
  const r = raw & mask(size);
  return {
    CF: raw > mask(size),
    AF: ((a ^ b ^ r) & 0x10) !== 0,
    OF: ((a ^ r) & (b ^ r) & signBit(size)) !== 0,
    ...resultFlags(r, size),
  };
}

/** SUB, SBB, CMP y NEG (como 0 − b). `raw` es la resta sin recortar (a − b − préstamo). */
export function subFlags(a: number, b: number, raw: number, size: Size): Partial<Flags> {
  const r = raw & mask(size);
  return {
    CF: raw < 0,
    AF: ((a ^ b ^ r) & 0x10) !== 0,
    OF: ((a ^ b) & (a ^ r) & signBit(size)) !== 0,
    ...resultFlags(r, size),
  };
}

/** INC: como ADD con 1, sin tocar CF. */
export function incFlags(a: number, size: Size): Partial<Flags> {
  const flags = addFlags(a, 1, a + 1, size);
  delete flags.CF;
  return flags;
}

/** DEC: como SUB con 1, sin tocar CF. */
export function decFlags(a: number, size: Size): Partial<Flags> {
  const flags = subFlags(a, 1, a - 1, size);
  delete flags.CF;
  return flags;
}

/** AND, OR, XOR, TEST. */
export function logicFlags(result: number, size: Size): Partial<Flags> {
  return { CF: false, OF: false, AF: false, ...resultFlags(result, size) };
}

export type ShiftKind = 'SHL' | 'SHR' | 'SAR';

/**
 * SHL, SHR y SAR. `cf` es el último bit que salió.
 * OF: SHL → bit alto del resultado XOR CF; SHR → bit alto del valor original; SAR → 0.
 */
export function shiftFlags(kind: ShiftKind, original: number, result: number, cf: boolean, size: Size): Partial<Flags> {
  const sign = signBit(size);
  let of: boolean;
  if (kind === 'SHL') of = ((result & sign) !== 0) !== cf;
  else if (kind === 'SHR') of = (original & sign) !== 0;
  else of = false;
  return { CF: cf, OF: of, AF: false, ...resultFlags(result, size) };
}

export type RotateKind = 'ROL' | 'ROR' | 'RCL' | 'RCR';

/**
 * Rotaciones: solo CF y OF.
 * OF a la izquierda: bit alto del resultado XOR CF. A la derecha: XOR de los dos bits más altos del resultado.
 */
export function rotateFlags(kind: RotateKind, result: number, cf: boolean, size: Size): Partial<Flags> {
  const sign = signBit(size);
  const top = (result & sign) !== 0;
  const next = (result & (sign >> 1)) !== 0;
  const of = kind === 'ROL' || kind === 'RCL' ? top !== cf : top !== next;
  return { CF: cf, OF: of };
}

/**
 * MUL e IMUL. `high` y `low` son las mitades del resultado (AH:AL o DX:AX).
 * CF=OF=1 si la mitad alta es significativa. SF y PF de la mitad baja. ZF y AF no cambian.
 */
export function mulFlags(signed: boolean, high: number, low: number, size: Size): Partial<Flags> {
  const m = mask(size);
  const significant = signed
    ? high !== ((low & signBit(size)) !== 0 ? m : 0)
    : high !== 0;
  return {
    CF: significant,
    OF: significant,
    SF: (low & signBit(size)) !== 0,
    PF: parity(low),
  };
}

/** Texto de DEBUG, en orden OF DF IF SF ZF AF PF CF. */
export function flagsText(f: Flags): string {
  return [
    f.OF ? 'OV' : 'NV',
    f.DF ? 'DN' : 'UP',
    f.IF ? 'EI' : 'DI',
    f.SF ? 'NG' : 'PL',
    f.ZF ? 'ZR' : 'NZ',
    f.AF ? 'AC' : 'NA',
    f.PF ? 'PE' : 'PO',
    f.CF ? 'CY' : 'NC',
  ].join(' ');
}

/** Las dos letras de una sola bandera, para la interfaz. */
export const FLAG_CODES: Record<'OF' | 'DF' | 'IF' | 'SF' | 'ZF' | 'AF' | 'PF' | 'CF', [string, string]> = {
  OF: ['NV', 'OV'],
  DF: ['UP', 'DN'],
  IF: ['DI', 'EI'],
  SF: ['PL', 'NG'],
  ZF: ['NZ', 'ZR'],
  AF: ['NA', 'AC'],
  PF: ['PO', 'PE'],
  CF: ['NC', 'CY'],
};
