// ============================================================================
// Pure parser for the company's monthly attendance register (.xlsx).
//
// No Supabase, no React, no I/O beyond the buffer handed in — so it can be
// unit-tested and run anywhere.
//
// LAYOUT (verified against "reference for desktop app (1).xlsx", Sheet1):
//   B1            year (2026)
//   B2            the month, as a real date (2026-06-01)
//   row 3         C..AF weekday names; AQ.. a legend ('P ' = Present with CO)
//   row 4         C..AF day-of-month 1..30/31; then the summary headers
//                 (P,T,LM,S,OH,L,CO,HD,WO) at AG..AO; AP 'Working Days'
//                 — both bands are located by content, not hardcoded, because
//                 C..AF is exactly 30 wide and cannot be right for every month.
//   row 5         A 'Empl. ID'; C..AF per-day target hours; AP..BP payroll headers
//   rows 6+       employee blocks, STRIDE 4:
//     k+0  A = Empl. ID, C..AF = status code, AG..AO = counts,
//          AP = working days, AQ = 'to pay for' days
//     k+1  B = 'In'                  C..AF punch-in
//     k+2  B = 'Out'                 C..AF punch-out
//     k+3  B = 'Total Hrs Completed' C..AF worked; AS month total
//
// TIME VALUES: exceljs hands back real Date objects (epoch 1899-12-30), *not*
// the raw Excel fractions the spec describes. Both are handled — see
// excelValueToMinutes. A zero/blank time means "no punch" -> null.
// ============================================================================
import ExcelJS from 'exceljs';

export interface ParsedDay {
  day: number;
  status: string;
  inMin: number | null;
  outMin: number | null;
  workedMin: number;
}

export interface ParsedEmployee {
  emplId: number;
  /** Derived key: 'DN' + zero-padded id. Resolved to employees.id by the importer. */
  code: string;
  days: ParsedDay[];
  counts: Record<string, number>;
  workingDays: number | null;
  payableDays: number | null;
  /** 1-indexed worksheet row the block starts on — for error messages. */
  rowNumber: number;
}

export interface ParsedRegister {
  year: number;
  /** 'YYYY-MM-01' */
  periodMonth: string;
  daysInMonth: number;
  employees: ParsedEmployee[];
  warnings: string[];
}

/**
 * Status codes the database enum accepts. 'CO' only exists once migration 0006
 * is applied — the importer surfaces the enum error rather than dropping it.
 */
export const KNOWN_STATUSES = ['P', 'LM', 'HD', 'L', 'WO', 'OH', 'AB', 'S', 'T', 'CO'] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

const KNOWN_SET = new Set<string>(KNOWN_STATUSES);

/**
 * Spellings seen in the sheet + its legend that aren't literal enum members.
 * 'P ' (trailing space) is the legend's "Present with CO"; it still books as a
 * present day, and TRIM collapses it into 'P' before we ever get here.
 */
const STATUS_ALIASES: Record<string, string> = {
  PRESENT: 'P',
  'P ADJUSTED': 'P',
  'P ADJ': 'P',
  'PRESENT WITH CO': 'P',
  A: 'AB',
  ABSENT: 'AB',
  'WEEK OFF': 'WO',
  'WEEKOFF': 'WO',
  'HALF DAY': 'HD',
  'HALFDAY': 'HD',
  'LATE MARK': 'LM',
  'OFFICIAL HOLIDAY': 'OH',
  HOLIDAY: 'OH',
  LEAVE: 'L',
  'COMP OFF': 'CO',
  COMPOFF: 'CO',
  SITE: 'S',
  TRAVEL: 'T',
  TRAVELLING: 'T',
};

// --------------------------------------------------------------- geometry ---
const ROW_YEAR = 1;
const ROW_MONTH = 2;
const ROW_DAY_NUMBERS = 4;
const BLOCK_START_ROW = 6;
const BLOCK_STRIDE = 4;

const COL_EMPL_ID = 1; // A
const COL_LABEL = 2; // B
const COL_FIRST_DAY = 3; // C
const MAX_DAY_COLUMNS = 31;

