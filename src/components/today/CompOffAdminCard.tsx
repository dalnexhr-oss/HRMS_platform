'use client';

// Show usable comp-off balances and let staff toggle credit applicability. Used and expired credits
// are retired regardless of that toggle.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/display-formatting';
import { setCompOffApplicability } from '@/lib/actions/comp-off';
import { useNotifications } from '@/components/ui/Notifications';
import type { CompOffAdminRow } from '@/lib/server-queries';

function CompOffAdminCard({ rows, error }: { rows: CompOffAdminRow[]; error?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showNotification, notificationContainer } = useNotifications();

  // Group live credits per employee, keeping the query's name ordering.
  const byEmployee = new Map<string, { code: string; name: string; credits: CompOffAdminRow[] }>();
  for (const r of rows) {
    const g = byEmployee.get(r.employeeId) ?? { code: r.code, name: r.name, credits: [] };
    g.credits.push(r);
    byEmployee.set(r.employeeId, g);
  }
  const groups = [...byEmployee.values()];
  const totalUsable = rows.filter((r) => r.status === 'available' && r.isApplicable).length;

  function toggle(credit: CompOffAdminRow) {
    setBusyId(credit.id);
    startTransition(async () => {
      const res = await setCompOffApplicability(credit.id, !credit.isApplicable);
      setBusyId(null);
      if (!res.ok) {
        showNotification(res.error ?? 'The comp off could not be updated.', 'error');
      } else {
        showNotification(
          !credit.isApplicable
            ? 'Comp off is applicable again — the employee can use it.'
            : 'Comp off marked not applicable — the employee cannot use it.',
          'success',
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="card">
      {notificationContainer}
      <div className="card-header">
        <h3>Comp offs</h3>
        <span className="card-caption">
          {error
            ? 'unavailable'
            : `${totalUsable} usable · ${rows.length} live credit${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="card-body" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {error ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Comp offs could not be loaded: {error}
          </p>
        ) : groups.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No live comp-off credits. Grant one from the register when an employee works a week-off
            or holiday.
          </p>
        ) : (
          groups.map((g) => {
            const balance = g.credits.filter(
              (c) => c.status === 'available' && c.isApplicable,
            ).length;
            return (
              <div key={g.code + g.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <b>{g.name}</b>
                  <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                    {g.code}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    className="status-badge"
                    style={{
                      borderColor: balance ? 'var(--attendance-present-border)' : 'var(--border-strong)',
                      color: balance ? 'var(--attendance-present)' : 'var(--text-muted)',
                      background: balance ? 'var(--attendance-present-background)' : undefined,
                    }}
                  >
                    Balance: {balance}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.credits.map((c) => (
                    <span
                      key={c.id}
                      className="status-badge"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        borderColor: 'var(--border-strong)',
                        color:
                          c.status === 'available' && c.isApplicable ? undefined : 'var(--text-muted)',
                      }}
                    >
                      {formatDate(c.earnedDate)}
                      {c.expiresOn ? (
                        <span className="text-muted" style={{ fontSize: 10 }}>
                          exp {formatDate(c.expiresOn)}
                        </span>
                      ) : null}
                      {c.status === 'applied' ? (
                        <span className="text-muted" style={{ fontSize: 10 }}>
                          awaiting approval
                        </span>
                      ) : (
                        <button
                          className="button quiet"
                          style={{ padding: '1px 7px', fontSize: 11 }}
                          disabled={pending && busyId === c.id}
                          title={
                            c.isApplicable
                              ? 'Put this credit on hold — the employee will not be able to use it'
                              : 'Make this credit usable again'
                          }
                          onClick={() => toggle(c)}
                        >
                          {pending && busyId === c.id
                            ? '…'
                            : c.isApplicable
                              ? 'Mark not applicable'
                              : 'Mark applicable'}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export { CompOffAdminCard };
