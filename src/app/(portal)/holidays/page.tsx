import { describePolicy } from '@/lib/weekly-off-policy';
import { HolidaysScreen } from '@/components/holidays/HolidaysScreen';
import { getHolidays, getWeekOffPolicy, getBranches, currentPeriodMonth } from '@/lib/server-queries';

async function HolidaysPage() {
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

export { HolidaysPage as default };
