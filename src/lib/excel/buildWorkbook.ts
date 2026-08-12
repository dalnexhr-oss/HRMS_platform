// ============================================================================
// Server-only .xlsx builders (exceljs write path). SERVER ONLY — never import
// into a client component; exceljs pulls in Node APIs. Server Actions call these
// and hand the bytes to the browser as base64 (see actions/export.ts).
//
// The register export reproduces the COMPANY'S OWN register layout (the one
// parseRegister.ts reads), so an exported file can be re-imported unchanged:
//   B1 year · B2 month · row 3 weekday names · row 4 day numbers + summary
//   headers · row 5 'Empl. ID' · rows 6+ employee blocks with STRIDE 4:
//     k+0  A=Empl. ID, B=Name, day cols = status, then counts / working / payable
//     k+1  B='In'                   day cols = punch-in
//     k+2  B='Out'                  day cols = punch-out
//     k+3  B='Total Hrs Completed'  day cols = hours worked
// ============================================================================
import ExcelJS from 'exceljs';
import { minutesToHHMM } from '@/lib/format';
import {
  STATUS_FILL,
  HEADER_FILL,
  TIME_FORMAT,
  clockToExcelTime,
} from '@/lib/excel/registerStyle';
import { writeBrandHeader, writeBrandOverlay } from '@/lib/excel/brand';
// Pure module — same label the Today board's <Stamp> renders.
import { statusMeta } from '@/lib/constants';
import type { PayslipRow, PunchLogRow, RegisterEmployee, DayCell } from '@/types/domain';
// Type-only import: erased at compile time, so this file stays free of the
// server-only modules queries.ts pulls in.
import type { ReimbursementView } from '@/lib/queries';
import type { LeaveSalaryViewRow } from '@/lib/leave-salary-view';
// Pure module (no server deps) — safe here for the same reason inr/minutesToHHMM are.
import { effectiveFigures } from '@/lib/leave-salary';

/** 'YYYY-MM-01' -> 'June 2026'. */
export function monthTitle(periodMonth: string): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function toBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9E1' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBB6AA' } } };
  });
}

