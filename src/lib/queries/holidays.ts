import 'server-only';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';

// holidays
interface HolidayView {
  id: string;
  date: string;
  name: string;
  branch: string | null; // branch null = all branches
}

/** Company holidays, sorted ascending by date. */
async function getHolidays(): Promise<HolidayView[]> {
  const holidays = await scoped(collections.holidays);
  const rows = await holidays.find({}, { sort: { holiday_date: 1 } });
  return rows.map((h) => ({
    id: h._id as string,
    date: h.holiday_date as string,
    name: h.name as string,
    // A null branch still means "all branches", same as before.
    branch: (h.branch_name as string | null) ?? null,
  }));
}

export { getHolidays };

export type { HolidayView };
