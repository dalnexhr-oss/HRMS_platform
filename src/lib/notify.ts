// ============================================================================
// Notification dispatch. SERVER ONLY.
//
// Uses the SERVICE-ROLE client because a notification is addressed to SOMEONE
// ELSE: an employee raising leave must notify approvers, and RLS (0012)
// deliberately gives normal users no INSERT policy so nobody can forge a
// "your leave was approved" for another account.
//
// Every function here is BEST-EFFORT and never throws. A failed notification
// must not roll back the business action that triggered it — approving leave
// still succeeds if the notification insert fails; it is logged instead.
// ============================================================================
import { createServiceClient, isServiceRoleConfigured } from '@/lib/supabase/server';
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
  | 'system';

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** In-app relative path, e.g. '/approvals'. */
  link?: string | null;
}

/** Roles that review things — the audience for "something needs your attention". */
const APPROVER_ROLES: readonly AppRole[] = ['admin', 'hr', 'manager'];

function warn(context: string, detail: unknown): void {
  console.warn(
    `[dalnex-hrms] notify(${context}) failed — the action itself succeeded: ` +
      (detail instanceof Error ? detail.message : String(detail)),
  );
}

/** Insert one row per recipient. Duplicates/empty lists are no-ops. */
async function dispatch(recipientIds: string[], input: NotifyInput): Promise<void> {
  const unique = [...new Set(recipientIds.filter(Boolean))];
  if (unique.length === 0) return;

  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'SUPABASE_SECRET_KEY is not set, so notifications are disabled.');
    return;
  }

  try {
    const admin = createServiceClient();
    const rows = unique.map((recipient_id) => ({
      recipient_id,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    }));
    const { error } = await admin.from('notifications').insert(rows);
    if (error) warn(input.kind, error.message);
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
export async function notifyEmployee(
  employeeId: string | null,
  input: NotifyInput,
): Promise<void> {
  if (!employeeId) return;
  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'SUPABASE_SECRET_KEY is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .eq('employee_id', employeeId);
    if (error) return warn(input.kind, error.message);
    await dispatch((data ?? []).map((p: { id: string }) => p.id), input);
  } catch (e) {
    warn(input.kind, e);
  }
}

/** Notify everyone who can approve things (admin/hr/manager). */
export async function notifyApprovers(input: NotifyInput, exceptProfileId?: string): Promise<void> {
  if (!isServiceRoleConfigured()) {
    warn(input.kind, 'SUPABASE_SECRET_KEY is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, role')
      .in('role', APPROVER_ROLES as unknown as string[]);
    if (error) return warn(input.kind, error.message);
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
    warn(input.kind, 'SUPABASE_SECRET_KEY is not set, so notifications are disabled.');
    return;
  }
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.from('profiles').select('id');
    if (error) return warn(input.kind, error.message);
    const ids = (data ?? [])
      .map((p: { id: string }) => p.id)
      .filter((id) => id !== exceptProfileId);
    await dispatch(ids, input);
  } catch (e) {
    warn(input.kind, e);
  }
}
