'use client';

import { useActionState, useState, useTransition } from 'react';
import { openNoticePdf } from '@/components/notices/open-pdf';
import { formatDate } from '@/lib/display-formatting';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { createNotice, updateNotice, deleteNotice, setNoticePublished } from '@/lib/actions/notices';
import sectionStyles from '@/components/ui/SectionCard.module.css';
import type { NotificationKind } from '@/components/ui/Notifications';
import type { NoticeView } from '@/lib/queries/notices';

const channelLabel: Record<NoticeView['channel'], string> = {
  app: 'App',
  whatsapp: 'WhatsApp',
  both: 'Both',
};

function NoticesScreen({
  notices,
  branchNames = [],
}: {
  notices: NoticeView[];
  // Active company branch names used for targeting notices.
  branchNames?: string[];
}) {
  const [editing, setEditing] = useState<NoticeView | null>(null);
  // Confirm + notification are hoisted so every row shares one modal / notification stack.
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  return (
    <div className="two-column-layout">
      {confirmDialog}
      {notificationContainer}
      <div className={`card ${sectionStyles.panel}`}>
        <div className="card-header">
          <h3>Published notices</h3>
          <span className="card-caption">{notices.length} total</span>
        </div>
        <div className="card-body">
          {notices.length === 0 && (
            <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              No notices yet. Use “Publish a notice” to add one.
            </p>
          )}
          {notices.map((n) => (
            <NoticeItem
              key={n.id}
              notice={n}
              onEdit={() => setEditing(n)}
              confirm={confirm}
              showNotification={showNotification}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{editing ? 'Edit notice' : 'Publish a notice'}</h3>
        </div>
        <div className="card-body">
          <NoticeForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onDone={() => setEditing(null)}
            showNotification={showNotification}
            branchNames={branchNames}
          />
        </div>
      </div>
    </div>
  );
}

function NoticeItem({
  notice,
  onEdit,
  confirm,
  showNotification,
}: {
  notice: NoticeView;
  onEdit: () => void;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const res = await setNoticePublished(notice.id, !notice.published);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not update the notice.', 'error');
      } else {
        showNotification(notice.published ? 'Notice unpublished.' : 'Notice published.', 'success');
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete notice',
      message: `Delete “${notice.title}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    startTransition(async () => {
      const res = await deleteNotice(notice.id);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not delete the notice.', 'error');
      } else {
        showNotification('Notice deleted.', 'success');
      }
    });
  };

  return (
    <div className="policy">
      <div className="entry-header">
        <h4>{notice.title}</h4>
        <span className="status-badge">{channelLabel[notice.channel]}</span>
        <span className="entry-category">{notice.branch ?? 'All branches'}</span>
        <span style={{ flex: 1 }} />
        {notice.published && notice.publishedAt ? (
          <span className="entry-version">{formatDate(notice.publishedAt.slice(0, 10))}</span>
        ) : (
          <span
            className="status-badge"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
          >
            Draft
          </span>
        )}
        {notice.pdfPath && (
          <button
            className="button quiet"
            onClick={() => openNoticePdf(notice.id, (m) => showNotification(m, 'error'))}
            title="Open the attached PDF"
          >
            📎 PDF
          </button>
        )}
        <button className="button quiet" onClick={onEdit} disabled={pending}>
          Edit
        </button>
        <button className="button" onClick={toggle} disabled={pending}>
          {pending ? '…' : notice.published ? 'Unpublish' : 'Publish'}
        </button>
        <button className="button quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
      {notice.body && <p className="entry-body text-muted">{notice.body}</p>}
    </div>
  );
}

function NoticeForm({
  editing,
  onDone,
  showNotification,
  branchNames = [],
}: {
  editing: NoticeView | null;
  onDone: () => void;
  showNotification: (message: string, kind?: NotificationKind) => void;
  branchNames?: string[];
}) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = editing ? await updateNotice(editing.id, formData) : await createNotice(formData);
      if (res.ok) {
        showNotification(editing ? 'Notice updated.' : 'Notice published.', 'success');
        if (editing) {
          onDone();
        }
      }
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="form-field">
        <label>Title</label>
        <input
          name="title"
          placeholder="e.g. Diwali holiday schedule"
          required
          defaultValue={editing?.title}
        />
      </div>
      <div className="form-field">
        <label>Body</label>
        <textarea
          name="body"
          rows={5}
          defaultValue={editing?.body ?? ''}
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Channel</label>
          <select name="channel" defaultValue={editing?.channel ?? 'app'}>
            <option value="app">App</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div className="form-field">
          <label>Branch</label>
          <select name="branch" defaultValue={editing?.branch ?? ''}>
            <option value="">All branches</option>
            {branchNames.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label>
          PDF attachment{' '}
          {editing?.pdfPath ? '(choosing a file replaces the current one)' : '(optional)'}
        </label>
        <input type="file" name="pdf" accept=".pdf,application/pdf" />
        {editing?.pdfPath && (
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6 }}
          >
            <input type="checkbox" name="remove_pdf" /> Remove the current PDF
          </label>
        )}
      </div>
      {!editing && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}
        >
          <input type="checkbox" name="publish" defaultChecked /> Publish immediately
        </label>
      )}

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && !editing && <div className="hint">✓&nbsp; Notice saved.</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Publish notice'}
        </button>
        {editing && (
          <button className="button quiet" type="button" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export { NoticesScreen };
