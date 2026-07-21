'use server';

// ============================================================================
// Monthly register import — preview + commit.
//
// Runs on the signed-in staff user's own session: migration 0003 grants
// `attendance_days_write` / `activity_log_write` to is_staff(), so no
// service-role key is needed (and none exists yet).
//
// Nothing here fakes a success. When Supabase is configured and a read or write
// fails, the real error comes back to the caller.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, getEmployeeCodeMap } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import {
  parseRegisterWorkbook,
  codeForEmplId,
  isKnownStatus,
  minutesToClock,
  type ParsedRegister,
} from '@/lib/excel/parseRegister';
import { autoCloseDay, getAutoPunchOutMinutes } from '@/lib/attendance-rules';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/_guard';
import type { AppRole } from '@/types/database';

export interface MatchedEmployee {
  code: string;
  name: string;
  days: number;
}

export interface ImportPreview {
  periodMonth: string;
  daysInMonth: number;
  matched: MatchedEmployee[];
  /** Empl. IDs in the sheet with no matching employees.code — never silently dropped. */
  unmatched: number[];
  warnings: string[];
  /** attendance_days rows this import would write. */
  totalRows: number;
}

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export type CommitResult =
  | { ok: true; inserted: number; updated: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/**
 * Roles that may actually write. This is deliberately NOT isStaffRole() from
 * '@/lib/auth': that helper counts 'viewer' as staff, but the database's
 * is_staff() (migration 0003) is only ('admin','hr','manager'). Gating on the
 * wider set would let a viewer through the UI and into an RLS denial.
 */
const IMPORT_ROLES: AppRole[] = ['admin', 'hr', 'manager'];

const UPSERT_CHUNK = 500;
const SELECT_PAGE = 1000;
const ON_CONFLICT = 'employee_id,work_date';

interface UpsertRow {
  employee_id: string;
  work_date: string;
  status: string;
  punch_in: string | null;
  punch_out: string | null;
  worked_minutes: number;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unexpected error.';
}

/**
 * Largest register we will parse. next.config.mjs already caps the Server Action
 * body at 10mb, but that limit is about TRANSPORT — this one is about what we
 * agree to decompress. A 2MB .xlsx is a zip that can expand to gigabytes in
 * exceljs (a zip bomb), so the size is checked before the buffer is read.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Turn the uploaded FormData field into a parsed register. */
async function readUpload(formData: FormData): Promise<ParsedRegister> {
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new Error('No file was uploaded. Choose the monthly register .xlsx and try again.');
  }
  const upload = file as File;
  if (upload.size === 0) throw new Error('That file is empty.');
  if (upload.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That file is ${(upload.size / 1024 / 1024).toFixed(1)}MB — the register limit is ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024}MB. Export a single month rather than a full year.`,
    );
  }

  const buf = await upload.arrayBuffer();
  return parseRegisterWorkbook(buf);
}

/**
 * Empl. ID -> employees.id.
 * Primary rule: 'DN' + pad3. Fallback: any code whose trailing digits match,
 * used only when exactly one code qualifies (an ambiguous match is reported,
 * never guessed).
 */
function buildResolver(codeMap: Record<string, string>) {
  const byTrailing = new Map<number, string[]>();
  for (const code of Object.keys(codeMap)) {
    const m = /(\d+)\s*$/.exec(code);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const list = byTrailing.get(n) ?? [];
    list.push(code);
    byTrailing.set(n, list);
  }

  return function resolve(emplId: number): { id: string; code: string } | { ambiguous: string[] } | null {
    const exact = codeForEmplId(emplId);
    if (codeMap[exact]) return { id: codeMap[exact], code: exact };

    const candidates = byTrailing.get(emplId) ?? [];
    if (candidates.length === 1) return { id: codeMap[candidates[0]], code: candidates[0] };
    if (candidates.length > 1) return { ambiguous: candidates };
    return null;
  };
}

/** code -> full_name, for a human-readable preview. */
async function fetchNames(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('employees').select('code, full_name');
  if (error) {
    throw new Error(`Could not load employee names: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  }
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { code: string; full_name: string | null }[]) {
    out[row.code] = row.full_name ?? row.code;
  }
  return out;
}

/**
 * Resolve every parsed block against the DB, and flatten to upsert rows.
 * Shared by preview and commit so the numbers shown are the numbers written.
 */
