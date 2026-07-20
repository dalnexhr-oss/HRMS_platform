import { NoticesScreen } from '@/components/notices/NoticesScreen';
import { getNotices } from '@/lib/queries';

export default async function NoticesPage() {
  const notices = await getNotices();

  return (
    <div className="wrap grid">
      <NoticesScreen notices={notices} />
    </div>
  );
}
