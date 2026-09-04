'use client';

import { useActionState, useEffect, useRef, useState, useTransition ,useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Stamp } from '@/components/ui/Stamp';
import { DOW } from '@/lib/constants';
import { correctAttendance, correctAttendanceBulk, type CorrectionState } from '@/lib/actions/attendance';
import { grantCompOff } from '@/lib/actions/compoff';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { DayCell, RegisterEmployee } from '@/types/domain';

/** Statuses that mean the day was scheduled off — mirrors OFF_DAY_STATUSES. */
const OFF_DAY_STATUSES = new Set(['WO', 'OH']);

/**
 * A comp off is owed when a day off carries real work.
 *
 * "Day off" is either stamp-based (WO/OH) or schedule-based (`scheduledOff` —
 * a Sunday or a 1st/3rd/5th Saturday). The schedule arm matters: an employee who
 * works a non-working Saturday is often stamped plain 'P', so a stamp-only check
 * would miss exactly the case this feature exists for.
 */
export function isCompOffEligible(cell: DayCell | undefined, scheduledOff = false): boolean {
  if (!cell) return false;
  if (!OFF_DAY_STATUSES.has(cell.status) && !scheduledOff) return false;
  return cell.in !== null || (cell.hours !== null && cell.hours !== '00:00');
}

/** Stable key for "this employee, this day". */
function compOffKey(employeeId: string, workDate: string): string {
  return `${employeeId}|${workDate}`;
}

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
  ['CO', 'CO · Comp off'],
];

interface Target {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  day: number;
  workDate: string;
  cell: DayCell | undefined;
  /** Worked a scheduled-off day — a comp off is owed. */
  compOffEligible: boolean;
  /** A credit for this day has already been granted. */
  compOffGranted: boolean;
  /** Bumped on every open so the form remounts with fresh state — see openSeq. */
  seq: number;
}

