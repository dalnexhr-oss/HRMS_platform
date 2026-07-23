'use client';

import { useActionState, useState, useTransition } from 'react';
import { createPolicy, updatePolicy, deletePolicy, setPolicyPublished } from '@/lib/actions/policies';
import { formatDate } from '@/lib/format';
import type { Policy } from '@/types/database';

export function PolicyAdmin({ policies }: { policies: Policy[] }) {
  const [editing, setEditing] = useState<Policy | null>(null);

  return (
    <div className="two-col">
      <div className="card">
        <div className="hd">
          <h3>Published &amp; draft policies</h3>
          <span className="folio">{policies.length} total</span>
        </div>
        <div className="bd">
          {policies.length === 0 && <p className="muted">No policies yet — create one on the right.</p>}
          {policies.map((p) => (
            <PolicyItem key={p.id} policy={p} onEdit={() => setEditing(p)} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>{editing ? 'Edit policy' : 'New policy'}</h3>
        </div>
        <div className="bd">
          <PolicyForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} />
        </div>
      </div>
    </div>
  );
}

function PolicyItem({ policy, onEdit }: { policy: Policy; onEdit: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const res = await setPolicyPublished(policy.id, !policy.published);
      if (!res.ok) setError(res.error ?? 'Could not update the policy.');
    });
  };

  const remove = () => {
    if (!window.confirm(`Delete “${policy.title}”? This removes it and all read receipts.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deletePolicy(policy.id);
      if (!res.ok) setError(res.error ?? 'Could not delete the policy.');
    });
  };

  return (
    <div className="policy">
      <div className="phd">
        <h4>{policy.title}</h4>
        {policy.category && <span className="cat">{policy.category}</span>}
        <span className="ver">
          v{policy.version}
          {policy.effective_date ? ` · from ${formatDate(policy.effective_date)}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="pill"
          style={
            policy.published
              ? { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }
              : { borderColor: 'var(--line-2)', color: 'var(--ink-3)' }
          }
        >
          {policy.published ? 'Published' : 'Draft'}
        </span>
        <button className="btn quiet" onClick={onEdit} disabled={pending}>
          Edit
        </button>
        <button className="btn" onClick={toggle} disabled={pending}>
          {pending ? '…' : policy.published ? 'Unpublish' : 'Publish'}
        </button>
        <button className="btn quiet" onClick={remove} disabled={pending}>
          {pending ? '…' : 'Delete'}
        </button>
      </div>
      <p className="body">{policy.body}</p>
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}

function PolicyForm({ editing, onDone }: { editing: Policy | null; onDone: () => void }) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = editing ? await updatePolicy(editing.id, formData) : await createPolicy(formData);
      if (res.ok && editing) onDone();
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="f">
        <label>Title</label>
        <input name="title" placeholder="e.g. Remote Work Policy" required defaultValue={editing?.title} />
      </div>
      <div className="f-row">
        <div className="f">
          <label>Category</label>
          <input name="category" placeholder="HR / Leave / Payroll…" defaultValue={editing?.category ?? ''} />
        </div>
        <div className="f">
          <label>Version</label>
          <input name="version" className="mono" defaultValue={editing ? String(editing.version) : '1'} />
        </div>
      </div>
      <div className="f">
        <label>Effective date</label>
        <input name="effective_date" type="date" defaultValue={editing?.effective_date ?? ''} />
      </div>
      <div className="f">
        <label>Body</label>
        <textarea
          name="body"
          rows={5}
          required
          defaultValue={editing?.body ?? ''}
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
      {!editing && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
          <input type="checkbox" name="published" defaultChecked /> Publish immediately
        </label>
      )}

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && !editing && <div className="hint">✓&nbsp; Policy saved.</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Save policy'}
        </button>
        {editing && (
          <button className="btn quiet" type="button" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
