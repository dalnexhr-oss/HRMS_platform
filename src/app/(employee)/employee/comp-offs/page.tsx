import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyCompOffs } from '@/lib/queries/compensatory-off';
import { getRequestRecipients } from '@/lib/requests/routing';
import { MyCompOffs } from '@/components/employee/MyCompOffs';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Comp offs earned by working an off day.
async function EmployeeCompOffsPage() {
  const { employeeId, canSubmit, blockedReason } = await getEmployeeContext();
  const [compOffs, people] = await Promise.all([
    employeeId ? getMyCompOffs(employeeId) : [],
    getRequestRecipients(),
  ]);

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyCompOffs
        compOffs={compOffs}
        canApply={canSubmit}
        blockedReason={blockedReason}
        people={people}
        id="comp-offs"
      />
    </div>
  );
}

export { EmployeeCompOffsPage as default };
