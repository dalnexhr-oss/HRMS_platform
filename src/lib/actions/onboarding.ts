'use server';

// Create onboarding tasks from a template snapshot so later template edits do not change active
// checklists.
import { revalidatePath } from 'next/cache';
import { queryErrorCodes } from '@/lib/db/query-errors';
import { createClient } from '@/lib/db/server-client';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';
import { notifyEmployee } from '@/lib/notification-delivery';
import type { AppRole } from '@/types/database';

interface ActionResult {
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
async function startOnboarding(
  employeeId: string,
  templateId?: string,
): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(onboardingRoles, 'Starting onboarding');
  if (!gate.ok) {
    return gate;
  }
  if (!uuidRe.test(String(employeeId ?? ''))) {
    return { ok: false, error: 'Pick an employee.' };
  }

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
  if (!tpl) {
    return { ok: false, error: 'No active onboarding template — create one first.' };
  }

  const { data: items, error: itemsErr } = await dbc
    .from('onboarding_template_items')
    .select('title, assignee_role, seq')
    .eq('template_id', tpl)
    .order('seq');
  if (itemsErr) {
    return { ok: false, error: itemsErr.message };
  }
  if (!items?.length) {
    return { ok: false, error: 'That template has no steps.' };
  }

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
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(made)) {
    return { ok: false, error: 'The checklist was not created — your role may lack permission.' };
  }

  // Notify employee of generated checklist items.
  await notifyEmployee(employeeId, {
    kind: 'system',
    title: 'Your onboarding checklist is ready',
    body: `${made!.length} step(s) to complete with HR and IT.`,
    link: '/employee/onboarding',
  });

  revalidatePath('/onboarding');
  // 'layout' is the refresh scope, not a path: /employee and every tab under it.
  revalidatePath('/employee', 'layout');
  return { ok: true, created: made!.length };
}

/**
 * Move a step between pending / done / blocked.
 *
 * Reopening clears done_by and done_at to maintain audit integrity.
 */
async function setOnboardingTaskStatus(
  id: string,
  status: (typeof taskStatuses)[number],
): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Updating an onboarding step');
  if (!gate.ok) {
    return gate;
  }
  if (!uuidRe.test(String(id ?? ''))) {
    return { ok: false, error: 'Unknown onboarding step.' };
  }
  if (!taskStatuses.includes(status)) {
    return { ok: false, error: 'Pick a valid status.' };
  }

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
  revalidatePath('/employee', 'layout');
  return { ok: true };
}

/** Add a one-off step to someone's checklist, beyond whatever the template gave them. */
async function addOnboardingTask(input: {
  employeeId: string;
  title: string;
  assigneeRole?: string;
  dueDate?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Adding an onboarding step');
  if (!gate.ok) {
    return gate;
  }

  if (!uuidRe.test(String(input.employeeId ?? ''))) {
    return { ok: false, error: 'Pick an employee.' };
  }
  const title = String(input.title ?? '').trim();
  if (!title) {
    return { ok: false, error: 'Give the step a title.' };
  }

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
  revalidatePath('/employee', 'layout');
  return { ok: true };
}

/** Remove a step. Used for steps added by mistake or made irrelevant by the role. */
async function deleteOnboardingTask(id: string): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Removing an onboarding step');
  if (!gate.ok) {
    return gate;
  }
  if (!uuidRe.test(String(id ?? ''))) {
    return { ok: false, error: 'Unknown onboarding step.' };
  }

  const dbc = await createClient();
  const { data, error } = await dbc.from('onboarding_tasks').delete().eq('id', id).select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That step was not removed — it may already be gone.' };
  }

  revalidatePath('/onboarding');
  revalidatePath('/employee', 'layout');
  return { ok: true };
}

// Owners a step can be given. A display label for who does the step, not a permission.
const stepOwners: readonly string[] = ['hr', 'it', 'admin', 'employee'];

/**
 * Create a checklist template, or replace the name, status and steps of the one named by `id`.
 * Checklists already started are snapshots, so editing a template never changes them.
 */
