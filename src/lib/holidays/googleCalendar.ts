// ============================================================================
// Import public holidays from Google Calendar.
//
// Google publishes its regional holiday calendars as PUBLIC .ics feeds, so this
// needs no OAuth, no API key and no user consent — the server just fetches a URL.
// That is deliberately simpler (and less privileged) than the Calendar API: we
// only ever want the published holiday list, never anyone's personal calendar.
//
// SERVER ONLY (makes an outbound fetch).
// ============================================================================

/** Google's public holiday calendars, by region. */
export const HOLIDAY_CALENDARS = {
  india: 'en.indian#holiday@group.v.calendar.google.com',
} as const;

export type HolidayRegion = keyof typeof HOLIDAY_CALENDARS;

export interface CalendarHoliday {
  /** 'YYYY-MM-DD' */
  date: string;
  name: string;
  /** Google marks some religious dates as tentative (moon-sighting etc.). */
  tentative: boolean;
}

function feedUrl(region: HolidayRegion): string {
  const id = HOLIDAY_CALENDARS[region];
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
}

/**
 * Unfold RFC 5545 line continuations: a CRLF followed by a space or tab is a
 * continuation of the previous line, not a new one. Long SUMMARY/DESCRIPTION
 * values are routinely folded, so parsing without this truncates names.
 */
function unfold(ics: string): string {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Unescape the RFC 5545 text escapes used in SUMMARY/DESCRIPTION. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/** '20260815' -> '2026-08-15'. */
function toISO(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Parse an .ics feed into holidays for one year.
 *
 * Only entries Google labels "Public holiday" are returned. The same feed also
 * carries ~37 "Observance" entries a year (Valentine's Day, Vasant Panchami …)
 * which are NOT days off — importing those would wrongly mark them non-working
 * and inflate payable days for everyone.
 */
export function parseHolidayIcs(ics: string, year: number): CalendarHoliday[] {
  const text = unfold(ics);
  const out: CalendarHoliday[] = [];
  const seen = new Set<string>();

  for (const chunk of text.split('BEGIN:VEVENT').slice(1)) {
    const body = chunk.split('END:VEVENT')[0];

    const dt = /^DTSTART(?:;VALUE=DATE)?:(\d{8})/m.exec(body);
    if (!dt) continue;
    const date = toISO(dt[1]);
    if (!date.startsWith(String(year))) continue;

    const summary = /^SUMMARY:(.*)$/m.exec(body);
    const name = summary ? unescapeText(summary[1]) : '';
    if (!name) continue;

    const description = /^DESCRIPTION:(.*)$/m.exec(body);
    const desc = description ? unescapeText(description[1]) : '';
    if (!/^public holiday/i.test(desc)) continue;

    // The feed can repeat an event across years/edits — one row per date+name.
    const key = `${date}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ date, name, tentative: /tentative/i.test(desc) });
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return out;
}

/** Fetch and parse a year's public holidays. Throws with a readable message. */
export async function fetchPublicHolidays(
  year: number,
  region: HolidayRegion = 'india',
): Promise<CalendarHoliday[]> {
  let res: Response;
  try {
    res = await fetch(feedUrl(region), {
      // The published calendar changes at most a few times a year.
      next: { revalidate: 60 * 60 * 24 },
      headers: { Accept: 'text/calendar' },
    });
  } catch (e) {
    throw new Error(
      `Could not reach Google Calendar: ${e instanceof Error ? e.message : String(e)}. ` +
        'Check the server has outbound internet access.',
    );
  }

  if (!res.ok) {
    throw new Error(`Google Calendar returned HTTP ${res.status} for the ${region} holiday feed.`);
  }

  const ics = await res.text();
  if (!ics.includes('BEGIN:VCALENDAR')) {
    throw new Error('The holiday feed did not return a calendar file.');
  }

  return parseHolidayIcs(ics, year);
}
