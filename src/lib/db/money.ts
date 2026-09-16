// Store money as Decimal128 and calculate in integer paise to avoid floating-point drift. Round at
// the calculation boundary; keep values within Number.MAX_SAFE_INTEGER.
import { Decimal128 } from 'mongodb';

export type MoneyInput = Decimal128 | number | string | null | undefined;

// Paise for a stored/typed value. Exact; throws on nonsense rather than NaN.
export function toPaise(value: MoneyInput): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const text = typeof value === 'string' ? value.trim() : value.toString();
  if (text === '') {
    return 0;
  }

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    throw new TypeError(`Not a money value: ${text}`);
  }

  const [, sign, whole = '0', frac = ''] = match;

  // Round to two decimal places using symmetric half-away-from-zero rounding.
  const digits = (frac + '000').slice(0, 3);
  let amount = Number(whole || '0') * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) {
    amount += 1;
  }

  return sign === '-' ? -amount : amount;
}

/** A Decimal128 for storage, from paise. */
export function fromPaise(paise: number): Decimal128 {
  if (!Number.isInteger(paise)) {
    throw new TypeError(`Paise must be a whole number, got ${paise}`);
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return Decimal128.fromString(
    `${negative ? '-' : ''}${rupees}.${String(remainder).padStart(2, '0')}`,
  );
}

/** A Decimal128 for storage, from anything. Use on every write of an amount. */
export function toMoney(value: MoneyInput): Decimal128 {
  return fromPaise(toPaise(value));
}

/**
 * Converts numeric quantities (such as leave day balances or rates) into Decimal128
 * to satisfy schema decimal validation without floating-point representation.
 */
export const toDecimal = toMoney;

/**
 * Formats geographical coordinates (latitude/longitude) as 6-decimal-place Decimal128.
 * Returns null for absent or non-finite values.
 */
export function toCoordinate(value: number | null | undefined): Decimal128 | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Decimal128.fromString(value.toFixed(6));
}

/**
 * A plain number, for DISPLAY and for JSON crossing into a client component.
 *
 * Never feed the result back into a calculation — that is the float64 problem
 * this module exists to avoid. Compute in paise, convert once at the edge.
 */
export function toNumber(value: MoneyInput): number {
  return toPaise(value) / 100;
}

/** Formatted for the UI, e.g. "₹1,23,456.00" in the Indian digit grouping. */
export function formatMoney(value: MoneyInput, withSymbol = true): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: withSymbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
  return formatted;
}

// Arithmetic. All of it in paise, so all of it exact.

export function addPaise(...values: MoneyInput[]): number {
  return values.reduce<number>((sum, v) => sum + toPaise(v), 0);
}

export function subPaise(from: MoneyInput, ...values: MoneyInput[]): number {
  return values.reduce<number>((rest, v) => rest - toPaise(v), toPaise(from));
}

/**
 * Multiplies a monetary amount in paise by a scalar ratio, applying symmetric
 * half-away-from-zero rounding to preserve sign-agnostic symmetry on deductions.
 */
export function scalePaise(value: MoneyInput, ratio: number): number {
  if (!Number.isFinite(ratio)) {
    throw new TypeError(`Ratio must be finite, got ${ratio}`);
  }
  const exact = toPaise(value) * ratio;
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
}

/**
 * Rounds paise to the nearest 100 paise (whole rupee) using half-away-from-zero rounding.
 */
export function roundToRupee(paise: number): number {
  const rupees = paise / 100;
  return (rupees < 0 ? -Math.round(-rupees) : Math.round(rupees)) * 100;
}

/** Split proportionally without losing a paisa — the remainder goes to the first. */
export function dividePaise(total: number, parts: number): number[] {
  if (parts <= 0) {
    return [];
  }
  const base = Math.floor(total / parts);
  const out = new Array<number>(parts).fill(base);
  out[0] += total - base * parts;
  return out;
}