function planImport(
  reg: ParsedRegister,
  codeMap: Record<string, string>,
  names: Record<string, string>,
  /** Auto punch-out time (minutes since midnight) for days left open. */
  autoOutMin: number,
) {
  const resolve = buildResolver(codeMap);
  const matched: MatchedEmployee[] = [];
  const unmatched: number[] = [];
  const rows: UpsertRow[] = [];
  const warnings: string[] = [...reg.warnings];
  let skipped = 0;
  let autoClosedCount = 0;

  const monthPrefix = reg.periodMonth.slice(0, 8); // 'YYYY-MM-'

  for (const emp of reg.employees) {
    const hit = resolve(emp.emplId);

    if (hit === null) {
      unmatched.push(emp.emplId);
      skipped += emp.days.length;
      continue;
    }
    if ('ambiguous' in hit) {
      unmatched.push(emp.emplId);
      skipped += emp.days.length;
      warnings.push(
        `Empl. ID ${emp.emplId} (row ${emp.rowNumber}) matches more than one employee code (${hit.ambiguous.join(', ')}) — skipped rather than guessed.`,
      );
      continue;
    }

    let usable = 0;
    for (const d of emp.days) {
      if (!isKnownStatus(d.status)) {
        skipped++; // already warned by the parser
        continue;
      }
      // Punched in but never out: close the day at the configured auto punch-out
      // time (default 18:00) instead of importing an open day, which would read
      // as zero worked minutes and inflate the hours-shortfall deduction.
      const closed = autoCloseDay(d.inMin, d.outMin, autoOutMin);
      const outMin = closed ? closed.outMin : d.outMin;
      const workedMin = closed && d.workedMin === 0 ? closed.workedMin : d.workedMin;
      if (closed) autoClosedCount++;

      rows.push({
        employee_id: hit.id,
        work_date: `${monthPrefix}${String(d.day).padStart(2, '0')}`,
        status: d.status,
        punch_in: minutesToClock(d.inMin),
        punch_out: minutesToClock(outMin),
        worked_minutes: workedMin,
      });
      usable++;
    }

    if (hit.code !== codeForEmplId(emp.emplId)) {
      warnings.push(`Empl. ID ${emp.emplId} matched employee ${hit.code} on a trailing-digit fallback.`);
    }
    matched.push({ code: hit.code, name: names[hit.code] ?? hit.code, days: usable });
  }

  if (autoClosedCount > 0) {
    warnings.push(
      `${autoClosedCount} day(s) had a punch-in but no punch-out — closed automatically at ${minutesToClock(autoOutMin)}.`,
    );
  }

  return { matched, unmatched, rows, warnings, skipped };
}

// ---------------------------------------------------------------- preview ---

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  try {
    // Gate BEFORE parsing. This is a public HTTP endpoint, and parsing an
    // attacker-supplied .xlsx is the expensive part — leaving it ungated let any
    // authenticated user drive server CPU/memory with crafted workbooks, and
    // leaked the employee roster through the preview's matched/unmatched lists.
    // Mirrors commitImport's IMPORT_ROLES (admin/hr/manager).
    const gate = await requireStaff('Previewing the register');
    if (!gate.ok) return { ok: false, error: gate.error };

    const reg = await readUpload(formData);

    const codeMap = await getEmployeeCodeMap();
    // In demo mode getEmployeeCodeMap returns the demo roster; say so rather
    // than implying the file was checked against real staff records.
    const configured = isSupabaseConfigured();
    const names = configured ? await fetchNames() : {};
    const autoOutMin = await getAutoPunchOutMinutes();

    const { matched, unmatched, rows, warnings } = planImport(reg, codeMap, names, autoOutMin);

    if (!configured) {
      warnings.unshift(
        'Supabase is not connected. This preview matched against demo employees and importing is disabled.',
      );
    }

    return {
      ok: true,
      preview: {
        periodMonth: reg.periodMonth,
        daysInMonth: reg.daysInMonth,
        matched,
        unmatched,
        warnings,
        totalRows: rows.length,
      },
    };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

// ----------------------------------------------------------------- commit ---

/** Existing (employee_id, work_date) keys for the month, so we can report insert vs update. */
async function fetchExistingKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodMonth: string,
  daysInMonth: number,
): Promise<Set<string>> {
  const from = periodMonth;
  const to = `${periodMonth.slice(0, 8)}${String(daysInMonth).padStart(2, '0')}`;
  const keys = new Set<string>();

  for (let offset = 0; ; offset += SELECT_PAGE) {
    // The order is load-bearing, not cosmetic: PostgREST gives no stability
    // guarantee for .range() without an ORDER BY, so an unordered paged read of
    // a full roster (~210 employees x ~30 days = ~6300 rows, i.e. 7 pages) can
    // repeat and omit rows between pages. That would silently misreport the
    // inserted/updated split. Ordering by the unique key makes paging total.
    const { data, error } = await supabase
      .from('attendance_days')
      .select('employee_id, work_date')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('employee_id', { ascending: true })
      .order('work_date', { ascending: true })
      .range(offset, offset + SELECT_PAGE - 1);

    if (error) {
      throw new Error(
        `Could not read existing attendance for ${periodMonth}: ${error.message}${error.code ? ` (${error.code})` : ''}`,
      );
    }
    const page = (data ?? []) as { employee_id: string; work_date: string }[];
    for (const r of page) keys.add(`${r.employee_id}|${String(r.work_date).slice(0, 10)}`);
    if (page.length < SELECT_PAGE) break;
  }
  return keys;
}

