'use client';

import { Fragment, useState } from 'react';
import { inr } from '@/lib/format';
import { printPayslip } from '@/lib/payslip-print';
import type { PayslipRow } from '@/types/domain';

/** Everything withheld from the earned gross to reach net payable. */
function totalDeductions(p: PayslipRow): number {
  return p.shortfallAmount + p.pfEmployee + p.esicEmployee + p.professionalTax;
}

/** 'YYYY-MM-01' -> 'June 2026'. */
function monthLabel(periodMonth: string | null): string | null {
  if (!periodMonth) return null;
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function downloadPayslip(p: PayslipRow) {
  if (!printPayslip(p)) {
    alert('Your browser blocked the payslip window. Allow pop-ups for this site and try again.');
  }
}

/**
 * The employee's own payslips, newest month first (the order `getMyPayslips`
 * returns them in). Reuses the payroll table's markup and inr() formatting.
 *
 * NOTE: `PayslipRow` carries no period month, so rows are labelled by their
 * position in that ordering rather than by a month we would have to invent.
 */
export function MyPayslips({ payslips }: { payslips: PayslipRow[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="card">
      <div className="hd">
        <h3>My payslips</h3>
        <span className="folio">
          {payslips.length ? `${payslips.length} · newest first` : 'None yet'}
        </span>
      </div>

      {payslips.length === 0 ? (
        <div className="bd">
          <div className="empty">
            <h3>No payslips yet</h3>
            <p>Your payslips appear here once a payroll run for your month has been computed.</p>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Payslip</th>
                <th className="right">Payable days</th>
                <th className="right">Earned gross</th>
                <th className="right">Deductions</th>
                <th className="right">Net payable</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((p, ix) => (
                // `PayslipRow.id` is the employee code — identical on every row
                // here — so the stable index is the only usable key.
                <Fragment key={ix}>
                  <tr
                    style={{ cursor: 'pointer' }}
                    onClick={() => setOpen((o) => (o === ix ? null : ix))}
                  >
                    <td>
                      <b>{monthLabel(p.periodMonth) ?? (ix === 0 ? 'Latest' : `Earlier · ${ix + 1}`)}</b>{' '}
                      <span className="mono muted">{p.code}</span>
                    </td>
                    <td className="right mono">{p.payableDays}</td>
                    <td className="right mono">{inr(p.earnedGross)}</td>
                    <td className="right mono" style={{ color: 'var(--hd)' }}>
                      {totalDeductions(p) ? '-' + inr(totalDeductions(p)) : '—'}
                    </td>
                    <td
                      className="right mono"
                      style={{ fontWeight: 700, color: 'var(--brand-deep)' }}
                    >
                      {inr(p.netPayable)}
                    </td>
                  </tr>
                  {open === ix && <PayslipBreakdown p={p} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PayslipBreakdown({ p }: { p: PayslipRow }) {
  return (
    <tr className="exp">
      <td colSpan={5}>
        <div className="exp-grid">
          <div className="exp-col">
            <h4>Earnings — {p.payableDays} payable days</h4>
            <Kv label="Per-day rate" value={inr(p.perDayRate)} />
            <Kv label="Basic (earned)" value={inr(p.basicEarned)} />
            <Kv label="HRA (earned)" value={inr(p.hraEarned)} />
            <Kv label="Special allowance (earned)" value={inr(p.specialEarned)} />
            <Kv label="Earned gross" value={inr(p.earnedGross)} total />
          </div>
          <div className="exp-col">
            <h4>Deductions</h4>
            <Kv
              label={`Hours shortfall (${p.shortfallMinutes} min)`}
              value={p.shortfallAmount ? '-' + inr(p.shortfallAmount) : '—'}
            />
            <Kv label="PF · 12% of Basic+DA" value={p.pfEmployee ? '-' + inr(p.pfEmployee) : '—'} />
            <Kv
              label={`ESIC · 0.75% ${p.esicEmployee ? '(eligible)' : '(above ₹21k cap)'}`}
              value={p.esicEmployee ? '-' + inr(p.esicEmployee) : '—'}
            />
            <Kv
              label={`Professional tax · ${p.state}`}
              value={p.professionalTax ? '-' + inr(p.professionalTax) : '—'}
            />
            <Kv label="Total deductions" value={totalDeductions(p) ? '-' + inr(totalDeductions(p)) : '—'} />
            <Kv label="Net payable" value={inr(p.netPayable)} total />
          </div>
          {/* .exp-grid is a three-column grid (see PayrollTable); the staff-only
              adjustments column has no employee equivalent, so the employer's
              own contributions take the slot rather than leaving it blank. */}
          <div className="exp-col">
            <h4>Employer contributions</h4>
            <Kv label="PF · 12%" value={p.pfEmployer ? inr(p.pfEmployer) : '—'} />
            <Kv label="ESIC · 3.25%" value={p.esicEmployer ? inr(p.esicEmployer) : '—'} />
            <div className="kv muted" style={{ fontSize: 11 }}>
              <span>Paid by the company on top of your gross — not deducted from your pay.</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn primary" type="button" onClick={() => downloadPayslip(p)}>
                Download payslip (PDF)
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Kv({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`kv${total ? ' total' : ''}`}>
      <span>{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}
