import { ReimbursementsScreen } from '@/components/reimbursements/ReimbursementsScreen';
import { getReimbursements } from '@/lib/server-queries';
import { getSession } from '@/lib/server-auth';

async function ReimbursementsPage() {
  const [claims, { profile }] = await Promise.all([getReimbursements(), getSession()]);
  // Control which actions are shown. Server Actions enforce the finance role gate.
  return <ReimbursementsScreen claims={claims} callerRole={profile?.role ?? null} />;
}

export { ReimbursementsPage as default };
