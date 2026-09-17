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

// Extra icons for tabs absent from Icons.tsx. Navigation rows, groups, and order come from navItems
// in constants.ts.
const extraIcons: Record<string, React.ReactNode> = {
  // Magnifier over a page — reading back who edited attendance.
  audit: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 3h9l4 4v4" />
      <path d="M5 3v18h6" />
      <circle cx="16.5" cy="16.5" r="3.5" />
      <path d="M19 19l2.5 2.5" />
    </svg>
  ),
  // Person with a plus — a joiner being brought on.
  onboarding: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0113 0" />
      <path d="M18 6v6M15 9h6" />
    </svg>
  ),
  // Door with an outbound arrow.
  exits: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h8" />
      <path d="M18 12H10" />
      <path d="M15 9l3 3-3 3" />
    </svg>
  ),
  // Two people over a dashboard line — the HR overview.
  hr: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 19a6 6 0 0112 0" />
      <path d="M16.5 4.5a3 3 0 010 5.5" />
      <path d="M17 13.5a6 6 0 014 5.5" />
    </svg>
  ),
  // Hourglass — entitlement running down.
  leave: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M7 3h10M7 21h10" />
      <path d="M7 3v3.5L12 12l-5 5.5V21" />
      <path d="M17 3v3.5L12 12l5 5.5V21" />
    </svg>
  ),
  // Receipt.
  reimbursements: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
    </svg>
  ),
  // Monitor + stand — IT assets.
  assets: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
    </svg>
  ),
  // Box — inventory.
  items: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  ),
  // Wide screen on a stand — the wall-mounted attendance board.
  tv: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  ),
  users: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20a6.2 6.2 0 0112.4 0" />
      <path d="M16.5 11.2a3 3 0 000-6" />
      <path d="M18 20a6 6 0 00-3-5.2" />
    </svg>
  ),
  // Arrow into a tray — the Excel register importer.
  import: (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
    </svg>
  ),
};

// Shown only if a NAV row is added without a mark. Deliberately neutral: the
// previous fallback was the Import arrow, so any unkeyed screen claimed to be
// an importer.
const fallbackIcon = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);

// Icon for a nav slug, falling back per-screen rather than to one shared mark.
function iconFor(slug: string) {
  return icons[slug] ?? extraIcons[slug] ?? fallbackIcon;
}

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

export function Sidebar({
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
          <Brand priority />
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
                    {iconFor(item.slug)}
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
