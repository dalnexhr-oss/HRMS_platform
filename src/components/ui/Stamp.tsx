import { statusMeta } from '@/lib/constants';
import type { AttendanceStatus } from '@/types/database';

function Stamp({ status }: { status: AttendanceStatus | string }) {
  const [label, cls, title] = statusMeta(status);
  return (
    <span className={`attendance-status ${cls}`} title={title}>
      {label}
    </span>
  );
}

export { Stamp };
