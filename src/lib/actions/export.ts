'use server';

// ============================================================================
// .xlsx export Server Actions. Build the workbook on the server (exceljs is
// server-only) and return the bytes as base64 for the client to download. Both
// exports carry payroll/attendance data, so they are staff-gated.
// ============================================================================
import {
  getPayslips,
  getPunchLogToday,
  getRegister,
  getReimbursements,
  currentPeriodMonth,
} from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';
import {
  attendanceTemplateWorkbook,
  leaveSalaryWorkbook,
  payrollWorkbook,
  punchLogWorkbook,
  registerWorkbook,
  registerImportTemplateWorkbook,
  reimbursementsWorkbook,
} from '@/lib/excel/buildWorkbook';
import { buildLeaveSalaryView } from '@/lib/leave-salary-view';
import {
  getStatutoryRows,
  buildPfEcr,
  buildEsicXlsx,
  buildPtXlsx,
} from '@/lib/statutory/statutory';
import { requireRoles, requireStaff } from '@/lib/actions/_guard';

export type ExportResult =
  | { ok: true; filename: string; base64: string; mime?: string }
  | { ok: false; error: string };

const TEXT_MIME = 'text/plain;charset=utf-8';

function b64(bytes: Uint8Array): string {
  // Node Buffer is available in the Server Action runtime.
  return Buffer.from(bytes).toString('base64');
}

/** Days-of-month [1..N] for the given 'YYYY-MM-01'. */
function daysOf(periodMonth: string): number[] {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => i + 1);
}

