'use server';

// ============================================================================
// Leave-salary workings (migration 0038): save, finalize, reopen, mark paid.
//
// The one rule of this file: THE SERVER COMPUTES. The client shows a live
// preview with the same pure module, but every figure that lands in the table
// is recomputed here from attendance_days + the submitted salaries — a crafted
// POST cannot save itself a bigger payout than the formula produces.
//
// Status flow: draft → finalized → paid. Finalize re-snapshots and locks the
// inputs; reopen (finalized → draft) exists for corrections; paid is terminal.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { notifyEmployee } from '@/lib/notify';
import { computeLeaveSalary, presenceByMonth } from '@/lib/leave-salary';
import { inr } from '@/lib/format';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A monthly gross beyond this is a typo, not a salary.
const SALARY_CAP = 10_000_000;

function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

function notMigrated(code?: string): boolean {
  return code === '42P01' || code === 'PGRST205';
}

/**
 * One employee-year of attendance, credit-weighted per month. ≤366 rows, so no
 * paging is needed here (the page-wide sweep in queries.ts is the paged one).
 */
async function loadPresence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  year: number,
): Promise<number[]> {
  const { data, error } = await supabase
    .from('attendance_days')
    .select('work_date, status')
    .eq('employee_id', employeeId)
    .gte('work_date', `${year}-01-01`)
    .lte('work_date', `${year}-12-31`);
  if (error) throw new Error(`could not load attendance: ${error.message}`);
  return presenceByMonth(
    (data ?? []).map((r: any) => ({ workDate: String(r.work_date), status: String(r.status) })),
  );
}

/**
 * Save (upsert) the working for one employee-year: validate, recompute from
 * attendance, snapshot everything. Refused once the row is finalized or paid —
 * reopen it first, so a "quick edit" cannot bypass the lock.
 */
export async function saveLeaveSalaryWorking(input: {
  employeeId: string;
  year: number;
  salaryBefore: number;
  salaryAfter: number;
  /** 1–12; 4 = the default 1 April increment. */
  incrementMonth: number;
  remarks?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Saving a leave-salary working');
  if (!gate.ok) return gate;

  const year = Number(input.year);
  const salaryBefore = Number(input.salaryBefore);
  const salaryAfter = Number(input.salaryAfter);
  const incrementMonth = Number(input.incrementMonth);

  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!validYear(year)) return { ok: false, error: 'Enter a valid year.' };
  if (!Number.isFinite(salaryBefore) || salaryBefore < 0 || salaryBefore > SALARY_CAP) {
    return { ok: false, error: 'Enter a valid monthly salary for the pre-appraisal period.' };
  }
  if (!Number.isFinite(salaryAfter) || salaryAfter < 0 || salaryAfter > SALARY_CAP) {
    return { ok: false, error: 'Enter a valid monthly salary for the post-appraisal period.' };
  }
  if (!Number.isInteger(incrementMonth) || incrementMonth < 1 || incrementMonth > 12) {
    return { ok: false, error: 'Pick the month the increment takes effect.' };
  }

  const supabase = await createClient();

  // The lock check. A separate read rather than a predicated upsert because the
  // caller deserves "reopen it first", not a silent no-op.
  const { data: existing, error: readErr } = await supabase
    .from('leave_salary_workings')
    .select('id, status')
    .eq('employee_id', input.employeeId)
    .eq('year', year)
    .maybeSingle<{ id: string; status: string }>();
  if (readErr) {
    if (notMigrated(readErr.code)) {
      return { ok: false, error: 'Leave salary is not set up on the database yet — apply migration 0038.' };
    }
    return { ok: false, error: readErr.message };
  }
  if (existing && existing.status !== 'draft') {
    return { ok: false, error: `This working is ${existing.status}. Reopen it before editing.` };
  }

  let monthlyPresence: number[];
  try {
    monthlyPresence = await loadPresence(supabase, input.employeeId, year);
  } catch (e) {
    return { ok: false, error: `Saving a leave-salary working: ${(e as Error).message}` };
  }

  const result = computeLeaveSalary({ year, salaryBefore, salaryAfter, incrementMonth, monthlyPresence });

  const snapshot = {
    employee_id: input.employeeId,
    year,
    salary_before: salaryBefore,
    salary_after: salaryAfter,
    increment_effective: `${year}-${String(incrementMonth).padStart(2, '0')}-01`,
    present_p1: result.p1.presentDays,
    present_p2: result.p2.presentDays,
    calendar_days_p1: result.p1.calendarDays,
    calendar_days_p2: result.p2.calendarDays,
    amount_p1: result.p1.payable,
    amount_p2: result.p2.payable,
    total_amount: result.total,
    remarks: String(input.remarks ?? '').trim() || null,
    updated_by: gate.profileId,
  };

  const { data, error } = await supabase
    .from('leave_salary_workings')
    .upsert(snapshot, { onConflict: 'employee_id,year' })
    .select('id');
  if (error) {
    if (notMigrated(error.code)) {
      return { ok: false, error: 'Leave salary is not set up on the database yet — apply migration 0038.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The working was not saved — your role may lack permission.' };
  }

  revalidatePath('/leave');
  return { ok: true };
}

/**
 * Lock a draft: recompute one last time (attendance may have moved since the
 * save) and stamp the result. From here the figures on the row ARE the payout.
 */
export async function finalizeLeaveSalary(id: string): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Finalizing a leave-salary working');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(id)) return { ok: false, error: 'Unknown working.' };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from('leave_salary_workings')
    .select('id, employee_id, year, salary_before, salary_after, increment_effective, status')
    .eq('id', id)
    .maybeSingle<{
      employee_id: string;
      year: number;
      salary_before: number | string;
      salary_after: number | string;
      increment_effective: string;
      status: string;
    }>();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: 'That working no longer exists.' };
  if (row.status !== 'draft') return { ok: false, error: `This working is already ${row.status}.` };

  const year = Number(row.year);
  let monthlyPresence: number[];
  try {
    monthlyPresence = await loadPresence(supabase, row.employee_id, year);
  } catch (e) {
    return { ok: false, error: `Finalizing a leave-salary working: ${(e as Error).message}` };
  }

  const result = computeLeaveSalary({
    year,
    salaryBefore: Number(row.salary_before),
    salaryAfter: Number(row.salary_after),
    incrementMonth: Number(String(row.increment_effective).slice(5, 7)),
    monthlyPresence,
  });

  const { data, error } = await supabase
    .from('leave_salary_workings')
    .update({
      present_p1: result.p1.presentDays,
      present_p2: result.p2.presentDays,
      calendar_days_p1: result.p1.calendarDays,
      calendar_days_p2: result.p2.calendarDays,
      amount_p1: result.p1.payable,
      amount_p2: result.p2.payable,
      total_amount: result.total,
      status: 'finalized',
      updated_by: gate.profileId,
    })
    .eq('id', id)
    .eq('status', 'draft') // races with a concurrent finalize lose here
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'Only a draft working can be finalized.' };

  await supabase.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: row.employee_id,
    event_type: 'leave_salary',
    message: `Leave salary for ${year} finalized at ${inr(result.total)}`,
    metadata: { year, total: result.total, working_id: id },
  });

  revalidatePath('/leave');
  return { ok: true };
}

