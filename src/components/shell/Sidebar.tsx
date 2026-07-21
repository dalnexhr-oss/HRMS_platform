'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { NAV, NAV_ROLE_GATED, type NavItem } from '@/lib/constants';
import { ICONS } from '@/components/Icons';
import { Brand } from '@/components/ui/Brand';

// The Excel register importer. Declared here rather than in NAV/ICONS so the
// shared constants stay untouched; it sits with the other "Operate" screens,
// directly after the register it populates.
const IMPORT_ITEM: NavItem = { slug: 'import', label: 'Import', group: 'Operate' };

// User administration — admin/HR only, so it is injected here (and filtered by
// role below) rather than living in the shared NAV every role renders.
const USERS_ITEM: NavItem = { slug: 'users', label: 'Users', group: 'People' };

const IMPORT_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 3v12" />
    <path d="M8 7l4-4 4 4" />
    <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
  </svg>
);

// Receipt mark for the reimbursements screen (NAV/ICONS stay untouched).
const REIMBURSE_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
    <path d="M9 7h6" />
    <path d="M9 11h6" />
  </svg>
);

const USERS_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 20a6.2 6.2 0 0112.4 0" />
    <path d="M16.5 11.2a3 3 0 000-6" />
    <path d="M18 20a6 6 0 00-3-5.2" />
  </svg>
);

const ACCOUNT_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0114 0" />
  </svg>
);

const EXTRA_ICONS: Record<string, React.ReactNode> = {
  reimbursements: REIMBURSE_ICON,
  users: USERS_ICON,
  account: ACCOUNT_ICON,
};

/** Icon for a nav slug, falling back per-screen rather than to one shared mark. */
function iconFor(slug: string) {
  return ICONS[slug] ?? EXTRA_ICONS[slug] ?? IMPORT_ICON;
}

function navItems(role?: string | null): NavItem[] {
  const items = [...NAV];
  const after = items.findIndex((n) => n.slug === 'register');
  items.splice(after < 0 ? items.length : after + 1, 0, IMPORT_ITEM);

  // Users sits with the other People screens, directly after Employees.
  const afterEmployees = items.findIndex((n) => n.slug === 'employees');
  items.splice(afterEmployees < 0 ? items.length : afterEmployees + 1, 0, USERS_ITEM);

  // Drop links this role would only be bounced from.
  return items.filter((n) => {
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

  const NAV_ITEMS = navItems(role);

  // Preserve the prototype's grouping order while rendering group headers once.
  const groups: string[] = [];
  for (const item of NAV_ITEMS) if (!groups.includes(item.group)) groups.push(item.group);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Brand priority />
      </div>
      <nav className="nav" aria-label="Primary">
        {groups.map((group) => (
          <div key={group}>
            <div className="group">{group}</div>
            {NAV_ITEMS.filter((n) => n.group === group).map((item) => (
              <Link
                key={item.slug}
                href={`/${item.slug}` as Route}
                aria-current={active === item.slug}
              >
                {iconFor(item.slug)}
                <span className="txt">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <b>{name || 'Signed in'}</b>
        <br />
        {role ? ROLE_LABEL[role] ?? role : 'Dalnex HRMS'}
      </div>
    </aside>
  );
}
