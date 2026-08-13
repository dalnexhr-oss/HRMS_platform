'use client';

// ============================================================================
// HR dashboard — Leave Management tab.
//
// The complete history of employee leave requests: every submission with its
// current status (pending / approved / rejected / cancelled), the span and day
// cost, the employee's reason, and the approver's decision remark. Decisions
// happen on /approvals; rows land here automatically via revalidation, so this
// tab is the audit trail rather than a second approval surface.
// ============================================================================
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RequestView } from '@/lib/queries';

const STATUS_TABS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_COLOR: Record<RequestView['status'], string> = {
  pending: 'var(--lm)',
  approved: 'var(--p)',
  rejected: 'var(--hd)',
  cancelled: 'var(--ink-3)',
};

const KIND_LABEL: Record<string, string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

/** '2026-07-16' -> '16 Jul 26'. */
function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** ISO timestamp -> '12 Aug 26'; '—' when absent. */
function stamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function LeaveHistory({ requests }: { requests: RequestView[] }) {
  const [tab, setTab] = useState<StatusTab>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { all: requests.length, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    for (const r of requests) c[r.status] += 1;
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter(
      (r) =>
        (tab === 'all' || r.status === tab) &&
        (!q ||
          r.employeeName.toLowerCase().includes(q) ||
          r.employeeCode.toLowerCase().includes(q) ||
          r.branch.toLowerCase().includes(q)),
    );
  }, [requests, tab, query]);

  return (
    <div className="card" id="leave-management">
      <div className="hd">
        <h3>Leave management</h3>
        <span className="folio">
          complete history · {counts.pending} pending · {requests.length} total
        </span>
        <span style={{ flex: 1 }} />
        <Link className="btn quiet" href="/approvals">
          Review pending →
        </Link>
      </div>
      <div className="bd">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              className={`btn quiet${tab === t ? ' primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: 12, textTransform: 'capitalize' }}
              onClick={() => setTab(t)}
            >
              {t} ({counts[t]})
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name / code / branch"
            aria-label="Search leave history by employee name, code or branch"
            style={{ minWidth: 200, padding: '6px 10px' }}
          />
        </div>

        {visible.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {requests.length === 0
              ? 'No leave requests have been filed yet. Requests submitted from the employee dashboard appear here automatically.'
              : 'Nothing matches this filter.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th className="right">Days</th>
                  <th>Submitted</th>
                  <th>Decided</th>
                  <th>Status</th>
                  <th>Reason / decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.employeeName}</b>{' '}
                      <span className="mono muted" style={{ fontSize: 11 }}>{r.employeeCode}</span>
                      <div className="muted" style={{ fontSize: 11 }}>{r.branch}</div>
                    </td>
                    <td>{(r.leaveKind && KIND_LABEL[r.leaveKind]) || r.leaveKind || 'Leave'}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {r.startDate === r.endDate ? day(r.startDate) : `${day(r.startDate)} – ${day(r.endDate)}`}
                    </td>
                    <td className="right mono">{r.days}</td>
                    <td className="mono">{stamp(r.createdAt)}</td>
                    <td className="mono">{stamp(r.reviewedAt)}</td>
                    <td>
                      <span
                        className="pill"
                        style={{ borderColor: 'var(--line-2)', color: STATUS_COLOR[r.status], textTransform: 'capitalize' }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      {r.reason && <div style={{ fontSize: 12 }}>{r.reason}</div>}
                      {r.reviewRemark && (
                        <div style={{ fontSize: 11, color: STATUS_COLOR[r.status] }}>
                          <b>Decision:</b> {r.reviewRemark}
                        </div>
                      )}
                      {!r.reason && !r.reviewRemark && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
