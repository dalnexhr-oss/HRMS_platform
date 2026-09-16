// Build all-day ICS events from HRMS records using RFC 5545 formatting. Callers supply the
// timestamp so identical inputs produce identical output.
//
// DATE end values are exclusive: a one-day event ends on the following date. Fold lines at 75 UTF-8
// octets, preserving code points, and use CRLF line endings. These helpers have no I/O or server
// dependencies.

// RFC 5545 §3.1: content lines are delimited by CRLF, never a bare LF.
const crlf = '\r\n';

// RFC 5545 §3.1: lines SHOULD NOT be longer than 75 octets, excluding CRLF.
const maxOctets = 75;

// Identifies the product that wrote the file. Free text, but must be present.
const prodid = '-//Dalnex LLP//HRMS Calendar 1.0//EN';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// RFC 5545 UTC date-time, e.g. '20260729T101530Z'.
const icsStamp = /^\d{8}T\d{6}Z$/;

export interface CalendarEvent {
  // Globally unique, STABLE id for this event. Re-exporting the same holiday must reuse the same UID, otherwise subscribers accumulate duplicates instead of seeing an update. Prefer `${table}-${row.id}@dalnex-hrms`.
  uid: string;
  // First day, 'YYYY-MM-DD'.
  start: string;
  // INCLUSIVE last day, 'YYYY-MM-DD'. Omit for a single-day event. This is the human meaning of
  // "leave until the 20th"; the +1 conversion to RFC 5545's exclusive DTEND happens inside buildIcs
  // so callers never have to think about it.
  end?: string | null;
  summary: string;
  description?: string | null;
  // All-day defaults to true. False emits floating midnight-to-midnight DATE-TIME values without
  // TZID, interpreted in each calendar client's timezone.
  allDay?: boolean;
}

export interface BuildIcsOptions {
  // Shown as the calendar's name in most clients via X-WR-CALNAME.
  calName?: string;
  // Supply DTSTAMP as YYYYMMDDTHHMMSSZ or ISO-8601 to make exports deterministic. One timestamp
  // can be reused for all events.
  timestamp?: string;
}

// UTF-8 byte length of a string. `for…of` iterates by code point, so an astral character (emoji,
// some Indic conjuncts) is measured once as 4 octets rather than twice as a surrogate.
function octetLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

// Keep Unicode code points and backslash escape pairs intact when folding. Some calendar clients
// mishandle escapes split across continuation lines.
function tokenize(line: string): string[] {
  const chars = Array.from(line);
  const tokens: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\\' && i + 1 < chars.length) {
      tokens.push(chars[i] + chars[i + 1]);
      i++;
    } else {
      tokens.push(chars[i]);
    }
  }
  return tokens;
}

// Round-trip parsed dates to reject impossible days and months that Date.UTC would normalize.
// Reject years below 100 to avoid its legacy two-digit-year conversion.
function assertIsoDate(value: string, field: string): void {
  if (!isoDate.test(value)) {
    throw new Error(`Calendar ${field} must be 'YYYY-MM-DD', got '${value}'.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`Calendar ${field} is not a real date: '${value}'.`);
  }
}

/** Render a Date as RFC 5545 UTC form 'YYYYMMDDTHHMMSSZ'. */
function formatIcsStamp(d: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Format DTSTAMP as YYYYMMDDTHHMMSSZ. Accept compact UTC or ISO timestamps; use the current clock
 * only when omitted. Callers should pass a timestamp for reproducible output.
 */
function toIcsStamp(value?: string): string {
  if (value === undefined) {
    return formatIcsStamp(new Date());
  }

  const raw = value.trim();
  if (icsStamp.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Calendar timestamp must be 'YYYYMMDDTHHMMSSZ' or an ISO-8601 date, got '${value}'.`,
    );
  }
  return formatIcsStamp(parsed);
}

/**
 * Escape backslashes before commas and semicolons, and encode newlines as literal \n. Leave colons
 * and quotes unchanged in ICS TEXT values.
 */
export function escapeIcsText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold at 75 UTF-8 octets per RFC 5545 §3.1. Continuation lines start with one space, leaving 74
 * octets for content. Count encoded bytes, not JavaScript string length.
 */
