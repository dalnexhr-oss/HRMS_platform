'use server';

// ============================================================================
// Onboarding checklists (migration 0037).
//
// A joiner's first week was tribal knowledge: someone remembered to chase the
// signed offer letter, someone else remembered the laptop, and nobody could say
// what was outstanding. `0037` created the tables and seeded a "Standard
// Onboarding" template; this file is what actually puts tasks on the board.
//
// Templates are COPIED into onboarding_tasks at start, never referenced live —
// editing a template must not rewrite the history of joiners already in flight
// (the 0037 table comment is explicit about this).
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { notifyEmployee } from '@/lib/notify';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ONBOARDING_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];
const TASK_STATUSES = ['pending', 'done', 'blocked'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Copy a template's items onto an employee as their checklist.
 *
 * Idempotent in practice: if the employee already has tasks we leave them alone
 * rather than duplicating the list — HR clicking "start onboarding" twice is a
 * mis-click, not a request for eighteen tasks.
 *
 * `templateId` is optional; the newest ACTIVE template is used when omitted, so
 * `createEmployee` can call this with no knowledge of template ids.
 */
export async function startOnboarding(
  employeeId: string,
  templateId?: string,
): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(ONBOARDING_ROLES, 'Starting onboarding');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(String(employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };

  const dbc = await createClient();

  const { count, error: countErr } = await dbc
    .from('onboarding_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId);
  if (countErr) {
    return { ok: false, error: countErr.message };
  }
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'This employee already has an onboarding checklist.' };
  }

  // Resolve the template: the one asked for, else the newest active one.
  let tpl = templateId ?? null;
  if (!tpl) {
    const { data: newest } = await dbc
      .from('onboarding_templates')
      .select('id')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    tpl = newest?.id ?? null;
  }
  if (!tpl) return { ok: false, error: 'No active onboarding template — create one first.' };

  const { data: items, error: itemsErr } = await dbc
    .from('onboarding_template_items')
    .select('title, assignee_role, seq')
    .eq('template_id', tpl)
    .order('seq');
  if (itemsErr) return { ok: false, error: itemsErr.message };
  if (!items?.length) return { ok: false, error: 'That template has no steps.' };

  // Due by the joining date: everything on this list is meant to be settled by
  // the time they walk in. A null due_date would also make them invisible to the
  // 0037 reminder job, which scans on due_date.
  const { data: emp } = await dbc
    .from('employees')
    .select('date_of_joining, full_name')
    .eq('id', employeeId)
    .maybeSingle<{ date_of_joining: string; full_name: string }>();
  const dueDate = emp?.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : null;

  const rows = (items as any[]).map((i) => ({
    employee_id: employeeId,
    title: i.title,
    assignee_role: i.assignee_role,
    status: 'pending',
    due_date: dueDate,
  }));

  const { data: made, error } = await dbc.from('onboarding_tasks').insert(rows).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(made)) {
    return { ok: false, error: 'The checklist was not created — your role may lack permission.' };
  }

  // Tell the joiner what is expected of them (their own steps are read-only for
  // them, but they should know the list exists).
  await notifyEmployee(employeeId, {
    kind: 'system',
    title: 'Your onboarding checklist is ready',
    body: `${made!.length} step(s) to complete with HR and IT.`,
    link: '/me#onboarding',
  });

  revalidatePath('/onboarding');
  revalidatePath('/me');
  return { ok: true, created: made!.length };
}

/**
 * Move a step between pending / done / blocked.
 *
 * Reopening CLEARS done_by and done_at. Leaving them behind would leave a
 * pending task still naming a reviewer and a completion time — the record would
 * claim someone signed off work that is once again outstanding.
 */
export async function setOnboardingTaskStatus(
  id: string,
  status: (typeof TASK_STATUSES)[number],
): Promise<ActionResult> {
  const gate = await requireRoles(ONBOARDING_ROLES, 'Updating an onboarding step');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(String(id ?? ''))) return { ok: false, error: 'Unknown onboarding step.' };
  if (!TASK_STATUSES.includes(status)) return { ok: false, error: 'Pick a valid status.' };

  const done = status === 'done';
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .update({
      status,
      done_by: done ? gate.profileId : null,
      done_at: done ? new Date() : null,
    })
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  // A policy-blocked update matches zero rows and is still reported as
  // success, so a silent no-op has to be caught here rather than trusted.
  if (wroteNothing(data)) {
    return { ok: false, error: 'That step was not updated — it may have been removed.' };
  }

  revalidatePath('/onboarding');
  revalidatePath('/me');
  return { ok: true };
}

/** Add a one-off step to someone's checklist, beyond whatever the template gave them. */
export async function addOnboardingTask(input: {
  employeeId: string;
  title: string;
  assigneeRole?: string;
  dueDate?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(ONBOARDING_ROLES, 'Adding an onboarding step');
  if (!gate.ok) return gate;

  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  const title = String(input.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give the step a title.' };

  // The date input posts '' when left empty; storing that would fail the date
  // cast, and storing it as a real value would be a lie about a deadline.
  const dueDate = String(input.dueDate ?? '').trim() || null;
  const assigneeRole = String(input.assigneeRole ?? '').trim() || null;

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .insert({
      employee_id: input.employeeId,
      title,
      assignee_role: assigneeRole,
      status: 'pending',
      due_date: dueDate,
    })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The step was not added — your role may lack permission.' };
  }

  revalidatePath('/onboarding');
  revalidatePath('/me');
  return { ok: true };
}

/** Remove a step. Used for steps added by mistake or made irrelevant by the role. */
export async function deleteOnboardingTask(id: string): Promise<ActionResult> {
  const gate = await requireRoles(ONBOARDING_ROLES, 'Removing an onboarding step');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(String(id ?? ''))) return { ok: false, error: 'Unknown onboarding step.' };

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That step was not removed — it may already be gone.' };
  }

  revalidatePath('/onboarding');
  revalidatePath('/me');
  return { ok: true };
}
