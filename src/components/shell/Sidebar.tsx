'use client';

import Link from 'next/link';
import { icons } from '@/components/Icons';
import { Brand } from '@/components/ui/Brand';
import { usePathname } from 'next/navigation';
import { canAccessTab } from '@/lib/access';
import { useEffect, useState } from 'react';
import { navItems, groupOrder } from '@/lib/constants';
import type { TabAccess } from '@/lib/access';
import type { NavItem } from '@/lib/constants';
import type { Route } from 'next';
import type { AppRole } from '@/types/database';

// Drop the links this role would only be bounced from — the static gate in constants.ts AND
// whatever the super admin has switched off on /access. Hiding the link is cosmetic; the (portal)
// layout is what actually blocks the page.
function visibleNav(role: AppRole | null | undefined, access: TabAccess): NavItem[] {
  return navItems.filter((n) => canAccessTab(role, n.slug, access));
}

// Turn a role slug into a human label for the sidebar footer.
const roleLabel: Record<string, string> = {
  admin: 'Administrator',
  super_admin: 'Super Admin',
  hr: 'HR',
  employee: 'Employee',
  intern: 'Intern',
};

function Sidebar({
  name,
  role,
  access = {},
}: {
  name?: string | null;
  role?: AppRole | null;
  // This account's tab switches; {} means nothing revoked.
  access?: TabAccess;
}) {
  const pathname = usePathname();
  const active = pathname.split('/')[1] || 'today';
  // Off-canvas on phones. On desktop the sidebar is always in flow and this
  // flag does nothing — the CSS only honours .open below the rail breakpoint.
  const [open, setOpen] = useState(false);

  // Navigating is the end of the menu's job. Without this the drawer stays over
  // the page the user just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const items = visibleNav(role, access);

  return (
    <>
      {/* Sits over the topbar's reserved left gutter on mobile, so it reads as part of the bar rather than as a floating button. */}
      <button
        type="button"
        className="nav-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M3.5 7h17" />
              <path d="M3.5 12h17" />
              <path d="M3.5 17h17" />
            </>
          )}
        </svg>
      </button>
      <div
        className={`nav-scrim${open ? ' on' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <Brand href="/today" priority onClick={() => setOpen(false)} />
        </div>
        <nav className="nav" aria-label="Primary">
          {/* Walk groupOrder, not the items: it fixes header order, and a group
            whose rows are all role-gated away renders nothing at all rather
            than a bare heading. */}
          {groupOrder.map((group) => {
            const rows = items.filter((n) => n.group === group);
            if (rows.length === 0) {
              return null;
            }

            return (
              <div key={group}>
                <div className="group">{group}</div>
                {/*
                 * Disable prefetch for dynamic, authenticated routes to avoid loading every
                 * sidebar destination at once. staleTimes caches revisits.
                 */}
                {rows.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/${item.slug}` as Route}
                    prefetch={false}
                    aria-current={active === item.slug}
                  >
                    {icons[item.slug]}
                    <span className="txt">{item.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <b>{name || 'Signed in'}</b>
          <br />
          {role ? (roleLabel[role] ?? role) : 'Dalnex HRMS'}
        </div>
      </aside>
    </>
  );
}

export { Sidebar };
