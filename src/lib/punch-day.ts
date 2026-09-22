// Shared IST session accounting for web punches, terminal punches and both night sweeps.
interface DayEvent {
  kind: string;
  punched_at: Date | string;
  within_geofence?: boolean | null;
  lat?: number | null;
  lng?: number | null;
}

function localParts(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

function dayFloorUtc(date: string): Date {
  const floor = new Date(`${date}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - 1);
  return floor;
}

function punchInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function punchedAt(event: DayEvent): Date {
  return punchInstant(event.punched_at);
}

function minuteOf(clock: string): number {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

function summarizePunches(events: DayEvent[]) {
  let firstIn: string | null = null;
  let openIn: string | null = null;
  let lastOut: string | null = null;
  let workedMinutes = 0;
  for (const event of events) {
    const clock = localParts(punchedAt(event)).time.slice(0, 5);
    if (event.kind === 'in') {
      firstIn ??= clock;
      openIn ??= clock;
    } else if (event.kind === 'out' && openIn !== null) {
      workedMinutes += Math.max(0, minuteOf(clock) - minuteOf(openIn));
      openIn = null;
      lastOut = clock;
    }
  }
  // A reopened day must remain visible to the sweep even after an earlier lunch punch-out.
  return { firstIn, openIn, lastOut: openIn === null ? lastOut : null, workedMinutes };
}

function sumWorkedMinutes(events: DayEvent[]): number {
  return summarizePunches(events).workedMinutes;
}

export { localParts, dayFloorUtc, punchInstant, punchedAt, summarizePunches, sumWorkedMinutes };
export type { DayEvent };