/** Paint one cell with a solid fill (+ optional bold), the reference sheet's idiom. */
function paint(cell: ExcelJS.Cell, argb: string, bold = true): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  cell.font = { bold, color: { argb: 'FF000000' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/**
 * Neutralise spreadsheet formula injection.
 *
 * Excel executes any cell whose text begins with = + - @ (or a leading tab/CR),
 * so an employee named `=HYPERLINK("http://evil","click")` — or a reimbursement
 * remark — becomes a live formula in whatever HR opens. Prefixing a single quote
 * makes Excel treat it as literal text; the visible value is unchanged.
 */
function safeText(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// ---------------------------------------------------------------- geometry ---
// Mirrors parseRegister.ts so the two stay in lockstep.
const ROW_YEAR = 1;
const ROW_MONTH = 2;
const ROW_WEEKDAYS = 3;
const ROW_DAY_NUMBERS = 4;
const ROW_EMPL_ID_LABEL = 5;
const BLOCK_START_ROW = 6;
const BLOCK_STRIDE = 4;
const COL_EMPL_ID = 1; // A
const COL_LABEL = 2; // B
const COL_FIRST_DAY = 3; // C

/** The 9 summary count columns, in the register's own order. */
const COUNT_ORDER = ['P', 'T', 'LM', 'S', 'OH', 'L', 'CO', 'HD', 'WO'] as const;

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayFor(periodMonth: string, day: number): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-${String(day).padStart(2, '0')}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : DOW_SHORT[d.getUTCDay()];
}

/** 'DN001' -> 1, so the exported Empl. ID column round-trips through the parser. */
function emplIdOf(code: string): number | string {
  const m = /(\d+)\s*$/.exec(code);
  return m ? Number(m[1]) : code;
}

/** Count each status across the employee's day cells. */
function countStatuses(days: DayCell[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of COUNT_ORDER) counts[key] = 0;
  for (const d of days) {
    if (d.status in counts) counts[d.status] += 1;
  }
  return counts;
}

// ------------------------------------------------- register (reference form) ---

function writeReferenceSheet(
  ws: ExcelJS.Worksheet,
  employees: RegisterEmployee[],
  days: number[],
  periodMonth: string,
): void {
  const year = Number(periodMonth.slice(0, 4));
  const lastDayCol = COL_FIRST_DAY + days.length - 1;
  const bandStart = lastDayCol + 1;

  // Header block — colours lifted from the reference sheet.
  const yearCell = ws.getCell(ROW_YEAR, COL_LABEL);
  yearCell.value = year;
  paint(yearCell, HEADER_FILL.period);

  const monthCell = ws.getCell(ROW_MONTH, COL_LABEL);
  monthCell.value = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  monthCell.numFmt = 'mmm-yy';
  paint(monthCell, HEADER_FILL.period);

  days.forEach((d, i) => {
    const wd = ws.getCell(ROW_WEEKDAYS, COL_FIRST_DAY + i);
    wd.value = weekdayFor(periodMonth, d);
    paint(wd, HEADER_FILL.weekday);

    const dn = ws.getCell(ROW_DAY_NUMBERS, COL_FIRST_DAY + i);
    dn.value = d;
    dn.font = { bold: true };
    dn.alignment = { horizontal: 'center' };
  });

  COUNT_ORDER.forEach((key, i) => {
    const c = ws.getCell(ROW_DAY_NUMBERS, bandStart + i);
    c.value = key;
    paint(c, HEADER_FILL.summary);
  });
  ws.getCell(ROW_DAY_NUMBERS, bandStart + COUNT_ORDER.length).value = 'Working Days';
  ws.getCell(ROW_DAY_NUMBERS, bandStart + COUNT_ORDER.length + 1).value =
    'to pay for (Working days + official Holidays + WO)';
  paint(ws.getCell(ROW_DAY_NUMBERS, bandStart + COUNT_ORDER.length), HEADER_FILL.summary);
  paint(ws.getCell(ROW_DAY_NUMBERS, bandStart + COUNT_ORDER.length + 1), HEADER_FILL.summary);

  const idCell = ws.getCell(ROW_EMPL_ID_LABEL, COL_EMPL_ID);
  idCell.value = 'Empl. ID';
  paint(idCell, HEADER_FILL.emplId);
  const nameCell = ws.getCell(ROW_EMPL_ID_LABEL, COL_LABEL);
  nameCell.value = 'Name';
  paint(nameCell, HEADER_FILL.emplId);

  // Employee blocks.
  employees.forEach((e, ix) => {
    const top = BLOCK_START_ROW + ix * BLOCK_STRIDE;
    const byDay = new Map(e.days.map((c) => [c.day, c]));

    ws.getCell(top, COL_EMPL_ID).value = emplIdOf(e.code);
    const blockName = ws.getCell(top, COL_LABEL);
    blockName.value = safeText(e.name);
    paint(blockName, HEADER_FILL.blockLabel);
    blockName.alignment = { horizontal: 'left', vertical: 'middle' };

    ws.getCell(top + 1, COL_LABEL).value = 'In';
    ws.getCell(top + 2, COL_LABEL).value = 'Out';
    ws.getCell(top + 3, COL_LABEL).value = 'Total Hrs Completed';
    ws.getRow(top).font = { bold: true };

    days.forEach((d, i) => {
      const col = COL_FIRST_DAY + i;
      const cell = byDay.get(d);

      // Status: bold black on the reference sheet's fill for that code.
      const statusCell = ws.getCell(top, col);
      statusCell.value = cell?.status ?? '';
      if (cell?.status && STATUS_FILL[cell.status]) {
        paint(statusCell, STATUS_FILL[cell.status]);
      }

      // Punches as REAL Excel times formatted h:mm, matching the reference —
      // and still re-importable, since excelValueToMinutes() handles both a
      // numeric serial and the Date exceljs hands back for a formatted cell.
      for (const [offset, clock] of [
        [1, cell?.in ?? null],
        [2, cell?.out ?? null],
        [3, cell?.hours ?? null],
      ] as [number, string | null][]) {
        const c = ws.getCell(top + offset, col);
        const serial = clockToExcelTime(clock);
        if (serial === null) {
          c.value = '';
        } else {
          c.value = serial;
          c.numFmt = TIME_FORMAT;
        }
        c.alignment = { horizontal: 'center' };
      }
    });

    const counts = countStatuses(e.days);
    COUNT_ORDER.forEach((key, i) => {
      ws.getCell(top, bandStart + i).value = counts[key];
    });
    ws.getCell(top, bandStart + COUNT_ORDER.length).value = e.summary.working;
    ws.getCell(top, bandStart + COUNT_ORDER.length + 1).value = e.summary.payable;
  });

  // Column widths: narrow day columns, wider identity columns.
  ws.getColumn(COL_EMPL_ID).width = 9;
  ws.getColumn(COL_LABEL).width = 22;
  for (let c = COL_FIRST_DAY; c <= lastDayCol; c++) ws.getColumn(c).width = 7;
  for (let i = 0; i < COUNT_ORDER.length; i++) ws.getColumn(bandStart + i).width = 5;
  ws.getColumn(bandStart + COUNT_ORDER.length).width = 12;
  ws.getColumn(bandStart + COUNT_ORDER.length + 1).width = 14;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: ROW_DAY_NUMBERS }];
}

function writeFlatSummarySheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  employees: RegisterEmployee[],
  days: number[],
  periodMonth: string,
): void {
  const columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Branch', key: 'branch', width: 11 },
    { header: 'P', key: 'P', width: 5 },
    { header: 'LM', key: 'LM', width: 5 },
    { header: 'HD', key: 'HD', width: 5 },
    { header: 'L', key: 'L', width: 5 },
    { header: 'WO', key: 'WO', width: 5 },
    { header: 'Working', key: 'working', width: 8 },
    { header: 'Payable', key: 'payable', width: 8 },
    { header: 'Worked hrs', key: 'worked', width: 10 },
    { header: 'Target hrs', key: 'target', width: 10 },
    ...days.map((d) => ({ header: String(d), key: `d${d}`, width: 4 })),
  ];
  // key+width only — a `header` here would land in row 1, over the brand band.
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, {
    title: `Attendance summary — ${monthTitle(periodMonth)}`,
  });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  for (const e of employees) {
    const byDay = new Map(e.days.map((c) => [c.day, c.status]));
    const row: Record<string, string | number> = {
      code: safeText(e.code),
      name: safeText(e.name),
      branch: safeText(e.branch),
      P: e.summary.P,
      LM: e.summary.LM,
      HD: e.summary.HD,
      L: e.summary.L,
      WO: e.summary.WO,
      working: e.summary.working,
      payable: e.summary.payable,
      worked: minutesToHHMM(e.workedMinutes),
      target: minutesToHHMM(e.targetMinutes),
    };
    for (const d of days) row[`d${d}`] = byDay.get(d) ?? '';
    ws.addRow(row);
  }
}

/** Per-employee-per-day punch detail: date, status, in, out, total. */
export function writeDailyPunchSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  employees: RegisterEmployee[],
  periodMonth: string,
): void {
  const columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Branch', key: 'branch', width: 11 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day', key: 'dow', width: 6 },
    { header: 'Status', key: 'status', width: 8 },
    { header: 'Punch in', key: 'in', width: 10 },
    { header: 'Punch out', key: 'out', width: 10 },
    { header: 'Total hrs', key: 'hours', width: 10 },
  ];
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, {
    title: `Daily punches — ${monthTitle(periodMonth)}`,
  });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  const ym = periodMonth.slice(0, 7);
  for (const e of employees) {
    for (const c of [...e.days].sort((a, b) => a.day - b.day)) {
      ws.addRow({
        code: safeText(e.code),
        name: safeText(e.name),
        branch: safeText(e.branch),
        date: `${ym}-${String(c.day).padStart(2, '0')}`,
        dow: weekdayFor(periodMonth, c.day),
        status: c.status,
        in: c.in ?? '',
        out: c.out ?? '',
        hours: c.hours ?? '',
      });
    }
  }
}

