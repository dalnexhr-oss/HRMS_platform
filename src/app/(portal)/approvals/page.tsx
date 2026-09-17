import { getRequests } from '@/lib/queries';
import { ApprovalsScreen } from '@/components/approvals/ApprovalsScreen';
import { getSession } from '@/lib/auth';
import { getRequestRecipients } from '@/lib/requests/routing';
import { redirect } from 'next/navigation';

// Load requests for the approval queue. Decisions are handled by Server Actions.
export default async function ApprovalsPage() {
  const [requests, people, { profile }] = await Promise.all([
    getRequests(),
    getRequestRecipients(),
    getSession(),
  ]);
  if (!profile) {
    redirect('/login');
  }
  return (
    <ApprovalsScreen
      requests={requests}
      people={people}
      actor={{ id: profile.id, employeeId: profile.employee_id, role: profile.role }}
    />
  );
}
