import { getHolidays, getWeekOffPolicy, getBranches } from '@/lib/queries';
import { HolidaysScreen } from '@/components/holidays/HolidaysScreen';
import { describePolicy } from '@/lib/week-off';
import { currentPeriodMonth } from '@/lib/queries';

export default async function HolidaysPage() {
  const [holidays, policy, branches] = await Promise.all([
    getHolidays(),
    getWeekOffPolicy(),
    getBranches(),
  ]);

  // The calendar year the register is working in (IST), not the host clock's year.
  const year = Number(currentPeriodMonth().slice(0, 4));

  return (
    <HolidaysScreen
      holidays={holidays}
      year={year}
      weekOffSummary={describePolicy(policy)}
      branchNames={branches.map((b) => b.name)}
    />
  );
}
