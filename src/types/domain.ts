// ============================================================================
// Derived / joined shapes used by the UI (views, aggregates, joins).
// ============================================================================
import type { AttendanceStatus, Gender, IndianState } from './database';

/** A register row: employee + monthly summary + 30-day strip. */
export interface RegisterEmployee {
  id: string;
  code: string;
  name: string;
  branch: string;
  gender: Gender;
  doj: string;
  summary: {
    P: number;
    LM: number;
    HD: number;
    L: number;
    WO: number;
    working: number;
    payable: number;
  };
  workedMinutes: number;
  targetMinutes: number;
  days: DayCell[];
}

export interface DayCell {
  day: number;
  status: AttendanceStatus;
  in: string | null;
  out: string | null;
  hours: string | null; // 'HH:MM'
  isWeekOff: boolean;
}

/** A payslip joined to its employee for the payroll table. */
export interface PayslipRow {
  id: string;
  code: string;
  name: string;
  branch: string;
  state: IndianState;
  /** 'YYYY-MM-01' pay-period, so payslips label by month rather than position. */
  periodMonth: string | null;
  payableDays: number;
  earnedGross: number;
  shortfallAmount: number;
  perDayRate: number;
  basicEarned: number;
  hraEarned: number;
  specialEarned: number;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
  professionalTax: number;
  netPayable: number;
  shortfallMinutes: number;
}

export interface TodayKpis {
  headcount: number;
  present: number;
  inOffice: number;
  field: number;
  absent: number;
  byBranch: { branch: string; count: number }[];
}

export interface Celebration {
  id: string;
  name: string;
  branch: string;
  department: string | null;
  kind: 'birthday' | 'anniversary';
  years: number;
}

export interface MarkWatch {
  employeeId: string;
  name: string;
  marks: number;
  threshold: number;
}

export interface PunchLogRow {
  code: string;
  name: string;
  branch: string;
  in: string | null;
  out: string | null;
  active: string | null;
  status: AttendanceStatus;
}
