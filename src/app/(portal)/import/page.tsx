import { ImportScreen } from '@/components/import/ImportScreen';
import { getSession } from '@/lib/auth';
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

  return (
    <ImportScreen canImport={!!role && IMPORT_ROLES.includes(role)} role={role} />
  );
}
