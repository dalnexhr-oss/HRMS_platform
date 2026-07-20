'use client';

import { useActionState, useTransition } from 'react';
import { createPolicy, setPolicyPublished } from '@/lib/actions/policies';
import { formatDate } from '@/lib/format';
import type { Policy } from '@/types/database';

export function PolicyAdmin({ policies }: { policies: Policy[] }) {
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
            <PolicyItem key={p.id} policy={p} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>New policy</h3>
        </div>
        <div className="bd">
          <NewPolicyForm />
        </div>
      </div>
    </div>
  );
}

function PolicyItem({ policy }: { policy: Policy }) {
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      await setPolicyPublished(policy.id, !policy.published);
    });

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
        <button className="btn" onClick={toggle} disabled={pending}>
          {pending ? '…' : policy.published ? 'Unpublish' : 'Publish'}
        </button>
      </div>
      <p className="body">{policy.body}</p>
    </div>
  );
}

function NewPolicyForm() {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => createPolicy(formData),
    {},
  );

  return (
    <form action={action}>
      <div className="f">
        <label>Title</label>
        <input name="title" placeholder="e.g. Remote Work Policy" required />
      </div>
      <div className="f-row">
        <div className="f">
          <label>Category</label>
          <input name="category" placeholder="HR / Leave / Payroll…" />
        </div>
        <div className="f">
          <label>Version</label>
          <input name="version" className="mono" defaultValue="1" />
        </div>
      </div>
      <div className="f">
        <label>Effective date</label>
        <input name="effective_date" type="date" />
      </div>
      <div className="f">
        <label>Body</label>
        <textarea
          name="body"
          rows={5}
          required
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
        <input type="checkbox" name="published" defaultChecked /> Publish immediately
      </label>

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Policy saved.</div>}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save policy'}
      </button>
    </form>
  );
}
