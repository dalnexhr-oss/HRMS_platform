import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/auth';
import { getRequests } from '@/lib/queries';
import { getRequestRecipients } from '@/lib/requests/routing';
import { employeeApprovalViews } from '@/lib/requests/employee-approvals';
import { EmployeeApprovals } from '@/components/employee/EmployeeApprovals';

export default async function EmployeeApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { profile } = await getSession();
  if (!profile) {
    redirect('/login');
  }
  if (isStaffRole(profile.role)) {
    redirect('/approvals');
  }
  const [requests, people, params] = await Promise.all([
    getRequests(),
    getRequestRecipients(),
    searchParams,
  ]);
  const view =
    employeeApprovalViews.find((option) => option.value === params.view)?.value ?? 'pending';
  return (
    <EmployeeApprovals
      key={view}
      requests={requests}
      people={people}
      actor={{ id: profile.id, employeeId: profile.employee_id, role: profile.role }}
      view={view}
    />
  );
}
