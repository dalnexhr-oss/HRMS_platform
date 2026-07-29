// ============================================================================
// Generate RFC 5545 .ics calendar files (OUTBOUND).
//
// This is the mirror of `holidays/googleCalendar.ts`, which PARSES an inbound
// Google holiday feed. Here we go the other way: turn HRMS rows (holidays,
// approved leave, WFH days) into a calendar file employees can subscribe to or
// import into Google Calendar / Outlook / Apple Calendar.
//
// Why hand-roll instead of pulling an ics library:
//   1. We emit a tiny, fixed subset — all-day VEVENTs with UID/SUMMARY/
//      DESCRIPTION. Every npm option ships timezone databases and RRULE engines
//      we will never touch, for a format that is ~40 lines of string building.
//   2. Calendar clients are unforgiving about the two things that actually
//      matter — CRLF line endings and 75-OCTET line folding — and both are
//      easier to get right (and to unit test) in code we own than to debug
//      through a dependency.
//   3. It stays pure. No fetch, no Supabase, no next/*. That means an API route,
//      a server action, a cron job or a test can all import it, and the same
//      inputs always produce byte-identical output (callers pass `timestamp`).
//
// The two rules that break real calendars if you get them wrong:
//   * DTEND IS EXCLUSIVE for DATE values. A one-day holiday on 2026-08-15 has
//     DTEND;VALUE=DATE:20260816. Emitting 20260815 makes Google silently drop
//     the event or render a zero-length blip; emitting the inclusive end of a
//     multi-day range paints one day short. See buildEvent() below.
//   * Folding is counted in OCTETS, not JS characters. "Diwali — दीपावली" is
//     far more bytes than `String.length` suggests, and folding on character
//     count produces lines over 75 octets that strict parsers reject. Worse,
//     naively slicing a JS string can cut a surrogate pair in half.
//
// SAFE ANYWHERE (pure string functions, no I/O, no server-only imports).
// ============================================================================

/** RFC 5545 §3.1: content lines are delimited by CRLF, never a bare LF. */
const CRLF = '\r\n';

/** RFC 5545 §3.1: lines SHOULD NOT be longer than 75 octets, excluding CRLF. */
const MAX_OCTETS = 75;

/** Identifies the product that wrote the file. Free text, but must be present. */
const PRODID = '-//Dalnex LLP//HRMS Calendar 1.0//EN';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 5545 UTC date-time, e.g. '20260729T101530Z'. */
const ICS_STAMP = /^\d{8}T\d{6}Z$/;

export interface CalendarEvent {
  /**
   * Globally unique, STABLE id for this event. Re-exporting the same holiday
   * must reuse the same UID, otherwise subscribers accumulate duplicates
   * instead of seeing an update. Prefer `${table}-${row.id}@dalnex-hrms`.
   */
  uid: string;
  /** First day, 'YYYY-MM-DD'. */
  start: string;
  /**
   * INCLUSIVE last day, 'YYYY-MM-DD'. Omit for a single-day event. This is the
   * human meaning of "leave until the 20th"; the +1 conversion to RFC 5545's
   * exclusive DTEND happens inside buildIcs so callers never have to think
   * about it.
   */
  end?: string | null;
  summary: string;
  description?: string | null;
  /**
   * Defaults to true. Our event model carries dates only — no clock time — so
   * all-day is the correct and normal shape for holidays, leave and WFH.
   * Passing false emits a *floating* midnight-to-midnight DATE-TIME instead
   * (no TZID, so each client renders it in its own local time), which is
   * occasionally what an importer expects.
   */
  allDay?: boolean;
}

export interface BuildIcsOptions {
  /** Shown as the calendar's name in most clients via X-WR-CALNAME. */
  calName?: string;
  /**
   * DTSTAMP for every VEVENT, as 'YYYYMMDDTHHMMSSZ' or any ISO-8601 string.
   * Callers should pass this: it is the only non-deterministic input, so
   * supplying it makes the output byte-stable and therefore testable (and lets
   * an HTTP handler reuse one timestamp across a whole export).
   */
  timestamp?: string;
}

/**
 * UTF-8 byte length of a string.
 *
 * `for…of` iterates by code point, so an astral character (emoji, some Indic
 * conjuncts) is measured once as 4 octets rather than twice as a surrogate.
 */
function octetLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Split a line into the smallest units a fold may not break apart: one code
 * point, or a backslash escape kept with the character it escapes.
 *
 * Unfolding formally happens before unescaping, so splitting `\,` across a fold
 * is legal — but enough clients mis-handle it that keeping escape pairs atomic
 * is free insurance. Grouping never costs more than one extra octet.
 */
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

/**
 * Throw a readable error rather than emitting a calendar with a broken date.
 *
 * The shape check alone is not enough: '2026-02-30' and '2026-13-01' both match
 * the regex, and Date.UTC would silently roll them forward into March / next
 * January — so the file would look valid while every subscriber saw the wrong
 * day. The round-trip below rejects them at the source instead. It also rejects
 * years under 100, where Date.UTC's legacy two-digit-year rule maps 0026 to
 * 1926 and would corrupt addDays() the same way.
 */
function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Calendar ${field} must be 'YYYY-MM-DD', got '${value}'.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
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
 * Normalise a DTSTAMP into RFC 5545 UTC form 'YYYYMMDDTHHMMSSZ'.
 *
 * Accepts what is already in that form, otherwise parses an ISO-8601 string
 * (the usual `new Date().toISOString()`) and formats it from UTC fields. With
 * no input it reads the clock — the single impure path in this module, which is
 * exactly why callers pass `opts.timestamp` when they want reproducible bytes.
 *
 * Formatting goes through explicit getUTC* fields rather than re-feeding
 * `toISOString()` back into this function: that recursion never terminates,
 * because the ISO string never matches the compact form it is being tested
 * against, and every caller that did the documented thing (pass an ISO
 * timestamp) blew the stack instead of exporting a calendar.
 */
