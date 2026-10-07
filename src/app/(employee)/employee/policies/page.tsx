import { getEmployeeContext } from '@/lib/employee-self-service';
import { getEmployeePolicies } from '@/lib/queries/policies';
import { PolicyList } from '@/components/policies/PolicyList';

// Published company policies for the employee to read and acknowledge.
async function EmployeePoliciesPage() {
  const { employeeId } = await getEmployeeContext();
  const policies = await getEmployeePolicies(employeeId);
  const unread = policies.filter((p) => !p.acknowledged).length;

  return (
    <div className="content-container grid">
      <div className="card" id="policies">
        <div className="card-header">
          <h3>Company policies</h3>
          <span className="card-caption">
            {unread > 0 ? `${unread} to read · ` : ''}
            {policies.length} published
          </span>
        </div>
        <div className="card-body">
          <PolicyList policies={policies} />
        </div>
      </div>
    </div>
  );
}

export { EmployeePoliciesPage as default };
