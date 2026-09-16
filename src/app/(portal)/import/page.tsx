import { ImportScreen } from '@/components/import/ImportScreen';
import { getSession } from '@/lib/auth';
import { currentPeriodMonth } from '@/lib/queries';
import type { AppRole } from '@/types/database';

// Match commitImport's staff role gate. The action and collection policy also enforce access.
const importRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function ImportPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;

  return (
    <ImportScreen
      canImport={!!role && importRoles.includes(role)}
      role={role}
      // Resolve the current payroll month in IST on the server so it matches the register.
      currentMonth={currentPeriodMonth()}
    />
  );
}
