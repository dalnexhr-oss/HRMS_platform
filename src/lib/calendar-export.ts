// Copyright (c) 2024 Dalnex LLP. All rights reserved

const calendarLineEnding = '\r\n';
const maxLineBytes = 75;
const millisecondsPerDay = 86_400_000;
const calendarProductId = '-//Dalnex LLP//HRMS Calendar 1.0//EN';
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const utcTimestampPattern = /^\d{8}T\d{6}Z$/;

/** A holiday, leave period, or company event to include in the calendar download. */
interface CalendarExportEvent {
  /** Stable across exports so calendar clients can recognise the same event. */
  uniqueId: string;
  /** First day in YYYY-MM-DD format. */
  startDate: string;
  /** Last included day in YYYY-MM-DD format; defaults to startDate. */
  endDateInclusive?: string | null;
  title: string;
  description?: string | null;
  /** Defaults to true; false exports local midnight-to-midnight times. */
  isAllDay?: boolean;
}

interface CalendarExportOptions {
  calendarName?: string;
  /** ISO or YYYYMMDDTHHMMSSZ timestamp; defaults to now. Supply it for repeatable output. */
  generatedAt?: string;
}

function getUtf8ByteLength(text: string): number {
  let byteLength = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    byteLength += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return byteLength;
}

/** Keep Unicode characters and backslash escapes together when wrapping a line. */
function splitPreservingEscapes(line: string): string[] {
  const characters = Array.from(line);
  const tokens: string[] = [];
  for (let index = 0; index < characters.length; index++) {
    if (characters[index] === '\\' && index + 1 < characters.length) {
      tokens.push(characters[index] + characters[index + 1]);
      index++;
    } else {
      tokens.push(characters[index]);
    }
  }
  return tokens;
}

function validateCalendarDate(dateValue: string, fieldName: string): void {
  if (!isoDatePattern.test(dateValue)) {
    throw new Error(`Calendar ${fieldName} must be 'YYYY-MM-DD', got '${dateValue}'.`);
  }
  const [year, month, day] = dateValue.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Calendar ${fieldName} is not a real date: '${dateValue}'.`);
  }
}

function formatUtcTimestamp(date: Date): string {
  const padNumber = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${padNumber(date.getUTCFullYear(), 4)}${padNumber(date.getUTCMonth() + 1)}${padNumber(date.getUTCDate())}` +
    `T${padNumber(date.getUTCHours())}${padNumber(date.getUTCMinutes())}${padNumber(date.getUTCSeconds())}Z`
  );
}

/**
 * Format DTSTAMP as YYYYMMDDTHHMMSSZ. Accept compact UTC or ISO timestamps; use the current clock
 * only when omitted. Callers should pass a timestamp for reproducible output.
 */
function normalizeExportTimestamp(generatedAt?: string): string {
  if (generatedAt === undefined) {
    return formatUtcTimestamp(new Date());
  }

  const trimmedTimestamp = generatedAt.trim();
  if (utcTimestampPattern.test(trimmedTimestamp)) {
    return trimmedTimestamp;
  }

  const parsedDate = new Date(trimmedTimestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      `Calendar timestamp must be 'YYYYMMDDTHHMMSSZ' or an ISO-8601 date, got '${generatedAt}'.`,
    );
  }
  return formatUtcTimestamp(parsedDate);
}

/**
 * Escape backslashes before commas and semicolons, and encode newlines as literal \n. Leave colons
 * and quotes unchanged in ICS TEXT values.
 */
function escapeCalendarText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold at 75 UTF-8 octets per RFC 5545 §3.1. Continuation lines start with one space, leaving 74
 * octets for content. Count encoded bytes, not JavaScript string length.
 */
function foldCalendarLine(line: string): string {
  if (getUtf8ByteLength(line) <= maxLineBytes) {
    return line;
  }

  const foldedLines: string[] = [];
  let currentLine = '';
  let currentLineBytes = 0;
  let availableLineBytes = maxLineBytes;

  for (const token of splitPreservingEscapes(line)) {
    const tokenBytes = getUtf8ByteLength(token);
    if (currentLineBytes > 0 && currentLineBytes + tokenBytes > availableLineBytes) {
      foldedLines.push(currentLine);
      currentLine = '';
      currentLineBytes = 0;
      availableLineBytes = maxLineBytes - 1; // Reserve one byte for the continuation space.
    }
    currentLine += token;
    currentLineBytes += tokenBytes;
  }
  if (currentLine) {
    foldedLines.push(currentLine);
  }

  return foldedLines.join(`${calendarLineEnding} `);
}

