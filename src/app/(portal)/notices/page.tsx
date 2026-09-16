import { NoticesScreen } from '@/components/notices/NoticesScreen';
import { getNotices, getBranches } from '@/lib/queries';

export default async function NoticesPage() {
  // Notice cleanup runs in the scheduler and createNotice, so this GET has no write side effects.
  const [notices, branches] = await Promise.all([getNotices(), getBranches()]);

  return (
    <div className="wrap grid">
      <NoticesScreen notices={notices} branchNames={branches.map((b) => b.name)} />
    </div>
  );
}