/**
 * Float the logo over the reference sheet WITHOUT moving anything. The layout
 * is parsed back by parseRegister.ts (B1 year, B2 month, row 4 day numbers,
 * blocks from row 6), so no row may be inserted and no cell written. A floating
 * drawing lives in the sheet's drawing part, not sheetData, and row heights are
 * cosmetic — the parser reads neither.
 */
function brandReferenceSheet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet): void {
  ws.getRow(ROW_YEAR).height = 22;
  ws.getRow(ROW_MONTH).height = 22;
  // Column C onward, rows 1–2: empty in both the export and the blank template.
  writeBrandOverlay(wb, ws, { col: COL_FIRST_DAY - 1, row: 0, height: 44 });
}

/**
 * The register export: the company's own layout first (re-importable), then a
 * flat one-row-per-employee summary, then per-day punch detail.
 */
export async function registerWorkbook(
  employees: RegisterEmployee[],
  days: number[],
  periodMonth: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';

  const ref = wb.addWorksheet('Register');
  writeReferenceSheet(ref, employees, days, periodMonth);
  brandReferenceSheet(wb, ref);
  writeFlatSummarySheet(wb, wb.addWorksheet('Summary'), employees, days, periodMonth);
  writeDailyPunchSheet(wb, wb.addWorksheet('Daily punches'), employees, periodMonth);

  return toBytes(wb);
}

// ------------------------------------------- register IMPORT template ---
// A blank version of the register above, for HR/Admin to fill in and upload
// back through the Import tab. It is built by the SAME writeReferenceSheet() the
// register export uses — the one parseRegister.ts round-trips against — so the
// template's structure can never drift from what the importer expects. It is a
// run of empty employee blocks (labelled In/Out/Total rows) ready to complete.

