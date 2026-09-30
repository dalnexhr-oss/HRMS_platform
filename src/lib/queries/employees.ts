import 'server-only';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { toNumber } from '@/lib/db/decimal-conversions';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';
import { currentPeriodMonth, monthRange, todayISO } from '@/lib/business-dates';
import { presentDaySurplus } from '@/lib/worked-time';
import { minutesToHHMM } from '@/lib/display-formatting';
import type { EmployeeDoc, EmployeeStatus, DepartmentDoc } from '@/lib/db/collection-registry';

// employee code map
/** employees.code -> employees.id, for the Excel importer. */
async function getEmployeeCodeMap(): Promise<Record<string, string>> {
  const employees = await scoped<EmployeeDoc>(collections.employees);
  const rows = await employees.find({}, { projection: { code: 1 } });
  return Object.fromEntries(rows.map((e) => [e.code, e._id]));
}

// employees
interface EmployeeListRow {
  code: string;
  name: string;
  branch: string;
  gender: string;
  // uan was declared non-nullable, but employees.pf_uan is nullable and the old
  // mapper returned null through an `any`. Corrected rather than coerced: the
  // register shows a blank UAN column for employees who have none.
  doj: string;
  gross: number;
  uan: string | null;
  esic_no: string | null;
  active: boolean;
  status: EmployeeStatus;
  // employmentType: EmploymentType;
}

/** Employee roster. Active-only by default; pass includeInactive to also return
 *  deactivated employees (so the UI can offer a "reactivate"). */
async function getEmployees(includeInactive = false): Promise<EmployeeListRow[]> {
  const employees = await scoped<EmployeeDoc>(collections.employees);
  // Reads denormalized branch_name directly without additional collection lookup.
  const rows = await employees.find(
    includeInactive ? { deleted_at: null } : { status: 'active', deleted_at: null },
    {
      sort: { code: 1 },
    },
  );
  return rows.map((e) => ({
    code: e.code,
    name: e.full_name,
    branch: e.branch_name ?? '',
    gender: e.gender,
    doj: e.date_of_joining,
    // toNumber, not Number(): the stored value is Decimal128, and this is the
    // display edge. Never feed the result back into a calculation.
    gross: toNumber(e.gross_monthly),
    uan: e.pf_uan,
    esic_no: e.esic_number,
    active: e.status === 'active',
    status: e.status,
    // Absent on rows written before the field existed — those are employees.
    // employmentType: e.employment_type === 'intern' ? 'intern' : 'employee',
  }));
}

// employee pick options
interface EmployeeOption {
  id: string;
  code: string;
  name: string;
}

/** Active employees as {id, code, name} — for "link this login to an employee". */
async function getEmployeeOptions(): Promise<EmployeeOption[]> {
  const employees = await scoped<EmployeeDoc>(collections.employees);
  const rows = await employees.find(
    { status: 'active', deleted_at: null },
    { projection: { code: 1, full_name: 1 }, sort: { code: 1 } },
  );
  return rows.map((e) => ({ id: e._id, code: e.code, name: e.full_name }));
}

/** Full editable fields for one employee, keyed by code. Null when not found. */
interface EmployeeEditRow {
  code: string;
  full_name: string;
  // employment_type: EmploymentType;
  branch: string;
  department: string | null;
  designation: string | null;
  gender: string;
  date_of_joining: string;
  date_of_birth: string | null;
  whatsapp: string | null;
  mobile_official: string | null;
  mobile_personal: string | null;
  email_official: string | null;
  email_personal: string | null;
  aadhaar: string | null;
  pan: string | null;
  pf_uan: string | null;
  esic_number: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relation: string | null;
  emergency_contact_phone: string | null;
  gross_monthly: number;
  basic_da: number;
  hra: number;
  special_allowance: number;
}

async function getEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  const dbc = await createClient();
  const fullCols = `code, full_name, employment_type, designation, gender, date_of_joining, date_of_birth, whatsapp,
     mobile_official, mobile_personal, email_official, email_personal, aadhaar,
     pan, pf_uan, esic_number,
     bank_name, bank_account_number, bank_ifsc,
     emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
     gross_monthly, basic_da, hra, special_allowance, branches(name), departments(name)`;

  const res = await dbc
    .from('employees')
    .select(fullCols)
    .eq('code', code)
    .is('deleted_at', null)
    .maybeSingle();
  const { data, error } = res;
  if (error) {
    fail('getEmployeeForEdit: could not load employee', error);
  }
  if (!data) {
    return null;
  }
  const e: any = data;
  return {
    code: e.code,
    full_name: e.full_name,
    // Rows written before the field existed have no value; they are employees.
    // employment_type: e.employment_type === 'intern' ? 'intern' : 'employee',

    branch: e.branches?.name ?? '',
    department: e.departments?.name ?? null,
    designation: e.designation ?? null,
    gender: e.gender,
    date_of_joining: e.date_of_joining,
    date_of_birth: e.date_of_birth,
    whatsapp: e.whatsapp,
    mobile_official: e.mobile_official ?? null,
    mobile_personal: e.mobile_personal ?? null,
    email_official: e.email_official ?? null,
    email_personal: e.email_personal ?? null,
    aadhaar: e.aadhaar ?? null,
    pan: e.pan,
    pf_uan: e.pf_uan,
    esic_number: e.esic_number,
    bank_name: e.bank_name ?? null,
    bank_account_number: e.bank_account_number ?? null,
    bank_ifsc: e.bank_ifsc ?? null,
    emergency_contact_name: e.emergency_contact_name ?? null,
    emergency_contact_relation: e.emergency_contact_relation ?? null,
    emergency_contact_phone: e.emergency_contact_phone ?? null,
    gross_monthly: Number(e.gross_monthly),
    basic_da: Number(e.basic_da),
    hra: Number(e.hra),
    special_allowance: Number(e.special_allowance),
  };
}

