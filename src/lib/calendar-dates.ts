// Checks for 'YYYY-MM-DD' form values. Dates are compared as strings, which is correct for this
// format and avoids timezone arithmetic.

// True for a real calendar day. Rejects roll-overs such as 2026-02-31, which Date normalises.
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// The calendar day a number of days after another.
function addCalendarDays(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export { isCalendarDate, addCalendarDays };
