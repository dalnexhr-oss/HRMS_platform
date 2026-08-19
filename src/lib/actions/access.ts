'use server';

// ============================================================================
// Per-user tab access — the side panel on /users. Super admin only.
//
// Writes the user_tab_access table from migration 0045. Every rule the panel
// shows is re-checked here, because a Server Action is a public endpoint: the
// button only being rendered for a super admin proves nothing about the caller.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRoles } from '@/lib/actions/_guard';
import { NAV } from '@/lib/constants';
import { isConfigurableRole, staticallyAllowed, type TabAccess } from '@/lib/access';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Only a super admin administers access — never admin or HR themselves. */
const ACCESS_ADMIN_ROLES: readonly AppRole[] = ['super_admin'];

const MIGRATION_HINT =
  'Tab access needs migration 0045_user_tab_access.sql — apply it first.';

function isMissingTable(code?: string): boolean {
  return code === 'PGRST205' || code === '42P01';
}

/** The target's role, so both the caller and the rules can be checked against it. */
async function targetRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ ok: true; role: AppRole } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle<{ role: AppRole }>();
  if (error) return { ok: false, error: `Could not read that account: ${error.message}` };
  if (!data) return { ok: false, error: 'That account no longer exists.' };
  return { ok: true, role: data.role };
}

/** Read one account's switches, for the panel. */
export async function fetchUserTabAccess(
  userId: string,
): Promise<{ ok: true; access: TabAccess } | { ok: false; error: string }> {
  const gate = await requireRoles(ACCESS_ADMIN_ROLES, 'Viewing tab access');
  if (!gate.ok) return { ok: false, error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_tab_access')
    .select('slug, allowed')
    .eq('user_id', userId);

  if (error) {
    if (isMissingTable(error.code)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: error.message };
  }

  const access: TabAccess = {};
  for (const row of (data ?? []) as { slug: string; allowed: boolean }[]) {
    access[row.slug] = row.allowed;
  }
  return { ok: true, access };
}

/**
 * Turn one tab on or off for one account.
 *
 * Refuses anything outside the admin/hr × real-NAV-slug grid, mirroring both the
 * 0045 trigger and the narrowing rule in lib/access.ts: a tab the account's role
 * cannot statically reach is not something this panel may hand out.
 */
export async function setUserTabAccess(
  userId: string,
  slug: string,
  allowed: boolean,
): Promise<ActionResult> {
  const gate = await requireRoles(ACCESS_ADMIN_ROLES, 'Changing tab access');
  if (!gate.ok) return gate;

  if (!NAV.some((n) => n.slug === slug)) return { ok: false, error: 'That is not a tab.' };

  const supabase = await createClient();
  const target = await targetRole(supabase, userId);
  if (!target.ok) return target;

  if (!isConfigurableRole(target.role)) {
    return {
      ok: false,
      error: `Tab access can only be set for admin and HR accounts — this one is "${target.role}".`,
    };
  }
  // Granting past the static gate would render a page whose queries then fail on
  // RLS. This table narrows; it never widens.
  if (!staticallyAllowed(target.role, slug)) {
    return {
      ok: false,
      error: `The ${target.role === 'hr' ? 'HR' : 'admin'} role has no access to that tab to begin with.`,
    };
  }

  const { error } = await supabase.from('user_tab_access').upsert(
    { user_id: userId, slug, allowed, updated_at: new Date().toISOString(), updated_by: gate.profileId },
    { onConflict: 'user_id,slug' },
  );

  if (error) {
    if (isMissingTable(error.code)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: error.message };
  }

  // Every portal page reads the map through the shared layout, so the whole
  // group has to re-render for a revoked tab to disappear.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Restore one account to every tab its role is statically entitled to. */
export async function resetUserTabAccess(userId: string): Promise<ActionResult> {
  const gate = await requireRoles(ACCESS_ADMIN_ROLES, 'Resetting tab access');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase.from('user_tab_access').delete().eq('user_id', userId);
  if (error) {
    if (isMissingTable(error.code)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
