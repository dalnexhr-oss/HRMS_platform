// ============================================================================
// Client-side payslip document renderer.
//
// Builds a self-contained, print-styled HTML payslip from a PayslipRow already
// on the page and opens it in a new window for printing. The browser's print
// dialog offers "Save as PDF", so this is the payslip PDF/download for both the
// staff payroll table and the employee self-service dashboard — no server route
// and no fetch-by-id, because the row it is handed already carries every figure
// it prints.
// ============================================================================
import { inr } from '@/lib/format';
import type { PayslipRow } from '@/types/domain';
import { COMPANY } from '@/lib/brand/company';

/** 'YYYY-MM-01' -> 'June 2026'; falls back gracefully. */
function monthLabel(periodMonth: string | null): string {
  if (!periodMonth) return 'Pay period';
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Calendar days in the pay period, or null when there is no usable period. */
function daysInPeriod(periodMonth: string | null): number | null {
  if (!periodMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(periodMonth);
  if (!m) return null;
  // Day 0 of the next month === last day of this one.
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** '26' / '26.5' — payable and LOP days are numeric(5,1), so half-days are real. */
function days(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function totalDeductions(p: PayslipRow): number {
  return (
    p.shortfallAmount +
    p.pfEmployee +
    p.esicEmployee +
    p.professionalTax +
    p.advanceRecovery +
    p.otherDeductions +
    p.lossDamage +
    // A negative carry-over is money withheld this month.
    Math.max(0, -p.lastMonthBalance)
  );
}

/** Additions on top of earned gross: bonus, reimbursement, positive carry-over. */
function totalAdditions(p: PayslipRow): number {
  return p.bonus + p.reimbursementBonus + Math.max(0, p.lastMonthBalance);
}

/**
 * Escape user-supplied text before injecting into the print document. Coerces
 * first: mapPayslip leaves `state` undefined when a branch has none, and a
 * `.replace` on that threw before a single line of the document was written,
 * so one missing field blanked the whole payslip window.
 */
function esc(v: unknown): string {
  const s = v === null || v === undefined ? '—' : String(v);
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

function payslipHtml(p: PayslipRow, logoUrl: string): string {
  const period = monthLabel(p.periodMonth);
  const ded = totalDeductions(p);
  const add = totalAdditions(p);
  const lmbDed = Math.max(0, -p.lastMonthBalance); // negative carry-over → deduction line
  const lmbAdd = Math.max(0, p.lastMonthBalance); //  positive carry-over → earnings line
  const totalDays = daysInPeriod(p.periodMonth);
  // Loss of pay is not stored on the payslip — it is the gap left by pro-rating.
  // fn_compute_payslip earns basic/HRA/special as (monthly / days_in_month *
  // payable_days), so the unpaid remainder is exactly the days not paid for, at
  // the per-day rate. Same quantity the PF ECR reports as NCP days.
  const lopDays = totalDays === null ? null : Math.max(0, totalDays - p.payableDays);
  const lopAmount = lopDays === null ? null : lopDays * p.perDayRate;
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
  .meta .payable { grid-column: 1 / -1; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #666;
       margin: 18px 0 6px; border-bottom: 1px solid #e5e3dd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .net { margin-top: 20px; padding: 12px 16px; background: #f3f7f4; border: 1px solid #cfe3d6;
         border-radius: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .foot { margin-top: 26px; font-size: 11px; color: #888; border-top: 1px solid #e5e3dd; padding-top: 10px; }
  @media print { body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                 .noprint { display: none; } }
</style></head>
<body>
  <div class="doc">
    <div class="hd">
      <div>
        <img src="${esc(logoUrl)}" alt="Dalnex" width="99" height="34"
          style="display:block;margin-bottom:8px" />
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
      <div><b>Payable days:</b> ${esc(days(p.payableDays))}</div>
      <div><b>Total days of ${esc(period)}:</b> ${esc(totalDays === null ? '—' : String(totalDays))}</div>
      <div><b>Loss of pay:</b> ${
        lopDays === null
          ? '—'
          : lopDays
            ? `${esc(days(lopDays))} ${lopDays === 1 ? 'day' : 'days'} (${esc(inr(lopAmount ?? 0))})`
            : 'None'
      }</div>
    </div>

    <div class="cols">
      <div>
        <h2>Earnings</h2>
        <table>
          ${row('Per-day ', inr(p.perDayRate))}
          ${row('Basic + DA ', inr(p.basicEarned))}
          ${row('HRA ', inr(p.hraEarned))}
          ${row('Special allowance ', inr(p.specialEarned))}
          ${row('Earned gross', inr(p.earnedGross), { total: true })}
          ${row('Bonus', p.bonus ? '+' + inr(p.bonus) : '—')}
          ${row('Reimbursement', p.reimbursementBonus ? '+' + inr(p.reimbursementBonus) : '—')}
          ${row('Last month balance ', '+' + inr(lmbAdd))}
          ${row('Total earnings', inr(p.earnedGross + add), { total: true })}
        </table>
      </div>
      <div>
        <h2>Deductions</h2>
        <table>
          ${row(`Hours shortfall (${p.shortfallMinutes} min)`, p.shortfallAmount ? '-' + inr(p.shortfallAmount) : '—', { neg: !!p.shortfallAmount })}
          ${row('PF ', p.pfEmployee ? '-' + inr(p.pfEmployee) : '—', { neg: !!p.pfEmployee })}
          ${row(`ESIC `, p.esicEmployee ? '-' + inr(p.esicEmployee) : '—', { neg: !!p.esicEmployee })}
          ${row(`Professional tax `, p.professionalTax ? '-' + inr(p.professionalTax) : '—', { neg: !!p.professionalTax })}
          ${row('Advance', p.advanceRecovery ? '-' + inr(p.advanceRecovery) : '—', { neg: !!p.advanceRecovery })}
          ${row('Other deductions', p.otherDeductions ? '-' + inr(p.otherDeductions) : '—', { neg: !!p.otherDeductions })}
          ${row('Late marks / Loss & damage', p.lossDamage ? '-' + inr(p.lossDamage) : '—', { neg: !!p.lossDamage })}
          ${lmbDed ? row('Last month balance (recovered)', '-' + inr(lmbDed), { neg: true }) : ''}
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
      ${row('PF ', p.pfEmployer ? inr(p.pfEmployer) : '—')}
      ${row('ESIC ', p.esicEmployer ? inr(p.esicEmployer) : '—')}
    </table>

    <div class="foot">
      Computer-generated payslip — no signature required.
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
  // The popup is about:blank, so a relative /logo.png would not resolve —
  // hand it an absolute URL. The full-size artwork keeps print output crisp.
  const logoUrl = new URL('/logo.png', window.location.origin).href;
  w.document.write(payslipHtml(p, logoUrl));
  w.document.close();
  w.focus();
  return true;
}
