// ============================================================================
// The /leave page's view-model, shared with the .xlsx export.
//
// One builder produces the merged rows (roster × presence × saved workings)
// for BOTH surfaces, so the sheet HR downloads always equals the screen they
// approved from — two independent merges would drift the day one is edited.
//
// Server-only by dependency (it calls the data layer); the pure math it leans
// on lives in @/lib/leave-salary, which the client table also imports.
// ============================================================================
import {
  getLeaveSalaryPresence,
  getLeaveSalaryRoster,
  getLeaveSalaryWorkings,
  type LeaveSalaryWorkingRow,
} from '@/lib/queries';
import { computeLeaveSalary, type LeaveSalaryResult } from '@/lib/leave-salary';

/** Increment month when nothing is saved: April — appraisals land in March. */
export const DEFAULT_INCREMENT_MONTH = 4;

export interface LeaveSalaryViewRow {
  employeeId: string;
  code: string;
  name: string;
  /** false = inactive employee kept on the sheet by a saved working. */
  onRoster: boolean;
  /** Inputs — the saved working wins; otherwise both default to gross. */
  salaryBefore: number;
  salaryAfter: number;
  incrementMonth: number;
  remarks: string;
  /** Credit-weighted presence per month (index 0 = Jan), from attendance. */
  monthlyPresence: number[];
  /** Computed from CURRENT attendance + the inputs above. */
  live: LeaveSalaryResult;
  /** The saved row, when one exists. Authoritative once status ≠ draft. */
  working: LeaveSalaryWorkingRow | null;
  /**
   * A finalized/paid snapshot no longer matches current attendance — someone
   * edited the register after the working was locked. The snapshot stays
   * authoritative; this flag is how the UI says "look again".
   */
  drift: boolean;
}

export interface LeaveSalaryView {
  year: number;
  /** false when migration 0038 has not been applied to this database. */
  migrated: boolean;
  rows: LeaveSalaryViewRow[];
}

export async function buildLeaveSalaryView(year: number): Promise<LeaveSalaryView> {
  const [roster, presence, workings] = await Promise.all([
    getLeaveSalaryRoster(year),
    getLeaveSalaryPresence(year),
    getLeaveSalaryWorkings(year),
  ]);

  const byEmployee = new Map<string, LeaveSalaryWorkingRow>(
    (workings ?? []).map((w) => [w.employeeId, w]),
  );

  const rows = roster.map((e): LeaveSalaryViewRow => {
    const working = byEmployee.get(e.id) ?? null;
    const monthlyPresence = presence[e.id] ?? new Array(12).fill(0);

    const salaryBefore = working ? working.salaryBefore : e.grossMonthly;
    const salaryAfter = working ? working.salaryAfter : e.grossMonthly;
    const incrementMonth = working
      ? Number(working.incrementEffective.slice(5, 7)) || DEFAULT_INCREMENT_MONTH
      : DEFAULT_INCREMENT_MONTH;

    const live = computeLeaveSalary({
      year,
      salaryBefore,
      salaryAfter,
      incrementMonth,
      monthlyPresence,
    });

    // Money compares within a paisa; presence within a half-day step.
    const drift =
      working !== null &&
      working.status !== 'draft' &&
      (Math.abs(working.totalAmount - live.total) > 0.01 ||
        Math.abs(working.presentP1 - live.p1.presentDays) > 0.01 ||
        Math.abs(working.presentP2 - live.p2.presentDays) > 0.01);

    return {
      employeeId: e.id,
      code: e.code,
      name: e.name,
      onRoster: e.status === 'active' || e.status === 'on_notice',
      salaryBefore,
      salaryAfter,
      incrementMonth,
      remarks: working?.remarks ?? '',
      monthlyPresence,
      live,
      working,
      drift,
    };
  });

  return { year, migrated: workings !== null, rows };
}

