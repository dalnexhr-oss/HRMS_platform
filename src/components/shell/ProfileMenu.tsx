'use client';

// ============================================================================
// The top-bar profile icon. Clicking it opens a small identity card — the
// avatar (or initials), name and basic info — plus a link to the account page
// where the avatar and password are actually changed. It does NOT edit anything
// itself; that lives on /account (staff) or /me (employees).
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { AvatarInner } from '@/components/ui/Avatar';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  hr: 'HR',
  manager: 'Manager',
  viewer: 'Viewer (read-only)',
  employee: 'Employee',
};

export function ProfileMenu({
  name,
  avatar,
  role,
  email,
  accountHref,
}: {
  name?: string | null;
  avatar?: string | null;
  role?: string | null;
  email?: string | null;
  /** Where "My account" navigates — /account for staff, /me for employees. */
  accountHref: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={boxRef} className="avatar-menu">
      <button
        type="button"
        className="av av-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Your profile"
      >
        <AvatarInner name={name} avatar={avatar} />
      </button>

      {open && (
        <div role="menu" className="avatar-pop">
          <div className="profile-id">
            <span className="av">
              <AvatarInner name={name} avatar={avatar} />
            </span>
            <div className="profile-id-txt">
              <b>{name || 'Signed in'}</b>
              {role && <span className="muted">{ROLE_LABEL[role] ?? role}</span>}
              {email && <span className="muted mono">{email}</span>}
            </div>
          </div>

          <Link
            href={accountHref as Route}
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setOpen(false)}
          >
            My account
          </Link>
        </div>
      )}
    </div>
  );
}
