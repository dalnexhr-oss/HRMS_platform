import { statusMeta } from '@/lib/constants';
import type { AttendanceStatus } from '@/types/database';

export function Stamp({ status }: { status: AttendanceStatus | string }) {
  const [label, cls, title] = statusMeta(status);
  return (
    <span className={`stamp ${cls}`} title={title}>
      {label}
    </span>
  );
}
