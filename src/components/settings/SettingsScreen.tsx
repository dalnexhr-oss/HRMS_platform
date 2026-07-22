'use client';

import { useState, useTransition } from 'react';
import { updateSetting } from '@/lib/actions/settings';
import type { SettingView } from '@/lib/queries';

export function SettingsScreen({ settings }: { settings: SettingView[] }) {
  return (
    <div className="wrap">
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
              <SettingRow key={s.key} setting={s} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ setting }: { setting: SettingView }) {
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
      if (res.ok) setSaved(true);
      else setError(res.error ?? 'Could not save this setting.');
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
