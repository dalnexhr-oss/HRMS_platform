// Payroll rules operate on integer paise and plain attendance data. Database adapters
// load configuration and convert Decimal128 values before calling these functions.
import { scalePaiseAmount as scaleAmount, roundToRupee } from '@/lib/currency-conversion';

interface PayrollAttendanceDay {
  status: string;
  workedMinutes: number;
}

interface PayslipInput {
  periodMonth: string;
  grossPaise: number;
  basicPaise: number;
  hraPaise: number;
  specialAllowancePaise: number;
  fullDayMinutes: number;
  esicCapPaise: number;
  professionalTaxPaise: number;
  attendance: PayrollAttendanceDay[];
  advancePaise: number;
  lossPaise: number;
  otherDeductionsPaise: number;
  lastMonthBalancePaise: number;
  reimbursementPaise: number;
  bonusPaise: number;
}

interface PayslipComputation {
  payable_days: number;
  worked_minutes: number;
  target_minutes: number;
  shortfall_minutes: number;
  // All amounts are integer paise; the persistence layer converts them on write.
  per_day_rate: number;
  basic_earned: number;
  hra_earned: number;
  special_earned: number;
  earned_gross: number;
  shortfall_amount: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  net_payable: number;
}

const fullDayStatuses = ['P', 'T', 'S', 'LM'];
const paidDayOffStatuses = ['CO', 'OH', 'WO'];

function calculatePayslip(input: PayslipInput): PayslipComputation {
  const [year, month] = input.periodMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fullDayMinutes = input.fullDayMinutes > 0 ? input.fullDayMinutes : 555;
  let workingDays = 0;
  let paidDaysOff = 0;
  let workedMinutes = 0;
  for (const day of input.attendance) {
    if (fullDayStatuses.includes(day.status)) {
      workingDays += 1;
    } else if (day.status === 'HD') {
      workingDays += 0.5;
    } else if (paidDayOffStatuses.includes(day.status)) {
      paidDaysOff += 1;
    }
    workedMinutes += day.workedMinutes;
  }
  const payableDays = workingDays + paidDaysOff;
  const targetMinutes = Math.round(workingDays * fullDayMinutes);
  const perDayRate = scaleAmount(input.grossPaise, 1 / daysInMonth);
  const basicEarned = scaleAmount(input.basicPaise, payableDays / daysInMonth);
  const hraEarned = scaleAmount(input.hraPaise, payableDays / daysInMonth);
  const specialEarned = scaleAmount(input.specialAllowancePaise, payableDays / daysInMonth);
  const earnedGross = basicEarned + hraEarned + specialEarned;

  let shortfallMinutes = 0;
  let shortfallAmount = 0;
  if (targetMinutes > 0 && workedMinutes < targetMinutes) {
    shortfallMinutes = targetMinutes - workedMinutes;
    // Shortfall deductions are floored to whole rupees.
    shortfallAmount = Math.floor(((perDayRate / fullDayMinutes) * shortfallMinutes) / 100) * 100;
  }
  const pfEmployee = roundToRupee(scaleAmount(basicEarned, 0.12));
  let esicEmployee = 0;
  let esicEmployer = 0;
  if (input.grossPaise <= input.esicCapPaise) {
    esicEmployee = roundToRupee(scaleAmount(earnedGross, 0.0075));
    esicEmployer = roundToRupee(scaleAmount(earnedGross, 0.0325));
  }
  const netRaw =
    earnedGross -
    shortfallAmount -
    pfEmployee -
    esicEmployee -
    input.professionalTaxPaise -
    input.advancePaise -
    input.lossPaise -
    input.otherDeductionsPaise +
    input.lastMonthBalancePaise +
    input.reimbursementPaise +
    input.bonusPaise;

  return {
    payable_days: payableDays,
    worked_minutes: workedMinutes,
    target_minutes: targetMinutes,
    shortfall_minutes: shortfallMinutes,
    per_day_rate: perDayRate,
    basic_earned: basicEarned,
    hra_earned: hraEarned,
    special_earned: specialEarned,
    earned_gross: earnedGross,
    shortfall_amount: shortfallAmount,
    pf_employee: pfEmployee,
    pf_employer: pfEmployee,
    esic_employee: esicEmployee,
    esic_employer: esicEmployer,
    professional_tax: input.professionalTaxPaise,
    net_payable: roundToRupee(netRaw),
  };
}

export { calculatePayslip };
export type { PayslipInput, PayslipComputation, PayrollAttendanceDay };
