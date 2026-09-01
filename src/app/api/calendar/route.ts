// ============================================================================
// Personal calendar feed (.ics) — subscribe to your own HR calendar.
//
// Returns the signed-in employee's approved leave, their comp-off credits and
// the company holiday list as a single RFC 5545 VCALENDAR, so it can be opened
// once as a download OR subscribed to in Google/Outlook/Apple Calendar and kept
// in sync automatically.
//
// AUTH: this deliberately uses the normal cookie session (the same client every
// page uses), NOT a long-lived feed token. A token in a webcal:// URL is a
// bearer credential that leaks through calendar-app logs and sync services and
// never expires — for a first cut, a signed-in fetch is the safer trade. The
// practical consequence is that desktop calendar apps which do not carry the
// session cookie will not auto-refresh; "Download .ics" always works.
//
// The collection policies do the real scoping: `requests` and `comp_offs` are
// already restricted to the caller, so this route cannot return another
// employee's leave even if the employee id were tampered with.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { getHolidays } from '@/lib/queries';
import { buildIcs, type CalendarEvent } from '@/lib/ics';

/** Always evaluated per-request: the feed is per-user and changes as leave is approved. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { profile } = await getSession();
  if (!profile) {
    return new NextResponse('Sign in to fetch your calendar.', { status: 401 });
  }

  const employeeId = profile.employee_id;
  const dbc = await createClient();
  const events: CalendarEvent[] = [];

  // --- company holidays (everyone sees these) -------------------------------
  try {
    for (const h of await getHolidays()) {
      events.push({
        uid: `holiday-${h.id}@dalnex-hrms`,
        start: h.date,
        summary: h.name,
        description: h.branch ? `Holiday · ${h.branch}` : 'Company holiday',
        allDay: true,
      });
    }
  } catch {
    // A holiday-table failure must not take the whole feed down — the personal
    // entries below are the part the employee actually depends on.
  }

  if (employeeId) {
    // --- approved leave / duty ---------------------------------------------
    const { data: reqs } = await dbc
      .from('requests')
      .select('id, type, leave_kind, start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved');

    for (const r of (reqs ?? []) as any[]) {
      const kind = r.leave_kind ? `${r.leave_kind} leave` : String(r.type).replace(/_/g, ' ');
      events.push({
        uid: `request-${r.id}@dalnex-hrms`,
        start: String(r.start_date).slice(0, 10),
        // `end` is the INCLUSIVE last day; buildIcs converts it to RFC 5545's
        // exclusive DTEND, so a single-day leave does not bleed into the next.
        end: String(r.end_date).slice(0, 10),
        summary: kind.charAt(0).toUpperCase() + kind.slice(1),
        description: 'Approved by Dalnex HR.',
        allDay: true,
      });
    }

    // --- comp-off credits still available ----------------------------------
    const { data: credits } = await dbc
      .from('comp_offs')
      .select('id, earned_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'available');

    for (const c of (credits ?? []) as any[]) {
      events.push({
        uid: `compoff-${c.id}@dalnex-hrms`,
        start: String(c.earned_date).slice(0, 10),
        summary: 'Comp-off earned',
        description: 'A comp-off credit is available for this worked day off.',
        allDay: true,
      });
    }
  }

  const ics = buildIcs(events, { calName: 'Dalnex HR' });

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dalnex-hr.ics"',
      // Per-user content — never let a shared cache serve one employee's
      // calendar to another.
      'Cache-Control': 'private, no-store',
    },
  });
}
