import { NoticesScreen } from '@/components/notices/NoticesScreen';
import { getNotices, getBranches } from '@/lib/queries';

export default async function NoticesPage() {
  // Old notices are removed by the scheduled purge in /api/cron and by the
  // opportunistic one inside createNotice — never as a side effect of this GET.
  const [notices, branches] = await Promise.all([getNotices(), getBranches()]);

  return (
    <div className="wrap grid">
      <NoticesScreen notices={notices} branchNames={branches.map((b) => b.name)} />
    </div>
  );
}
