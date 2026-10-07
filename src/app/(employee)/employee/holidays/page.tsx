import { todayIST } from '@/lib/display-formatting';
import { getEmployeeContext } from '@/lib/employee-self-service';
import { getEmployeeOverview } from '@/lib/queries/employees';
import { getHolidays } from '@/lib/queries/holidays';
import { getWeekOffPolicy } from '@/lib/queries/settings';
import { EmployeeHolidays } from '@/components/employee/EmployeeHolidays';

// Holiday calendar for the employee's branch, with the weekly-off policy.
async function EmployeeHolidaysPage() {
  const { profile, employeeId } = await getEmployeeContext();
  const [overview, holidays, weekOffPolicy] = await Promise.all([
    getEmployeeOverview(employeeId, profile?.full_name),
    getHolidays(),
    getWeekOffPolicy(),
  ]);
  const myBranch = overview.branch || null;
  const visibleHolidays = holidays.filter((h) => !h.branch || h.branch === myBranch);
  const today = todayIST();
  const upcoming = visibleHolidays.filter((h) => h.date >= today).length;

  return (
    <div className="content-container grid">
      <div className="card" id="holidays">
        <div className="card-header">
          <h3>Holiday calendar</h3>
          <span className="card-caption">
            {upcoming} upcoming · {visibleHolidays.length} total
          </span>
        </div>
        <div className="card-body">
          <EmployeeHolidays holidays={visibleHolidays} policy={weekOffPolicy} />
        </div>
      </div>
    </div>
  );
}

export { EmployeeHolidaysPage as default };
