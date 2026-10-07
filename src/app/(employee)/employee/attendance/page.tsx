import { currentPeriodMonth } from '@/lib/business-dates';
import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyAttendance } from '@/lib/queries/attendance';
import { MyAttendance } from '@/components/employee/MyAttendance';
import { Punch } from '@/components/employee/Punch';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Live punch clock and the employee's own month of attendance.
async function EmployeeAttendancePage() {
  const { employeeId } = await getEmployeeContext();
  const periodMonth = currentPeriodMonth();
  const attendance = employeeId ? await getMyAttendance(employeeId, periodMonth) : [];

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      {/* The ids are notification targets; NotificationBell scrolls to them on click. */}
      <Punch id="punch" />
      <MyAttendance days={attendance} periodMonth={periodMonth} id="attendance" />
    </div>
  );
}

export { EmployeeAttendancePage as default };
