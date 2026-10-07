import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyReimbursements, getReimbursementRate } from '@/lib/queries/reimbursements';
import { MyReimbursements } from '@/components/employee/MyReimbursements';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// The employee's expense claims.
async function EmployeeReimbursementsPage() {
  const { employeeId, canSubmit, blockedReason } = await getEmployeeContext();
  const [claims, ratePerKm] = await Promise.all([
    employeeId ? getMyReimbursements(employeeId) : [],
    getReimbursementRate(),
  ]);

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyReimbursements
        claims={claims}
        ratePerKm={ratePerKm}
        canClaim={canSubmit}
        blockedReason={blockedReason}
        id="reimbursements"
      />
    </div>
  );
}

export { EmployeeReimbursementsPage as default };