function toIcsStamp(value?: string): string {
  if (value === undefined) return formatIcsStamp(new Date());

  const raw = value.trim();
  if (ICS_STAMP.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Calendar timestamp must be 'YYYYMMDDTHHMMSSZ' or an ISO-8601 date, got '${value}'.`,
    );
  }
  return formatIcsStamp(parsed);
}

/**
 * Escape the RFC 5545 TEXT specials. Inverse of `unescapeText` in
 * holidays/googleCalendar.ts.
 *
 * Backslash MUST be escaped first, otherwise the backslashes this function
 * introduces for `,` and `;` would themselves be doubled on a second pass.
 * All newline flavours collapse to the literal two-character sequence `\n`,
 * because a raw newline inside a value would be read as a new content line.
 * Colons and quotes are NOT escaped in TEXT values — doing so leaks visible
 * backslashes into event titles in Outlook.
 */
export function escapeIcsText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets per RFC 5545 §3.1.
 *
 * Continuation lines begin with a single space, and that space counts toward
 * the 75 — so the first line carries 75 octets of content and each following
 * line 74. Readers strip exactly one leading whitespace character when
 * unfolding, which is why we emit exactly one.
 *
 * The measurement is in UTF-8 octets, not `String.length`: a line of 60
 * Devanagari characters is ~180 octets and must still be folded.
 */
export function foldLine(line: string): string {
  if (octetLength(line) <= MAX_OCTETS) return line;

  const out: string[] = [];
  let chunk = '';
  let used = 0;
  let limit = MAX_OCTETS; // first line spends nothing on a continuation space

  for (const token of tokenize(line)) {
    const size = octetLength(token);
    if (used > 0 && used + size > limit) {
      out.push(chunk);
      chunk = '';
      used = 0;
      limit = MAX_OCTETS - 1; // every later line gives one octet to the space
    }
    chunk += token;
    used += size;
  }
  if (chunk) out.push(chunk);

  return out.join(`${CRLF} `);
}

/** '2026-08-15' -> '20260815'. Inverse of the parser's `toISO`. */
export function icsDate(iso: string): string {
  assertIsoDate(iso, 'date');
  return iso.replace(/-/g, '');
}

/**
 * Add (or subtract) whole days to a 'YYYY-MM-DD' date, in UTC.
 *
 * Deliberately built on Date.UTC rather than the local-time constructor: UTC
 * has no DST, so a day is always exactly 86 400 000 ms. Using local time makes
 * this silently return the wrong date for servers in DST-observing zones on the
 * two shift days a year — and the caller here is DTEND, where a one-day error
 * moves everybody's holiday.
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
 * Render one VEVENT.
 *
 * THE OFF-BY-ONE: RFC 5545 §3.8.2.2 makes DTEND *non-inclusive* — it is the
 * first instant NOT in the event. Our CalendarEvent.end is the inclusive last
 * working day people actually mean, so DTEND is always `end + 1 day`:
 *
 *   single day  2026-08-15            -> DTSTART 20260815, DTEND 20260816
 *   range       2026-08-15..2026-08-17 -> DTSTART 20260815, DTEND 20260818
 *
 * Passing the inclusive end straight through is the classic bug: Google shows
 * the leave ending a day early, and a one-day event collapses to nothing.
 */
function buildEvent(ev: CalendarEvent, stamp: string): string[] {
  // UID is REQUIRED and must actually carry a value — a bare `UID:` line makes
  // strict parsers reject the whole VCALENDAR, and lenient ones invent a fresh
  // id on every import, which is precisely the duplicate-storm we use stable
  // UIDs to avoid.
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
  if (description) lines.push(textLine('DESCRIPTION', description));

  lines.push('END:VEVENT');
  return lines;
}

/**
 * Build a complete VCALENDAR document from HRMS events.
 *
 * The result uses CRLF throughout and ends with a trailing CRLF — some parsers
 * (notably older Outlook) drop the final END:VCALENDAR without it. Serve it as
 * `text/calendar; charset=utf-8`.
 *
 * There is deliberately no METHOD property. METHOD belongs to iTIP (RFC 5546):
 * §3.7.2 says that if METHOD is present the Content-Type MUST carry a matching
 * `method=` parameter, and a PUBLISH message MUST also carry an ORGANIZER.
 * A subscribable holiday/leave feed is neither of those things, and Outlook
 * treats a METHOD-bearing file as a meeting message — which is what actually
 * produces the stray Accept/Decline buttons on a public holiday.
 *
 * An empty `events` array yields a valid, empty calendar rather than throwing:
 * "this employee has no upcoming leave" is a normal state for a subscription
 * feed, and returning an error there would break the client's polling.
 *
 * @param events  Events to emit, one VEVENT each. UIDs should be stable.
 * @param opts.calName    Calendar display name (X-WR-CALNAME). Default 'Dalnex HRMS'.
 * @param opts.timestamp  DTSTAMP for every event; pass it for deterministic output.
 */
export function buildIcs(events: CalendarEvent[], opts: BuildIcsOptions = {}): string {
  const stamp = toIcsStamp(opts.timestamp);
  const calName = opts.calName?.trim() || 'Dalnex HRMS';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldLine(`PRODID:${PRODID}`),
    'CALSCALE:GREGORIAN',
    // X-WR-* are non-standard but universally honoured; without CALNAME the
    // calendar imports as "Untitled".
    textLine('X-WR-CALNAME', calName),
    textLine('X-WR-CALDESC', `${calName} — holidays, leave and company events`),
  ];

  for (const ev of events) lines.push(...buildEvent(ev, stamp));

  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF;
}
