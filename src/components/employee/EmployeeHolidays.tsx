'use client';

import { useState } from 'react';
import { CalendarExportButton } from '@/components/employee/CalendarExportButton';
import { describePolicy } from '@/lib/weekly-off-policy';
import { todayIST, yearOptionsAround } from '@/lib/display-formatting';
import type { WeekOffPolicy } from '@/lib/weekly-off-policy';
import type { HolidayView } from '@/lib/queries/holidays';

// Show the employee's weekly off schedule and one year of holidays at a time. The year can be
// moved fifty years either way; the current year splits into upcoming and earlier holidays.
function EmployeeHolidays({
  holidays,
  policy,
}: {
  holidays: HolidayView[];
  policy?: WeekOffPolicy;
}) {
  const today = todayIST();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const years = yearOptionsAround(currentYear);
  const inYear = holidays.filter((h) => h.date.startsWith(`${year}-`));
  // Other years are a plain calendar; only this year has a "next up".
  const upcoming = year === currentYear ? inYear.filter((h) => h.date >= today) : inYear;
  const past = year === currentYear ? inYear.filter((h) => h.date < today).reverse() : [];

  return (
    <div>
      {policy && <WeekOffBanner policy={policy} />}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 12px',
          border: '1px solid var(--border-strong)',
          borderRadius: 8,
          marginBottom: 14,
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Add to your calendar</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            Download your approved leave, work requests, comp-off credits and company holidays to
            import into your calendar app.
          </div>
        </div>
        <CalendarExportButton />
      </div>

      <div className="period-toolbar">
        <button
          type="button"
          className="button quiet"
          onClick={() => setYear(year - 1)}
          disabled={year <= years[0]}
          aria-label="Previous year"
        >
          ←
        </button>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Holiday year"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button quiet"
          onClick={() => setYear(year + 1)}
          disabled={year >= years[years.length - 1]}
          aria-label="Next year"
        >
          →
        </button>
        {year !== currentYear && (
          <button type="button" className="button quiet" onClick={() => setYear(currentYear)}>
            This year
          </button>
        )}
        <span className="text-muted" style={{ fontSize: 12 }}>
          {inYear.length} holiday{inYear.length === 1 ? '' : 's'} in {year}
        </span>
      </div>

      {inYear.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          No holidays are published for {year}.
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div>
              {upcoming.map((h, i) => (
                <HolidayRow key={h.id} holiday={h} next={year === currentYear && i === 0} />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <div className="holiday-group-heading">Earlier</div>
              <div className="holiday-past-group">
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

const saturday = 6;
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n] ?? 'th'}`;

// Creates a friendly, plain-English summary of the employee's weekly days off.
function weekOffSentence(policy: WeekOffPolicy): string {
  const parts: string[] = [];

  // Non-Saturday off weekdays, in the order they appear.
  const otherOff = policy.weekOffWeekdays
    .filter((d) => d !== saturday)
    .map((d) => weekdayNames[d])
    .filter(Boolean);
  if (otherOff.length) {
    parts.push(`Every ${otherOff.join(' and ')} is off`);
  }

  // Saturday clause only when Saturday is actually a week-off weekday.
  if (policy.weekOffWeekdays.includes(saturday)) {
    const workSats = policy.workingSaturdays.slice().sort((a, b) => a - b);
    const offSats = [1, 2, 3, 4, 5].filter((n) => !policy.workingSaturdays.includes(n));
    if (!workSats.length) {
      parts.push('every Saturday is off');
    } else {
      const working = `the ${workSats.map(ord).join(' & ')} Saturday${
        workSats.length > 1 ? 's are' : ' is'
      } working`;
      parts.push(
        offSats.length ? `${working}, so the ${offSats.map(ord).join(', ')} are off` : working,
      );
    }
  }

  return parts.length ? `${parts.join('; ')}.` : '';
}

function WeekOffBanner({ policy }: { policy: WeekOffPolicy }) {
  const sentence = weekOffSentence(policy);
  return (
    <div className="weekly-off-summary">
      <span className="weekly-off-label">Weekly offs</span>
      <div className="weekly-off-description">
        <b>{describePolicy(policy)}</b>
        {sentence && <span className="subtitle">{sentence}</span>}
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
    <div className={`holiday-row${next ? ' holiday-upcoming' : ''}`}>
      <div className="holiday-date">
        <span className="holiday-day">{day}</span>
        <span className="holiday-month">{mon}</span>
      </div>
      <div className="holiday-name">
        <b>
          {holiday.name}
          {next && <span className="holiday-upcoming-badge">Next up</span>}
        </b>
        <span className="subtitle">
          {weekday} · {full}
        </span>
      </div>
      <span className="status-badge">{holiday.branch ?? 'All branches'}</span>
    </div>
  );
}

export { EmployeeHolidays };
