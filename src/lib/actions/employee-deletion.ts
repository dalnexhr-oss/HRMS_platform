'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireStaff, wroteNothing } from '@/lib/actions/guards';

interface EmployeeToDelete {
  id: string;
  code: string;
  full_name: string;
  status: string;
  deleted_at: Date | string | null;
}

type DeleteResult = { ok: true; warning?: string } | { ok: false; error: string };

/** Remove an inactive employee from the roster while retaining referenced historical records. */
export async function deleteEmployee(code: string): Promise<DeleteResult> {
  const gate = await requireStaff('Deleting an employee');
  if (!gate.ok) {
    return gate;
  }
  const employeeCode = code.trim();
  if (!employeeCode) {
    return { ok: false, error: 'Choose an employee to delete.' };
  }

  try {
    const dbc = await createClient();
    const { data: employee, error: readError } = await dbc
      .from('employees')
      .select('id, code, full_name, status, deleted_at')
      .eq('code', employeeCode)
      .maybeSingle<EmployeeToDelete>();
    if (readError) {
      return { ok: false, error: `Could not load the employee: ${readError.message}` };
    }
    if (!employee || employee.deleted_at) {
      return { ok: false, error: 'That employee has already been deleted or no longer exists.' };
    }
    if (employee.id === gate.employeeId) {
      return { ok: false, error: 'You cannot delete your own employee record.' };
    }
    if (employee.status !== 'inactive') {
      return { ok: false, error: 'Deactivate the employee before deleting them.' };
    }

    const { data: enabledLogins, error: loginError } = await dbc
      .from('profiles')
      .select('id')
      .eq('employee_id', employee.id)
      .neq('disabled', true)
      .limit(1);
    if (loginError) {
      return { ok: false, error: `Could not check linked logins: ${loginError.message}` };
    }
    if (enabledLogins?.length) {
      return {
        ok: false,
        error:
          'This employee still has an enabled login. Disable it in Users before deleting the employee.',
      };
    }

    const { data: deleted, error: deleteError } = await dbc
      .from('employees')
      .update({ deleted_at: new Date(), deleted_by: gate.profileId })
      .eq('id', employee.id)
      .eq('status', 'inactive')
      .is('deleted_at', null)
      .select('id');
    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }
    if (wroteNothing(deleted)) {
      return {
        ok: false,
        error: 'The employee changed or was already deleted. Refresh and try again.',
      };
    }

    revalidatePath('/employees');
    revalidatePath('/users');

    // Keep the employee row for historical joins. Record deletion separately from deactivation.
    try {
      const { error: auditError } = await dbc.from('activity_log').insert({
        actor_id: gate.profileId,
        employee_id: employee.id,
        employee_code: employee.code,
        employee_name: employee.full_name,
        event_type: 'employee_deleted',
        message: `${employee.full_name} (${employee.code}) was deleted from the employee list. Historical records were retained.`,
        metadata: { history_retained: true },
      });
      if (auditError) {
        throw new Error(auditError.message);
      }
    } catch {
      return { ok: true, warning: 'Employee deleted, but the audit entry could not be saved.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not delete the employee.',
    };
  }
}
