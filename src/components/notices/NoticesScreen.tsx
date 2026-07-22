'use client';

import { useActionState, useState, useTransition } from 'react';
import { createNotice, deleteNotice } from '@/lib/actions/notices';
import { formatDate } from '@/lib/format';
import type { NoticeView } from '@/lib/queries';

const CHANNEL_LABEL: Record<NoticeView['channel'], string> = {
  app: 'App',
  whatsapp: 'WhatsApp',
  both: 'Both',
};

export function NoticesScreen({ notices }: { notices: NoticeView[] }) {
  return (
    <div className="two-col">
      <div className="card">
        <div className="hd">
          <h3>Published notices</h3>
          <span className="folio">{notices.length} total</span>
        </div>
        <div className="bd">
          {notices.length === 0 && (
            <p className="muted">No notices yet — publish one on the right.</p>
          )}
          {notices.map((n) => (
            <NoticeItem key={n.id} notice={n} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Publish a notice</h3>
        </div>
        <div className="bd">
          <PublishNoticeForm />
        </div>
      </div>
    </div>
  );
}

function NoticeItem({ notice }: { notice: NoticeView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteNotice(notice.id);
      if (!res.ok) setError(res.error ?? 'Could not delete the notice.');
    });
  };

  return (
    <div className="policy">
      <div className="phd">
        <h4>{notice.title}</h4>
        <span className="pill">{CHANNEL_LABEL[notice.channel]}</span>
        <span className="cat">{notice.branch ?? 'All branches'}</span>
        <span style={{ flex: 1 }} />
        {notice.published && notice.publishedAt ? (
          <span className="ver">{formatDate(notice.publishedAt.slice(0, 10))}</span>
        ) : (
          <span
            className="pill"
            style={{ borderColor: 'var(--line-2)', color: 'var(--ink-3)' }}
          >
            Draft
          </span>
        )}
        <button className="btn quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
      {notice.body && <p className="body muted">{notice.body}</p>}
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}

function PublishNoticeForm() {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => createNotice(formData),
    {},
  );

  return (
    <form action={action}>
      <div className="f">
        <label>Title</label>
        <input name="title" placeholder="e.g. Diwali holiday schedule" required />
      </div>
      <div className="f">
        <label>Body</label>
        <textarea
          name="body"
          rows={5}
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--line-2)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>
      <div className="f-row">
        <div className="f">
          <label>Channel</label>
          <select name="channel" defaultValue="app">
            <option value="app">App</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div className="f">
          <label>Branch</label>
          <select name="branch" defaultValue="">
            <option value="">All branches</option>
            <option value="Pune">Pune</option>
            <option value="Vadodara">Vadodara</option>
          </select>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
        <input type="checkbox" name="publish" defaultChecked /> Publish immediately
      </label>

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Notice saved.</div>}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Publishing…' : 'Publish notice'}
      </button>
    </form>
  );
}
