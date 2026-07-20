import { getRequests } from '@/lib/queries';
import { ApprovalsScreen } from '@/components/approvals/ApprovalsScreen';

// Pending leave / outdoor-duty requests. In production these come from the
// `requests` table (status = 'pending'); Approve/Reject call a Server Action.
export default async function ApprovalsPage() {
  const requests = await getRequests();
  return <ApprovalsScreen requests={requests} />;
}
