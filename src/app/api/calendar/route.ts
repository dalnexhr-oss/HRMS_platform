// Export the signed-in employee's approved leave, comp-off credits, and company holidays as an ICS
// calendar.
//
// The route uses the normal cookie session. Calendar clients without that cookie cannot refresh the
// feed; authenticated downloads still work. Collection policies restrict employee records to the
// caller.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { getHolidays } from '@/lib/queries';
import { buildIcs } from '@/lib/ics';
import type { CalendarEvent } from '@/lib/ics';

// Always evaluated per-request: the feed is per-user and changes as leave is approved.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { profile } = await getSession();
  if (!profile) {
    return new NextResponse('Sign in to fetch your calendar.', { status: 401 });
  }

  const employeeId = profile.employee_id;
  const dbc = await createClient();
  const events: CalendarEvent[] = [];

  // company holidays (everyone sees these)
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
    // approved leave / duty
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
        end: String(r.end_date).slice(0, 10),
        summary: kind.charAt(0).toUpperCase() + kind.slice(1),
        description: 'Approved by Dalnex HR.',
        allDay: true,
      });
    }

    // comp-off credits still available
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
      'Cache-Control': 'private, no-store',
    },
  });
}
