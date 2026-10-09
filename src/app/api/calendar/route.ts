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
import { buildCalendarIcs } from '@/lib/calendar-export';
import type { CalendarExportEvent } from '@/lib/calendar-export';

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
  const events: CalendarExportEvent[] = [];

  // Fail the download if any source is unavailable, rather than exporting missing events.
  for (const holiday of await getHolidays()) {
    events.push({
      uniqueId: `holiday-${holiday.id}@dalnex-hrms`,
      startDate: holiday.date,
      title: holiday.name,
      description: holiday.branch ? `Holiday · ${holiday.branch}` : 'Company holiday',
      isAllDay: true,
    });
  }

  if (employeeId) {
    const queryClient = await createClient();
    // approved leave / duty
    const { data: approvedRequests, error: requestsError } = await queryClient
      .from<CalendarRequest[]>('requests')
      .select('id, type, leave_kind, start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved');

    if (requestsError) {
      throw new Error(`Calendar requests could not be loaded: ${requestsError.message}`);
    }

    for (const request of approvedRequests ?? []) {
      const requestLabel = request.leave_kind
        ? `${request.leave_kind} leave`
        : String(request.type).replace(/_/g, ' ');
      events.push({
        uniqueId: `request-${request.id}@dalnex-hrms`,
        startDate: String(request.start_date).slice(0, 10),
        endDateInclusive: request.end_date ? String(request.end_date).slice(0, 10) : undefined,
        title: requestLabel.charAt(0).toUpperCase() + requestLabel.slice(1),
        description: 'Approved by Dalnex HR.',
        isAllDay: true,
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

    for (const credit of credits ?? []) {
      events.push({
        uniqueId: `compoff-${credit.id}@dalnex-hrms`,
        startDate: String(credit.earned_date).slice(0, 10),
        title: 'Comp-off earned',
        description: 'A comp-off credit is available for this worked day off.',
        isAllDay: true,
      });
    }
  }

  const calendarContent = buildCalendarIcs(events, { calendarName: 'Dalnex HR' });

  return new NextResponse(calendarContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dalnex-hr.ics"',
      'Cache-Control': 'private, no-store',
    },
  });
}

const GET = apiRoute('GET /api/calendar', calendar);

export { GET };
