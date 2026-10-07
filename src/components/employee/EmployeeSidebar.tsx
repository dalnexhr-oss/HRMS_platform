'use client';

import { usePathname } from 'next/navigation';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NavigationSidebar } from '@/components/shell/NavigationSidebar';
import { employeeGroupOrder, employeeHref, employeeNavItems, employeeSlugFromPathname } from '@/lib/employee-navigation';
import type { AppRole } from '@/types/database';

const sections = employeeGroupOrder.map((group) => ({
  label: group,
  links: employeeNavItems
    .filter((item) => item.group === group)
    .map((item) => ({
      key: item.slug,
      href: employeeHref(item.slug),
      label: item.label,
      icon: item.icon,
    })),
}));

// Employee self-service sidebar. Sign out sits in its footer, away from the punch button in the
// top bar, so one slip cannot end the session instead of starting the day.
function EmployeeSidebar({ name, role }: { name?: string | null; role?: AppRole | null }) {
  const pathname = usePathname();

  return (
    <NavigationSidebar
      homeHref="/employee"
      sections={sections}
      activeKey={employeeSlugFromPathname(pathname)}
      name={name}
      role={role}
      footerAction={<SignOutButton />}
      caption="Employee Workspace"
      light
    />
  );
}

export { EmployeeSidebar };
