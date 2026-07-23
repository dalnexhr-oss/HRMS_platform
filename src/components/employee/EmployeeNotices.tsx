'use client';

import { useState, useTransition } from 'react';
import { formatDate } from '@/lib/format';
import { markNoticeRead } from '@/lib/actions/notices';
import type { NoticeView } from '@/lib/queries';

// Read-only company notices for the employee dashboard. Full title + body, the
// branch it applies to, when it was published, and a per-notice "Mark as read".
// Long bodies collapse behind a "Read more" toggle.
export function EmployeeNotices({
  notices,
  readIds = [],
  canMark = false,
}: {
  notices: NoticeView[];
  /** Ids the employee has already marked read. */
  readIds?: string[];
  /** False when the login isn't linked to an employee (can't record a read). */
  canMark?: boolean;
}) {
  if (!notices.length) {
    return (
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        No notices right now — company announcements will appear here.
      </p>
    );
  }

  const readSet = new Set(readIds);
  return (
    <div>
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} initialRead={readSet.has(n.id)} canMark={canMark} />
      ))}
    </div>
  );
}

// Bodies longer than this collapse to a few lines with a Read more/less toggle.
const CLAMP_AT = 180;

function NoticeItem({
  notice,
  initialRead,
  canMark,
}: {
  notice: NoticeView;
  initialRead: boolean;
  canMark: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState(initialRead);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const body = notice.body ?? '';
  const isLong = body.length > CLAMP_AT;

  const onRead = () => {
    setError(null);
    startTransition(async () => {
      const res = await markNoticeRead(notice.id);
      if (res.ok) setRead(true);
      else setError(res.error ?? 'Could not mark as read.');
    });
  };

  return (
    <div className={`policy${read ? ' notice-read' : ''}`}>
      <div className="phd">
        <h4>{notice.title}</h4>
        <span className="pill">{notice.branch ?? 'All branches'}</span>
        {notice.publishedAt && (
          <span className="ver">{formatDate(notice.publishedAt.slice(0, 10))}</span>
        )}
        <span style={{ flex: 1 }} />
        {read ? (
          <span className="ack">✓ Read</span>
        ) : (
          canMark && (
            <button type="button" className="btn" onClick={onRead} disabled={pending}>
              {pending ? 'Saving…' : 'Mark as read'}
            </button>
          )
        )}
      </div>
      {body && (
        <>
          <p className={`body${isLong && !expanded ? ' clamp' : ''}`}>{body}</p>
          {isLong && (
            <button
              type="button"
              className="rowtoggle"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}
