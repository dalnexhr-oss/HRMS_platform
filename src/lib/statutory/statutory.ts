// ============================================================================
// Statutory filing builders — PF ECR, ESIC contribution, Professional Tax.
// SERVER ONLY. Reads payslips joined to employee statutory identifiers and emits
// the filing artifacts. These are DRAFTS to reconcile against the EPFO/ESIC/state
// portals before submission — the wage bases follow the app's confirmed rules.
// ============================================================================
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { monthTitle } from '@/lib/excel/buildWorkbook';

export interface StatutoryRow {
  code: string;
  name: string;
  uan: string | null;
  esicNumber: string | null;
  state: string;
  payableDays: number;
  basicEarned: number; // EPF wages
  earnedGross: number;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
  professionalTax: number;
}

/** EPS wage ceiling (₹15,000) and EPS rate (8.33%). */
const EPS_CEILING = 15000;
const EPS_RATE = 0.0833;

function daysInMonth(periodMonth: string): number {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Load the statutory rows for a month's locked/draft run. Requires Supabase —
 * callers gate on requireStaff() first, which guarantees it is configured.
 */
export async function getStatutoryRows(periodMonth: string): Promise<StatutoryRow[]> {
  const start = `${periodMonth.slice(0, 7)}-01`;
  const supabase = await createClient();

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id')
    .eq('period_month', start)
    .maybeSingle<{ id: string }>();
  if (runErr) throw new Error(`Statutory: could not load the payroll run: ${runErr.message}`);
  if (!run) return [];

  const { data, error } = await supabase
    .from('payslips')
    .select(
      `payable_days, basic_earned, earned_gross, pf_employee, pf_employer,
       esic_employee, esic_employer, professional_tax,
       employees(code, full_name, pf_uan, esic_number, branches(state))`,
    )
    .eq('payroll_run_id', run.id);
  if (error) throw new Error(`Statutory: could not load payslips: ${error.message}`);

  return (data ?? [])
    .map((p: any): StatutoryRow => ({
      code: p.employees?.code ?? '',
      name: p.employees?.full_name ?? '',
      uan: p.employees?.pf_uan ?? null,
      esicNumber: p.employees?.esic_number ?? null,
      state: p.employees?.branches?.state ?? '',
      payableDays: Number(p.payable_days),
      basicEarned: Number(p.basic_earned),
      earnedGross: Number(p.earned_gross),
      pfEmployee: Number(p.pf_employee),
      pfEmployer: Number(p.pf_employer),
      esicEmployee: Number(p.esic_employee),
      esicEmployer: Number(p.esic_employer),
      professionalTax: Number(p.professional_tax),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

// -------------------------------------------------------------------- PF ECR ---

/**
 * EPFO ECR v2.0 text file: one #~#-delimited line per member, fields:
 * UAN, Name, Gross, EPF wages, EPS wages, EDLI wages, EPF contribution,
 * EPS contribution, EPF-EPS diff (employer), NCP days, Refund of advances.
 * A DRAFT — reconcile against the EPFO portal before uploading.
 */
/**
 * Make a value safe to place in a #~#-delimited, newline-separated ECR record.
 *
 * employees.full_name is free text that any staff role can set. A name
 * containing '#~#' would shift every later field of that member's row (moving
 * wages into the contribution columns), and an embedded newline would inject an
 * entire extra member row into a statutory filing uploaded to EPFO. Strip the
 * delimiter and all line breaks rather than trusting the input.
 */
function ecrField(v: unknown): string {
  return String(v ?? '')
    .replace(/#~#/g, ' ')
    .replace(/[#~]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

export function buildPfEcr(rows: StatutoryRow[], periodMonth: string): string {
  const nDays = daysInMonth(periodMonth);
  const lines: string[] = [];
  for (const r of rows) {
    if (r.pfEmployee <= 0) continue; // not a PF member this month
    const epfWages = Math.round(r.basicEarned);
    const epsWages = Math.min(epfWages, EPS_CEILING);
    const eps = Math.round(epsWages * EPS_RATE);
    const epfEmployee = Math.round(r.pfEmployee);
    const epfEmployerDiff = Math.max(0, Math.round(r.pfEmployer) - eps);
    const ncp = Math.max(0, nDays - Math.round(r.payableDays));
    lines.push(
      [
        ecrField(r.uan ?? ''),
        ecrField(r.name),
        epfWages, // gross wages (proxy: EPF wages)
        epfWages,
        epsWages,
        epfWages, // EDLI wages
        epfEmployee,
        eps,
        epfEmployerDiff,
        ncp,
        0, // refund of advances
      ].join('#~#'),
    );
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

async function bytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * Neutralise spreadsheet formula injection — Excel executes a cell beginning
 * with = + - @ (or a leading tab/CR). Statutory files are opened by finance and
 * uploaded to government portals, so a crafted employee name must stay inert text.
 */
function safeText(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function header(row: ExcelJS.Row): void {
  row.font = { bold: true };
}

// --------------------------------------------------------------------- ESIC ---

/** ESIC monthly contribution as .xlsx — covered employees only (esic_employee > 0). */
export async function buildEsicXlsx(rows: StatutoryRow[], periodMonth: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet(`ESIC ${monthTitle(periodMonth)}`);
  ws.columns = [
    { header: 'IP Number', key: 'ip', width: 16 },
    { header: 'IP Name', key: 'name', width: 24 },
    { header: 'No. of Days', key: 'days', width: 12 },
    { header: 'Total Monthly Wages', key: 'wages', width: 18 },
    { header: 'IP Contribution (0.75%)', key: 'ipc', width: 20 },
    { header: 'Employer Contribution (3.25%)', key: 'erc', width: 24 },
  ];
  header(ws.getRow(1));
  for (const r of rows) {
    if (r.esicEmployee <= 0) continue;
    ws.addRow({
      ip: safeText(r.esicNumber ?? ''),
      name: safeText(r.name),
      days: r.payableDays,
      wages: Math.round(r.earnedGross),
      ipc: Math.round(r.esicEmployee),
      erc: Math.round(r.esicEmployer),
    });
  }
  for (const c of [4, 5, 6]) ws.getColumn(c).numFmt = '#,##0';
  return bytes(wb);
}

// ----------------------------------------------------------- Professional Tax ---

/** PT summary as .xlsx, grouped by branch state, with per-state totals. */
export async function buildPtXlsx(rows: StatutoryRow[], periodMonth: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dalnex HRMS';
  const ws = wb.addWorksheet(`PT ${monthTitle(periodMonth)}`);
  ws.columns = [
    { header: 'State', key: 'state', width: 14 },
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Professional Tax', key: 'pt', width: 16 },
  ];
  header(ws.getRow(1));

  const byState = new Map<string, StatutoryRow[]>();
  for (const r of rows) {
    const list = byState.get(r.state) ?? [];
    list.push(r);
    byState.set(r.state, list);
  }
  for (const [state, list] of [...byState.entries()].sort()) {
    let total = 0;
    for (const r of list) {
      ws.addRow({
        state: safeText(state),
        code: safeText(r.code),
        name: safeText(r.name),
        pt: Math.round(r.professionalTax),
      });
      total += Math.round(r.professionalTax);
    }
    const t = ws.addRow({ state, name: `${state} total`, pt: total });
    t.font = { bold: true };
  }
  ws.getColumn(4).numFmt = '#,##0';
  return bytes(wb);
}
