// Export the signed-in employee's approved leave, comp-off credits, and company holidays as an ICS
// calendar.
//
// The route uses the normal cookie session. Calendar clients without that cookie cannot refresh the
// feed; authenticated downloads still work. Collection policies restrict employee records to the
// caller.
import { NextResponse } from 'next/server';
import { apiRoute, requireSession } from '@/lib/api/route-handler';
import { createClient } from '@/lib/db/server-client';
import { getHolidays } from '@/lib/queries/holidays';
import { buildIcs } from '@/lib/calendar-export';
import type { CalendarEvent } from '@/lib/calendar-export';

// Always evaluated per-request: the feed is per-user and changes as leave is approved.
export const dynamic = 'force-dynamic';

interface CalendarRequest {
  id: string;
  type: string;
  leave_kind: string | null;
  start_date: string;
  end_date: string | null;
}

interface CalendarCredit {
  id: string;
  earned_date: string;
}

async function calendar(): Promise<Response> {
  const profile = await requireSession();

  const employeeId = profile.employee_id;
  const events: CalendarEvent[] = [];

  // Fail the download if any source is unavailable, rather than exporting missing events.
  for (const h of await getHolidays()) {
    events.push({
      uid: `holiday-${h.id}@dalnex-hrms`,
      start: h.date,
      summary: h.name,
      description: h.branch ? `Holiday · ${h.branch}` : 'Company holiday',
      allDay: true,
    });
  }

  if (employeeId) {
    const queryClient = await createClient();
    // approved leave / duty
    const { data: reqs, error: requestsError } = await queryClient
      .from<CalendarRequest[]>('requests')
      .select('id, type, leave_kind, start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved');

    if (requestsError) {
      throw new Error(`Calendar requests could not be loaded: ${requestsError.message}`);
    }

    for (const r of reqs ?? []) {
      const kind = r.leave_kind ? `${r.leave_kind} leave` : String(r.type).replace(/_/g, ' ');
      events.push({
        uid: `request-${r.id}@dalnex-hrms`,
        start: String(r.start_date).slice(0, 10),
        end: r.end_date ? String(r.end_date).slice(0, 10) : undefined,
        summary: kind.charAt(0).toUpperCase() + kind.slice(1),
        description: 'Approved by Dalnex HR.',
        allDay: true,
      });
    }

    // comp-off credits still available
    const { data: credits, error: creditsError } = await queryClient
      .from<CalendarCredit[]>('comp_offs')
      .select('id, earned_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'available');

    if (creditsError) {
      throw new Error(`Calendar comp-off credits could not be loaded: ${creditsError.message}`);
    }

    for (const c of credits ?? []) {
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

const GET = apiRoute('GET /api/calendar', calendar);

export { GET };
