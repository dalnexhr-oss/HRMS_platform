'use client';

// Profile popover with identity details and a link to the account settings page.
import Link from 'next/link';
import { AvatarInner } from '@/components/ui/Avatar';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './HeaderTooltip.module.css';
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
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !tooltipVisible) {
      return;
    }
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setTooltipVisible(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setTooltipVisible(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, tooltipVisible]);

  return (
    <div
      ref={boxRef}
      className="avatar-menu"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        className="avatar avatar-button"
        onClick={() => {
          setTooltipVisible(false);
          setOpen((o) => !o);
        }}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Manage profile"
        aria-describedby={!open && tooltipVisible ? tooltipId : undefined}
      >
        <AvatarInner name={name} avatar={avatar} />
      </button>

      {!open && tooltipVisible && (
        <span id={tooltipId} role="tooltip" className={styles.tooltip}>
          Manage profile
        </span>
      )}

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
