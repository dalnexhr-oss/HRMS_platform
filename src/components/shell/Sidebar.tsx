'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { NAV, NAV_ROLE_GATED, GROUP_ORDER, type NavItem } from '@/lib/constants';
import { ICONS } from '@/components/Icons';
import { Brand } from '@/components/ui/Brand';

// Marks for the screens added since the prototype, whose slugs ICONS does not
// carry. They are looked up after ICONS so the ported artwork always wins.
//
// Nav rows themselves are NOT declared here: NAV owns every row, its group and
// its order. Injecting 'Import' and 'Users' locally is what let their group
// names drift out of sync with the shared list.
const EXTRA_ICONS: Record<string, React.ReactNode> = {
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
const FALLBACK_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);

/** Icon for a nav slug, falling back per-screen rather than to one shared mark. */
function iconFor(slug: string) {
  return ICONS[slug] ?? EXTRA_ICONS[slug] ?? FALLBACK_ICON;
}

/** Drop the links this role would only be bounced from. */
function visibleNav(role?: string | null): NavItem[] {
  return NAV.filter((n) => {
    const allowed = NAV_ROLE_GATED[n.slug];
    return !allowed || (role != null && allowed.includes(role));
  });
}

/** Turn a role slug into a human label for the sidebar footer. */
const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  hr: 'HR',
  manager: 'Manager',
  viewer: 'Viewer (read-only)',
  employee: 'Employee',
};

export function Sidebar({ name, role }: { name?: string | null; role?: string | null }) {
  const pathname = usePathname();
  const active = pathname.split('/')[1] || 'today';

  const items = visibleNav(role);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Brand priority />
      </div>
      <nav className="nav" aria-label="Primary">
        {/* Walk GROUP_ORDER, not the items: it fixes header order, and a group
            whose rows are all role-gated away renders nothing at all rather
            than a bare heading. */}
        {GROUP_ORDER.map((group) => {
          const rows = items.filter((n) => n.group === group);
          if (rows.length === 0) return null;

          return (
            <div key={group}>
              <div className="group">{group}</div>
              {/* prefetch={false}: every nav target is fully dynamic and
                  auth-gated, so a prefetched payload is barely reusable — but
                  all ~19 links sit in the viewport at once, so prefetching them
                  fires 19 full layout renders against a free-tier pooler and
                  starves the click the user actually made. staleTimes in
                  next.config.mjs is what keeps revisits feeling instant. */}
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
        {role ? ROLE_LABEL[role] ?? role : 'Dalnex HRMS'}
      </div>
    </aside>
  );
}
