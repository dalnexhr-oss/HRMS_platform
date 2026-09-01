import { ImportScreen } from '@/components/import/ImportScreen';
import { getSession } from '@/lib/auth';
import { currentPeriodMonth } from '@/lib/queries';
import type { AppRole } from '@/types/database';

/**
 * Roles allowed to import. Mirrors IMPORT_ROLES in '@/lib/actions/import',
 * which in turn mirrors is_staff() as of 0046 — super_admin, admin, hr.
 *
 * This is a UI affordance only: it decides whether the button is offered.
 * commitImport re-checks the role server-side, and the attendance_days write
 * policy checks it a third time, so hiding it here is convenience, not
 * security.
 */
const IMPORT_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function ImportPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;

  return (
    <ImportScreen
      canImport={!!role && IMPORT_ROLES.includes(role)}
      role={role}
      // Resolved on the SERVER: currentPeriodMonth() reads the clock in IST, the
      // business timezone every other monthly view uses. Recomputing it in the
      // browser would give a user abroad a different "current month" than the
      // register and payroll pages show.
      currentMonth={currentPeriodMonth()}
    />
  );
}