/** Days-of-month [1..N] for a 'YYYY-MM-01'. Local mirror of export.ts's daysOf. */
function daysOfMonth(periodMonth: string): number[] {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Code → human label, for the template's legend. Keep in step with KNOWN_STATUSES. */
const STATUS_LEGEND: [string, string][] = [
  ['P', 'Present'],
  ['HD', 'Half day'],
  ['L', 'Leave'],
  ['LM', 'Late mark'],
  ['WO', 'Week off'],
  ['OH', 'Official holiday'],
  ['CO', 'Comp off'],
  ['S', 'Site'],
  ['T', 'Travel'],
  ['AB', 'Absent'],
];

/** An empty employee block — labelled In/Out/Total rows with nothing to fill yet. */
function blankBlock(i: number): RegisterEmployee {
  return {
    id: `blank-${i}`,
    code: '',
    name: '',
    branch: '',
    gender: 'Male',
    doj: '',
    summary: { P: 0, LM: 0, HD: 0, L: 0, WO: 0, working: 0, payable: 0 },
    workedMinutes: 0,
    targetMinutes: 0,
    days: [],
  };
}

/**
 * The import template workbook: a "Register" sheet in the exact upload layout
 * (`blankBlocks` empty employee blocks) plus a "How to fill this in" sheet with
 * the column guide and status legend.
 */
export async function registerImportTemplateWorkbook(
  periodMonth: string,
  blankBlocks = 20,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';

  const days = daysOfMonth(periodMonth);
  const employees: RegisterEmployee[] = Array.from({ length: blankBlocks }, (_, i) => blankBlock(i));

  const ref = wb.addWorksheet('Register');
  writeReferenceSheet(ref, employees, days, periodMonth);
  brandReferenceSheet(wb, ref);
  writeTemplateGuideSheet(wb, wb.addWorksheet('How to fill this in'), periodMonth);

  return toBytes(wb);
}

/** The instruction + legend sheet that accompanies the blank register. */
function writeTemplateGuideSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  periodMonth: string,
): void {
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 68;

  // The old A1 title is folded into the band; addRow then appends from row 4.
  writeBrandHeader(wb, ws, {
    title: `Register import template — ${monthTitle(periodMonth)}`,
  });

  const lines: [string, string][] = [
    ['', ''],
    ['Before you start', 'Fill in the "Register" sheet, then upload it in the Import tab. A preview shows exactly what will be written before anything is saved.'],
    ['', ''],
    ['Month (cell B2)', `Set to the month you are importing. This template is set to ${monthTitle(periodMonth)}. Cell B1 holds the year.`],
    ['Day columns (row 4)', 'One column per day of the month (1..31), already laid out. Do not add or remove day columns.'],
    ['Empl. ID (column A)', 'A whole number that maps to the employee code: 1 → DN001, 47 → DN047, and so on. Put it on the FIRST row of each 4-row block.'],
    ['Name (column B)', 'For your reference only — matching is by Empl. ID, not name.'],
    ['', ''],
    ['Each employee = 4 rows', 'Row 1: day status codes (see legend below). Row 2 (In): punch-in time. Row 3 (Out): punch-out time. Row 4 (Total Hrs Completed): hours worked.'],
    ['Time format', 'Use 24-hour h:mm, e.g. 09:30 or 18:45. Leave blank if there was no punch.'],
    ['Blank days', 'Leave the status cell empty for days you are not recording — they are simply skipped.'],
    ['', ''],
    ['If something is wrong', 'The preview lists the affected Empl. ID / row and the reason (unknown status code, unmatched Empl. ID, missing In/Out, …). Fix the sheet and re-upload — nothing is saved until you confirm.'],
    ['', ''],
    ['Status codes', 'Enter these codes in the status row (row 1 of each block):'],
  ];

  for (const [k, v] of lines) {
    const row = ws.addRow([k, v]);
    if (k) row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  for (const [code, label] of STATUS_LEGEND) {
    const row = ws.addRow([code, label]);
    row.getCell(1).font = { bold: true };
    if (STATUS_FILL[code]) paint(row.getCell(1), STATUS_FILL[code]);
  }
}

// ------------------------------------------------- attendance template ---

/** Sanitise a string into a valid Excel sheet name (≤31 chars, no []:*?/\). */
function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

/**
 * A monthly attendance template — ONE worksheet per employee, the pay period
 * day-by-day (Date/Day/Status/In/Out/Hours) with a summary footer. Intended to
 * be handed out from /payroll alongside the payslips.
 */
export async function attendanceTemplateWorkbook(
  employees: RegisterEmployee[],
  periodMonth: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ym = periodMonth.slice(0, 7);
  const title = monthTitle(periodMonth);

  // exceljs writes an invalid file with zero worksheets — guard the empty case.
  if (employees.length === 0) {
    writeBrandHeader(wb, wb.addWorksheet('Attendance'), {
      title: `Monthly attendance · ${title}`,
    });
  }

  employees.forEach((e, ix) => {
    const ws = wb.addWorksheet(safeSheetName(e.code || e.name, `Employee ${ix + 1}`));

    // Rows 1–3 are the brand band (which carries the old A1 heading); the
    // employee meta block sits below it at rows 5–6.
    writeBrandHeader(wb, ws, { title: `Monthly attendance · ${title}` });

    ws.getCell('A5').value = 'Name';
    ws.getCell('B5').value = safeText(e.name);
    ws.getCell('D5').value = 'Branch';
    ws.getCell('E5').value = safeText(e.branch);
    ws.getCell('A6').value = 'Code';
    ws.getCell('B6').value = safeText(e.code);
    ws.getCell('D6').value = 'Month';
    ws.getCell('E6').value = title;
    for (const addr of ['A5', 'D5', 'A6', 'D6']) ws.getCell(addr).font = { bold: true };

    const headerRowIx = 8;
    const header = ws.getRow(headerRowIx);
    header.values = ['Date', 'Day', 'Status', 'In', 'Out', 'Hours'];
    styleHeader(header);

    for (const c of [...e.days].sort((a, b) => a.day - b.day)) {
      ws.addRow([
        `${ym}-${String(c.day).padStart(2, '0')}`,
        weekdayFor(periodMonth, c.day),
        c.status,
        c.in ?? '',
        c.out ?? '',
        c.hours ?? '',
      ]);
    }

    const counts = countStatuses(e.days);
    ws.addRow([]);
    const summary = ws.addRow([
      'Summary',
      `Present ${counts.P}`,
      `WO ${counts.WO}`,
      `Holidays ${counts.OH}`,
      `Leave ${counts.L}`,
      `Working ${e.summary.working} · Payable ${e.summary.payable}`,
    ]);
    summary.font = { bold: true };

    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 6;
    ws.getColumn(3).width = 8;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 12;
    ws.views = [{ state: 'frozen', ySplit: headerRowIx }];
  });

  return toBytes(wb);
}

// ----------------------------------------------------------- reimbursements ---

const PURPOSE_LABEL: Record<string, string> = {
  travel: 'Travel',
  material_purchase: 'Material purchase',
  other: 'Other expenses',
};

/** The claim sheet, column-for-column as the business records it. */
export async function reimbursementsWorkbook(
  claims: ReimbursementView[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet('Reimbursement claims');

  const columns = [
    { header: 'Sr. No.', key: 'sr', width: 7 },
    { header: 'Employee', key: 'employee', width: 22 },
    { header: 'Code', key: 'code', width: 9 },
    { header: 'Description', key: 'description', width: 34 },
    { header: 'Purpose', key: 'purpose', width: 18 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Source/Medium', key: 'source', width: 18 },
    { header: 'Kms', key: 'kms', width: 8 },
    { header: 'Mode of payment', key: 'mode', width: 16 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 30 },
    { header: 'Status', key: 'status', width: 13 },
    // Review/payment trail: without these the export could not answer "why was
    // this rejected?" or "when was it actually paid?", which is the whole point
    // of an audit export. All are populated from migration 0020/0035 columns and
    // fall back to blank on a database where those are not applied yet.
    { header: 'Review remark', key: 'reviewRemark', width: 32 },
    { header: 'Receipt', key: 'receipt', width: 10 },
    { header: 'Finance reviewed', key: 'financeReviewed', width: 18 },
    { header: 'Paid on', key: 'paidAt', width: 14 },
    { header: 'Payment ref', key: 'paymentRef', width: 20 },
  ];
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, { title: 'Reimbursement claims' });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  /** '2026-07-27T10:20:00Z' -> '2026-07-27'; blank when absent. */
  const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '');

  claims.forEach((c, ix) => {
    ws.addRow({
      sr: ix + 1,
      employee: safeText(c.employeeName),
      code: safeText(c.employeeCode),
      description: safeText(c.description),
      purpose: PURPOSE_LABEL[c.purpose] ?? c.purpose,
      date: c.claimDate,
      source: safeText(c.sourceMedium ?? ''),
      kms: c.kms ?? '',
      mode: safeText(c.modeOfPayment ?? ''),
      amount: c.amount,
      remarks: safeText(c.remarks ?? ''),
      status: c.status,
      reviewRemark: safeText(c.reviewRemark ?? ''),
      // The path itself is an internal storage key and useless in a sheet — what
      // an auditor needs to know is whether a receipt exists at all.
      receipt: c.receiptPath ? 'Yes' : '',
      financeReviewed: day(c.financeReviewedAt),
      paidAt: day(c.paidAt),
      paymentRef: safeText(c.paymentRef ?? ''),
    });
  });

  // No TOTAL row and no calculation footnote — HR asked for a clean claim list
  // that drops straight into their own sheet without stray summary lines.
  ws.getColumn(8).numFmt = '#,##0.0';
  ws.getColumn(10).numFmt = '#,##0.00';

  return toBytes(wb);
}

// ------------------------------------------------------------------ payroll ---

export async function payrollWorkbook(
  payslips: PayslipRow[],
  periodMonth: string,
  /** Register rows for the same month, so payroll carries each day's in/out. */
  register: RegisterEmployee[] = [],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet(`Payroll ${monthTitle(periodMonth)}`);

  const columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Branch', key: 'branch', width: 12 },
    { header: 'State', key: 'state', width: 12 },
    { header: 'Payable days', key: 'payableDays', width: 12 },
    { header: 'Earned gross', key: 'earnedGross', width: 13 },
    { header: 'Basic earned', key: 'basicEarned', width: 13 },
    { header: 'HRA earned', key: 'hraEarned', width: 12 },
    { header: 'Special earned', key: 'specialEarned', width: 13 },
    { header: 'Shortfall ₹', key: 'shortfallAmount', width: 11 },
    { header: 'PF (emp)', key: 'pfEmployee', width: 10 },
    { header: 'PF (er)', key: 'pfEmployer', width: 10 },
    { header: 'ESIC (emp)', key: 'esicEmployee', width: 11 },
    { header: 'ESIC (er)', key: 'esicEmployer', width: 10 },
    { header: 'Prof. tax', key: 'professionalTax', width: 10 },
    { header: 'Net payable', key: 'netPayable', width: 13 },
  ];
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, {
    title: `Payroll — ${monthTitle(periodMonth)}`,
  });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  for (const p of payslips) {
    ws.addRow({
      code: safeText(p.code),
      name: safeText(p.name),
      branch: safeText(p.branch),
      state: safeText(p.state),
      payableDays: p.payableDays,
      earnedGross: p.earnedGross,
      basicEarned: p.basicEarned,
      hraEarned: p.hraEarned,
      specialEarned: p.specialEarned,
      shortfallAmount: p.shortfallAmount,
      pfEmployee: p.pfEmployee,
      pfEmployer: p.pfEmployer,
      esicEmployee: p.esicEmployee,
      esicEmployer: p.esicEmployer,
      professionalTax: p.professionalTax,
      netPayable: p.netPayable,
    });
  }

  const sum = (k: keyof PayslipRow) => payslips.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const totals = ws.addRow({
    name: `TOTAL · ${payslips.length} employee${payslips.length === 1 ? '' : 's'}`,
    earnedGross: sum('earnedGross'),
    basicEarned: sum('basicEarned'),
    hraEarned: sum('hraEarned'),
    specialEarned: sum('specialEarned'),
    shortfallAmount: sum('shortfallAmount'),
    pfEmployee: sum('pfEmployee'),
    pfEmployer: sum('pfEmployer'),
    esicEmployee: sum('esicEmployee'),
    esicEmployer: sum('esicEmployer'),
    professionalTax: sum('professionalTax'),
    netPayable: sum('netPayable'),
  });
  totals.font = { bold: true };
  for (let c = 6; c <= 16; c++) ws.getColumn(c).numFmt = '#,##0';

  // Each day's login/logout alongside the payroll figures, for verification.
  if (register.length > 0) {
    writeDailyPunchSheet(wb, wb.addWorksheet('Daily punches'), register, periodMonth);
  }

  return toBytes(wb);
}

