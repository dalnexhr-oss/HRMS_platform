import { ReimbursementsScreen } from '@/components/reimbursements/ReimbursementsScreen';
import { getReimbursements } from '@/lib/queries';
import { getSession } from '@/lib/auth';

export default async function ReimbursementsPage() {
  const [claims, { profile }] = await Promise.all([getReimbursements(), getSession()]);
  // Control which actions are shown. Server Actions enforce the finance role gate.
  return <ReimbursementsScreen claims={claims} callerRole={profile?.role ?? null} />;
}
