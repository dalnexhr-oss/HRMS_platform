'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Stamp } from '@/components/ui/Stamp';
import { DOW } from '@/lib/constants';
import { correctAttendance, type CorrectionState } from '@/lib/actions/attendance';
import type { DayCell, RegisterEmployee } from '@/types/domain';

// The month register: a fixed employee/summary column + a scrollable day strip.
// Clicking "Show punches" expands a row to reveal in/out/hours per day.
// For staff, clicking a day cell opens the correction drawer.

/** Statuses offered in the correction drawer — mirrors ALLOWED_STATUSES in the action. */
const STATUS_OPTIONS: [string, string][] = [
  ['P', 'P · Present'],
  ['LM', 'LM · Late mark'],
  ['HD', 'HD · Half day'],
  ['L', 'L · Leave'],
  ['WO', 'WO · Week off'],
  ['OH', 'OH · Holiday'],
  ['AB', 'A · Absent'],
  ['S', 'S · Site'],
  ['T', 'T · Travel'],
];

interface Target {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  day: number;
  workDate: string;
  cell: DayCell | undefined;
  /** Bumped on every open so the form remounts with fresh state — see openSeq. */
  seq: number;
}

export function RegisterGrid({
  employees,
  days,
  weekOffs,
  periodMonth,
  canCorrect = false,
}: {
  employees: RegisterEmployee[];
  days: number[];
  weekOffs: number[];
  /** 'YYYY-MM-01' — the month this grid is showing. */
  periodMonth: string;
  /** Staff may click a day to correct it. */
  canCorrect?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Monotonic open counter. Without it, the form's key is stable per cell, so
  // reopening a cell you just corrected reuses the instance whose state.ok is
  // still true — and the success effect immediately slams the drawer shut again.
  const openSeq = useRef(0);
  const wo = new Set(weekOffs);

  function openCorrection(e: RegisterEmployee, day: number, cell: DayCell | undefined) {
    openSeq.current += 1;
    setTarget({
      employeeId: e.id,
      employeeName: e.name,
      employeeCode: e.code,
      day,
      workDate: dateFor(periodMonth, day),
      cell,
      seq: openSeq.current,
    });
    setDrawerOpen(true);
  }

  return (
    <div className="card register">
      <div className="reg-scroll">
        <div id="reggrid" style={{ minWidth: 1660 }}>
          {/* header row */}
          <div className="rrow hd-row">
            <div className="emp-cell">
              <span
                className="folio"
                style={{
                  font: '600 10px var(--mono)',
                  letterSpacing: '.14em',
                  color: 'var(--ink-3)',
                }}
              >
                EMPLOYEE · SUMMARY
              </span>
            </div>
            <div className="daystrip">
              {days.map((d) => (
                <div key={d} className={`dhead${wo.has(d) ? ' wo-col' : ''}`}>
                  <div className="dw">{weekdayLabel(periodMonth, d)}</div>
                  <div className="dn">{d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* employee rows */}
          {employees.map((e) => {
            const short = e.workedMinutes < e.targetMinutes;
            // Without a target there is no meaningful completion bar.
            const pct =
              e.targetMinutes > 0
                ? Math.min(100, Math.round((e.workedMinutes / e.targetMinutes) * 100))
                : 0;
            const isOpen = open[e.id];
            // Index by day so a month with missing rows still lines up with the header.
            const byDay = new Map(e.days.map((c) => [c.day, c]));
            return (
              <div key={e.id} className={`rrow${isOpen ? ' open' : ''}`}>
                <div className="emp-cell">
                  <div>
                    <span className="nm">{e.name}</span>{' '}
                    <span className="meta">· {e.code}</span>
                  </div>
                  <div className="meta">
                    {e.branch} · {e.gender}
                  </div>
                  <div className="sums">
                    <span>P <b>{e.summary.P}</b></span>
                    <span>LM <b>{e.summary.LM}</b></span>
                    <span>HD <b>{e.summary.HD}</b></span>
                    <span>L <b>{e.summary.L}</b></span>
                    <span>WO <b>{e.summary.WO}</b></span>
                  </div>
                  <div className="sums">
                    <span>Working <b>{e.summary.working}</b></span>
                    <span>Payable <b>{e.summary.payable}</b></span>
                  </div>
                  <div className={`hrsbar${short ? ' short' : ''}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="meta mono">
                    {formatHrs(e.workedMinutes)} / {formatHrs(e.targetMinutes)} hrs{' '}
                    {short ? '· short' : '· met'}
                  </div>
                  <button
                    className="rowtoggle"
                    onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                  >
                    {isOpen ? 'Hide punches' : 'Show punches'}
                  </button>
                </div>
                <div className="daystrip">
                  {days.map((d) => {
                    const c = byDay.get(d);
                    const isWeekOff = c ? c.isWeekOff : wo.has(d);
                    const punchTitle = c?.in ? `${c.in} – ${c.out} · ${c.hours}` : undefined;
                    return (
                      <div
                        key={d}
                        className={`dcell${isWeekOff ? ' wo-col' : ''}`}
                        title={
                          canCorrect
                            ? `${punchTitle ? `${punchTitle} · ` : ''}Click to correct`
                            : punchTitle
                        }
                        onClick={canCorrect ? () => openCorrection(e, d, c) : undefined}
                        onKeyDown={
                          canCorrect
                            ? (ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  openCorrection(e, d, c);
                                }
                              }
                            : undefined
                        }
                        role={canCorrect ? 'button' : undefined}
                        tabIndex={canCorrect ? 0 : undefined}
                        aria-label={
                          canCorrect
                            ? `Correct ${e.name} on day ${d}${c ? ` — currently ${c.status}` : ''}`
                            : undefined
                        }
                        style={canCorrect ? { cursor: 'pointer' } : undefined}
                      >
                        <div style={{ display: 'grid', placeItems: 'center' }}>
                          {c ? <Stamp status={c.status} /> : null}
                          {c?.in ? (
                            <div className="tms">
                              {c.in}
                              <br />
                              {c.out}
                              <br />
                              <b>{c.hours}</b>
                            </div>
                          ) : (
                            <div className="tms muted">—</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canCorrect && (
        <>
          <div
            className={`overlay${drawerOpen ? ' on' : ''}`}
            onClick={() => setDrawerOpen(false)}
          />
          <aside className={`drawer${drawerOpen ? ' on' : ''}`} aria-label="Correct attendance">
            {target && (
              // Keying on the cell *and the open counter* remounts the form every
              // time the drawer opens, resetting the field defaults, any stale
              // error, and the stale state.ok that would otherwise re-close it.
              <CorrectionForm
                key={`${target.employeeId}-${target.workDate}-${target.seq}`}
                target={target}
                onClose={() => setDrawerOpen(false)}
              />
            )}
          </aside>
        </>
      )}
    </div>
  );
}

function CorrectionForm({ target, onClose }: { target: Target; onClose: () => void }) {
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(
    async (_prev, formData) => correctAttendance(formData),
    {},
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const { cell } = target;

  return (
    <form action={formAction} style={{ display: 'contents' }}>
      <input type="hidden" name="employee_id" value={target.employeeId} />
      <input type="hidden" name="work_date" value={target.workDate} />

      <div className="dhd">
        <h3>Correct attendance</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn quiet" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="dbd">
        <div className="hint">
          {target.employeeName} · <span className="mono">{target.employeeCode}</span> —{' '}
          <span className="mono">{target.workDate}</span>
          {cell ? (
            <>
              {' '}
              · currently <b>{cell.status}</b>
              {cell.in ? (
                <>
                  {' '}
                  <span className="mono">
                    {cell.in}–{cell.out}
                  </span>
                </>
              ) : (
                ' · no punches'
              )}
            </>
          ) : (
            ' · no attendance recorded yet'
          )}
        </div>

        <div className="f">
          <label htmlFor="corr-status">Status</label>
          <select id="corr-status" name="status" defaultValue={cell?.status ?? 'P'}>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="f-row">
          <div className="f">
            <label htmlFor="corr-in">Punch in</label>
            <input
              id="corr-in"
              name="punch_in"
              type="time"
              className="mono"
              defaultValue={cell?.in ?? ''}
            />
          </div>
          <div className="f">
            <label htmlFor="corr-out">Punch out</label>
            <input
              id="corr-out"
              name="punch_out"
              type="time"
              className="mono"
              defaultValue={cell?.out ?? ''}
            />
          </div>
        </div>

        <div className="f">
          <label htmlFor="corr-reason">Reason for correction (required)</label>
          <textarea
            id="corr-reason"
            name="reason"
            required
            rows={3}
            placeholder="e.g. Biometric failed at the Pune gate; verified against the visitor log."
          />
        </div>

        <div className="hint">
          Hours are recalculated from the punch times. This change is stamped as a correction
          against your name and written to the audit log.
        </div>

        {state.error && <div className="login-error">{state.error}</div>}
      </div>

      <div className="dft">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save correction'}
        </button>
      </div>
    </form>
  );
}

/** 'YYYY-MM-01' + day -> 'YYYY-MM-DD'. */
function dateFor(periodMonth: string, day: number): string {
  return `${periodMonth.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** Real weekday for the day-of-month, so any month's header is correct. */
function weekdayLabel(periodMonth: string, day: number): string {
  const d = new Date(`${dateFor(periodMonth, day)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  // JS: 0=Sun..6=Sat. DOW is Mo-first.
  return DOW[(d.getDay() + 6) % 7];
}

function formatHrs(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
