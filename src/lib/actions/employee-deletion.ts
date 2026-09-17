'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireStaff } from '@/lib/actions/guards';
import { deleteUserAccounts } from '@/lib/actions/user-deletion';
import { collections, usersCollection, type EmployeeDoc } from '@/lib/db/collections';
import { withTransaction } from '@/lib/db/mongo';
import { scoped } from '@/lib/db/repo';

type DeleteResult = { ok: true; warning?: string } | { ok: false; error: string };

/** Remove an inactive employee and linked logins while retaining referenced historical records. */
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
    const employeeRecords = await scoped<EmployeeDoc>(collections.employees);
    const employee = await withTransaction(async (session) => {
      const employees = employeeRecords.inSession(session);
      const target = await employees.findOne({ code: employeeCode });
      if (!target || target.deleted_at) {
        throw new Error('That employee has already been deleted or no longer exists.');
      }
      if (target._id === gate.employeeId) {
        throw new Error('You cannot delete your own employee record.');
      }
      if (target.status !== 'inactive') {
        throw new Error('Deactivate the employee before deleting them.');
      }

      const users = await usersCollection();
      const logins = await users
        .find({ employee_id: target._id }, { session, projection: { _id: 1 } })
        .toArray();
      const deletedAt = new Date();
      const deleted = await employees.updateOne(
        { _id: target._id, status: 'inactive', deleted_at: null },
        { $set: { deleted_at: deletedAt, deleted_by: gate.profileId } },
      );
      if (deleted === 0) {
        throw new Error('The employee changed or was already deleted. Refresh and try again.');
      }

      try {
        await deleteUserAccounts(
          logins.map((login) => login._id),
          gate,
          session,
          target._id,
        );
      } catch (error) {
        // A replica set rolls back both changes. On standalone servers, restore the roster entry
        // so a failed account deletion remains visible and can be retried.
        if (!session) {
          await employees.updateOne(
            { _id: target._id, deleted_at: deletedAt, deleted_by: gate.profileId },
            { $set: { deleted_at: null, deleted_by: null } },
          );
        }
        throw error;
      }
      return target;
    });

    revalidatePath('/employees');
    revalidatePath('/users');

    // Keep the employee row for historical joins. Record deletion separately from deactivation.
    try {
      const dbc = await createClient();
      const { error: auditError } = await dbc.from('activity_log').insert({
        actor_id: gate.profileId,
        employee_id: employee._id,
        employee_code: employee.code,
        employee_name: employee.full_name,
        event_type: 'employee_deleted',
        message: `${employee.full_name} (${employee.code}) and linked user accounts were deleted. Historical records were retained.`,
        metadata: { history_retained: true, linked_users_deleted: true },
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