export function RegisterGrid({
  employees,
  days,
  weekOffs,
  periodMonth,
  canCorrect = false,
  compOffKeys = [],
}: {
  employees: RegisterEmployee[];
  days: number[];
  weekOffs: number[];
  /** 'YYYY-MM-01' — the month this grid is showing. */
  periodMonth: string;
  /** Staff may click a day to correct it. */
  canCorrect?: boolean;
  /** `employeeId|YYYY-MM-DD` keys that already have a comp-off credit. */
  compOffKeys?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const granted = new Set(compOffKeys);
  // Monotonic open counter. Without it, the form's key is stable per cell, so
  // reopening a cell you just corrected reuses the instance whose state.ok is
  // still true — and the success effect immediately slams the drawer shut again.
  const openSeq = useRef(0);
  const wo = new Set(weekOffs);

  // --- bulk correction: select many cells, apply one status + reason at once ---
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, startApply] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();
  const onWarning = useCallback(
  (w: string) => toast(w, 'info'),
  [toast]
);

  function toggleSelect(employeeId: string, day: number) {
    const key = `${employeeId}|${dateFor(periodMonth, day)}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exitBulk() {
    setBulkMode(false);
    setSelected(new Set());
  }

  function onCellClick(e: RegisterEmployee, day: number, cell: DayCell | undefined) {
    if (bulkMode) toggleSelect(e.id, day);
    else openCorrection(e, day, cell);
  }

  function openCorrection(e: RegisterEmployee, day: number, cell: DayCell | undefined) {
    openSeq.current += 1;
    const workDate = dateFor(periodMonth, day);
    setTarget({
      employeeId: e.id,
      employeeName: e.name,
      employeeCode: e.code,
      day,
      workDate,
      cell,
      compOffEligible: isCompOffEligible(cell, wo.has(day)),
      compOffGranted: granted.has(compOffKey(e.id, workDate)),
      seq: openSeq.current,
    });
    setDrawerOpen(true);
  }

  return (
    <div className="card register">
      {confirmDialog}
      {toastNode}
      {canCorrect && (
        <BulkBar
          bulkMode={bulkMode}
          count={selected.size}
          pending={applying}
          onEnter={() => setBulkMode(true)}
          onExit={exitBulk}
          onClear={() => setSelected(new Set())}
          onApply={async (status, reason) => {
            const targets = [...selected].map((k) => {
              const i = k.indexOf('|');
              return { employeeId: k.slice(0, i), workDate: k.slice(i + 1) };
            });
            // The confirm MUST stay outside the transition. This whole handler
            // used to run inside BulkBar's startTransition, which deadlocked the
            // button: confirm() shows its dialog via a state update, React defers
            // state updates made inside a pending async transition until the
            // action finishes — and the action was awaiting the dialog. Result:
            // no dialog, "Applying…" forever. Same split as SettingsScreen's
            // remove(): dialog first, then only the server call in a transition.
            const ok = await confirm({
              title: 'Apply bulk correction',
              message: `Set ${targets.length} day(s) to “${status}”? Each is stamped as a correction against your name and written to the audit log.`,
              confirmLabel: 'Apply',
              danger: true,
            });
            if (!ok) return;
            startApply(async () => {
              const res = await correctAttendanceBulk({ targets, status, reason });
              if (!res.ok) toast(res.error ?? 'The bulk correction failed.', 'error');
              else {
                if (res.warning) toast(res.warning, 'info');
                else toast(`Corrected ${targets.length} day(s).`, 'success');
                exitBulk();
                router.refresh();
              }
            });
          }}
        />
      )}
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
                    {/* if late mark is more than 3 times, than it is counted as a half day */}
                    <span>payable <b>{e.summary.working + e.summary.WO + e.summary.HD  - e.summary.L}</b></span>
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
                    // Worked an off day: flag it so staff can grant the comp off.
                    // `wo.has(d)` carries the schedule (Sundays + 1st/3rd/5th
                    // Saturdays), so a worked non-working Saturday counts even
                    // when it is stamped plain 'P'.
                    const coEligible = isCompOffEligible(c, wo.has(d));
                    const coGranted =
                      coEligible && granted.has(compOffKey(e.id, dateFor(periodMonth, d)));
                    const coTitle = coEligible
                      ? coGranted
                        ? ' · Comp off granted'
                        : ' · Comp off applicable'
                      : '';
                    const isSelected =
                      bulkMode && selected.has(`${e.id}|${dateFor(periodMonth, d)}`);
                    return (
                      <div
                        key={d}
                        className={`dcell${isWeekOff ? ' wo-col' : ''}`}
                        title={
                          canCorrect
                            ? bulkMode
                              ? `${punchTitle ? `${punchTitle} · ` : ''}Click to ${isSelected ? 'deselect' : 'select'}`
                              : `${punchTitle ? `${punchTitle} · ` : ''}Click to correct${coTitle}`
                            : `${punchTitle ?? ''}${coTitle}`
                        }
                        onClick={canCorrect ? () => onCellClick(e, d, c) : undefined}
                        onKeyDown={
                          canCorrect
                            ? (ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  onCellClick(e, d, c);
                                }
                              }
                            : undefined
                        }
                        role={canCorrect ? 'button' : undefined}
                        tabIndex={canCorrect ? 0 : undefined}
                        aria-label={
                          canCorrect
                            ? bulkMode
                              ? `${isSelected ? 'Deselect' : 'Select'} ${e.name} on day ${d}`
                              : `Correct ${e.name} on day ${d}${c ? ` — currently ${c.status}` : ''}`
                            : undefined
                        }
                        aria-pressed={bulkMode ? isSelected : undefined}
                        style={
                          canCorrect
                            ? {
                                cursor: 'pointer',
                                ...(isSelected
                                  ? { outline: '2px solid var(--brand)', outlineOffset: -2, background: 'var(--p-bg)' }
                                  : {}),
                              }
                            : undefined
                        }
                      >
                        <div style={{ display: 'grid', placeItems: 'center', position: 'relative' }}>
                          {coEligible && (
                            <span
                              aria-label={coGranted ? 'Comp off granted' : 'Comp off applicable'}
                              style={{
                                position: 'absolute',
                                top: -2,
                                right: -2,
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: coGranted ? 'var(--p)' : 'var(--lm)',
                              }}
                            />
                          )}
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
                onWarning ={onWarning}
              />
            )}
          </aside>
        </>
      )}
    </div>
  );
}

function CorrectionForm({
  target,
  onClose,
  onWarning,
}: {
  target: Target;
  onClose: () => void;
  onWarning?: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(
    async (_prev, formData) => correctAttendance(formData),
    {},
  );

  useEffect(() => {
    if (state.ok) {
      // Saved-with-a-caveat (e.g. the audit-log write failed) still closes the
      // drawer — the correction is committed — but the caveat is surfaced.
      if (state.warning) onWarning?.(state.warning);
      onClose();
    }
  }, [state.ok, state.warning, onClose, onWarning]);

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
        {target.compOffEligible && <CompOffPanel target={target} />}

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

/**
 * The "comp off applicable" callout. Shown at the top of the correction drawer
 * whenever the clicked day is a worked week-off/holiday, with the one action
 * that matters: grant the credit. Once granted it reports the state instead.
 */
function CompOffPanel({ target }: { target: Target }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [granted, setGranted] = useState(target.compOffGranted);
  const [error, setError] = useState<string | null>(null);

  const onGrant = () =>
    startTransition(async () => {
      setError(null);
      const res = await grantCompOff(target.employeeId, target.workDate);
      if (!res.ok) {
        setError(res.error ?? 'Could not grant the comp off.');
        return;
      }
      setGranted(true);
      router.refresh();
    });

  return (
    <div
      style={{
        border: '1px solid var(--lm-line)',
        background: 'var(--lm-bg)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 14,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--lm)', marginBottom: 4 }}>
        ⚡ Comp off applicable
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        {target.employeeName} worked on {target.cell?.status === 'OH' ? 'a holiday' : 'a week-off'} (
        <span className="mono">{target.workDate}</span>
        {target.cell?.in ? (
          <>
            {' '}
            · <span className="mono">{target.cell.in}–{target.cell.out}</span>
          </>
        ) : null}
        ). Granting a comp off credits them one day, which they can then apply for from their
        dashboard.
      </p>

      {granted ? (
        <span className="pill" style={{ borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }}>
          ✓ Comp off granted
        </span>
      ) : (
        <button type="button" className="btn primary" onClick={onGrant} disabled={pending}>
          {pending ? 'Granting…' : 'Grant comp off'}
        </button>
      )}

      {error && <div className="login-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/**
 * The bulk-correction toolbar above the grid. Off by default (a single "Select
 * cells" button); once on, clicking cells toggles selection and this bar takes a
 * status + reason and applies them to the whole selection in one audited write.
 */
function BulkBar({
  bulkMode,
  count,
  pending,
  onEnter,
  onExit,
  onClear,
  onApply,
}: {
  bulkMode: boolean;
  count: number;
  /** True while the parent's apply transition is in flight. The transition lives
   *  in RegisterGrid, NOT here — wrapping onApply in a transition from this side
   *  would put the confirm dialog's state update inside it and deadlock the
   *  whole flow (see the onApply call site). */
  pending: boolean;
  onEnter: () => void;
  onExit: () => void;
  onClear: () => void;
  onApply: (status: string, reason: string) => void;
}) {
  const [status, setStatus] = useState('L');
  const [reason, setReason] = useState('');

  if (!bulkMode) {
    return (
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-2)' }}>
        <button type="button" className="btn quiet" onClick={onEnter}>
          ☑ Select cells (bulk correct)
        </button>
      </div>
    );
  }

  const canApply = count > 0 && reason.trim().length > 0 && !pending;

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '10px 12px',
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--p-bg)',
      }}
    >
      <span className="pill" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
        {count} selected
      </span>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Bulk status">
        {STATUS_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        style={{ flex: '1 1 220px', minWidth: 160 }}
        aria-label="Bulk correction reason"
      />
      <button
        type="button"
        className="btn primary"
        disabled={!canApply}
        title={count === 0 ? 'Select at least one cell' : !reason.trim() ? 'Enter a reason' : undefined}
        onClick={() => onApply(status, reason.trim())}
      >
        {pending ? 'Applying…' : `Apply to ${count}`}
      </button>
      <button type="button" className="btn quiet" onClick={onClear} disabled={pending || count === 0}>
        Clear
      </button>
      <button type="button" className="btn quiet" onClick={onExit} disabled={pending}>
        Done
      </button>
    </div>
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
