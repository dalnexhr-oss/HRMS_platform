// ============================================================================
// Per-user tab access (migration 0045).
//
// A super admin decides, per individual account, which sidebar tabs it may open
// — set from a side panel on /users, not a screen of its own. Two admins can
// therefore see different tabs.
//
// Pure helpers, no I/O: the signed-in user's map is fetched once per request by
// the (portal) layout and threaded to the Sidebar, so this file imports cleanly
// into both server and client components.
//
// The rule everything else derives from:
//
//     effective = NAV_ROLE_GATED (static, in code)  AND  the user's map (DB)
//
// It can only NARROW. Handing an account a tab its ROLE was never entitled to
// would render a page whose every query then fails, because RLS gates the data
// underneath and knows nothing about this table. So the map's only real power is
// to switch a tab off.
// ============================================================================
import { NAV_ROLE_GATED } from '@/lib/constants';
import type { AppRole } from '@/types/database';

/** Roles whose accounts a super admin may configure. Mirrors the 0045 trigger. */
export const CONFIGURABLE_ROLES: readonly AppRole[] = ['admin', 'hr'];

/** slug -> allowed, for ONE account. A missing entry means allowed. */
export type TabAccess = Record<string, boolean>;

/** True when the STATIC gate in constants.ts lets this role reach the tab. */
export function staticallyAllowed(role: AppRole | null | undefined, slug: string): boolean {
  const allowed = NAV_ROLE_GATED[slug];
  if (!allowed) return true; // ungated tab — every staff role reaches it
  return role != null && allowed.includes(role);
}

/** True when this account's role may be customised at all. */
export function isConfigurableRole(role: AppRole | null | undefined): boolean {
  return !!role && CONFIGURABLE_ROLES.includes(role);
}

/**
 * The one function that decides whether an account may open a tab.
 *
 * super_admin short-circuits to true: it is not configurable, so it can never be
 * locked out and left with no way to undo a change.
 */
export function canAccessTab(
  role: AppRole | null | undefined,
  slug: string,
  access: TabAccess,
): boolean {
  if (role === 'super_admin') return true;
  if (!staticallyAllowed(role, slug)) return false;
  if (!isConfigurableRole(role)) return true;
  // Absent row = allowed, so an unapplied migration or an untouched tab behaves
  // exactly as it did before this feature existed.
  return access[slug] !== false;
}

/** Slug for a portal pathname: '/assets/x' -> 'assets'. '' for the root. */
export function slugFromPathname(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? '';
}
