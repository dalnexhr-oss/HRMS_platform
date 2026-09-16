import { getRequests } from '@/lib/queries';
import { ApprovalsScreen } from '@/components/approvals/ApprovalsScreen';

// Load requests for the approval queue. Decisions are handled by Server Actions.
export default async function ApprovalsPage() {
  const requests = await getRequests();
  return <ApprovalsScreen requests={requests} />;
}
