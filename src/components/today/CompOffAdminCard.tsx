'use client';

// ============================================================================
// Admin-dashboard comp-off card (0041).
//
// One row per employee holding live credits: their usable balance, and each
// credit as a pill with an applicable/not-applicable switch. A credit marked
// not applicable stays on the books but cannot be applied for by the employee
// until it is switched back; availing and expiry retire credits regardless.
// ============================================================================
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { setCompOffApplicability } from '@/lib/actions/compoff';
import { useToast } from '@/components/ui/Toast';
import type { CompOffAdminRow } from '@/lib/queries';

export function CompOffAdminCard({ rows, error }: { rows: CompOffAdminRow[]; error?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast, toastNode } = useToast();

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
      if (!res.ok) toast(res.error ?? 'The comp off could not be updated.', 'error');
      else {
        toast(
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
      {toastNode}
      <div className="hd">
        <h3>Comp offs</h3>
        <span className="folio">
          {error
            ? 'unavailable'
            : `${totalUsable} usable · ${rows.length} live credit${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="bd" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {error ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Comp offs could not be loaded: {error}
          </p>
        ) : groups.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No live comp-off credits. Grant one from the register when an employee works a week-off
            or holiday.
          </p>
        ) : (
          groups.map((g) => {
            const balance = g.credits.filter((c) => c.status === 'available' && c.isApplicable).length;
            return (
              <div key={g.code + g.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <b>{g.name}</b>
                  <span className="mono muted" style={{ fontSize: 11 }}>{g.code}</span>
                  <span style={{ flex: 1 }} />
                  <span
                    className="pill"
                    style={{
                      borderColor: balance ? 'var(--p-line)' : 'var(--line-2)',
                      color: balance ? 'var(--p)' : 'var(--ink-3)',
                      background: balance ? 'var(--p-bg)' : undefined,
                    }}
                  >
                    Balance: {balance}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.credits.map((c) => (
                    <span
                      key={c.id}
                      className="pill"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        borderColor: 'var(--line-2)',
                        color: c.status === 'available' && c.isApplicable ? undefined : 'var(--ink-3)',
                      }}
                    >
                      {formatDate(c.earnedDate)}
                      {c.expiresOn ? (
                        <span className="muted" style={{ fontSize: 10 }}>
                          exp {formatDate(c.expiresOn)}
                        </span>
                      ) : null}
                      {c.status === 'applied' ? (
                        <span className="muted" style={{ fontSize: 10 }}>awaiting approval</span>
                      ) : (
                        <button
                          className="btn quiet"
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
