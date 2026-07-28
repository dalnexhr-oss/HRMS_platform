import { ReimbursementsScreen } from '@/components/reimbursements/ReimbursementsScreen';
import { getReimbursements } from '@/lib/queries';
import { getSession } from '@/lib/auth';

export default async function ReimbursementsPage() {
  const [claims, { profile }] = await Promise.all([getReimbursements(), getSession()]);
  // Finance sign-off is admin-only; the screen only decides what to OFFER — the
  // server action re-checks, so this never becomes the security boundary.
  return <ReimbursementsScreen claims={claims} callerRole={profile?.role ?? null} />;
}