/** Unlock a finalized working for correction. Paid stays paid. */
export async function reopenLeaveSalary(id: string): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Reopening a leave-salary working');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(id)) return { ok: false, error: 'Unknown working.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leave_salary_workings')
    .update({ status: 'draft', updated_by: gate.profileId })
    .eq('id', id)
    .eq('status', 'finalized')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only a finalized working can be reopened — a paid one is settled.' };
  }

  revalidatePath('/leave');
  return { ok: true };
}

/** Mark a finalized working paid: stamp who/when, tell the employee. */
export async function markLeaveSalaryPaid(id: string): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Marking a leave salary paid');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(id)) return { ok: false, error: 'Unknown working.' };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from('leave_salary_workings')
    .select('id, employee_id, year, total_amount, status')
    .eq('id', id)
    .maybeSingle<{ employee_id: string; year: number; total_amount: number | string; status: string }>();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: 'That working no longer exists.' };
  if (row.status !== 'finalized') {
    return {
      ok: false,
      error: row.status === 'paid' ? 'This working is already paid.' : 'Finalize the working before paying it.',
    };
  }

  const { data, error } = await supabase
    .from('leave_salary_workings')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_by: gate.profileId,
      updated_by: gate.profileId,
    })
    .eq('id', id)
    .eq('status', 'finalized')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'Only a finalized working can be marked paid.' };

  const total = Number(row.total_amount ?? 0);
  await notifyEmployee(row.employee_id, {
    kind: 'payroll',
    title: 'Your leave salary was paid',
    body: `${inr(total)} for ${row.year}`,
    // /me has no leave-salary section of its own yet; payslips is the nearest
    // truthful destination for a payout notification.
    link: '/me#payslips',
  });
  await supabase.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: row.employee_id,
    event_type: 'leave_salary',
    message: `Leave salary for ${row.year} marked paid (${inr(total)})`,
    metadata: { year: row.year, total, working_id: id },
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true };
}
