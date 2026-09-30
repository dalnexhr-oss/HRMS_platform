'use client';

import { useNotifications } from '@/components/ui/Notifications';
import { formatDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useActionState, useState, useTransition } from 'react';
import { createPolicy, updatePolicy, deletePolicy, setPolicyPublished } from '@/lib/actions/policies';
import type { NotificationKind } from '@/components/ui/Notifications';
import type { Policy } from '@/types/database';

function PolicyAdmin({
  policies,
  ackCounts = {},
  headcount = 0,
}: {
  policies: Policy[];
  // policy_id -> employees who have filed a read receipt.
  ackCounts?: Record<string, number>;
  // Active headcount — the denominator for "n/N read".
  headcount?: number;
}) {
  const [editing, setEditing] = useState<Policy | null>(null);
  // Shared confirm modal + notification stack for every row and the form.
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  return (
    <div className="two-column-layout">
      {confirmDialog}
      {notificationContainer}
      <div className="card">
        <div className="card-header">
          <h3>Published &amp; draft policies</h3>
          <span className="card-caption">{policies.length} total</span>
        </div>
        <div className="card-body">
          {policies.length === 0 && (
            <p className="text-muted">No policies yet — create one on the right.</p>
          )}
          {policies.map((p) => (
            <PolicyItem
              key={p.id}
              policy={p}
              ackCount={ackCounts[p.id] ?? 0}
              headcount={headcount}
              onEdit={() => setEditing(p)}
              confirm={confirm}
              showNotification={showNotification}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{editing ? 'Edit policy' : 'New policy'}</h3>
        </div>
        <div className="card-body">
          <PolicyForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onDone={() => setEditing(null)}
            showNotification={showNotification}
          />
        </div>
      </div>
    </div>
  );
}

function PolicyItem({
  policy,
  ackCount,
  headcount,
  onEdit,
  confirm,
  showNotification,
}: {
  policy: Policy;
  ackCount: number;
  headcount: number;
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
      const res = await setPolicyPublished(policy.id, !policy.published);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not update the policy.', 'error');
      } else {
        showNotification(policy.published ? 'Policy unpublished.' : 'Policy published.', 'success');
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete policy',
      message: `Delete “${policy.title}”? This removes it and all read receipts.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    startTransition(async () => {
      const res = await deletePolicy(policy.id);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not delete the policy.', 'error');
      } else {
        showNotification('Policy deleted.', 'success');
      }
    });
  };

  return (
    <div className="policy">
      <div className="entry-header">
        <h4>{policy.title}</h4>
        {policy.category && <span className="entry-category">{policy.category}</span>}
        <span className="entry-version">
          v{policy.version}
          {policy.effective_date ? ` · from ${formatDate(policy.effective_date)}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {/* Read receipts only mean anything once a policy is published. */}
        {policy.published && (
          <span
            className="status-badge"
            style={
              headcount > 0 && ackCount >= headcount
                ? { borderColor: 'var(--attendance-present-border)', color: 'var(--attendance-present)', background: 'var(--attendance-present-background)' }
                : { borderColor: 'var(--border-strong)', color: 'var(--attendance-half-day)' }
            }
            title="Employees who have marked this policy as read"
          >
            {headcount > 0 ? `${ackCount}/${headcount} read` : `${ackCount} read`}
          </span>
        )}
        <span
          className="status-badge"
          style={
            policy.published
              ? { borderColor: 'var(--attendance-present-border)', color: 'var(--attendance-present)', background: 'var(--attendance-present-background)' }
              : { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }
          }
        >
          {policy.published ? 'Published' : 'Draft'}
        </span>
        <button className="button quiet" onClick={onEdit} disabled={pending}>
          Edit
        </button>
        <button className="button" onClick={toggle} disabled={pending}>
          {pending ? '…' : policy.published ? 'Unpublish' : 'Publish'}
        </button>
        <button className="button quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
      <p className="entry-body">{policy.body}</p>
    </div>
  );
}

function PolicyForm({
  editing,
  onDone,
  showNotification,
}: {
  editing: Policy | null;
  onDone: () => void;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = editing ? await updatePolicy(editing.id, formData) : await createPolicy(formData);
      if (res.ok) {
        showNotification(editing ? 'Policy updated.' : 'Policy saved.', 'success');
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
          placeholder="e.g. Remote Work Policy"
          required
          defaultValue={editing?.title}
        />
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Category</label>
          <input
            name="category"
            placeholder="HR / Leave / Payroll…"
            defaultValue={editing?.category ?? ''}
          />
        </div>
        <div className="form-field">
          <label>Version</label>
          <input
            name="version"
            className="text-monospace"
            defaultValue={editing ? String(editing.version) : '1'}
          />
        </div>
      </div>
      <div className="form-field">
        <label>Effective date</label>
        <input name="effective_date" type="date" defaultValue={editing?.effective_date ?? ''} />
      </div>
      <div className="form-field">
        <label>Body</label>
        <textarea
          name="body"
          rows={5}
          required
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
      {!editing && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}
        >
          <input type="checkbox" name="published" defaultChecked /> Publish immediately
        </label>
      )}

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && !editing && <div className="hint">✓&nbsp; Policy saved.</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Save policy'}
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

export { PolicyAdmin };
