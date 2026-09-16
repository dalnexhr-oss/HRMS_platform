'use server';

// Create onboarding tasks from a template snapshot so later template edits do not change active
// checklists.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';
import { notifyEmployee } from '@/lib/notify';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const onboardingRoles: AppRole[] = ['super_admin', 'admin', 'hr'];
const taskStatuses = ['pending', 'done', 'blocked'] as const;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Instantiates onboarding tasks for an employee from the specified (or default active) template.
 * Idempotent: returns early if onboarding tasks already exist for the employee.
 */
export async function startOnboarding(
  employeeId: string,
  templateId?: string,
): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(onboardingRoles, 'Starting onboarding');
  if (!gate.ok) return gate;
  if (!uuidRe.test(String(employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };

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

  // Set task due date to employee joining date for deadline tracking and automated reminder sweeps.
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

  // Notify employee of generated checklist items.
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
 * Reopening clears done_by and done_at to maintain audit integrity.
 */
export async function setOnboardingTaskStatus(
  id: string,
  status: (typeof taskStatuses)[number],
): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Updating an onboarding step');
  if (!gate.ok) return gate;
  if (!uuidRe.test(String(id ?? ''))) return { ok: false, error: 'Unknown onboarding step.' };
  if (!taskStatuses.includes(status)) return { ok: false, error: 'Pick a valid status.' };

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
  // Guard against silent no-ops when row does not exist or policy denies update.
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
  const gate = await requireRoles(onboardingRoles, 'Adding an onboarding step');
  if (!gate.ok) return gate;

  if (!uuidRe.test(String(input.employeeId ?? '')))
    return { ok: false, error: 'Pick an employee.' };
  const title = String(input.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give the step a title.' };

  // Empty date strings are normalized to null.
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
  const gate = await requireRoles(onboardingRoles, 'Removing an onboarding step');
  if (!gate.ok) return gate;
  if (!uuidRe.test(String(id ?? ''))) return { ok: false, error: 'Unknown onboarding step.' };

  const dbc = await createClient();
  const { data, error } = await dbc.from('onboarding_tasks').delete().eq('id', id).select('id');
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
