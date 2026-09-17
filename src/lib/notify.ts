// Dispatch notifications with system scope. Normal users cannot insert notifications for others.
// Log delivery failures without failing the business action.
import { createServiceClient, isServiceRoleConfigured } from '@/lib/db/server';
import type { AppRole } from '@/types/database';

export type NotificationKind =
  | 'notice'
  | 'policy'
  | 'request'
  | 'approval'
  | 'reimbursement'
  | 'comp_off'
  | 'ticket'
  | 'payroll'
  | 'asset'
  | 'item'
  | 'warranty'
  | 'system';

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  // Relative in-app path, optionally with a dashboard fragment such as /me#payslips.
  // NotificationBell also scrolls when the user is already on that page.
  link?: string | null;
}

// Roles that review things — the audience for "something needs your attention".
const approverRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

function warn(context: string, detail: unknown): void {
  console.warn(
    `[dalnex-hrms] notify(${context}) failed — the action itself succeeded: ${
      detail instanceof Error ? detail.message : String(detail)
    }`,
  );
}

/** Insert one row per recipient. Duplicates/empty lists are no-ops. */
async function dispatch(recipientIds: string[], input: NotifyInput): Promise<void> {
  const unique = [...new Set(recipientIds.filter(Boolean))];
  if (unique.length === 0) {
    return;
  }

  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'MONGO_URI is not set, so notifications are disabled.');
    return;
  }

  try {
    const admin = createServiceClient();
    const rows = unique.map((recipientId) => ({
      recipient_id: recipientId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    }));
    const { error } = await admin.from('notifications').insert(rows);
    if (error) {
      warn(input.kind, error.message);
    }
  } catch (e) {
    warn(input.kind, e);
  }
}

/** Notify specific profile ids. */
export async function notifyProfiles(profileIds: string[], input: NotifyInput): Promise<void> {
  await dispatch(profileIds, input);
}

/**
 * Notify the profile linked to an employee record (if any). Used for
 * "your claim was approved" style messages.
 */
export async function notifyEmployee(employeeId: string | null, input: NotifyInput): Promise<void> {
  if (!employeeId) {
    return;
  }
  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'MONGO_URI is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .select<Array<{ id: string }>>('id')
      .eq('employee_id', employeeId);
    if (error) {
      return warn(input.kind, error.message);
    }
    await dispatch(
      (data ?? []).map((p: { id: string }) => p.id),
      input,
    );
  } catch (e) {
    warn(input.kind, e);
  }
}

/** Notify everyone who can approve things — mirrors guards.ts writeRoles. */
export async function notifyApprovers(input: NotifyInput, exceptProfileId?: string): Promise<void> {
  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'MONGO_URI is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .select<Array<{ id: string; role: string }>>('id, role')
      .in('role', approverRoles as unknown as string[]);
    if (error) {
      return warn(input.kind, error.message);
    }
    const ids = (data ?? [])
      .map((p: { id: string }) => p.id)
      .filter((id) => id !== exceptProfileId);
    await dispatch(ids, input);
  } catch (e) {
    warn(input.kind, e);
  }
}

/**
 * Notify every account (staff and employees) — used for company-wide events
 * like a published notice or policy. The actor is excluded: publishing a notice
 * should not notify the person who just published it.
 */
export async function notifyEveryone(input: NotifyInput, exceptProfileId?: string): Promise<void> {
  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'MONGO_URI is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.from('profiles').select<Array<{ id: string }>>('id');
    if (error) {
      return warn(input.kind, error.message);
    }
    const ids = (data ?? [])
      .map((p: { id: string }) => p.id)
      .filter((id) => id !== exceptProfileId);
    await dispatch(ids, input);
  } catch (e) {
    warn(input.kind, e);
  }
}