/**
 * The summary band (counts, then Working Days, then 'to pay for') is FOUND by
 * its header rather than assumed to be at a fixed letter.
 *
 * In the June 2026 sample the days occupy C..AF (exactly 30 columns) and the
 * band starts at AG(33) — matching the layout note. But C..AF holds only 30
 * days, so a 31-day month must put day 31 somewhere, and a 28-day month leaves
 * a gap. Whether such sheets shift the band or pin it at AG is unknowable from
 * a June-only sample. Both hardcoding AG and hugging the last day column get
 * one of those cases wrong, so instead we scan right from the end of the day
 * columns for the 'P' header. That resolves to AG..AO / AP / AQ on the real
 * sheet and stays correct either way.
 */
const SUMMARY_COUNT_COLUMNS = 9; // P,T,LM,S,OH,L,CO,HD,WO
const OFFSET_WORKING_DAYS = SUMMARY_COUNT_COLUMNS; // AP, relative to band start
const OFFSET_PAYABLE_DAYS = SUMMARY_COUNT_COLUMNS + 1; // AQ
/** How far past the day columns to look for the band's 'P' header. */
const SUMMARY_SEARCH_SPAN = 10;

/** Excel serial 0. Workbooks using the 1904 system shift this — see parse(). */
const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

const MS_PER_MIN = 60_000;
const MINUTES_PER_DAY = 1440;

// ------------------------------------------------------------- primitives ---

type CellLike = ExcelJS.CellValue;

/**
 * Unwrap the shapes exceljs hands back: formula results, rich text, hyperlinks
 * and shared-string objects all arrive as objects rather than scalars.
 */
function unwrap(v: CellLike): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return unwrap(o.result as CellLike); // formula
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('');
    }
    if ('text' in o) return o.text; // hyperlink
    if ('error' in o) return null; // #REF! etc — treat as blank
    return null;
  }
  return v;
}

function asText(v: CellLike): string {
  const u = unwrap(v);
  if (u === null || u === undefined) return '';
  if (u instanceof Date) return '';
  return String(u).trim();
}

