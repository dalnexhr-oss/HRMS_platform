'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addHoliday, deleteHoliday, importHolidaysFromGoogle } from '@/lib/actions/holidays';
import { formatDate, yearOptionsAround } from '@/lib/display-formatting';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import type { NotificationKind } from '@/components/ui/Notifications';
import type { HolidayView } from '@/lib/queries/holidays';

function HolidaysScreen({
  holidays,
  year,
  weekOffSummary,
  branchNames = [],
}: {
  holidays: HolidayView[];
  year: number;
  // e.g. "Sun off · Sat off except 2nd, 4th" — the scheduled week-off rule.
  weekOffSummary: string;
  // Real branch names from the DB — was a hardcoded Pune/Vadodara pair.
  branchNames?: string[];
}) {
  // One shared confirm modal + notification stack for the whole screen.
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();
  return (
    <div className="content-container grid">
      {confirmDialog}
      {notificationContainer}
      <div className="card">
        <div className="card-header">
          <h3>Weekly off schedule</h3>
          <span className="card-caption">Applies to every month</span>
        </div>
        <div className="card-body">
          <p style={{ margin: 0 }}>
            <b>{weekOffSummary}</b>
          </p>
          <p className="text-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            The <b>2nd and 4th Saturday are working days</b>; the 1st, 3rd and 5th Saturdays and
            every Sunday are week-offs. Change this in Settings (“Week-off days” and “Working
            Saturdays”). Working a scheduled week-off makes a comp off applicable on the register.
          </p>
        </div>
      </div>

      <div className="two-column-layout">
        <div className="card">
          <div className="card-header">
            <h3>Holiday calendar {year}</h3>
            <span className="card-caption">{holidays.length} holidays</span>
          </div>
          <div className="card-body">
            {holidays.length === 0 && (
              <p className="empty-state">No holidays yet — import them or add one on the right.</p>
            )}
            {holidays.map((h) => (
              <HolidayRow
                key={h.id}
                holiday={h}
                confirm={confirm}
                showNotification={showNotification}
              />
            ))}
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="card-header">
              <h3>Import from Google Calendar</h3>
            </div>
            <div className="card-body">
              <ImportHolidays year={year} showNotification={showNotification} />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Add holiday</h3>
            </div>
            <div className="card-body">
              <AddHolidayForm showNotification={showNotification} branchNames={branchNames} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportHolidays({
  year,
  showNotification,
}: {
  year: number;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState(year);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [tentative, setTentative] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const years = yearOptionsAround(year);

  const onImport = () =>
    start(async () => {
      setError(null);
      setResult(null);
      setTentative([]);
      const res = await importHolidaysFromGoogle(target);
      if (!res.ok) {
        setError(res.error);
        showNotification(res.error, 'error');
        return;
      }
      const msg =
        res.imported === 0
          ? `All ${res.skipped} public holiday(s) for ${res.year} are already in your calendar.`
          : `Imported ${res.imported} public holiday(s) for ${res.year}${
              res.skipped ? `, skipped ${res.skipped} already present.` : '.'
            }`;
      setResult(msg);
      showNotification(msg, 'success');
      setTentative(res.tentative);
      router.refresh();
    });

  return (
    <>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Pulls India’s gazetted public holidays from Google’s published calendar and adds them for
        all branches. Dates you already have are skipped, so it is safe to re-run.
      </p>

      <div className="form-field">
        <label>Year</label>
        <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}
      {result && <div className="hint">✓&nbsp; {result}</div>}
      {tentative.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          Google lists these as <b>tentative</b> (the date can shift) — confirm before publishing:{' '}
          {tentative.join(', ')}.
        </div>
      )}

      <button
        className="button primary"
        type="button"
        onClick={onImport}
        disabled={pending}
        style={{ marginTop: 4 }}
      >
        {pending ? 'Importing…' : `Import ${target} holidays`}
      </button>

      <p className="text-muted" style={{ fontSize: 11, marginBottom: 0 }}>
        Only entries Google marks “Public holiday” are imported — the same feed carries ~37
        observances a year (Valentine’s Day, Vasant Panchami…) which are not days off.
      </p>
    </>
  );
}

function HolidayRow({
  holiday,
  confirm,
  showNotification,
}: {
  holiday: HolidayView;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const [pending, startTransition] = useTransition();
  const remove = async () => {
    const ok = await confirm({
      title: 'Delete holiday',
      message: `Delete “${holiday.name}” (${formatDate(holiday.date)})? This affects payable-day counts for that date.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    startTransition(async () => {
      const res = await deleteHoliday(holiday.id);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not delete the holiday.', 'error');
      } else {
        showNotification('Holiday deleted.', 'success');
      }
    });
  };

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--border-strong)',
      }}
    >
      <div className="form-row" style={{ alignItems: 'center', gap: 12 }}>
        <span className="text-monospace" style={{ minWidth: 96, color: 'var(--text-muted)' }}>
          {formatDate(holiday.date)}
        </span>
        <strong style={{ flex: 1 }}>{holiday.name}</strong>
        <span
          className="status-badge"
          style={
            holiday.branch
              ? { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }
              : {
                  borderColor: 'var(--attendance-present-border)',
                  color: 'var(--attendance-present)',
                  background: 'var(--attendance-present-background)',
                }
          }
        >
          {holiday.branch ?? 'All branches'}
        </span>
        <button className="button quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function AddHolidayForm({
  showNotification,
  branchNames = [],
}: {
  showNotification: (message: string, kind?: NotificationKind) => void;
  branchNames?: string[];
}) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await addHoliday(formData);
      if (res.ok) {
        showNotification('Holiday added.', 'success');
      }
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="form-field">
        <label>Date</label>
        <input name="holiday_date" type="date" required />
      </div>
      <div className="form-field">
        <label>Name</label>
        <input name="name" placeholder="e.g. Independence Day" required />
      </div>
      <div className="form-field">
        <label>Branch</label>
        <select name="branch" defaultValue="">
          <option value="">All branches</option>
          {branchNames.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Holiday added.</div>}

      <button className="button primary" type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add holiday'}
      </button>
    </form>
  );
}

export { HolidaysScreen };
