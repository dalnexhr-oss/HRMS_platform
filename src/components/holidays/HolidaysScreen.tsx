'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addHoliday, deleteHoliday, importHolidaysFromGoogle } from '@/lib/actions/holidays';
import { formatDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast, type ToastKind } from '@/components/ui/Toast';
import type { HolidayView } from '@/lib/queries';

export function HolidaysScreen({
  holidays,
  year,
  weekOffSummary,
  branchNames = [],
}: {
  holidays: HolidayView[];
  year: number;
  /** e.g. "Sun off · Sat off except 2nd, 4th" — the scheduled week-off rule. */
  weekOffSummary: string;
  /** Real branch names from the DB — was a hardcoded Pune/Vadodara pair. */
  branchNames?: string[];
}) {
  // One shared confirm modal + toast stack for the whole screen.
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();
  return (
    <div className="wrap grid">
      {confirmDialog}
      {toastNode}
      <div className="card">
        <div className="hd">
          <h3>Weekly off schedule</h3>
          <span className="folio">Applies to every month</span>
        </div>
        <div className="bd">
          <p style={{ margin: 0 }}>
            <b>{weekOffSummary}</b>
          </p>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            The <b>2nd and 4th Saturday are working days</b>; the 1st, 3rd and 5th Saturdays and
            every Sunday are week-offs. Change this in Settings (“Week-off days” and “Working
            Saturdays”). Working a scheduled week-off makes a comp off applicable on the register.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="hd">
            <h3>Holiday calendar {year}</h3>
            <span className="folio">{holidays.length} holidays</span>
          </div>
          <div className="bd">
            {holidays.length === 0 && (
              <p className="empty">No holidays yet — import them or add one on the right.</p>
            )}
            {holidays.map((h) => (
              <HolidayRow key={h.id} holiday={h} confirm={confirm} toast={toast} />
            ))}
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="hd">
              <h3>Import from Google Calendar</h3>
            </div>
            <div className="bd">
              <ImportHolidays year={year} toast={toast} />
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <h3>Add holiday</h3>
            </div>
            <div className="bd">
              <AddHolidayForm toast={toast} branchNames={branchNames} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportHolidays({ year, toast }: { year: number; toast: (message: string, kind?: ToastKind) => void }) {
  const router = useRouter();
  const [target, setTarget] = useState(year);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [tentative, setTentative] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const years = [year - 1, year, year + 1];

  const onImport = () =>
    start(async () => {
      setError(null);
      setResult(null);
      setTentative([]);
      const res = await importHolidaysFromGoogle(target);
      if (!res.ok) {
        setError(res.error);
        toast(res.error, 'error');
        return;
      }
      const msg =
        res.imported === 0
          ? `All ${res.skipped} public holiday(s) for ${res.year} are already in your calendar.`
          : `Imported ${res.imported} public holiday(s) for ${res.year}` +
              (res.skipped ? `, skipped ${res.skipped} already present.` : '.');
      setResult(msg);
      toast(msg, 'success');
      setTentative(res.tentative);
      router.refresh();
    });

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Pulls India’s gazetted public holidays from Google’s published calendar and adds them for
        all branches. Dates you already have are skipped, so it is safe to re-run.
      </p>

      <div className="f">
        <label>Year</label>
        <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="login-error">{error}</div>}
      {result && <div className="hint">✓&nbsp; {result}</div>}
      {tentative.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          Google lists these as <b>tentative</b> (the date can shift) — confirm before publishing:{' '}
          {tentative.join(', ')}.
        </div>
      )}

      <button className="btn primary" type="button" onClick={onImport} disabled={pending} style={{ marginTop: 4 }}>
        {pending ? 'Importing…' : `Import ${target} holidays`}
      </button>

      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        Only entries Google marks “Public holiday” are imported — the same feed carries ~37
        observances a year (Valentine’s Day, Vasant Panchami…) which are not days off.
      </p>
    </>
  );
}

function HolidayRow({
  holiday,
  confirm,
  toast,
}: {
  holiday: HolidayView;
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  toast: (message: string, kind?: ToastKind) => void;
}) {
  const [pending, startTransition] = useTransition();
  const remove = async () => {
    const ok = await confirm({
      title: 'Delete holiday',
      message: `Delete “${holiday.name}” (${formatDate(holiday.date)})? This affects payable-day counts for that date.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteHoliday(holiday.id);
      if (!res.ok) toast(res.error ?? 'Could not delete the holiday.', 'error');
      else toast('Holiday deleted.', 'success');
    });
  };

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--line-2)',
      }}
    >
      <div className="f-row" style={{ alignItems: 'center', gap: 12 }}>
        <span className="mono" style={{ minWidth: 96, color: 'var(--ink-3)' }}>
          {formatDate(holiday.date)}
        </span>
        <strong style={{ flex: 1 }}>{holiday.name}</strong>
        <span
          className="pill"
          style={
            holiday.branch
              ? { borderColor: 'var(--line-2)', color: 'var(--ink-3)' }
              : { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }
          }
        >
          {holiday.branch ?? 'All branches'}
        </span>
        <button className="btn quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function AddHolidayForm({
  toast,
  branchNames = [],
}: {
  toast: (message: string, kind?: ToastKind) => void;
  branchNames?: string[];
}) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await addHoliday(formData);
      if (res.ok) toast('Holiday added.', 'success');
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="f">
        <label>Date</label>
        <input name="holiday_date" type="date" required />
      </div>
      <div className="f">
        <label>Name</label>
        <input name="name" placeholder="e.g. Independence Day" required />
      </div>
      <div className="f">
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

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Holiday added.</div>}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add holiday'}
      </button>
    </form>
  );
}
