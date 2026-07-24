import { ReimbursementsScreen } from '@/components/reimbursements/ReimbursementsScreen';
import { getReimbursements } from '@/lib/queries';

export default async function ReimbursementsPage() {
  const claims = await getReimbursements();
  return <ReimbursementsScreen claims={claims} />;
}
