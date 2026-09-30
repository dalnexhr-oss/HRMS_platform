import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';

// onboarding
interface OnboardingTaskRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  title: string;
  assigneeRole: string | null;
  status: 'pending' | 'done' | 'blocked';
  dueDate: string | null;
}

interface OnboardingTemplateRow {
  id: string;
  name: string;
  active: boolean;
  /** How many steps the template fans out into. */
  steps: number;
}

const onboardingTaskFields =
  'id, employee_id, title, assignee_role, status, due_date, employees(code, full_name)';

function mapOnboardingTask(r: any): OnboardingTaskRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    code: r.employees?.code ?? '',
    name: r.employees?.full_name ?? '',
    title: r.title,
    assigneeRole: r.assignee_role,
    status: r.status,
    dueDate: r.due_date,
  };
}

/** Return onboarding tasks by due date, with undated tasks last so overdue work appears first. */
async function getOnboardingBoard(): Promise<OnboardingTaskRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .select(onboardingTaskFields)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) {
    fail('getOnboardingBoard: could not load onboarding tasks', error);
  }
  return (data ?? []).map(mapOnboardingTask);
}

/** One employee's own checklist — the read-only card on /employee. */
async function getMyOnboardingTasks(employeeId: string): Promise<OnboardingTaskRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .select(onboardingTaskFields)
    .eq('employee_id', employeeId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) {
    fail('getMyOnboardingTasks: could not load your onboarding checklist', error);
  }
  return (data ?? []).map(mapOnboardingTask);
}

/** Load reusable checklists with an embedded step count. Templates without items have zero steps. */
async function getOnboardingTemplates(): Promise<OnboardingTemplateRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_templates')
    .select('id, name, active, onboarding_template_items(count)')
    .order('name');
  if (error) {
    fail('getOnboardingTemplates: could not load onboarding templates', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    steps: Number(r.onboarding_template_items?.[0]?.count ?? 0),
  }));
}

export { getOnboardingBoard, getMyOnboardingTasks, getOnboardingTemplates };

export type { OnboardingTaskRow, OnboardingTemplateRow };
