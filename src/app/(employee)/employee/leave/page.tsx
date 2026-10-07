import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyCompOffs } from '@/lib/queries/compensatory-off';
import { getLeaveBalances } from '@/lib/queries/leave';
import { getMyRequests } from '@/lib/queries/requests';
import { getRequestRecipients } from '@/lib/requests/routing';
import { ApplyLeave } from '@/components/employee/ApplyLeave';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Leave and duty requests with the employee's balances.
async function EmployeeLeavePage() {
  const { employeeId } = await getEmployeeContext();
  const [requests, balances, compOffs, people] = await Promise.all([
    employeeId ? getMyRequests(employeeId) : [],
    employeeId ? getLeaveBalances(employeeId) : [],
    employeeId ? getMyCompOffs(employeeId) : [],
    getRequestRecipients(),
  ]);
  const compOffBalance = compOffs.filter((c) => c.status === 'available' && c.isApplicable).length;

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <ApplyLeave
        requests={requests}
        balances={balances}
        canApply={!!employeeId}
        compOffBalance={compOffBalance}
        people={people}
        id="leave"
      />
    </div>
  );
}

export { EmployeeLeavePage as default };
