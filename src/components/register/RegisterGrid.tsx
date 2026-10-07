'use client';

import './register.css';
import { useActionState, useEffect, useRef, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AttendanceStatusBadge } from '@/components/ui/AttendanceStatusBadge';
import { dow, isWorkedStatus } from '@/lib/attendance-status';
import { correctAttendance, correctAttendanceBulk } from '@/lib/actions/attendance';
import { grantCompOff } from '@/lib/actions/comp-off';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import type { CSSProperties } from 'react';
import type { CorrectionState } from '@/lib/actions/attendance';
import type { DayCell, RegisterEmployee } from '@/types/domain';

// Statuses that mean the day was scheduled off — mirrors offDayStatuses.
const offDayStatuses = new Set(['WO', 'OH']);

// Comp-off eligibility includes both WO/OH stamps and scheduled days off. An employee can be
// stamped P after working a scheduled day off.
function isCompOffEligible(cell: DayCell | undefined, scheduledOff = false): boolean {
  if (!cell) {
    return false;
  }
  if (!offDayStatuses.has(cell.status) && !scheduledOff) {
    return false;
  }
  return cell.in !== null || (cell.hours !== null && cell.hours !== '00:00');
}

// Stable key for "this employee, this day".
function compOffKey(employeeId: string, workDate: string): string {
  return `${employeeId}|${workDate}`;
}

// The month register: a fixed employee/summary column + a scrollable day strip.
// Expanding a row reveals the monthly summary and in/out/hours per day.
// For staff, clicking a day cell opens the correction drawer.

