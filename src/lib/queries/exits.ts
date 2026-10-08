import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, isoOrNull } from '@/lib/queries/shared';

// exits
interface ExitCaseRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  stage: 'initiated' | 'clearance' | 'settlement' | 'completed';
  resignationDate: string | null;
  lastWorkingDay: string | null;
  reason: string | null;
  /** Outstanding counts from v_exit_clearance_pending. */
  assetsOutstanding: number;
  itemsOutstanding: number;
  clearanceItemsOpen: number;
  clearanceComplete: boolean;
  /** Settlement, when one has been prepared. */
  fnfStatus: 'draft' | 'approved' | 'paid' | null;
  fnfNetPayable: number | null;
}

/** Every exit case with its clearance and settlement state — the HR exits board. */
async function getExitCases(): Promise<ExitCaseRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('exit_cases')
    .select(
      'id, employee_id, stage, resignation_date, last_working_day, reason, employees(code, full_name)',
    )
    .order('last_working_day', { ascending: false });
  if (error) {
    fail('getExitCases: could not load exit cases', error);
  }
  const cases = (data ?? []) as any[];
  if (cases.length === 0) {
    return [];
  }

  // Query clearance view and settlement records in parallel with graceful fallbacks.
  const [{ data: pending }, { data: fnfs }] = await Promise.all([
    queryClient
      .from('v_exit_clearance_pending')
      .select(
        'exit_case_id, assets_outstanding, items_outstanding, clearance_items_open, clearance_complete',
      ),
    queryClient.from('full_and_final').select('exit_case_id, status, net_payable'),
  ]);
  const byCase = new Map((pending ?? []).map((p: any) => [p.exit_case_id, p]));
  const fnfByCase = new Map((fnfs ?? []).map((f: any) => [f.exit_case_id, f]));

  return cases.map((c) => {
    const p = byCase.get(c.id);
    const f = fnfByCase.get(c.id);
    return {
      id: c.id,
      employeeId: c.employee_id,
      code: c.employees?.code ?? '',
      name: c.employees?.full_name ?? '',
      stage: c.stage,
      resignationDate: c.resignation_date,
      lastWorkingDay: c.last_working_day,
      reason: c.reason,
      assetsOutstanding: Number(p?.assets_outstanding ?? 0),
      itemsOutstanding: Number(p?.items_outstanding ?? 0),
      clearanceItemsOpen: Number(p?.clearance_items_open ?? 0),
      clearanceComplete: Boolean(p?.clearance_complete ?? false),
      fnfStatus: f?.status ?? null,
      fnfNetPayable: f ? Number(f.net_payable ?? 0) : null,
    };
  });
}

interface ExitInterviewRow {
  id: string;
  question: string;
  answer: string | null;
  submittedAt: string | null;
}

/** Read interview answers in insertion order. Each exit stores its own questionnaire snapshot. */
async function getExitInterview(exitCaseId: string): Promise<ExitInterviewRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('exit_interviews')
    .select('id, question, answer, submitted_at, created_at')
    .eq('exit_case_id', exitCaseId)
    .order('created_at', { ascending: true });
  if (error) {
    fail('getExitInterview: could not load the exit interview', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    submittedAt: isoOrNull(r.submitted_at),
  }));
}

interface KtItemRow {
  id: string;
  task: string;
  handoverTo: string | null;
  handoverName: string | null;
  status: 'pending' | 'in_progress' | 'done';
  notes: string | null;
}

/** One exit case's knowledge-transfer items. */
async function getKtItems(exitCaseId: string): Promise<KtItemRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('knowledge_transfer_items')
    .select('id, task, handover_to, status, notes, created_at, employees(full_name)')
    .eq('exit_case_id', exitCaseId)
    .order('created_at', { ascending: true });
  if (error) {
    fail('getKtItems: could not load handover items', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    task: r.task,
    handoverTo: r.handover_to,
    handoverName: r.employees?.full_name ?? null,
    status: r.status,
    notes: r.notes,
  }));
}

interface ClearanceItemRow {
  id: string;
  area: string;
  description: string | null;
  cleared: boolean;
}

/** The clearance checklist for one exit case. */
async function getClearanceItems(exitCaseId: string): Promise<ClearanceItemRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('exit_clearance_items')
    .select('id, area, description, cleared')
    .eq('exit_case_id', exitCaseId)
    .order('area');
  if (error) {
    fail('getClearanceItems: could not load clearance items', error);
  }
  return (data ?? []) as unknown as ClearanceItemRow[];
}

export { getExitCases, getExitInterview, getKtItems, getClearanceItems };

export type { ExitCaseRow, ExitInterviewRow, KtItemRow, ClearanceItemRow };
