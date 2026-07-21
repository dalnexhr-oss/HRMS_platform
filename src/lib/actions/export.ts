'use server';

// ============================================================================
// .xlsx export Server Actions. Build the workbook on the server (exceljs is
// server-only) and return the bytes as base64 for the client to download. Both
// exports carry payroll/attendance data, so they are staff-gated.
// ============================================================================
import { getPayslips, getRegister, getReimbursements, getReimbursementRate } from '@/lib/queries';
import { payrollWorkbook, registerWorkbook, reimbursementsWorkbook } from '@/lib/excel/buildWorkbook';
import {
  getStatutoryRows,
  buildPfEcr,
  buildEsicXlsx,
  buildPtXlsx,
} from '@/lib/statutory/statutory';
import { requireStaff } from '@/lib/actions/_guard';

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

export async function exportReimbursementsXlsx(): Promise<ExportResult> {
  const gate = await requireStaff('Exporting reimbursement claims');
  if (!gate.ok) return gate;
  try {
    const [claims, rate] = await Promise.all([getReimbursements(), getReimbursementRate()]);
    if (claims.length === 0) return { ok: false, error: 'There are no claims to export.' };
    const bytes = await reimbursementsWorkbook(claims, rate);
    return { ok: true, filename: 'reimbursement-claims.xlsx', base64: b64(bytes) };
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