async function saveOnboardingTemplate(input: {
  id?: string;
  name: string;
  active: boolean;
  items: Array<{ title: string; assigneeRole: string | null }>;
}): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Changing an onboarding template');
  if (!gate.ok) {
    return gate;
  }
  const name = String(input.name ?? '').trim();
  if (!name) {
    return { ok: false, error: 'Give the template a name.' };
  }
  if (name.length > 80) {
    return { ok: false, error: 'Keep the template name under 80 characters.' };
  }
  const items = (Array.isArray(input.items) ? input.items : []).map((item) => ({
    title: String(item.title ?? '').trim(),
    assigneeRole:
      item.assigneeRole && stepOwners.includes(item.assigneeRole) ? item.assigneeRole : null,
  }));
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one step.' };
  }
  if (items.length > 100) {
    return { ok: false, error: 'That is too many steps for one template.' };
  }
  const titles = new Set<string>();
  for (const item of items) {
    if (!item.title) {
      return { ok: false, error: 'Every step needs a description.' };
    }
    if (item.title.length > 200) {
      return { ok: false, error: 'Keep each step under 200 characters.' };
    }
    if (titles.has(item.title.toLowerCase())) {
      return { ok: false, error: `“${item.title}” is listed twice.` };
    }
    titles.add(item.title.toLowerCase());
  }
  if (input.id !== undefined && !uuidRe.test(String(input.id))) {
    return { ok: false, error: 'Unknown onboarding template.' };
  }

  const dbc = await createClient();
  let templateId = input.id ?? '';
  if (templateId) {
    const { data, error } = await dbc
      .from('onboarding_templates')
      .update({ name, active: input.active === true })
      .eq('id', templateId)
      .select('id');
    if (error) {
      return { ok: false, error: templateSaveError(error, name) };
    }
    if (wroteNothing(data)) {
      return { ok: false, error: 'That template no longer exists.' };
    }
  } else {
    const { data, error } = await dbc
      .from('onboarding_templates')
      .insert({ name, active: input.active === true })
      .select('id');
    if (error) {
      return { ok: false, error: templateSaveError(error, name) };
    }
    templateId = (data?.[0] as { id: string } | undefined)?.id ?? '';
    if (!templateId) {
      return { ok: false, error: 'The template was not created — your role may lack permission.' };
    }
  }

  // Replace the steps as a whole, so order and removals are saved together.
  const { error: clearError } = await dbc
    .from('onboarding_template_items')
    .delete()
    .eq('template_id', templateId);
  if (clearError) {
    return {
      ok: false,
      error: `The template was saved, but its steps were not: ${clearError.message}`,
    };
  }
  const { error: itemsError } = await dbc.from('onboarding_template_items').insert(
    items.map((item, index) => ({
      template_id: templateId,
      seq: index + 1,
      title: item.title,
      assignee_role: item.assigneeRole,
    })),
  );
  if (itemsError) {
    return {
      ok: false,
      error: `The template was saved, but its steps were not: ${itemsError.message}. Open it and save the steps again.`,
    };
  }

  revalidatePath('/onboarding');
  return { ok: true };
}

function templateSaveError(error: { code?: string; message: string }, name: string): string {
  return error.code === queryErrorCodes.duplicateKey
    ? `A template called “${name}” already exists.`
    : error.message;
}

/** Delete a template and its steps. Checklists already started from it are unaffected. */
async function deleteOnboardingTemplate(id: string): Promise<ActionResult> {
  const gate = await requireRoles(onboardingRoles, 'Deleting an onboarding template');
  if (!gate.ok) {
    return gate;
  }
  if (!uuidRe.test(String(id ?? ''))) {
    return { ok: false, error: 'Unknown onboarding template.' };
  }
  const dbc = await createClient();
  const { error: itemsError } = await dbc
    .from('onboarding_template_items')
    .delete()
    .eq('template_id', id);
  if (itemsError) {
    return { ok: false, error: itemsError.message };
  }
  const { data, error } = await dbc.from('onboarding_templates').delete().eq('id', id).select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That template no longer exists.' };
  }
  revalidatePath('/onboarding');
  return { ok: true };
}

export {
  startOnboarding,
  setOnboardingTaskStatus,
  addOnboardingTask,
  deleteOnboardingTask,
  saveOnboardingTemplate,
  deleteOnboardingTemplate,
};

export type { ActionResult };
