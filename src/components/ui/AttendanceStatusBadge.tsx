import { getAttendanceStatusDetails } from '@/lib/attendance/attendance-status';
import type { AttendanceStatus } from '@/types/database';

function AttendanceStatusBadge({ status }: { status: AttendanceStatus | string }) {
  const [label, statusClassName, title] = getAttendanceStatusDetails(status);
  return (
    <span
      className={`attendance-status ${statusClassName}`}
      role="img"
      aria-label={title}
      data-tooltip-content={title}
    >
      {label}
    </span>
  );
}

export { AttendanceStatusBadge };