/** Statuses offered in the correction drawer — mirrors allowedStatuses in the action. */
const statusOptions: Array<[string, string]> = [
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

function RegisterGrid({
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
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const granted = new Set(compOffKeys);
  // Monotonic open counter. Without it, the form's key is stable per cell, so
  // reopening a cell you just corrected reuses the instance whose state.ok is
  // still true — and the success effect immediately slams the drawer shut again.
  const openSeq = useRef(0);
  const wo = new Set(weekOffs);

  // bulk correction: select many cells, apply one status + reason at once
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, startApply] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();
  const onWarning = useCallback((w: string) => showNotification(w, 'info'), [showNotification]);

  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleEmployees = employees.filter((employee) => {
    const identity = `${employee.name} ${employee.code}`.toLowerCase();
    return searchTerms.every((term) => identity.includes(term));
  });

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded || drawerOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const register = scrollRef.current?.closest('.monthly-register');
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        register?.querySelector('[role="dialog"]') ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea, select'))
      ) {
        return;
      }
      setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, drawerOpen]);

  function changeSearch(value: string) {
    setQuery(value);
    // A correction must never include cells hidden by a new employee filter.
    setSelected(new Set());
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }

  function toggleSelect(employeeId: string, day: number) {
    const key = `${employeeId}|${dateFor(periodMonth, day)}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function exitBulk() {
    setBulkMode(false);
    setSelected(new Set());
  }

  function onCellClick(e: RegisterEmployee, day: number, cell: DayCell | undefined) {
    if (bulkMode) {
      toggleSelect(e.id, day);
    } else {
      openCorrection(e, day, cell);
    }
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
    <div className={`card attendance-register monthly-register${expanded ? ' is-expanded' : ''}`}>
      {confirmDialog}
      {notificationContainer}
      <div className="register-controls">
        {expanded && (
          <div className="register-expanded-title">
            <b>Monthly register</b>
            <span className="text-monospace text-muted">
              {new Intl.DateTimeFormat('en-GB', {
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Kolkata',
              }).format(new Date(`${periodMonth}T00:00:00+05:30`))}
            </span>
          </div>
        )}
        <label className="search-field register-search">
          <span className="visually-hidden">Search employees by name or employee ID</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="search"
            placeholder="Search name or employee ID…"
            value={query}
            onChange={(event) => changeSearch(event.target.value)}
            disabled={applying}
            aria-controls="reggrid"
          />
        </label>
        <span
          className="register-count text-monospace text-muted"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {visibleEmployees.length} of {employees.length} employees
        </span>
        {query && (
          <button
            type="button"
            className="button quiet"
            onClick={() => changeSearch('')}
            disabled={applying}
          >
            Clear search
          </button>
        )}
        <button
          type="button"
          className="button quiet register-expand"
          aria-pressed={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Exit expanded view' : 'Expand view'}
        </button>
        {canCorrect && (
          <BulkBar
            bulkMode={bulkMode}
            count={selected.size}
            pending={applying}
            onEnter={() => setBulkMode(true)}
            onExit={exitBulk}
            onClear={() => setSelected(new Set())}
            onApply={async (status, reason, punchIn, punchOut) => {
              const targets = [...selected].map((k) => {
                const i = k.indexOf('|');
                return { employeeId: k.slice(0, i), workDate: k.slice(i + 1) };
              });
              // Show confirmation before starting the transition. Awaiting a dialog state update
              // inside the same async transition can leave both waiting indefinitely.
              const ok = await confirm({
                title: 'Apply bulk correction',
                message: `Set ${targets.length} day(s) to “${status}”${
                  punchIn ? ` with punches ${punchIn}–${punchOut}` : ''
                }? Each is stamped as a correction against your name and written to the audit log.`,
                confirmLabel: 'Apply',
                danger: true,
              });
              if (!ok) {
                return;
              }
              startApply(async () => {
                const res = await correctAttendanceBulk({
                  targets,
                  status,
                  reason,
                  punchIn,
                  punchOut,
                });
                if (!res.ok) {
                  showNotification(res.error ?? 'The bulk correction failed.', 'error');
                } else {
                  if (res.warning) {
                    showNotification(res.warning, 'info');
                  } else {
                    showNotification(`Corrected ${targets.length} day(s).`, 'success');
                  }
                  exitBulk();
                  router.refresh();
                }
              });
            }}
          />
        )}
      </div>
      {bulkMode && (
        <p className="register-selection-note text-muted">
          Changing the search clears selected cells.
        </p>
      )}
      <div
        ref={scrollRef}
        className="attendance-scroll register-scroll"
        role="region"
        aria-label="Monthly attendance register"
        tabIndex={0}
      >
        <div
          id="reggrid"
          className="register-grid"
          style={{ '--register-day-count': days.length } as CSSProperties}
        >
          {/* header row */}
          <div className="attendance-row attendance-header-row">
            <div className="attendance-employee-cell">
              <span className="card-caption">Employee · summary</span>
            </div>
            <div className="attendance-days">
              {days.map((d) => (
                <div
                  key={d}
                  className={`attendance-day-header${wo.has(d) ? ' is-weekly-off' : ''}`}
                >
                  <div className="weekday-label">{weekdayLabel(periodMonth, d)}</div>
                  <div className="day-number">{d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* employee rows */}
          {visibleEmployees.map((e) => {
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
              <div key={e.id} className={`attendance-row${isOpen ? ' is-open' : ''}`}>
                <div className="attendance-employee-cell">
                  <div className="register-identity">
                    <span className="employee-name">{e.name}</span>
                    <span className="entry-details">{e.code}</span>
                  </div>
                  <div className="register-row-footer">
                    <span className="entry-details" title="Worked hours / target hours">
                      {formatHrs(e.workedMinutes)} / {formatHrs(e.targetMinutes)} hrs
                    </span>
                    <button
                      type="button"
                      className="details-toggle"
                      aria-expanded={!!isOpen}
                      aria-controls={`register-summary-${e.id}`}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} summary and punches for ${e.name}`}
                      onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                    >
                      {isOpen ? 'Hide details' : 'Details'}
                    </button>
                  </div>
                  <div
                    id={`register-summary-${e.id}`}
                    className="register-row-details"
                    hidden={!isOpen}
                  >
                    <div className="entry-details">
                      {e.branch} · {e.gender}
                    </div>
                    <div className="attendance-summary">
                      <span>
                        P <b>{e.summary.P}</b>
                      </span>
                      <span>
                        LM <b>{e.summary.LM}</b>
                      </span>
                      <span>
                        HD <b>{e.summary.HD}</b>
                      </span>
                      <span>
                        L <b>{e.summary.L}</b>
                      </span>
                      <span>
                        WO <b>{e.summary.WO}</b>
                      </span>
                    </div>
                    <div className="attendance-summary">
                      <span>
                        Working <b>{e.summary.working}</b>
                      </span>
                      {/* if late mark is more than 3 times, than it is counted as a half day */}
                      <span>
                        payable{' '}
                        <b>{e.summary.working + e.summary.WO + e.summary.HD - e.summary.L}</b>
                      </span>
                    </div>
                    <div className={`worked-hours-bar${short ? ' has-hours-shortfall' : ''}`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <div className="entry-details text-monospace">
                      {formatHrs(e.workedMinutes)} / {formatHrs(e.targetMinutes)} hrs{' '}
                      {short ? '· short' : '· met'}
                    </div>
                  </div>
                </div>
                <div className="attendance-days">
                  {days.map((d) => {
                    const c = byDay.get(d);
                    const isWeekOff = c ? c.isWeekOff : wo.has(d);
                    const punchTitle = c?.in ? `${c.in} – ${c.out} · ${c.hours}` : undefined;
                    // Include scheduled days off even when attendance is stamped P, so staff can
                    // grant comp-off for working them.
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
                        className={`attendance-day-cell${isWeekOff ? ' is-weekly-off' : ''}`}
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
                                  ? {
                                      outline: '2px solid var(--brand)',
                                      outlineOffset: -2,
                                      background: 'var(--attendance-present-background)',
                                    }
                                  : {}),
                              }
                            : undefined
                        }
                      >
                        <div
                          style={{ display: 'grid', placeItems: 'center', position: 'relative' }}
                        >
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
                                background: coGranted
                                  ? 'var(--attendance-present)'
                                  : 'var(--attendance-late)',
                              }}
                            />
                          )}
                          {c ? <AttendanceStatusBadge status={c.status} /> : null}
                          {c?.in ? (
                            <div className="punch-times">
                              {c.in}
                              <br />
                              {c.out}
                              <br />
                              <b>{c.hours}</b>
                            </div>
                          ) : (
                            <div className="punch-times text-muted">—</div>
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
      {visibleEmployees.length === 0 && (
        <div className="register-empty text-muted" role="status">
          {employees.length === 0
            ? 'No employees in this register.'
            : 'No employees match your search. Try a different name or employee ID.'}
        </div>
      )}

      {canCorrect && (
        <>
          <div
            className={`dialog-backdrop${drawerOpen ? ' is-active' : ''}`}
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className={`drawer${drawerOpen ? ' is-active' : ''}`}
            aria-label="Correct attendance"
          >
            {target && (
              // Keying on the cell *and the open counter* remounts the form every
              // time the drawer opens, resetting the field defaults, any stale
              // error, and the stale state.ok that would otherwise re-close it.
              <CorrectionForm
                key={`${target.employeeId}-${target.workDate}-${target.seq}`}
                target={target}
                onClose={() => setDrawerOpen(false)}
                onWarning={onWarning}
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
      if (state.warning) {
        onWarning?.(state.warning);
      }
      onClose();
    }
  }, [state.ok, state.warning, onClose, onWarning]);

  const { cell } = target;

  return (
    <form action={formAction} style={{ display: 'contents' }}>
      <input type="hidden" name="employee_id" value={target.employeeId} />
      <input type="hidden" name="work_date" value={target.workDate} />

      <div className="drawer-header">
        <h3>Correct attendance</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className="button quiet" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {target.compOffEligible && <CompOffPanel target={target} />}

        <div className="hint">
          {target.employeeName} · <span className="text-monospace">{target.employeeCode}</span> —{' '}
          <span className="text-monospace">{target.workDate}</span>
          {cell ? (
            <>
              {' '}
              · currently <b>{cell.status}</b>
              {cell.in ? (
                <>
                  {' '}
                  <span className="text-monospace">
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

        <div className="form-field">
          <label htmlFor="corr-status">Status</label>
          <select id="corr-status" name="status" defaultValue={cell?.status ?? 'P'}>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="corr-in">Punch in</label>
            <input
              id="corr-in"
              name="punch_in"
              type="time"
              className="text-monospace"
              defaultValue={cell?.in ?? ''}
            />
          </div>
          <div className="form-field">
            <label htmlFor="corr-out">Punch out</label>
            <input
              id="corr-out"
              name="punch_out"
              type="time"
              className="text-monospace"
              defaultValue={cell?.out ?? ''}
            />
          </div>
        </div>

        <div className="form-field">
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
          Hours are recalculated from the punch times, which are required for Present, Late mark,
          Half day, Site and Travel. To change only the status while the employee is still punched
          in today, leave punch out blank. This change is stamped as a correction against your name
          and written to the audit log.
        </div>

        {state.error && <div className="error-message">{state.error}</div>}
      </div>

      <div className="drawer-footer">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={pending}>
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
        border: '1px solid var(--attendance-late-border)',
        background: 'var(--attendance-late-background)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 14,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--attendance-late)', marginBottom: 4 }}>
        ⚡ Comp off applicable
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        {target.employeeName} worked on {target.cell?.status === 'OH' ? 'a holiday' : 'a week-off'}{' '}
        (<span className="text-monospace">{target.workDate}</span>
        {target.cell?.in ? (
          <>
            {' '}
            ·{' '}
            <span className="text-monospace">
              {target.cell.in}–{target.cell.out}
            </span>
          </>
        ) : null}
        ). Granting a comp off credits them one day, which they can then apply for from their
        dashboard.
      </p>

      {granted ? (
        <span
          className="status-badge"
          style={{
            borderColor: 'var(--attendance-present-border)',
            color: 'var(--attendance-present)',
            background: 'var(--attendance-present-background)',
          }}
        >
          ✓ Comp off granted
        </span>
      ) : (
        <button type="button" className="button primary" onClick={onGrant} disabled={pending}>
          {pending ? 'Granting…' : 'Grant comp off'}
        </button>
      )}

      {error && (
        <div className="error-message" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
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
  /**
   * The parent owns the apply transition. Await confirmation before starting it, or the dialog
   * update can remain suspended inside the transition.
   */
  pending: boolean;
  onEnter: () => void;
  onExit: () => void;
  onClear: () => void;
  onApply: (status: string, reason: string, punchIn?: string, punchOut?: string) => void;
}) {
  const [status, setStatus] = useState('L');
  const [reason, setReason] = useState('');
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  // Worked statuses need hours; the same timings are applied to every selected day.
  const needsTimes = isWorkedStatus(status);
  const timesReady = !needsTimes || (punchIn !== '' && punchOut !== '' && punchOut >= punchIn);

  function resetFields() {
    setStatus('L');
    setReason('');
    setPunchIn('');
    setPunchOut('');
  }

  if (!bulkMode) {
    return (
      <div className="register-bulk-toggle">
        <button
          type="button"
          className="button quiet"
          onClick={() => {
            resetFields();
            onEnter();
          }}
          title="Select attendance cells for bulk correction"
        >
          ☑ Select cells
        </button>
      </div>
    );
  }

  const canApply = count > 0 && reason.trim().length > 0 && timesReady && !pending;

  return (
    <div className="register-bulk-bar">
      <span className="status-badge" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
        {count} selected
      </span>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Bulk status">
        {statusOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {needsTimes && (
        <>
          <input
            type="time"
            className="text-monospace"
            value={punchIn}
            onChange={(e) => setPunchIn(e.target.value)}
            aria-label="Bulk punch in"
            title="Punch in (required for this status)"
          />
          <input
            type="time"
            className="text-monospace"
            value={punchOut}
            onChange={(e) => setPunchOut(e.target.value)}
            aria-label="Bulk punch out"
            title="Punch out (required for this status)"
          />
        </>
      )}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        style={{ flex: '1 1 220px', minWidth: 160 }}
        aria-label="Bulk correction reason"
      />
      <button
        type="button"
        className="button primary"
        disabled={!canApply}
        title={
          count === 0
            ? 'Select at least one cell'
            : !timesReady
              ? 'Enter punch in and punch out for this status'
              : !reason.trim()
                ? 'Enter a reason'
                : undefined
        }
        onClick={() =>
          onApply(
            status,
            reason.trim(),
            needsTimes ? punchIn : undefined,
            needsTimes ? punchOut : undefined,
          )
        }
      >
        {pending ? 'Applying…' : `Apply to ${count}`}
      </button>
      <button
        type="button"
        className="button quiet"
        onClick={onClear}
        disabled={pending || count === 0}
      >
        Clear
      </button>
      <button
        type="button"
        className="button quiet"
        onClick={() => {
          resetFields();
          onExit();
        }}
        disabled={pending}
      >
        Close
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
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  // JS: 0=Sun..6=Sat. DOW is Mo-first.
  return dow[(d.getDay() + 6) % 7];
}

function formatHrs(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export { isCompOffEligible, RegisterGrid };