export async function exportPayrollXlsx(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting payroll');
  if (!gate.ok) return gate;
  try {
    // The register is fetched alongside the payslips so the workbook carries each
    // day's punch in/out on a second sheet — payroll can be verified against the
    // attendance it was computed from without opening a second file.
    const [payslips, register] = await Promise.all([
      getPayslips(periodMonth),
      getRegister(periodMonth),
    ]);
    if (payslips.length === 0) return { ok: false, error: 'No payslips to export for this month.' };
    const bytes = await payrollWorkbook(payslips, periodMonth, register);
    return { ok: true, filename: `payroll-${periodMonth.slice(0, 7)}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/** Today's punch log as a branded .xlsx — replaces the old client-side CSV. */
export async function exportPunchLogXlsx(date: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the punch log');
  if (!gate.ok) return gate;
  try {
    const rows = await getPunchLogToday();
    if (rows.length === 0) return { ok: false, error: 'Nothing to export yet.' };
    const bytes = await punchLogWorkbook(rows, date);
    return { ok: true, filename: `punch-log-${date}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

export async function exportRegisterXlsx(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the register');
  if (!gate.ok) return gate;
  try {
    const employees = await getRegister(periodMonth);
    if (employees.length === 0) return { ok: false, error: 'No attendance to export for this month.' };
    const bytes = await registerWorkbook(employees, daysOf(periodMonth), periodMonth);
    return { ok: true, filename: `register-${periodMonth.slice(0, 7)}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/** Per-employee monthly attendance sheets for the pay period, to hand out with payroll. */
export async function exportAttendanceTemplateXlsx(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the attendance template');
  if (!gate.ok) return gate;
  try {
    const employees = await getRegister(periodMonth);
    if (employees.length === 0) return { ok: false, error: 'No attendance to export for this month.' };
    const bytes = await attendanceTemplateWorkbook(employees, periodMonth);
    return { ok: true, filename: `attendance-${periodMonth.slice(0, 7)}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/** Roles that may import the register — mirrors IMPORT_ROLES in actions/import. */
const IMPORT_ROLES: AppRole[] = ['admin', 'hr', 'manager'];

/** 'YYYY-MM' — the same shape /register and /payroll accept in their ?m= param. */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Normalise a caller-supplied period month to 'YYYY-MM-01', or explain why it
 * cannot be used. Accepts 'YYYY-MM' and 'YYYY-MM-01' alike.
 *
 * This value now arrives from a client component, i.e. across the network, so it
 * is untrusted input to a Server Action — validate rather than interpolate it
 * straight into a Date. Returns {ok:false} instead of throwing, matching
 * exportLeaveSalaryXlsx's year check below.
 */
function normalisePeriodMonth(
  input: string,
): { ok: true; periodMonth: string } | { ok: false; error: string } {
  const ym = input.slice(0, 7);
  if (!MONTH_RE.test(ym)) {
    return { ok: false, error: `“${input}” is not a valid month. Expected YYYY-MM.` };
  }
  const year = Number(ym.slice(0, 4));
  if (year < 2000 || year > 2100) {
    return { ok: false, error: `${year} is outside the supported range (2000–2100).` };
  }
  return { ok: true, periodMonth: `${ym}-01` };
}

/**
 * A blank register-import template for HR/Admin to fill in and upload.
 *
 * Unlike the other exports this reads NO employee data — the workbook is blank —
 * so it is gated on role via getSession() rather than requireStaff(), and
 * exposes nothing sensitive by design.
 *
 * `periodMonth` ('YYYY-MM' or 'YYYY-MM-01') stamps cell B2, which is the ONLY
 * thing that decides where a later upload lands — parseRegister's readPeriod()
 * reads it back and commitImport builds every work_date from it. Omitted, it
 * falls back to the current month, which is what the button did before the
 * month picker existed.
 */
export async function exportRegisterImportTemplateXlsx(
  periodMonth?: string,
): Promise<ExportResult> {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !IMPORT_ROLES.includes(role)) {
    return {
      ok: false,
      error: `Downloading the import template needs an admin, HR or manager account${
        role ? ` — yours is "${role}".` : '.'
      }`,
    };
  }

  let month: string;
  if (periodMonth === undefined) {
    month = currentPeriodMonth();
  } else {
    const parsed = normalisePeriodMonth(periodMonth);
    if (!parsed.ok) return parsed;
    month = parsed.periodMonth;
  }

  try {
    const bytes = await registerImportTemplateWorkbook(month);
    return {
      ok: true,
      filename: `register-import-template-${month.slice(0, 7)}.xlsx`,
      base64: b64(bytes),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Template download failed.' };
  }
}

export async function exportReimbursementsXlsx(): Promise<ExportResult> {
  const gate = await requireStaff('Exporting reimbursement claims');
  if (!gate.ok) return gate;
  try {
    const claims = await getReimbursements();
    if (claims.length === 0) return { ok: false, error: 'There are no claims to export.' };
    const bytes = await reimbursementsWorkbook(claims);
    return { ok: true, filename: 'reimbursement-claims.xlsx', base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

/**
 * The annual leave-salary working as a sheet. Gated admin/hr — the same gate
 * as the /leave page itself, and deliberately narrower than requireStaff:
 * this file carries every employee's salary.
 */
export async function exportLeaveSalaryXlsx(year: number): Promise<ExportResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Exporting the leave-salary working');
  if (!gate.ok) return gate;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, error: 'Enter a valid year.' };
  }
  try {
    const view = await buildLeaveSalaryView(year);
    if (view.rows.length === 0) return { ok: false, error: 'There are no employees to export.' };
    const bytes = await leaveSalaryWorkbook(view.rows, year);
    return { ok: true, filename: `leave-salary-${year}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

// -------------------------------------------------------------- statutory ---

export async function exportPfEcr(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the PF ECR');
  if (!gate.ok) return gate;
  try {
    const rows = await getStatutoryRows(periodMonth);
    if (rows.length === 0) return { ok: false, error: 'No payslips to file for this month.' };
    const text = buildPfEcr(rows, periodMonth);
    if (!text) return { ok: false, error: 'No PF members with contributions this month.' };
    return {
      ok: true,
      filename: `PF_ECR_${periodMonth.slice(0, 7)}.txt`,
      base64: Buffer.from(text, 'utf-8').toString('base64'),
      mime: TEXT_MIME,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

export async function exportEsic(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the ESIC return');
  if (!gate.ok) return gate;
  try {
    const rows = await getStatutoryRows(periodMonth);
    const bytes = await buildEsicXlsx(rows, periodMonth);
    return { ok: true, filename: `ESIC_${periodMonth.slice(0, 7)}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}

export async function exportPt(periodMonth: string): Promise<ExportResult> {
  const gate = await requireStaff('Exporting the PT summary');
  if (!gate.ok) return gate;
  try {
    const rows = await getStatutoryRows(periodMonth);
    const bytes = await buildPtXlsx(rows, periodMonth);
    return { ok: true, filename: `PT_${periodMonth.slice(0, 7)}.xlsx`, base64: b64(bytes) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Export failed.' };
  }
}
