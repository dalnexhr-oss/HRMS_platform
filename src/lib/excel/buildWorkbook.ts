// ============================================================================
// Server-only .xlsx builders (exceljs write path). SERVER ONLY — never import
// into a client component; exceljs pulls in Node APIs. Server Actions call these
// and hand the bytes to the browser as base64 (see actions/export.ts).
//
// The read path (parseRegister.ts) and this write path both use exceljs, which
// is already a dependency — no new packages.
// ============================================================================
import ExcelJS from 'exceljs';
import { minutesToHHMM } from '@/lib/format';
import type { PayslipRow } from '@/types/domain';
import type { RegisterEmployee } from '@/types/domain';

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

// ------------------------------------------------------------------ payroll ---

export async function payrollWorkbook(
  payslips: PayslipRow[],
  periodMonth: string,
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

  const money = '#,##0';
  for (const p of payslips) {
    ws.addRow({
      code: p.code,
      name: p.name,
      branch: p.branch,
      state: p.state,
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

  // Totals row.
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

  // Money number format on the currency columns (F..P == 6..16).
  for (let c = 6; c <= 16; c++) ws.getColumn(c).numFmt = money;

  return toBytes(wb);
}

// ----------------------------------------------------------------- register ---

export async function registerWorkbook(
  employees: RegisterEmployee[],
  days: number[],
  periodMonth: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet(`Register ${monthTitle(periodMonth)}`);

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
  // Per-day status columns.
  const dayCols = days.map((d) => ({ header: String(d), key: `d${d}`, width: 4 }));
  ws.columns = [...fixed, ...dayCols];
  styleHeader(ws.getRow(1));

  for (const e of employees) {
    const byDay = new Map(e.days.map((c) => [c.day, c.status]));
    const row: Record<string, string | number> = {
      code: e.code,
      name: e.name,
      branch: e.branch,
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

  return toBytes(wb);
}