function explainWriteError(message: string, code?: string): string {
  if (/invalid input value for enum/i.test(message)) {
    return (
      `${message} — the register uses a status the database enum does not have yet. ` +
      "If this is 'CO' (comp off), apply migration 0006_comp_off_and_import.sql, then re-run the import."
    );
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return `${message} — your account is not permitted to write attendance (needs admin, hr or manager).`;
  }
  return code ? `${message} (${code})` : message;
}

export async function commitImport(formData: FormData): Promise<CommitResult> {
  // 1. A write is impossible without a database. Never pretend otherwise.
  if (!isSupabaseConfigured()) return { ok: false, error: 'Connect Supabase to import.' };

  try {
    // 2. Staff only.
    const { userId, profile } = await getSession();
    if (!userId) return { ok: false, error: 'Sign in to import the register.' };
    const role = profile?.role;
    if (!role || !IMPORT_ROLES.includes(role)) {
      return {
        ok: false,
        error: `Importing the register needs an admin, HR or manager account${role ? ` — yours is "${role}".` : '.'}`,
      };
    }

    // 3. Parse + resolve.
    const reg = await readUpload(formData);
    const codeMap = await getEmployeeCodeMap();
    const names = await fetchNames();
    const autoOutMin = await getAutoPunchOutMinutes();
    const { matched, unmatched, rows, skipped } = planImport(reg, codeMap, names, autoOutMin);

    const errors: string[] = [];
    if (unmatched.length) {
      errors.push(
        `${unmatched.length} Empl. ID(s) had no matching employee and were skipped: ${unmatched.join(', ')}.`,
      );
    }
    for (const w of reg.warnings) errors.push(w);

    if (rows.length === 0) {
      return {
        ok: false,
        error:
          'Nothing to import — no rows in the register could be matched to an employee. ' +
          (unmatched.length ? `Unmatched Empl. IDs: ${unmatched.join(', ')}.` : ''),
      };
    }

    const supabase = await createClient();

    // 3b. Never rewrite a month whose payroll is already locked or paid — the
    //     payslips are final and 0005 blocks the recompute, so the register and
    //     pay would silently diverge. Checked once for the sheet's own month.
    const monthOpen = await requireOpenPayrollMonth(supabase, reg.periodMonth);
    if (!monthOpen.ok) return { ok: false, error: monthOpen.error };

    // 4. Snapshot existing keys so inserted/updated are real, not guessed.
    const existing = await fetchExistingKeys(supabase, reg.periodMonth, reg.daysInMonth);

    // 5. Chunked upsert. Only count rows whose chunk actually committed.
    let inserted = 0;
    let updated = 0;
    let failedRows = 0;

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase.from('attendance_days').upsert(chunk, { onConflict: ON_CONFLICT });

      if (error) {
        failedRows += chunk.length;
        errors.push(
          `Rows ${i + 1}–${i + chunk.length} failed: ${explainWriteError(error.message, error.code)}`,
        );
        continue;
      }
      for (const r of chunk) {
        if (existing.has(`${r.employee_id}|${r.work_date}`)) updated++;
        else inserted++;
      }
    }

    // Every chunk failed => this was not a successful import.
    if (inserted + updated === 0) {
      return { ok: false, error: errors[0] ?? 'The import wrote no rows.' };
    }

    // 6. Audit trail. A failure here must not misreport the attendance write,
    //    so it is surfaced as an error but the import still counts.
    const summary =
      `Imported monthly register for ${reg.periodMonth}: ${matched.length} employee(s), ` +
      `${inserted} inserted, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}` +
      `${failedRows ? `, ${failedRows} failed` : ''}.`;

    const { error: logError } = await supabase.from('activity_log').insert({
      actor_id: profile?.id ?? userId,
      event_type: 'register_import',
      message: summary,
      metadata: {
        period_month: reg.periodMonth,
        employees: matched.length,
        inserted,
        updated,
        skipped,
        failed_rows: failedRows,
        unmatched_empl_ids: unmatched,
        source_rows: rows.length,
      },
    });
    if (logError) errors.push(`Attendance imported, but the activity log entry failed: ${logError.message}`);

    revalidatePath('/register');
    revalidatePath('/today');
    revalidatePath('/payroll');
    revalidatePath('/me');

    return { ok: true, inserted, updated, skipped, errors };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}