export function foldLine(line: string): string {
  if (octetLength(line) <= maxOctets) {
    return line;
  }

  const out: string[] = [];
  let chunk = '';
  let used = 0;
  let limit = maxOctets; // first line spends nothing on a continuation space

  for (const token of tokenize(line)) {
    const size = octetLength(token);
    if (used > 0 && used + size > limit) {
      out.push(chunk);
      chunk = '';
      used = 0;
      limit = maxOctets - 1; // every later line gives one octet to the space
    }
    chunk += token;
    used += size;
  }
  if (chunk) {
    out.push(chunk);
  }

  return out.join(`${crlf} `);
}

/** 'YYYY-08-15' -> '20260815'. Inverse of the parser's `toISO`. */
export function icsDate(iso: string): string {
  assertIsoDate(iso, 'date');
  return iso.replace(/-/g, '');
}

/**
 * Add whole days to YYYY-MM-DD in UTC so daylight-saving transitions cannot shift calendar end
 * dates.
 */
export function addDays(iso: string, n: number): string {
  assertIsoDate(iso, 'date');
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Emit `NAME:escaped-value`, folded. Empty values are skipped by the caller. */
function textLine(name: string, value: string): string {
  return foldLine(`${name}:${escapeIcsText(value)}`);
}

/**
 * Convert the inclusive event end to ICS's exclusive DTEND by adding one day. A holiday on August
 * 15 ends on August 16; leave through August 17 ends on August 18.
 */
function buildEvent(ev: CalendarEvent, stamp: string): string[] {
  // Require a nonempty stable UID so calendar clients can update an existing event without
  // creating duplicates.
  const uid = ev.uid?.trim();
  if (!uid) {
    throw new Error(`Calendar event for '${ev.summary}' is missing a UID.`);
  }

  assertIsoDate(ev.start, `event '${uid}' start`);
  // `?? ev.start` alone is not enough: a nullable DB column arriving as '' is
  // "no end date", not a date, and would otherwise throw on the shape check.
  const lastDay = ev.end?.trim() || ev.start;
  assertIsoDate(lastDay, `event '${uid}' end`);
  if (lastDay < ev.start) {
    throw new Error(`Calendar event '${uid}' ends (${lastDay}) before it starts (${ev.start}).`);
  }

  const exclusiveEnd = addDays(lastDay, 1); // <- the +1 described above
  const allDay = ev.allDay !== false;

  const lines: string[] = ['BEGIN:VEVENT'];
  // UID is a TEXT value, so it is escaped like any other; stable across exports.
  lines.push(textLine('UID', uid));
  lines.push(`DTSTAMP:${stamp}`);

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(exclusiveEnd)}`);
  } else {
    // No clock time exists in our model, so this degenerates to a floating
    // midnight-to-midnight span. No TZID and no trailing Z: floating times are
    // rendered in each viewer's own zone, which is what a distributed team wants.
    lines.push(`DTSTART:${icsDate(ev.start)}T000000`);
    lines.push(`DTEND:${icsDate(exclusiveEnd)}T000000`);
  }

  lines.push(textLine('SUMMARY', ev.summary?.trim() || '(untitled)'));
  const description = ev.description?.trim();
  if (description) {
    lines.push(textLine('DESCRIPTION', description));
  }

  lines.push('END:VEVENT');
  return lines;
}

/**
 * Build a VCALENDAR with CRLF endings, including the final line. Serve as text/calendar;
 * charset=utf-8. Omit METHOD so clients treat this as a calendar feed rather than a meeting
 * invitation. Empty event lists are valid.
 *
 * @param events Events with stable UIDs.
 * @param opts Calendar name and optional timestamp; pass the timestamp for deterministic output.
 */
export function buildIcs(events: CalendarEvent[], opts: BuildIcsOptions = {}): string {
  const stamp = toIcsStamp(opts.timestamp);
  const calName = opts.calName?.trim() || 'Dalnex HRMS';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldLine(`PRODID:${prodid}`),
    'CALSCALE:GREGORIAN',
    // X-WR-* are non-standard but universally honoured; without CALNAME the
    // calendar imports as "Untitled".
    textLine('X-WR-CALNAME', calName),
    textLine('X-WR-CALDESC', `${calName} — holidays, leave and company events`),
  ];

  for (const ev of events) {
    lines.push(...buildEvent(ev, stamp));
  }

  lines.push('END:VCALENDAR');
  return lines.join(crlf) + crlf;
}
