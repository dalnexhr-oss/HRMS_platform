import 'server-only';
import { usersCollection } from '@/lib/db/collections';
import { db } from '@/lib/db/mongo';
import { tierLabel, tierOf } from '@/lib/roles';
import type { ClientSession } from 'mongodb';
import type { AppRole } from '@/types/database';

/** Shared account deletion rules for Users and employee deletion. Caller supplies a staff gate. */
export async function deleteUserAccounts(
  userIds: string[],
  caller: { profileId: string; role: AppRole },
  session?: ClientSession,
  employeeId?: string,
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  if (userIds.includes(caller.profileId)) {
    throw new Error('You cannot delete your own account.');
  }

  const users = await usersCollection();
  const targets = await users
    .find(
      { _id: { $in: userIds }, ...(employeeId ? { employee_id: employeeId } : {}) },
      { session, projection: { password_hash: 0 } },
    )
    .toArray();
  if (targets.length !== new Set(userIds).size) {
    throw new Error('That account no longer exists.');
  }

  // Check every target before removing any accounts, including legacy employees with multiple logins.
  for (const target of targets) {
    if (tierOf(target.role) > tierOf(caller.role)) {
      const label = tierLabel[target.role];
      throw new Error(`Only a ${label} account can manage another ${label} account.`);
    }
    if (target.role === 'admin' || target.role === 'super_admin') {
      const remaining = await users.countDocuments(
        { role: target.role, _id: { $nin: userIds } },
        { session, limit: 1 },
      );
      if (remaining === 0) {
        throw new Error(
          `This is the last ${tierLabel[target.role]} account — promote another before deleting it.`,
        );
      }
    }
  }

  const database = await db();
  // Clear reset credentials first so a standalone database failure leaves the login retryable.
  await database
    .collection('password_reset_tokens')
    .deleteMany({ user_id: { $in: userIds } }, { session });
  for (const target of targets) {
    const result = await users.deleteOne(
      { _id: target._id, role: target.role, employee_id: target.employee_id },
      { session },
    );
    if (result.deletedCount === 0) {
      throw new Error('The account changed or no longer exists. Refresh and try again.');
    }
  }
}
