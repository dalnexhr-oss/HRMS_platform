'use client';

import { usePathname } from 'next/navigation';
import { NavigationSidebar } from '@/components/shell/NavigationSidebar';
import { canAccessTab, slugFromPathname } from '@/lib/portal-access';
import { navItems, groupOrder } from '@/lib/portal-navigation';
import type { TabAccess } from '@/lib/portal-access';
import type { NavItem } from '@/lib/portal-navigation';
import type { AppRole } from '@/types/database';

// Drop the links this role would only be bounced from — the static gate in portal-navigation.ts AND
// whatever the super admin has switched off on /access. Hiding the link is cosmetic; the (portal)
// layout is what actually blocks the page.
function visibleNav(role: AppRole | null | undefined, access: TabAccess): NavItem[] {
  return navItems.filter((n) => canAccessTab(role, n.slug, access));
}

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
  const active = slugFromPathname(pathname) || 'dashboard';
  const items = visibleNav(role, access);
  // Walk groupOrder, not the items: it fixes header order.
  const sections = groupOrder.map((group) => ({
    label: group,
    links: items
      .filter((n) => n.group === group)
      .map((n) => ({ key: n.slug, href: `/${n.slug}`, label: n.label, icon: n.slug })),
  }));

  return (
    <NavigationSidebar
      homeHref="/dashboard"
      sections={sections}
      activeKey={active}
      name={name}
      role={role}
    />
  );
}

export { Sidebar };