// ------------------------------------------------------------- leave salary ---

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The annual leave-salary working, one row per employee — the owner's sheet
 * shape, widened from one employee to the roster. Finalized/paid rows carry
 * their frozen snapshot, drafts the live figures (effectiveFigures — the same
 * rule the page table renders by, so the sheet always equals the screen).
 */
export async function leaveSalaryWorkbook(
  rows: LeaveSalaryViewRow[],
  year: number,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet(`Leave salary ${year}`);

  const columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Salary before', key: 'salaryBefore', width: 13 },
    { header: 'Salary after', key: 'salaryAfter', width: 13 },
    { header: 'Increment from', key: 'incrementFrom', width: 14 },
    { header: 'Months (before)', key: 'monthsP1', width: 14 },
    { header: 'Days (before)', key: 'daysP1', width: 12 },
    { header: 'Present (before)', key: 'presentP1', width: 14 },
    { header: 'Entitled (before)', key: 'entitledP1', width: 14 },
    { header: 'Payable (before)', key: 'payableP1', width: 14 },
    { header: 'Months (after)', key: 'monthsP2', width: 13 },
    { header: 'Days (after)', key: 'daysP2', width: 11 },
    { header: 'Present (after)', key: 'presentP2', width: 13 },
    { header: 'Entitled (after)', key: 'entitledP2', width: 13 },
    { header: 'Payable (after)', key: 'payableP2', width: 13 },
    { header: 'Total leave salary', key: 'total', width: 16 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Remarks', key: 'remarks', width: 30 },
  ];
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, { title: `Leave salary — ${year}` });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  for (const r of rows) {
    const fig = effectiveFigures(r.working, r.live);
    const monthsP1 = r.incrementMonth - 1;
    const monthsP2 = 12 - monthsP1;
    ws.addRow({
      code: safeText(r.code),
      name: safeText(r.name),
      salaryBefore: r.salaryBefore,
      salaryAfter: r.salaryAfter,
      incrementFrom: `${MONTH_SHORT[r.incrementMonth - 1]} ${year}`,
      monthsP1,
      daysP1: fig.calendarDaysP1,
      presentP1: fig.presentP1,
      // Entitled is deterministic from salary and months — (salary/2) × m/12 —
      // so it is derived here rather than stored, exactly the owner's B5/B6.
      entitledP1: Math.round((r.salaryBefore / 2) * (monthsP1 / 12) * 100) / 100,
      payableP1: fig.amountP1,
      monthsP2,
      daysP2: fig.calendarDaysP2,
      presentP2: fig.presentP2,
      entitledP2: Math.round((r.salaryAfter / 2) * (monthsP2 / 12) * 100) / 100,
      payableP2: fig.amountP2,
      total: fig.total,
      status: r.working ? r.working.status : 'draft',
      remarks: safeText(r.remarks),
    });
  }

  const sum = (pick: (r: LeaveSalaryViewRow) => number) =>
    Math.round(rows.reduce((a, r) => a + pick(r), 0) * 100) / 100;
  const totals = ws.addRow({
    name: `TOTAL · ${rows.length} employee${rows.length === 1 ? '' : 's'}`,
    payableP1: sum((r) => effectiveFigures(r.working, r.live).amountP1),
    payableP2: sum((r) => effectiveFigures(r.working, r.live).amountP2),
    total: sum((r) => effectiveFigures(r.working, r.live).total),
  });
  totals.font = { bold: true };

  // Money columns; presence keeps one decimal for half-days.
  for (const key of ['salaryBefore', 'salaryAfter', 'entitledP1', 'payableP1', 'entitledP2', 'payableP2', 'total']) {
    ws.getColumn(key).numFmt = '#,##0.00';
  }
  for (const key of ['presentP1', 'presentP2']) ws.getColumn(key).numFmt = '#,##0.0';

  return toBytes(wb);
}

// ---------------------------------------------------------------- punch log ---

/**
 * The Today board's punch log — same columns the on-screen table (and the old
 * CSV export) shows, statusMeta giving the same label the <Stamp> renders.
 */
export async function punchLogWorkbook(
  rows: PunchLogRow[],
  /** The log's business date (Asia/Kolkata, 'YYYY-MM-DD'). */
  date: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet('Punch log');

  const columns = [
    { header: 'Emp', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Branch', key: 'branch', width: 12 },
    { header: 'In', key: 'in', width: 10 },
    { header: 'Out', key: 'out', width: 10 },
    { header: 'Active', key: 'active', width: 10 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  ws.columns = columns.map(({ key, width }) => ({ key, width }));
  const headerRow = writeBrandHeader(wb, ws, { title: `Punch log — ${date}` });
  const hr = ws.getRow(headerRow);
  hr.values = columns.map((c) => c.header);
  styleHeader(hr);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  for (const r of rows) {
    const [label] = statusMeta(r.status);
    ws.addRow({
      code: safeText(r.code),
      name: safeText(r.name),
      branch: safeText(r.branch),
      in: r.in ?? '',
      out: r.out ?? '',
      active: r.active ?? '',
      status: label,
    });
  }

  return toBytes(wb);
}
