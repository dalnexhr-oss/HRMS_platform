import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyOnboardingTasks } from '@/lib/queries/onboarding';
import { MyOnboarding } from '@/components/employee/MyOnboarding';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Joiner checklist. Read-only: ticking a step is a staff action.
async function EmployeeOnboardingPage() {
  const { employeeId } = await getEmployeeContext();
  const tasks = employeeId ? await getMyOnboardingTasks(employeeId) : [];

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      {tasks.length === 0 ? (
        // MyOnboarding renders nothing without tasks; a tab still needs to say so.
        <div className="card" id="onboarding">
          <div className="card-header">
            <h3>Your onboarding</h3>
          </div>
          <div className="card-body">
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              You have no onboarding steps at the moment.
            </p>
          </div>
        </div>
      ) : (
        <MyOnboarding tasks={tasks} id="onboarding" />
      )}
    </div>
  );
}

export { EmployeeOnboardingPage as default };
