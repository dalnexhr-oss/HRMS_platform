// Use the shared attendance labels and status-pill colours on every employee card.
import { presenceLabel } from '@/types/tv';
import { statusMeta } from '@/lib/constants';
import type { EmployeeData } from '@/types/tv';

const timeFmt: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

// Initials displayed on the employee tile.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '—';
  }
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function clock(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-IN', timeFmt).format(date);
}

function EmployeeCard({ employee }: { employee: EmployeeData }) {
  const at = clock(employee.lastPunchAt);
  const subtitle = employee.designation || employee.department || employee.branch || employee.code;

  return (
    <article className={`card tv-dashboard-employee-card is-${employee.presence}`}>
      <div className="tv-dashboard-employee-header">
        <span className="tv-dashboard-employee-avatar" aria-hidden="true">
          {initials(employee.name)}
        </span>
        <span className="status-badge tv-dashboard-attendance-status">
          <i className="status-dot" />
          {presenceLabel[employee.presence]}
        </span>
      </div>

      <h3 className="tv-dashboard-employee-name">{employee.name}</h3>
      {subtitle ? <p className="tv-dashboard-employee-details">{subtitle}</p> : null}

      <p className="tv-dashboard-employee-footer text-monospace">
        {at ? (
          <>
            {employee.lastKind === 'in' ? 'Check-in' : 'Check-out'} {at}
            {employee.withinGeofence === false ? <span className="tv-dashboard-attendance-note">off-site</span> : null}
          </>
        ) : employee.presence === 'off' || employee.presence === 'leave' ? (
          // The human name for the day's status ('Leave', 'Week off'…), not the
          // raw 'L' / 'WO' code the register uses.
          employee.dayStatus ? (
            statusMeta(employee.dayStatus)[2]
          ) : (
            presenceLabel[employee.presence]
          )
        ) : (
          'No check-in recorded'
        )}
      </p>
    </article>
  );
}

export { EmployeeCard, EmployeeCard as default };