/** Convert YYYY-MM-DD to the calendar file's YYYYMMDD date format. */
function formatCalendarDate(dateValue: string): string {
  validateCalendarDate(dateValue, 'date');
  return dateValue.replace(/-/g, '');
}

/**
 * Add whole days to YYYY-MM-DD in UTC so daylight-saving transitions cannot shift calendar end
 * dates.
 */
function addCalendarDays(dateValue: string, daysToAdd: number): string {
  validateCalendarDate(dateValue, 'date');
  const [year, month, day] = dateValue.split('-').map(Number);
  const shiftedDate = new Date(Date.UTC(year, month - 1, day) + daysToAdd * millisecondsPerDay);
  const formattedYear = String(shiftedDate.getUTCFullYear()).padStart(4, '0');
  const formattedMonth = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
  const formattedDay = String(shiftedDate.getUTCDate()).padStart(2, '0');
  return `${formattedYear}-${formattedMonth}-${formattedDay}`;
}

/** Emit `NAME:escaped-value`, folded. Empty values are skipped by the caller. */
function formatTextProperty(propertyName: string, text: string): string {
  return foldCalendarLine(`${propertyName}:${escapeCalendarText(text)}`);
}

/**
 * Convert the inclusive event end to ICS's exclusive DTEND by adding one day. A holiday on August
 * 15 ends on August 16; leave through August 17 ends on August 18.
 */
function buildEventLines(event: CalendarExportEvent, exportTimestamp: string): string[] {
  const eventId = event.uniqueId?.trim();
  if (!eventId) {
    throw new Error(`Calendar event for '${event.title}' is missing a UID.`);
  }

  validateCalendarDate(event.startDate, `event '${eventId}' start`);
  // Missing and blank end dates both mean a single-day event.
  const inclusiveEndDate = event.endDateInclusive?.trim() || event.startDate;
  validateCalendarDate(inclusiveEndDate, `event '${eventId}' end`);
  if (inclusiveEndDate < event.startDate) {
    throw new Error(
      `Calendar event '${eventId}' ends (${inclusiveEndDate}) before it starts (${event.startDate}).`,
    );
  }

  const exclusiveEndDate = addCalendarDays(inclusiveEndDate, 1);
  const isAllDay = event.isAllDay !== false;

  const eventLines: string[] = ['BEGIN:VEVENT'];
  eventLines.push(formatTextProperty('UID', eventId));
  eventLines.push(`DTSTAMP:${exportTimestamp}`);

  if (isAllDay) {
    eventLines.push(`DTSTART;VALUE=DATE:${formatCalendarDate(event.startDate)}`);
    eventLines.push(`DTEND;VALUE=DATE:${formatCalendarDate(exclusiveEndDate)}`);
  } else {
    // Events have dates but no clock times. Export midnight in the viewer's local timezone.
    eventLines.push(`DTSTART:${formatCalendarDate(event.startDate)}T000000`);
    eventLines.push(`DTEND:${formatCalendarDate(exclusiveEndDate)}T000000`);
  }

  eventLines.push(formatTextProperty('SUMMARY', event.title?.trim() || '(untitled)'));
  const description = event.description?.trim();
  if (description) {
    eventLines.push(formatTextProperty('DESCRIPTION', description));
  }

  eventLines.push('END:VEVENT');
  return eventLines;
}

/**
 * Build a VCALENDAR with CRLF endings, including the final line. Serve as text/calendar;
 * charset=utf-8. Omit METHOD so clients treat this as a calendar feed rather than a meeting
 * invitation. Empty event lists are valid.
 */
function buildCalendarIcs(
  events: CalendarExportEvent[],
  options: CalendarExportOptions = {},
): string {
  const exportTimestamp = normalizeExportTimestamp(options.generatedAt);
  const calendarName = options.calendarName?.trim() || 'Dalnex HRMS';

  const calendarLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldCalendarLine(`PRODID:${calendarProductId}`),
    'CALSCALE:GREGORIAN',
    // Calendar clients can use these properties to display the calendar's name and description.
    formatTextProperty('X-WR-CALNAME', calendarName),
    formatTextProperty('X-WR-CALDESC', `${calendarName} — holidays, leave and company events`),
  ];

  for (const event of events) {
    calendarLines.push(...buildEventLines(event, exportTimestamp));
  }

  calendarLines.push('END:VCALENDAR');
  return calendarLines.join(calendarLineEnding) + calendarLineEnding;
}

export { escapeCalendarText, foldCalendarLine, formatCalendarDate ,addCalendarDays buildCalendarIcs };
export type { CalendarExportEvent, CalendarExportOptions };
