// What every employee tab needs to know about the signed-in person before it loads its own data.
import 'server-only';
import { getSession } from '@/lib/server-auth';
import { isMongoConfigured } from '@/lib/db/mongodb-connection';

async function getEmployeeContext() {
  const { profile, email } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  const databaseReady = isMongoConfigured();

  return {
    profile,
    email,
    employeeId,
    canSubmit: databaseReady && !!employeeId,
    blockedReason: !databaseReady
      ? 'The database is not configured, so a ticket cannot be saved.'
      : 'Your login is not linked to an employee record, so a ticket could not be traced back to you. Ask HR to link it.',
  };
}

export { getEmployeeContext };
