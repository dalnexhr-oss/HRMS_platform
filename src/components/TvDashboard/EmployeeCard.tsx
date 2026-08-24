// One employee tile on the TV attendance board.
//
// Sized and coloured to be read across a room: presence is carried by the tile
// tint, a coloured dot AND the word itself, so it survives both a washed-out
// projector and colour-vision deficiency.
import type { EmployeeData } from '@/lib/types/employee';
import { PRESENCE_LABEL } from '@/lib/types/employee';
import { statusMeta } from '@/lib/constants';

const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

/** Two-letter monogram — 'Rahul Gupta' -> 'RG'. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function clock(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-IN', TIME_FMT).format(date);
}

export function EmployeeCard({ employee }: { employee: EmployeeData }) {
  const at = clock(employee.lastPunchAt);
  const subtitle = employee.designation || employee.department || employee.branch || employee.code;

  return (
    <article className={`tv-card is-${employee.presence}`}>
      <div className="tv-card-top">
        <span className="tv-mono" aria-hidden="true">
          {initials(employee.name)}
        </span>
        <span className="tv-state">
          <i className="dot" />
          {PRESENCE_LABEL[employee.presence]}
        </span>
      </div>

      <h3 className="tv-name">{employee.name}</h3>
      {subtitle ? <p className="tv-sub">{subtitle}</p> : null}

      <p className="tv-foot mono">
        {at ? (
          <>
            {employee.lastKind === 'in' ? 'In' : 'Out'} {at}
            {employee.withinGeofence === false ? (
              <span className="tv-flag">off-site</span>
            ) : null}
          </>
        ) : employee.presence === 'off' || employee.presence === 'leave' ? (
          // The human name for the day's status ('Leave', 'Week off'…), not the
          // raw 'L' / 'WO' code the register uses.
          employee.dayStatus ? statusMeta(employee.dayStatus)[2] : 'Away'
        ) : (
          'No punch yet'
        )}
      </p>
    </article>
  );
}

export default EmployeeCard;
