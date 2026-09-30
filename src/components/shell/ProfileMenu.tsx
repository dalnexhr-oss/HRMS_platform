'use client';

// Profile popover with identity details and a link to the account settings page.
import Link from 'next/link';
import { AvatarInner } from '@/components/ui/Avatar';
import { useEffect, useRef, useState } from 'react';
import type { Route } from 'next';

const roleLabel: Record<string, string> = {
  admin: 'Administrator',
  super_admin: 'Super Admin',
  hr: 'HR',
  employee: 'Employee',
  intern: 'Intern',
};

function ProfileMenu({
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
  // Where "My account" navigates — /account for staff, /employee/account for employees.
  accountHref: Route;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
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
        className="avatar avatar-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Your profile"
      >
        <AvatarInner name={name} avatar={avatar} />
      </button>

      {open && (
        <div role="menu" className="avatar-popover">
          <div className="profile-identity">
            <span className="avatar">
              <AvatarInner name={name} avatar={avatar} />
            </span>
            <div className="profile-identity-text">
              <b>{name || 'Signed in'}</b>
              {role && <span className="text-muted">{roleLabel[role] ?? role}</span>}
              {email && <span className="text-muted text-monospace">{email}</span>}
            </div>
          </div>

          <Link
            href={accountHref}
            className="button"
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

export { ProfileMenu };
