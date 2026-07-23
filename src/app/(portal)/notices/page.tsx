import { NoticesScreen } from '@/components/notices/NoticesScreen';
import { getNotices } from '@/lib/queries';

export default async function NoticesPage() {
  // Old notices are removed by the daily pg_cron job (migration 0015) and by the
  // opportunistic purge inside createNotice — never as a side effect of this GET.
  const notices = await getNotices();

  return (
    <div className="wrap grid">
      <NoticesScreen notices={notices} />
    </div>
  );
}
