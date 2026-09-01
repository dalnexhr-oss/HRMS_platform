// ============================================================================
// Money. The replacement for 48 `numeric(12,2)` columns.
//
// THE RULE: money is never a JavaScript number in transit or at rest.
//
// Postgres numeric is exact. A JS number is a float64, where 0.1 + 0.2 is
// 0.30000000000000004 — and a payroll run is thousands of additions, so the
// error compounds into rupees that show up on a payslip and in a bank transfer.
// Stored values are BSON Decimal128; arithmetic happens in integer PAISE.
//
// Why paise rather than a decimal library: the driver's Decimal128 has no
// arithmetic API, so any calculation means converting anyway. INR amounts here
// top out around ₹10^10, which is 10^12 paise — comfortably inside the 2^53
// range where integers are exact. So the conversion IS the arithmetic, with no
// dependency and no rounding mode to get wrong.
//
// Round once, at the end. Rounding each intermediate step is what makes a
// payslip's components fail to add up to its total.
// ============================================================================
import { Decimal128 } from 'mongodb';

export type MoneyInput = Decimal128 | number | string | null | undefined;

/** Paise for a stored/typed value. Exact; throws on nonsense rather than NaN. */
export function toPaise(value: MoneyInput): number {
  if (value === null || value === undefined) return 0;

  const text = typeof value === 'string' ? value.trim() : value.toString();
  if (text === '') return 0;

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new TypeError(`Not a money value: ${text}`);

  const [, sign, whole = '0', frac = ''] = match;

  // Reduce to two decimal places by ROUNDING HALF AWAY FROM ZERO, which is what
  // Postgres did when casting into numeric(12,2). Truncating instead would make
  // every third-decimal input (a percentage-derived figure, an imported sheet)
  // land a paisa low, and the two systems would disagree on the same input.
  // Magnitude is computed unsigned and the sign reapplied, so away-from-zero
  // falls out of rounding the magnitude up.
  const digits = (frac + '000').slice(0, 3);
  let amount = Number(whole || '0') * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) amount += 1;

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
 * A Decimal128 for a `numeric` column that is NOT money — leave days, a rate.
 *
 * Same rule, same conversion: those columns are `bsonType: "decimal"` too, and
 * a JS number is not a decimal. BSON serialises 15.5 as a double and 15 as an
 * int32, and the validator rejects both with error 121 — which is what made
 * provisioning a leave year, adjusting a balance and filing a comp-off day
 * fail. The separate name is so a reader can tell a quantity from an amount at
 * the call site; the two decimal places suit a numeric(n,2) or numeric(n,1)
 * column equally.
 */
export const toDecimal = toMoney;

/**
 * A Decimal128 for a `numeric(9,6)` geo coordinate — punch_events.lat/lng and
 * branches.geofence_lat/lng.
 *
 * Deliberately NOT toDecimal(): two decimal places is the right rule for money
 * and about a kilometre of error on a latitude, which would make a 50-metre
 * geofence meaningless. Six places is what the column declares.
 *
 * Returns null for a missing or non-finite value, because a punch with no
 * coordinates is normal — the browser may refuse to share them — and the
 * column is nullable for exactly that reason.
 */
export function toCoordinate(value: number | null | undefined): Decimal128 | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
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

// ---------------------------------------------------------------------------
// Arithmetic. All of it in paise, so all of it exact.
// ---------------------------------------------------------------------------

export function addPaise(...values: MoneyInput[]): number {
  return values.reduce<number>((sum, v) => sum + toPaise(v), 0);
}

export function subPaise(from: MoneyInput, ...values: MoneyInput[]): number {
  return values.reduce<number>((rest, v) => rest - toPaise(v), toPaise(from));
}

/**
 * Multiply by a ratio — payable days over month days, a percentage, a rate.
 *
 * Rounds half away from zero, which is what Postgres's `round(numeric)` did and
 * therefore what the existing payslips were computed with. JS's Math.round
 * rounds half UP, so -0.5 becomes -0 instead of -1; on a deduction that is a
 * one-paisa drift in the employee's favour that never reconciles.
 */
export function scalePaise(value: MoneyInput, ratio: number): number {
  if (!Number.isFinite(ratio)) throw new TypeError(`Ratio must be finite, got ${ratio}`);
  const exact = toPaise(value) * ratio;
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
}

/**
 * Round PAISE to a whole rupee, half AWAY FROM ZERO — Postgres `round(x, 0)`.
 *
 * The distinction only shows on negatives, which is exactly where a payslip
 * has them: `Math.round(-2.5)` is -2 (half UP), Postgres `round(-2.50)` is -3.
 * An employee whose advance recovery and loss/damage take the net below zero
 * therefore differed from the SQL by a rupee — on the same figure this file's
 * header calls out as never being handed to Math.round.
 */
export function roundToRupee(paise: number): number {
  const rupees = paise / 100;
  return (rupees < 0 ? -Math.round(-rupees) : Math.round(rupees)) * 100;
}

/** Split proportionally without losing a paisa — the remainder goes to the first. */
export function dividePaise(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const out = new Array<number>(parts).fill(base);
  out[0] += total - base * parts;
  return out;
}
