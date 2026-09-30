import { getAttendanceStatusDetails } from '@/lib/constants';
import type { AttendanceStatus } from '@/types/database';

function AttendanceStatusBadge({ status }: { status: AttendanceStatus | string }) {
  const [label, statusClassName, title] = getAttendanceStatusDetails(status);
  return (
    <span className={`attendance-status ${statusClassName}`} title={title}>
      {label}
    </span>
  );
}

export { AttendanceStatusBadge };
