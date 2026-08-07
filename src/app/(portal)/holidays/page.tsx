import { getHolidays, getWeekOffPolicy, getBranches } from '@/lib/queries';
import { HolidaysScreen } from '@/components/holidays/HolidaysScreen';
import { describePolicy } from '@/lib/week-off';
import { DEFAULT_PERIOD_MONTH } from '@/lib/queries';

export default async function HolidaysPage() {
  const [holidays, policy, branches] = await Promise.all([
    getHolidays(),
    getWeekOffPolicy(),
    getBranches(),
  ]);

  // The calendar year the register is working in, not the host clock's year.
  const year = Number(DEFAULT_PERIOD_MONTH.slice(0, 4));

  return (
    <HolidaysScreen
      holidays={holidays}
      year={year}
      weekOffSummary={describePolicy(policy)}
      branchNames={branches.map((b) => b.name)}
    />
  );
}
