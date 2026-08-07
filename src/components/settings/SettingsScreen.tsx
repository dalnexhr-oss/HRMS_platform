'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSetting } from '@/lib/actions/settings';
import { updateBranch, deleteBranch } from '@/lib/actions/branches';
import { INDIAN_STATES } from '@/lib/constants';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast, type ToastKind } from '@/components/ui/Toast';
import type { SettingView, BranchRow } from '@/lib/queries';

export function SettingsScreen({
  settings,
  branches = [],
}: {
  settings: SettingView[];
  branches?: BranchRow[];
}) {
  const { toast, toastNode } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div className="wrap grid">
      {toastNode}
      {confirmDialog}
      <div className="card">
        <div className="hd">
          <h3>Branches</h3>
          <span className="folio">{branches.length} configured</span>
        </div>
        <div className="bd">
          <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
            New branches are created from the employee form (&ldquo;+ Add new branch&rdquo;). Fix a
            name or state here, or remove a branch added by mistake — a branch with employees
            cannot be deleted.
          </p>
          {branches.length === 0 && <p className="empty">No branches yet.</p>}
          <div style={{ display: 'grid', gap: 12 }}>
            {branches.map((b) => (
              <BranchManageRow key={b.id} branch={b} toast={toast} confirm={confirm} />
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Rule flags</h3>
          <span className="folio">{settings.length} rules</span>
        </div>
        <div className="bd">
          <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
            Every open rule is a switch.
          </p>
          {settings.length === 0 && <p className="empty">No rules configured.</p>}
          <div style={{ display: 'grid', gap: 12 }}>
            {settings.map((s) => (
              <SettingRow key={s.key} setting={s} toast={toast} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchManageRow({
  branch,
  toast,
  confirm,
}: {
  branch: BranchRow;
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const router = useRouter();
  const [name, setName] = useState(branch.name);
  const [state, setState] = useState(branch.state);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== branch.name || state !== branch.state;

  const save = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('name', name);
      fd.set('state', state);
      const res = await updateBranch(branch.id, fd);
      if (!res.ok) {
        toast(res.error ?? 'Could not update the branch.', 'error');
        return;
      }
      toast(`Branch “${name.trim()}” saved.`, 'success');
      router.refresh();
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete branch',
      message:
        `Delete “${branch.name}”? Holidays and notices scoped to it go with it. ` +
        'A branch that still has employees cannot be deleted.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteBranch(branch.id);
      if (!res.ok) {
        toast(res.error ?? 'Could not delete the branch.', 'error');
        return;
      }
      toast(`Branch “${branch.name}” deleted.`, 'success');
      router.refresh();
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '12px 14px',
        border: '1px solid var(--line-2)',
        borderRadius: 10,
        background: 'var(--card-2, #fff)',
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ flex: '1 1 160px', minWidth: 0 }}
        aria-label="Branch name"
      />
      <select
        value={state}
        onChange={(e) => setState(e.target.value)}
        style={{ flex: '1 1 200px', minWidth: 0 }}
        aria-label="Branch state"
      >
        {/* A stored state missing from the list (pre-0040 data oddity) stays selectable. */}
        {!(INDIAN_STATES as readonly string[]).includes(state) && (
          <option value={state}>{state}</option>
        )}
        {INDIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button className="btn primary" onClick={save} disabled={pending || !dirty || !name.trim()}>
        {pending ? '…' : 'Save'}
      </button>
      <button className="btn quiet" onClick={remove} disabled={pending}>
        Delete
      </button>
    </div>
  );
}

function SettingRow({ setting, toast }: { setting: SettingView; toast: (message: string, kind?: ToastKind) => void }) {
  const isNumber = typeof setting.value === 'number';
  const [value, setValue] = useState(String(setting.value ?? ''));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setSaved(false);
    setError(null);
    const parsed: unknown = isNumber ? Number(value) : value;
    startTransition(async () => {
      const res = await updateSetting(setting.key, parsed);
      if (res.ok) {
        setSaved(true);
        toast(`Saved “${setting.label ?? setting.key}”.`, 'success');
      } else {
        setError(res.error ?? 'Could not save this setting.');
        toast(res.error ?? 'Could not save this setting.', 'error');
      }
    });
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '12px 14px',
        border: '1px solid var(--line-2)',
        borderRadius: 10,
        background: 'var(--card-2, #fff)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{setting.label ?? setting.key}</div>
        {setting.description && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {setting.description}
          </div>
        )}
        <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
          {setting.key}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="mono"
          type={isNumber ? 'number' : 'text'}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          style={{ width: 110, textAlign: 'right' }}
        />
        <button className="btn primary" onClick={save} disabled={pending}>
          {pending ? '…' : 'Save'}
        </button>
        {saved && !pending && (
          <span className="hint" style={{ whiteSpace: 'nowrap' }}>
            ✓ Saved
          </span>
        )}
        {error && !pending && (
          <span className="login-error" role="alert" style={{ whiteSpace: 'nowrap' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
