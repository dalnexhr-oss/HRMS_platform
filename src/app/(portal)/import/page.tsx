import { ImportScreen } from '@/components/import/ImportScreen';
import { getSession } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/queries';
import type { AppRole } from '@/types/database';

/**
 * Roles allowed to import. Mirrors IMPORT_ROLES in '@/lib/actions/import',
 * which in turn mirrors the database's is_staff() (migration 0003) —
 * ('admin','hr','manager'), deliberately excluding 'viewer'.
 *
 * This is a UI affordance only. commitImport re-checks server-side, and RLS
 * enforces it again in the database.
 */
const IMPORT_ROLES: AppRole[] = ['admin', 'hr', 'manager'];

export default async function ImportPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;

  // `configured` is passed separately from `role` on purpose. Without Supabase,
  // getSession() hands back a demo profile whose role is 'admin' — so a role
  // check alone would light up the Import button on a build that cannot write a
  // single row. commitImport refuses immediately in that state, and a button
  // that can only ever fail is a lie. The client disables it and says why.
  const configured = isSupabaseConfigured();

  return (
    <ImportScreen
      canImport={configured && !!role && IMPORT_ROLES.includes(role)}
      configured={configured}
      role={role}
    />
  );
}