/** Distinct department names — suggestions for the Add/Edit Employee combobox. */
async function getDepartments(): Promise<string[]> {
  const departments = await scoped<DepartmentDoc>(collections.departments);
  const rows = await departments.find({}, { projection: { name: 1 }, sort: { name: 1 } });
  // The same department name can exist under several branches, so the list is
  // deduplicated — callers want the set of names, not the rows.
  return Array.from(new Set(rows.map((d) => d.name)));
}

// employee overview
interface EmployeeOverview {
  name: string;
  code: string;
  branch: string;
  present: number;
  halfDays: number;
  leaves: number;
  workedHours: string;
  /** Month-to-date surplus above 9h 15m per present day. */
  surplusMinutes: number;
  surplusPresentDays: number;
  netPay: number | null;
  /**
   * Month-to-date hours still owed: (working days so far × full_day_minutes)
   * − worked minutes so far, floored at zero. 'HH:MM'.
   */
  pendingHours: string;
  pendingMinutes: number;
  /** The month-to-date target the pending figure is measured against. 'HH:MM'. */
  targetHours: string;
}

async function getEmployeeOverview(
  employeeId: string | null,
  fallbackName?: string | null,
  periodMonth: string = currentPeriodMonth(),
): Promise<EmployeeOverview> {
  // No linked employee record is a real state (e.g. a staff login), not an error.
  if (!employeeId) {
    return {
      name: fallbackName ?? '',
      code: '',
      branch: '',
      present: 0,
      halfDays: 0,
      leaves: 0,
      workedHours: '00:00',
      surplusMinutes: 0,
      surplusPresentDays: 0,
      netPay: null,
      pendingHours: '00:00',
      pendingMinutes: 0,
      targetHours: '00:00',
    };
  }

  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();

  const { data: emp, error: empError } = await dbc
    .from('employees')
    .select('code, full_name, branches(name)')
    .eq('id', employeeId)
    .maybeSingle();
  if (empError) {
    fail('getEmployeeOverview: could not load the employee', empError);
  }
  if (!emp) {
    throw new Error(`getEmployeeOverview: no employee with id ${employeeId}`);
  }

  const { data: days, error: daysError } = await dbc
    .from('attendance_days')
    .select('work_date, status, worked_minutes')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end);
  if (daysError) {
    fail('getEmployeeOverview: could not load attendance', daysError);
  }

  const rows = (days ?? []) as Array<{
    work_date: string;
    status: string;
    worked_minutes: number | null;
  }>;
  const count = (s: string) => rows.filter((d) => d.status === s).length;
  const workedMin = rows.reduce((a, d) => a + (d.worked_minutes ?? 0), 0);

  // Calculate pending hours through today using the payroll target: P+T+S+LM+0.5×HD,
  // multiplied by full_day_minutes. Use the default when the setting is missing.
  const today = todayISO();
  const surplus = presentDaySurplus(rows, periodMonth, today);
  const workingStatuses = ['P', 'T', 'S', 'LM'];
  let workingCredit = 0;
  let workedToDate = 0;
  for (const d of rows) {
    if (String(d.work_date) > today) {
      continue;
    }
    if (workingStatuses.includes(d.status)) {
      workingCredit += 1;
    } else if (d.status === 'HD') {
      workingCredit += 0.5;
    }
    workedToDate += d.worked_minutes ?? 0;
  }
  let fullDayMin = 555;
  const { data: fdm } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'full_day_minutes')
    .maybeSingle<{ value: unknown }>();
  const fdmNum = Number(fdm?.value);
  if (Number.isFinite(fdmNum) && fdmNum > 0) {
    fullDayMin = fdmNum;
  }
  const targetMin = Math.round(workingCredit * fullDayMin);
  const pendingMin = Math.max(0, targetMin - workedToDate);

  const { data: slip, error: slipError } = await dbc
    .from('payslips')
    .select('net_payable, payroll_runs!inner(period_month)')
    .eq('employee_id', employeeId)
    .eq('payroll_runs.period_month', start)
    .maybeSingle();
  if (slipError) {
    fail('getEmployeeOverview: could not load the payslip', slipError);
  }

  return {
    name: (emp as any).full_name,
    code: (emp as any).code,
    branch: (emp as any).branches?.name ?? '',
    present: count('P'),
    halfDays: count('HD'),
    leaves: count('L'),
    workedHours: minutesToHHMM(workedMin),
    surplusMinutes: surplus.surplusMinutes,
    surplusPresentDays: surplus.presentDays,
    netPay: slip ? Number((slip as any).net_payable) : null,
    pendingHours: minutesToHHMM(pendingMin),
    pendingMinutes: pendingMin,
    targetHours: minutesToHHMM(targetMin),
  };
}

/** Active headcount — the denominator for "n/N read". */
async function getActiveEmployeeCount(): Promise<number> {
  try {
    const employees = await scoped<EmployeeDoc>(collections.employees);
    return await employees.countDocuments({ status: 'active' });
  } catch {
    return 0;
  }
}

export {
  getEmployeeCodeMap,
  getEmployees,
  getEmployeeOptions,
  getEmployeeForEdit,
  getDepartments,
  getEmployeeOverview,
  getActiveEmployeeCount,
};

export type { EmployeeListRow, EmployeeOption, EmployeeEditRow, EmployeeOverview };
