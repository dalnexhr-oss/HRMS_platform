// Returns the first day of the current month in IST ('YYYY-MM-01') as the default accounting period.
function currentPeriodMonth(): string {
  return `${todayISO().slice(0, 8)}01`;
}

/** 'YYYY-06-01' -> { start: 'YYYY-06-01', end: 'YYYY-06-30' } */
function monthRange(periodMonth: string): { start: string; end: string } {
  const start = `${periodMonth.slice(0, 8)}01`;
  const d = new Date(`${start}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start, end: end.toISOString().slice(0, 10) };
}

/**
 * Today's date in IST, used for calendar-day query filters.
 */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export { currentPeriodMonth, monthRange, todayISO };
