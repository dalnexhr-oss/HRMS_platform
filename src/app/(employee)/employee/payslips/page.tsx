import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyPayslips } from '@/lib/queries/payroll';
import { MyPayslips } from '@/components/employee/MyPayslips';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// The employee's own payslips.
async function EmployeePayslipsPage() {
  const { employeeId } = await getEmployeeContext();
  const payslips = employeeId ? await getMyPayslips(employeeId) : [];

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyPayslips payslips={payslips} id="payslips" />
    </div>
  );
}

export { EmployeePayslipsPage as default };
