// ============================================================================
// Client-side payslip document renderer.
//
// Builds a self-contained, print-styled HTML payslip from a PayslipRow already
// on the page and opens it in a new window for printing. The browser's print
// dialog offers "Save as PDF", so this is the payslip PDF/download for both the
// staff payroll table and the employee self-service dashboard — no server route,
// no fetch-by-id (PayslipRow.id is the employee code, not the payslip UUID).
// ============================================================================
import { inr } from '@/lib/format';
import type { PayslipRow } from '@/types/domain';

const COMPANY = 'Dalnex LLP';

/** 'YYYY-MM-01' -> 'June 2026'; falls back gracefully. */
function monthLabel(periodMonth: string | null): string {
  if (!periodMonth) return 'Pay period';
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function totalDeductions(p: PayslipRow): number {
  return p.shortfallAmount + p.pfEmployee + p.esicEmployee + p.professionalTax;
}

/** Escape user-supplied text before injecting into the print document. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function row(label: string, value: string, opts: { total?: boolean; neg?: boolean } = {}): string {
  const weight = opts.total ? 'font-weight:700;border-top:1px solid #333;' : '';
  const color = opts.neg ? 'color:#a12;' : '';
  return `<tr>
    <td style="padding:5px 0;${weight}">${esc(label)}</td>
    <td style="padding:5px 0;text-align:right;font-variant-numeric:tabular-nums;${weight}${color}">${esc(value)}</td>
  </tr>`;
}

function payslipHtml(p: PayslipRow): string {
  const period = monthLabel(p.periodMonth);
  const ded = totalDeductions(p);
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Payslip — ${esc(p.name)} — ${esc(period)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; }
  .doc { max-width: 720px; margin: 0 auto; }
  .hd { display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 20px; }
  .hd h1 { font-size: 22px; margin: 0; }
  .hd .co { font-size: 12px; color: #666; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 22px; font-size: 12px; }
  .meta b { color: #333; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #666;
       margin: 18px 0 6px; border-bottom: 1px solid #e5e3dd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .net { margin-top: 20px; padding: 12px 16px; background: #f3f7f4; border: 1px solid #cfe3d6;
         border-radius: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .foot { margin-top: 26px; font-size: 11px; color: #888; border-top: 1px solid #e5e3dd; padding-top: 10px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body>
  <div class="doc">
    <div class="hd">
      <div>
        <h1>Payslip</h1>
        <div class="co">${esc(COMPANY)} · ${esc(period)}</div>
      </div>
      <button class="noprint" onclick="window.print()"
        style="padding:8px 14px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:8px;cursor:pointer;font:inherit;">
        Print / Save as PDF
      </button>
    </div>

    <div class="meta">
      <div><b>Employee:</b> ${esc(p.name)}</div>
      <div><b>Code:</b> ${esc(p.code)}</div>
      <div><b>Branch:</b> ${esc(p.branch)} (${esc(p.state)})</div>
      <div><b>Payable days:</b> ${esc(String(p.payableDays))}</div>
    </div>

    <div class="cols">
      <div>
        <h2>Earnings</h2>
        <table>
          ${row('Per-day rate', inr(p.perDayRate))}
          ${row('Basic + DA (earned)', inr(p.basicEarned))}
          ${row('HRA (earned)', inr(p.hraEarned))}
          ${row('Special allowance (earned)', inr(p.specialEarned))}
          ${row('Earned gross', inr(p.earnedGross), { total: true })}
        </table>
      </div>
      <div>
        <h2>Deductions</h2>
        <table>
          ${row(`Hours shortfall (${p.shortfallMinutes} min)`, p.shortfallAmount ? '-' + inr(p.shortfallAmount) : '—', { neg: !!p.shortfallAmount })}
          ${row('PF · 12% of Basic+DA', p.pfEmployee ? '-' + inr(p.pfEmployee) : '—', { neg: !!p.pfEmployee })}
          ${row(`ESIC · 0.75%${p.esicEmployee ? '' : ' (above ₹21k cap)'}`, p.esicEmployee ? '-' + inr(p.esicEmployee) : '—', { neg: !!p.esicEmployee })}
          ${row(`Professional tax · ${p.state}`, p.professionalTax ? '-' + inr(p.professionalTax) : '—', { neg: !!p.professionalTax })}
          ${row('Total deductions', ded ? '-' + inr(ded) : '—', { total: true, neg: !!ded })}
        </table>
      </div>
    </div>

    <div class="net">
      <span>Net payable</span>
      <span>${inr(p.netPayable)}</span>
    </div>

    <h2>Employer contributions (not deducted from pay)</h2>
    <table>
      ${row('PF · 12%', p.pfEmployer ? inr(p.pfEmployer) : '—')}
      ${row('ESIC · 3.25%', p.esicEmployer ? inr(p.esicEmployer) : '—')}
    </table>

    <div class="foot">
      Computer-generated payslip — no signature required. Statutory deductions follow PF (12% of
      earned Basic+DA), ESIC (0.75% below the ₹21,000 gross cap) and Professional Tax by branch state.
    </div>
  </div>
</body></html>`;
}

/**
 * Open the payslip in a new window ready to print / save as PDF. Returns false
 * if the browser blocked the popup so callers can surface a hint.
 */
export function printPayslip(p: PayslipRow): boolean {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return false;
  w.document.write(payslipHtml(p));
  w.document.close();
  w.focus();
  return true;
}
