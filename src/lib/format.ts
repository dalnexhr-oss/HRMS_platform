// Formatting helpers ported from the prototype's inline script.

/**
 * Today's date 'YYYY-MM-DD' in the business timezone (IST) — NOT the host
 * clock. new Date().toISOString() is UTC, which is *yesterday* between
 * 00:00 and 05:30 IST; every business-date default must go through this.
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** The current calendar year in IST. */
export function currentYearIST(): number {
  return Number(todayIST().slice(0, 4));
}

/** ₹1,23,456 — Indian-grouped rupees, rounded. */
export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** minutes -> 'HH:MM' (e.g. 560 -> '09:20'). */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:MM' or 'HH:MM:SS' time string -> minutes since midnight. */
export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** '2022-07-15' -> '15 Jul 2022'. */
export function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** '09:20:00' -> '09:20' (trim seconds from a Postgres time). */
export function trimTime(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Period-month helpers.
//
// A "period month" is the 'YYYY-MM-01' string used everywhere as the key for a
// monthly period (payroll_runs.period_month, the register's ?m=, cell B2 of the
// import template).
//
// These live in format.ts — not queries.ts — deliberately: queries.ts imports
// '@/lib/supabase/server', so a client component cannot touch it. These are
// pure string/date arithmetic and are safe on both sides.
// ---------------------------------------------------------------------------

/**
 * 'YYYY-MM-01' -> 'August 2026'.
 *
 * Parsed as UTC and formatted in UTC, both ends pinned deliberately.
 *
 * The floating form this replaces (`new Date(`${d}T00:00:00`)` formatted with no
 * timeZone) was not itself broken: a no-Z date-time parses as LOCAL and is then
 * formatted as local, so the two cancel and the label is correct in every zone.
 * The reason to pin UTC anyway is that the cancellation is a coincidence of the
 * exact string shape — trim it to 'YYYY-MM' or a bare 'YYYY-MM-DD' and the spec
 * switches to UTC parsing while the formatter stays local, at which point a
 * viewer west of UTC silently sees the PREVIOUS month.
 *
 * That matters most here: this labels cell B2 of the import template, which
 * buildWorkbook writes as `new Date('…T00:00:00Z')` and titles via monthTitle()
 * in UTC. Sharing their convention means the label and the cell it describes
 * cannot drift apart.
 */
export function monthLabelUTC(periodMonth: string): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A window of period months around `currentMonth`, newest first: `ahead` future
 * months, then the current one, then `back` past ones.
 *
 * Date.UTC normalises out-of-range months on its own (month -1 rolls to the
 * previous December), so no year arithmetic is needed here.
 */
export function monthOptionsAround(currentMonth: string, back = 12, ahead = 1): string[] {
  const year = Number(currentMonth.slice(0, 4));
  const month1 = Number(currentMonth.slice(5, 7));
  const out: string[] = [];
  for (let delta = ahead; delta >= -back; delta--) {
    const d = new Date(Date.UTC(year, month1 - 1 + delta, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}
