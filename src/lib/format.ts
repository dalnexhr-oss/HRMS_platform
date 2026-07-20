// Formatting helpers ported from the prototype's inline script.

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
