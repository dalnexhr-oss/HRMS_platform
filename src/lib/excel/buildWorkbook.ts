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
import type { PayslipRow, RegisterEmployee, DayCell } from '@/types/domain';
// Type-only import: erased at compile time, so this file stays free of the
// server-only modules queries.ts pulls in.
import type { ReimbursementView } from '@/lib/queries';

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
  ws: ExcelJS.Worksheet,
  employees: RegisterEmployee[],
  days: number[],
): void {
  const fixed = [
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
  ];
  ws.columns = [...fixed, ...days.map((d) => ({ header: String(d), key: `d${d}`, width: 4 }))];
  styleHeader(ws.getRow(1));

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
  ws: ExcelJS.Worksheet,
  employees: RegisterEmployee[],
  periodMonth: string,
): void {
  ws.columns = [
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
  styleHeader(ws.getRow(1));

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

  writeReferenceSheet(wb.addWorksheet('Register'), employees, days, periodMonth);
  writeFlatSummarySheet(wb.addWorksheet('Summary'), employees, days);
  writeDailyPunchSheet(wb.addWorksheet('Daily punches'), employees, periodMonth);

  return toBytes(wb);
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
  if (employees.length === 0) wb.addWorksheet('Attendance');

  employees.forEach((e, ix) => {
    const ws = wb.addWorksheet(safeSheetName(e.code || e.name, `Employee ${ix + 1}`));

    ws.mergeCells('A1:F1');
    const heading = ws.getCell('A1');
    heading.value = `Monthly attendance · ${title}`;
    heading.font = { bold: true, size: 13 };

    ws.getCell('A2').value = 'Name';
    ws.getCell('B2').value = safeText(e.name);
    ws.getCell('D2').value = 'Branch';
    ws.getCell('E2').value = safeText(e.branch);
    ws.getCell('A3').value = 'Code';
    ws.getCell('B3').value = safeText(e.code);
    ws.getCell('D3').value = 'Month';
    ws.getCell('E3').value = title;
    for (const addr of ['A2', 'D2', 'A3', 'D3']) ws.getCell(addr).font = { bold: true };

    const headerRowIx = 5;
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

  ws.columns = [
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
    { header: 'Status', key: 'status', width: 11 },
  ];
  styleHeader(ws.getRow(1));

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

  ws.columns = [
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
  styleHeader(ws.getRow(1));

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
    writeDailyPunchSheet(wb.addWorksheet('Daily punches'), register, periodMonth);
  }

  return toBytes(wb);
}
