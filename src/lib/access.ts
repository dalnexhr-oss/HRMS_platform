// Per-user tab access can restrict the static role gate, but cannot grant additional role
// permissions. These pure helpers are shared by the server layout and sidebar.
import { tabRoleAccess } from '@/lib/constants';
import type { AppRole } from '@/types/database';

export const configurableRoles: readonly AppRole[] = ['admin', 'hr'];

// Per-account overrides. Missing entries leave the role's default access unchanged.
export type TabAccess = Record<string, boolean>;

// Check the static role gate before applying per-account restrictions.
export function staticallyAllowed(role: AppRole | null | undefined, slug: string): boolean {
  const allowed = tabRoleAccess[slug];
  if (!allowed) return true; // ungated tab — every staff role reaches it
  return role != null && allowed.includes(role);
}

// True when this account's role may be customised at all.
export function isConfigurableRole(role: AppRole | null | undefined): boolean {
  return !!role && configurableRoles.includes(role);
}

// Super admins retain access so they can restore another account's permissions.
export function canAccessTab(
  role: AppRole | null | undefined,
  slug: string,
  access: TabAccess,
): boolean {
  if (role === 'super_admin') return true;
  if (!staticallyAllowed(role, slug)) return false;
  if (!isConfigurableRole(role)) return true;
  // Keep existing restrictions until the account saves the renamed tab's setting.
  const allowed =
    slug === 'leave-management' ? (access[slug] ?? access.leaveManagment) : access[slug];
  return allowed !== false;
}

// Slug for a portal pathname: '/assets/x' -> 'assets'. '' for the root.
export function slugFromPathname(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? '';
}
