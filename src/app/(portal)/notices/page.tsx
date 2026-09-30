import { NoticesScreen } from '@/components/notices/NoticesScreen';
import { getNotices } from '@/lib/queries/notices';
import { getBranches } from '@/lib/queries/branches';

async function NoticesPage() {
  // Notice cleanup runs in the scheduler and createNotice, so this GET has no write side effects.
  const [notices, branches] = await Promise.all([getNotices(), getBranches()]);

  return (
    <div className="content-container grid">
      <NoticesScreen notices={notices} branchNames={branches.map((b) => b.name)} />
    </div>
  );
}

export { NoticesPage as default };
