'use client';

import { useActionState, useTransition } from 'react';
import { addHoliday, deleteHoliday } from '@/lib/actions/holidays';
import { formatDate } from '@/lib/format';
import type { HolidayView } from '@/lib/queries';

export function HolidaysScreen({ holidays }: { holidays: HolidayView[] }) {
  return (
    <div className="wrap">
      <div className="two-col">
        <div className="card">
          <div className="hd">
            <h3>Holiday calendar 2026</h3>
            <span className="folio">{holidays.length} holidays</span>
          </div>
          <div className="bd">
            {holidays.length === 0 && (
              <p className="empty">No holidays yet — add the 2026 list on the right.</p>
            )}
            {holidays.map((h) => (
              <HolidayRow key={h.id} holiday={h} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="hd">
            <h3>Add holiday</h3>
          </div>
          <div className="bd">
            <AddHolidayForm />
          </div>
        </div>
      </div>
    </div>
  );
}

function HolidayRow({ holiday }: { holiday: HolidayView }) {
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      await deleteHoliday(holiday.id);
    });

  return (
    <div
      className="f-row"
      style={{
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--line-2)',
      }}
    >
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
  );
}

function AddHolidayForm() {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => addHoliday(formData),
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
          <option value="Pune">Pune</option>
          <option value="Vadodara">Vadodara</option>
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
