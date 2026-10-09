'use client';

// Leave request history. Decisions happen on /approvals; revalidation keeps this list in sync.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import styles from '@/components/ui/RecordTable.module.css';
import type { RequestView } from '@/lib/queries/requests';

const statusTabs = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;
type StatusTab = (typeof statusTabs)[number];

const statusColor: Record<RequestView['status'], string> = {
  pending: 'var(--attendance-late)',
  approved: 'var(--attendance-present)',
  rejected: 'var(--attendance-half-day)',
  cancelled: 'var(--text-muted)',
};

const kindLabel: Record<string, string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

// 'YYYY-07-16' -> '16 Jul 26'.
function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/** ISO timestamp -> '12 Aug 26'; '—' when absent. */
function stamp(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function LeaveHistory({ requests }: { requests: RequestView[] }) {
  const [tab, setTab] = useState<StatusTab>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = {
      all: requests.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const r of requests) {
      c[r.status] += 1;
    }
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
    <div className={`card ${styles.panel}`} id="leave-management">
      <div className={styles.header}>
        <div className={styles.heading}>
          <h3>Leave management</h3>
          <p className={styles.subtitle}>
            Complete history · {counts.pending} pending · {requests.length} total
          </p>
        </div>
        <Link className={`button ${styles.headerAction}`} href="/approvals">
          Review pending →
        </Link>
      </div>
      <div>
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Filter leave requests by status">
            {statusTabs.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.filter}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t} <span className={styles.filterCount}>({counts[t]})</span>
              </button>
            ))}
          </div>
          <label className={`search-field ${styles.search}`}>
            <span className="visually-hidden">
              Search leave history by employee name, code or branch
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name / code / branch"
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <p className={styles.empty}>
            {requests.length === 0
              ? 'No leave requests have been filed yet. Requests submitted from the employee dashboard appear here automatically.'
              : 'Nothing matches this filter.'}
          </p>
        ) : (
          <div
            className={`${styles.scroll} ${styles.historyScroll}`}
            role="region"
            aria-label="Leave request history"
            tabIndex={0}
          >
            <table className={`${styles.table} ${styles.historyTable}`} aria-label="Leave requests">
              <thead>
                <tr>
                  <th scope="col" className={styles.identity}>
                    Employee
                  </th>
                  <th scope="col">Type</th>
                  <th scope="col">Dates</th>
                  <th scope="col" className="text-right">
                    Days
                  </th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Decided</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reason / decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.identity}>
                      <Link href={`/requests/${r.id}`}>
                        <b className={styles.employeeName}>{r.employeeName}</b>
                      </Link>
                      <div className={styles.identityDetails}>
                        <span className="text-monospace">{r.employeeCode}</span>
                        <span>{r.branch}</span>
                      </div>
                    </td>
                    <td>{(r.leaveKind && kindLabel[r.leaveKind]) || r.leaveKind || 'Leave'}</td>
                    <td className={`text-monospace ${styles.nowrap}`}>
                      {r.startDate === r.endDate
                        ? day(r.startDate)
                        : `${day(r.startDate)} – ${day(r.endDate)}`}
                    </td>
                    <td className="text-right text-monospace">{r.days}</td>
                    <td className={`text-monospace ${styles.nowrap}`}>{stamp(r.createdAt)}</td>
                    <td className={`text-monospace ${styles.nowrap}`}>{stamp(r.reviewedAt)}</td>
                    <td>
                      <span className={`status-badge ${styles.leaveStatus}`} data-status={r.status}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      {r.reason && <div style={{ fontSize: 12 }}>{r.reason}</div>}
                      {r.reviewRemark && (
                        <div style={{ fontSize: 11, color: statusColor[r.status] }}>
                          <b>Decision:</b> {r.reviewRemark}
                        </div>
                      )}
                      {!r.reason && !r.reviewRemark && <span className="text-muted">—</span>}
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

export { LeaveHistory };
