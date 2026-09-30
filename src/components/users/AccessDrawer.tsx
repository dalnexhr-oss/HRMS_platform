'use client';

// Super-admin control for individual admin/HR tab access. setUserTabAccess checks both the caller
// and target roles.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fetchUserTabAccess, setUserTabAccess, resetUserTabAccess } from '@/lib/actions/access';
import { navItems, groupOrder } from '@/lib/constants';
import { canAccessTab, staticallyAllowed } from '@/lib/access';
import type { TabAccess } from '@/lib/access';
import type { AppRole } from '@/types/database';

interface AccessTarget {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
}

function AccessDrawer({
  user,
  onClose,
  onNotification,
}: {
  user: AccessTarget | null;
  onClose: () => void;
  onNotification: (msg: string, kind: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const open = user !== null;
  const [access, setAccess] = useState<TabAccess>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latestId = useRef<string | null>(null);

  // Load this account's switches whenever the panel opens on someone new.
  useEffect(() => {
    if (!user) {
      return;
    }
    latestId.current = user.id;
    setLoading(true);
    setLoadError(null);
    fetchUserTabAccess(user.id).then((res) => {
      if (latestId.current !== user.id) {
        // a newer account opened meanwhile
        return;
      }
      setLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        setAccess({});
        return;
      }
      setAccess(res.access);
    });
  }, [user]);

  function toggle(slug: string, next: boolean) {
    if (!user) {
      return;
    }
    setBusySlug(slug);
    // Optimistic: the switch answers immediately, and a failure puts it back.
    setAccess((a) => ({ ...a, [slug]: next }));
    startTransition(async () => {
      const res = await setUserTabAccess(user.id, slug, next);
      setBusySlug(null);
      if (!res.ok) {
        setAccess((a) => ({ ...a, [slug]: !next }));
        onNotification(res.error ?? 'Could not change that.', 'error');
        return;
      }
      router.refresh();
    });
  }

  function onReset() {
    if (!user) {
      return;
    }
    setBusySlug('__reset');
    startTransition(async () => {
      const res = await resetUserTabAccess(user.id);
      setBusySlug(null);
      if (!res.ok) {
        onNotification(res.error ?? 'Could not reset.', 'error');
        return;
      }
      setAccess({});
      onNotification('All tabs restored.', 'success');
      router.refresh();
    });
  }

  // Tabs this account's ROLE can reach at all. Anything else is not ours to give.
  const eligible = user ? navItems.filter((n) => staticallyAllowed(user.role, n.slug)) : [];
  const revoked = user
    ? eligible.filter((n) => !canAccessTab(user.role, n.slug, access)).length
    : 0;

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' is-active' : ''}`} aria-label="Tab access">
        {user && (
          <>
            <div className="drawer-header">
              <h3>Tab access</h3>
              <span style={{ flex: 1 }} />
              <button type="button" className="button quiet" onClick={onClose}>
                ✕
              </button>
            </div>

            <div className="drawer-body">
              <div className="hint" style={{ marginBottom: 14 }}>
                <span>
                  <b>{user.fullName || user.email}</b>{' '}
                  <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                    {user.role === 'hr' ? 'HR' : 'Admin'}
                  </span>
                  <br />
                  Unticking a tab removes it from this person&rsquo;s sidebar.
                  {revoked > 0 && (
                    <>
                      {' '}
                      <b>
                        {revoked} tab{revoked === 1 ? '' : 's'} currently hidden.
                      </b>
                    </>
                  )}
                </span>
              </div>

              {loadError && (
                <div className="hint" style={{ borderColor: 'var(--attendance-absent)', color: 'var(--attendance-absent)' }}>
                  {loadError}
                </div>
              )}

              {loading ? (
                <p className="text-muted">Loading…</p>
              ) : (
                groupOrder.map((group) => {
                  const rows = eligible.filter((n) => n.group === group);
                  if (rows.length === 0) {
                    return null;
                  }
                  return (
                    <div key={group} style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          font: '600 10px var(--font-monospace)',
                          letterSpacing: '.13em',
                          textTransform: 'uppercase',
                          color: 'var(--text-muted)',
                          marginBottom: 6,
                        }}
                      >
                        {group}
                      </div>
                      {rows.map((n) => {
                        const on = canAccessTab(user.role, n.slug, access);
                        return (
                          <label
                            key={n.slug}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 9,
                              padding: '7px 8px',
                              borderRadius: 8,
                              cursor: 'pointer',
                              opacity: pending && busySlug === n.slug ? 0.5 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={pending && busySlug !== null}
                              onChange={(e) => toggle(n.slug, e.target.checked)}
                              style={{
                                width: 16,
                                height: 16,
                                flex: 'none',
                                accentColor: 'var(--brand)',
                              }}
                            />
                            <span style={{ flex: 1 }}>{n.label}</span>
                            <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                              /{n.slug}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <div className="drawer-footer">
              <button
                type="button"
                className="button quiet"
                onClick={onReset}
                disabled={pending && busySlug === '__reset'}
                title="Give this account every tab its role allows"
              >
                Restore all tabs
              </button>
              <button type="button" className="button primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

export { AccessDrawer, type AccessTarget };
