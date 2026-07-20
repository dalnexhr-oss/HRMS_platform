'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { NAV, type NavItem } from '@/lib/constants';
import { ICONS } from '@/components/Icons';

// The Excel register importer. Declared here rather than in NAV/ICONS so the
// shared constants stay untouched; it sits with the other "Operate" screens,
// directly after the register it populates.
const IMPORT_ITEM: NavItem = { slug: 'import', label: 'Import', group: 'Operate' };

const IMPORT_ICON = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 3v12" />
    <path d="M8 7l4-4 4 4" />
    <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
  </svg>
);

function navItems(): NavItem[] {
  const items = [...NAV];
  const after = items.findIndex((n) => n.slug === 'register');
  items.splice(after < 0 ? items.length : after + 1, 0, IMPORT_ITEM);
  return items;
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

  const NAV_ITEMS = navItems();

  // Preserve the prototype's grouping order while rendering group headers once.
  const groups: string[] = [];
  for (const item of NAV_ITEMS) if (!groups.includes(item.group)) groups.push(item.group);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="eyebrow">HRMS · Muster</div>
        <h1>
          Dalnex<span>.</span>
        </h1>
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
                {ICONS[item.slug] ?? IMPORT_ICON}
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
