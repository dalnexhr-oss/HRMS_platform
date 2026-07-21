'use client';

// Topbar notification bell: unread badge + dropdown list.
// Titles/bodies are rendered as TEXT (never dangerouslySetInnerHTML) because a
// notification body can quote user-supplied content — a ticket subject, a claim
// description — which would otherwise be stored XSS.
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/actions/notifications';
import type { NotificationRow } from '@/lib/queries';

const KIND_ICON: Record<string, string> = {
  notice: '📣',
  policy: '📄',
  request: '🗓️',
  approval: '✅',
  reimbursement: '💰',
  comp_off: '🌴',
  ticket: '🎫',
  payroll: '🧾',
  system: '⚙️',
};

/** '2026-07-21T10:20:00Z' -> '3h ago' / '2d ago'. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell({
  notifications,
  unread,
}: {
  notifications: NotificationRow[];
  unread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a dropdown that traps focus in a sticky
  // topbar is worse than no dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onOpenItem = (n: NotificationRow) => {
    if (!n.readAt) {
      startTransition(async () => {
        await markNotificationRead(n.id);
        router.refresh();
      });
    }
    setOpen(false);
  };

  const onMarkAll = () =>
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn quiet"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        style={{ position: 'relative' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--ab)',
              color: '#fff',
              font: '700 10px var(--mono)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,.12)',
            zIndex: 50,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid var(--line-2)',
            }}
          >
            <b style={{ fontSize: 13 }}>Notifications</b>
            <span style={{ flex: 1 }} />
            {unread > 0 && (
              <button className="btn quiet" style={{ fontSize: 12 }} onClick={onMarkAll}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, padding: 16, margin: 0, textAlign: 'center' }}>
              Nothing yet.
            </p>
          ) : (
            notifications.map((n) => {
              const inner = (
                <>
                  <span style={{ fontSize: 15, lineHeight: '18px' }}>{KIND_ICON[n.kind] ?? '•'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: n.readAt ? 500 : 700, fontSize: 13 }}>{n.title}</span>
                    {n.body && (
                      <span
                        className="muted"
                        style={{ display: 'block', fontSize: 12, wordBreak: 'break-word' }}
                      >
                        {n.body}
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {ago(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--brand)',
                        marginTop: 5,
                      }}
                    />
                  )}
                </>
              );

              const style: React.CSSProperties = {
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '10px 12px',
                borderBottom: '1px solid var(--line)',
                background: n.readAt ? '#fff' : 'var(--p-bg, #f6faf7)',
                textDecoration: 'none',
                color: 'inherit',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
              };

              // Only relative in-app paths are ever linked; anything else renders
              // as a plain button so a stored value can't become an external link.
              const safeLink = n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : null;

              return safeLink ? (
                <Link key={n.id} href={safeLink as Route} style={style} onClick={() => onOpenItem(n)}>
                  {inner}
                </Link>
              ) : (
                <button key={n.id} type="button" style={style} onClick={() => onOpenItem(n)}>
                  {inner}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