function asNumber(v: CellLike): number | null {
  const u = unwrap(v);
  if (u === null || u === undefined || u === '') return null;
  if (typeof u === 'number') return Number.isFinite(u) ? u : null;
  if (typeof u === 'string') {
    const n = Number(u.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Convert a duration/time cell to whole minutes.
 *
 * exceljs normally resolves these to Date objects anchored at the workbook's
 * epoch, but a raw fraction (0.385416.. = 09:15) shows up when a cell has no
 * date format. Both are supported. Values may legitimately exceed 24h (the
 * month's total-hours cell), so this returns elapsed minutes since the epoch
 * rather than a clock reading.
 */
export function excelValueToMinutes(v: CellLike, date1904 = false): number | null {
  const u = unwrap(v);
  if (u === null || u === undefined || u === '') return null;

  if (u instanceof Date) {
    const epoch = date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
    const mins = Math.round((u.getTime() - epoch) / MS_PER_MIN);
    return Number.isFinite(mins) ? mins : null;
  }
  if (typeof u === 'number') {
    if (!Number.isFinite(u)) return null;
    return Math.round(u * MINUTES_PER_DAY);
  }
  if (typeof u === 'string') {
    // 'HH:MM' / 'HH:MM:SS' typed as text.
    const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(u.trim());
    if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Math.round(Number(m[3]) / 60) : 0);
    const n = Number(u.trim());
    if (Number.isFinite(n)) return Math.round(n * MINUTES_PER_DAY);
  }
  return null;
}

/** A punch is a clock reading; 0 (or blank) means the employee never punched. */
function toPunchMinutes(v: CellLike, date1904: boolean): number | null {
  const mins = excelValueToMinutes(v, date1904);
  if (mins === null || mins <= 0) return null;
  // Normalise to a time-of-day so 'HH:MM' formatting is always valid.
  return ((mins % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Minutes since midnight -> 'HH:MM' (a Postgres `time` literal). */
export function minutesToClock(mins: number | null): string | null {
  if (mins === null) return null;
  const m = ((Math.round(mins) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Trim + uppercase + collapse whitespace, then fold known aliases. */
export function normalizeStatus(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return '';
  if (KNOWN_SET.has(s)) return s;
  if (STATUS_ALIASES[s]) return STATUS_ALIASES[s];
  return s; // unknown — reported as a warning, never thrown
}

export function isKnownStatus(s: string): s is KnownStatus {
  return KNOWN_SET.has(s);
}

/** employees.code convention: 1 -> 'DN001'. */
export function codeForEmplId(id: number): string {
  return `DN${String(id).padStart(3, '0')}`;
}

function pad2(n: number): number | string {
  return String(n).padStart(2, '0');
}

function daysInMonthOf(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// ------------------------------------------------------------ month header ---

/** Resolve B2 (and B1) into a year + 1-indexed month. Fatal if undecidable. */
function readPeriod(
  ws: ExcelJS.Worksheet,
  date1904: boolean,
  warnings: string[],
): { year: number; month1: number } {
  const monthCell = unwrap(ws.getCell(ROW_MONTH, COL_LABEL).value);
  const headerYear = asNumber(ws.getCell(ROW_YEAR, COL_LABEL).value);

  let year: number | null = null;
  let month1: number | null = null;

  if (monthCell instanceof Date) {
    year = monthCell.getUTCFullYear();
    month1 = monthCell.getUTCMonth() + 1;
  } else if (typeof monthCell === 'number' && Number.isFinite(monthCell)) {
    // A bare serial: 46174 -> 2026-06-01.
    const epoch = date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
    const d = new Date(epoch + monthCell * MINUTES_PER_DAY * MS_PER_MIN);
    year = d.getUTCFullYear();
    month1 = d.getUTCMonth() + 1;
  } else if (typeof monthCell === 'string' && monthCell.trim()) {
    const t = monthCell.trim();
    const iso = /^(\d{4})-(\d{1,2})/.exec(t);
    if (iso) {
      year = Number(iso[1]);
      month1 = Number(iso[2]);
    } else {
      const parsed = new Date(`${t} 1, ${headerYear ?? new Date().getUTCFullYear()} UTC`);
      if (!Number.isNaN(parsed.getTime())) {
        year = parsed.getUTCFullYear();
        month1 = parsed.getUTCMonth() + 1;
      }
    }
  }

  if (year === null || month1 === null || month1 < 1 || month1 > 12) {
    throw new Error(
      'Could not read the register month from cell B2. Expected a date such as Jun-26; ' +
        `found ${monthCell === null ? '(blank)' : JSON.stringify(monthCell)}.`,
    );
  }

  // B1 carries the year separately; B2 wins because it carries the month too.
  if (headerYear !== null && headerYear !== year) {
    warnings.push(
      `Year in B1 (${headerYear}) does not match the month in B2 (${year}-${pad2(month1)}). Using ${year}.`,
    );
  }
  return { year, month1 };
}

/** Day columns, read from row 4 rather than assumed, so 28..31-day months work. */
function readDayColumns(ws: ExcelJS.Worksheet): { col: number; day: number }[] {
  const out: { col: number; day: number }[] = [];
  for (let col = COL_FIRST_DAY; col < COL_FIRST_DAY + MAX_DAY_COLUMNS; col++) {
    const n = asNumber(ws.getCell(ROW_DAY_NUMBERS, col).value);
    // Summary headers ('P','T',…) are text, so a non-number ends the day band.
    if (n === null || !Number.isInteger(n) || n < 1 || n > 31) break;
    if (out.length && n !== out[out.length - 1].day + 1) break; // non-contiguous
    out.push({ col, day: n });
  }
  return out;
}

/** Header-driven summary counts, falling back to the documented order. */
const FALLBACK_COUNT_ORDER = ['P', 'T', 'LM', 'S', 'OH', 'L', 'CO', 'HD', 'WO'];

/**
 * Locate the summary band by scanning row 4 past the day columns for the 'P'
 * count header. Returns null when it cannot be found.
 */
function findSummaryBand(ws: ExcelJS.Worksheet, firstCandidate: number): number | null {
  for (let col = firstCandidate; col <= firstCandidate + SUMMARY_SEARCH_SPAN; col++) {
    if (normalizeStatus(asText(ws.getCell(ROW_DAY_NUMBERS, col).value)) === 'P') return col;
  }
  return null;
}

function readCountHeaders(ws: ExcelJS.Worksheet, bandStart: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < SUMMARY_COUNT_COLUMNS; i++) {
    headers.push(normalizeStatus(asText(ws.getCell(ROW_DAY_NUMBERS, bandStart + i).value)));
  }
  return headers.every((h) => !h) ? [...FALLBACK_COUNT_ORDER] : headers;
}

function findLabelledRow(ws: ExcelJS.Worksheet, from: number, to: number, re: RegExp): number | null {
  for (let r = from; r <= to; r++) {
    if (re.test(asText(ws.getCell(r, COL_LABEL).value).toUpperCase())) return r;
  }
  return null;
}

// ----------------------------------------------------------------- parser ---

export async function parseRegisterWorkbook(buf: ArrayBuffer | Buffer): Promise<ParsedRegister> {
  const workbook = new ExcelJS.Workbook();
  const nodeBuf: Buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(new Uint8Array(buf));

  try {
    // exceljs's types want a Buffer; the runtime accepts one.
    await workbook.xlsx.load(nodeBuf as unknown as ExcelJS.Buffer);
  } catch (e) {
    throw new Error(
      `That file could not be opened as an .xlsx workbook: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const ws = workbook.getWorksheet('Sheet1') ?? workbook.worksheets[0];
  if (!ws) throw new Error('The workbook has no worksheets.');

  const warnings: string[] = [];
  const date1904 = Boolean((workbook.properties as { date1904?: boolean } | undefined)?.date1904);
  if (date1904) warnings.push('Workbook uses the 1904 date system; times were converted accordingly.');

  const { year, month1 } = readPeriod(ws, date1904, warnings);
  const periodMonth = `${year}-${pad2(month1)}-01`;
  const calendarDays = daysInMonthOf(year, month1);

  const dayCols = readDayColumns(ws);
  if (dayCols.length === 0) {
    throw new Error(
      'No day columns found on row 4 (expected the numbers 1..30 starting at column C). ' +
        'This does not look like the monthly register.',
    );
  }
  if (dayCols.length !== calendarDays) {
    warnings.push(
      `Row 4 lists ${dayCols.length} day column(s) but ${year}-${pad2(month1)} has ${calendarDays} days. ` +
        'Days outside the real month were ignored.',
    );
  }

  const afterDays = dayCols[dayCols.length - 1].col + 1;
  const found = findSummaryBand(ws, afterDays);
  if (found === null) {
    warnings.push(
      'Could not find the monthly summary headers (P, T, LM, …) to the right of the day columns; ' +
        'per-employee counts and working/payable days were not read. Attendance itself is unaffected.',
    );
  }
  const bandStart = found ?? afterDays;
  const colWorkingDays = bandStart + OFFSET_WORKING_DAYS;
  const colPayableDays = bandStart + OFFSET_PAYABLE_DAYS;
  const countHeaders = readCountHeaders(ws, bandStart);

  const employees: ParsedEmployee[] = [];
  const seenIds = new Map<number, number>(); // emplId -> first row

  const lastRow = Math.max(ws.rowCount, ws.actualRowCount ?? 0);

  for (let r = BLOCK_START_ROW; r <= lastRow; r += BLOCK_STRIDE) {
    const idRaw = asNumber(ws.getCell(r, COL_EMPL_ID).value);

    // Collect statuses first — they decide whether a headerless block is real.
    const rawStatuses = dayCols.map(({ col, day }) => ({
      day,
      raw: asText(ws.getCell(r, col).value),
    }));
    const hasAnyStatus = rawStatuses.some((s) => s.raw !== '');

    // The sheet is padded with hundreds of blank-but-styled rows; skip quietly.
    if (idRaw === null && !hasAnyStatus) continue;

    if (idRaw === null) {
      warnings.push(`Row ${r}: attendance found but the Empl. ID cell (A${r}) is blank — block skipped.`);
      continue;
    }
    if (!Number.isInteger(idRaw) || idRaw <= 0) {
      warnings.push(`Row ${r}: Empl. ID "${idRaw}" is not a positive whole number — block skipped.`);
      continue;
    }
    const emplId = idRaw;

    if (seenIds.has(emplId)) {
      warnings.push(
        `Row ${r}: Empl. ID ${emplId} already appeared at row ${seenIds.get(emplId)} — the later block was skipped.`,
      );
      continue;
    }
    seenIds.set(emplId, r);

    if (!hasAnyStatus) {
      warnings.push(`Empl. ID ${emplId} (row ${r}): no day statuses found — nothing to import.`);
      continue;
    }

    const inRow = findLabelledRow(ws, r + 1, r + BLOCK_STRIDE - 1, /^IN\b/);
    const outRow = findLabelledRow(ws, r + 1, r + BLOCK_STRIDE - 1, /^OUT\b/);
    const totalRow = findLabelledRow(ws, r + 1, r + BLOCK_STRIDE - 1, /^TOTAL/);
    if (inRow === null && outRow === null) {
      warnings.push(`Empl. ID ${emplId} (row ${r}): no In/Out rows found — punch times imported as blank.`);
    }
    // A missing Total-Hrs row used to silently zero worked_minutes for every day,
    // which inflates the payroll shortfall/deduction with no warning. When the
    // Total row is absent but punches exist, worked minutes are derived from
    // out−in below; flag it so the numbers are trusted deliberately, not blindly.
    if (totalRow === null && (inRow !== null || outRow !== null)) {
      warnings.push(
        `Empl. ID ${emplId} (row ${r}): no "Total Hrs" row found — worked minutes were derived from the In/Out punch times.`,
      );
    }

    const days: ParsedDay[] = [];
    const unknownHere = new Map<string, number[]>();

    for (let i = 0; i < dayCols.length; i++) {
      const { col, day } = dayCols[i];
      const { raw } = rawStatuses[i];
      if (!raw) continue; // no status = day not recorded
      if (day > calendarDays) continue; // guarded by the warning above

      const status = normalizeStatus(raw);
      if (!status) continue;
      if (!isKnownStatus(status)) {
        const at = unknownHere.get(raw.trim()) ?? [];
        at.push(day);
        unknownHere.set(raw.trim(), at);
        // Still emitted; the importer decides what to do with it.
      }

      // One bad cell must never sink the block — each read is independently safe.
      const inMin = inRow === null ? null : toPunchMinutes(ws.getCell(inRow, col).value, date1904);
      const outMin = outRow === null ? null : toPunchMinutes(ws.getCell(outRow, col).value, date1904);
      const workedRaw = totalRow === null ? null : excelValueToMinutes(ws.getCell(totalRow, col).value, date1904);

      let workedMin = workedRaw !== null && workedRaw > 0 ? workedRaw : 0;
      // Fallback: no Total-Hrs cell but both punches present — derive out−in so
      // payroll doesn't see a phantom zero. Overnight (out < in) wraps a day.
      if (workedMin === 0 && workedRaw === null && inMin !== null && outMin !== null) {
        const span = outMin >= inMin ? outMin - inMin : outMin + MINUTES_PER_DAY - inMin;
        if (span > 0) workedMin = span;
      }

      days.push({ day, status, inMin, outMin, workedMin });
    }

    for (const [raw, atDays] of unknownHere) {
      warnings.push(
        `Empl. ID ${emplId} (row ${r}): unrecognised status "${raw}" on day ${atDays.join(', ')}.`,
      );
    }

    const counts: Record<string, number> = {};
    for (let i = 0; i < countHeaders.length; i++) {
      const key = countHeaders[i];
      if (!key) continue;
      const n = asNumber(ws.getCell(r, bandStart + i).value);
      if (n !== null) counts[key] = n;
    }

    employees.push({
      emplId,
      code: codeForEmplId(emplId),
      days,
      counts,
      workingDays: asNumber(ws.getCell(r, colWorkingDays).value),
      payableDays: asNumber(ws.getCell(r, colPayableDays).value),
      rowNumber: r,
    });
  }

  if (employees.length === 0) {
    throw new Error(
      `No employee blocks found. Expected an Empl. ID in column A starting at row ${BLOCK_START_ROW}, every ${BLOCK_STRIDE} rows.`,
    );
  }

  return { year, periodMonth, daysInMonth: calendarDays, employees, warnings };
}
