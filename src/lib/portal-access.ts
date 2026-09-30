// Per-user tab access can restrict the static role gate, but cannot grant additional role
// permissions. These pure helpers are shared by the server layout and sidebar.
import { tabRoleAccess } from '@/lib/constants';
import type { AppRole } from '@/types/database';

const configurableRoles: readonly AppRole[] = ['admin', 'hr'];

// Per-account overrides. Missing entries leave the role's default access unchanged.
type TabAccess = Record<string, boolean>;

// Existing users.tab_access fields remain effective until an administrator saves the current
// key. These are stored permission keys only; they do not define or redirect application URLs.
const storedTabKeys: Readonly<Record<string, readonly string[]>> = {
  dashboard: ['today'],
  'monthly-register': ['register'],
  'attendance-audit': ['audit'],
  'tv-dashboard': ['attendance-board', 'tv'],
  'leave-salary': ['leave'],
  'asset-management': ['assets'],
  'inventory-management': ['items'],
  'company-policies': ['policies'],
  'data-import': ['import'],
  'helpdesk': ['support'],
  'leave-management': ['leaveManagment'],
};

// Check the static role gate before applying per-account restrictions.
function staticallyAllowed(role: AppRole | null | undefined, slug: string): boolean {
  const allowed = tabRoleAccess[slug];
  if (!allowed) {
    // ungated tab — every staff role reaches it
    return true;
  }
  return role != null && allowed.includes(role);
}

// True when this account's role may be customised at all.
function isConfigurableRole(role: AppRole | null | undefined): boolean {
  return !!role && configurableRoles.includes(role);
}

// Super admins retain access so they can restore another account's permissions.
function canAccessTab(role: AppRole | null | undefined, slug: string, access: TabAccess): boolean {
  if (role === 'super_admin') {
    return true;
  }
  if (!staticallyAllowed(role, slug)) {
    return false;
  }
  if (!isConfigurableRole(role)) {
    return true;
  }
  // A renamed URL must not grant access that was denied under its previous name.
  // Once an administrator saves the new key, it takes precedence over older settings.
  const key = [slug, ...(storedTabKeys[slug] ?? [])].find(
    (candidate) => typeof access[candidate] === 'boolean',
  );
  const allowed = key === undefined ? undefined : access[key];
  return allowed !== false;
}

// Slug for the current portal pathname.
function slugFromPathname(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? '';
}

export { configurableRoles, staticallyAllowed, isConfigurableRole, canAccessTab, slugFromPathname };

export type { TabAccess };
