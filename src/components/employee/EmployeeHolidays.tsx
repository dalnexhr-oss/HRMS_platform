import type { HolidayView } from '@/lib/queries';
import { describePolicy, type WeekOffPolicy } from '@/lib/week-off';

// Read-only holiday calendar for the employee dashboard. Leads with the weekly
// off schedule (Sundays + which Saturdays), then holidays split into upcoming and
// past with the next upcoming one highlighted.
export function EmployeeHolidays({
  holidays,
  policy,
}: {
  holidays: HolidayView[];
  policy?: WeekOffPolicy;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today).reverse(); // most recent first

  return (
    <div>
      {policy && <WeekOffBanner policy={policy} />}

      {holidays.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          No public holidays published yet.
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div>
              {upcoming.map((h, i) => (
                <HolidayRow key={h.id} holiday={h} next={i === 0} />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <div className="holi-sep">Earlier</div>
              <div className="holi-dim">
                {past.map((h) => (
                  <HolidayRow key={h.id} holiday={h} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const SATURDAY = 6;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n] ?? 'th'}`;

// Build a plain-language explanation that stays consistent with describePolicy
// for ANY configured policy — no hardcoded Sunday/Saturday assumptions.
function weekOffSentence(policy: WeekOffPolicy): string {
  const parts: string[] = [];

  // Non-Saturday off weekdays, in the order they appear.
  const otherOff = policy.weekOffWeekdays
    .filter((d) => d !== SATURDAY)
    .map((d) => WEEKDAY_NAMES[d])
    .filter(Boolean);
  if (otherOff.length) parts.push(`Every ${otherOff.join(' and ')} is off`);

  // Saturday clause only when Saturday is actually a week-off weekday.
  if (policy.weekOffWeekdays.includes(SATURDAY)) {
    const workSats = policy.workingSaturdays.slice().sort((a, b) => a - b);
    const offSats = [1, 2, 3, 4, 5].filter((n) => !policy.workingSaturdays.includes(n));
    if (!workSats.length) {
      parts.push('every Saturday is off');
    } else {
      const working = `the ${workSats.map(ord).join(' & ')} Saturday${
        workSats.length > 1 ? 's are' : ' is'
      } working`;
      parts.push(offSats.length ? `${working}, so the ${offSats.map(ord).join(', ')} are off` : working);
    }
  }

  return parts.length ? `${parts.join('; ')}.` : '';
}

function WeekOffBanner({ policy }: { policy: WeekOffPolicy }) {
  const sentence = weekOffSentence(policy);
  return (
    <div className="weekoff">
      <span className="weekoff-tag">Weekly offs</span>
      <div className="weekoff-txt">
        <b>{describePolicy(policy)}</b>
        {sentence && <span className="sub">{sentence}</span>}
      </div>
    </div>
  );
}

function HolidayRow({ holiday, next = false }: { holiday: HolidayView; next?: boolean }) {
  const d = new Date(`${holiday.date}T00:00:00Z`);
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', timeZone: 'UTC' });
  const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const full = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className={`holi${next ? ' holi-next' : ''}`}>
      <div className="holi-cal">
        <span className="d">{day}</span>
        <span className="m">{mon}</span>
      </div>
      <div className="holi-nm">
        <b>
          {holiday.name}
          {next && <span className="holi-badge">Next up</span>}
        </b>
        <span className="sub">
          {weekday} · {full}
        </span>
      </div>
      <span className="pill">{holiday.branch ?? 'All branches'}</span>
    </div>
  );
}
