'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { fetchPublicHolidays } from '@/lib/holidays/googleCalendar';
import { ALL_BRANCHES, resolveBranchScope } from '@/lib/actions/_branch';

/** Add an official holiday. Blank branch = all branches (branch_id null). */
export async function addHoliday(formData: FormData) {
  const holiday_date = String(formData.get('holiday_date') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const branch = String(formData.get('branch') ?? '').trim();

  if (!holiday_date) return { ok: false, error: 'Please choose a date.' };
  if (!name) return { ok: false, error: 'Please enter a holiday name.' };

  const gate = await requireStaff('Adding a holiday');
  if (!gate.ok) return gate;

  const dbc = await createClient();
  const scope = await resolveBranchScope(dbc, branch);
  const { data, error } = await dbc
    .from('holidays')
    .insert({ holiday_date, name, ...scope })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The holiday was not added — your account may not have permission.' };
  }

  revalidatePath('/holidays');
  return { ok: true };
}

export type ImportHolidaysResult =
  | { ok: true; imported: number; skipped: number; tentative: string[]; year: number }
  | { ok: false; error: string };

/**
 * Import a year's public holidays from Google's published India calendar.
 *
 * Imported as ALL-BRANCH holidays (branch_id null). Existing dates are skipped
 * rather than overwritten, so a holiday HR has already added or renamed — or a
 * branch-specific one — is never clobbered, and the import is safe to re-run.
 */
export async function importHolidaysFromGoogle(year: number): Promise<ImportHolidaysResult> {
  const gate = await requireStaff('Importing holidays');
  if (!gate.ok) return gate;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, error: 'Choose a valid year.' };
  }

  try {
    const holidays = await fetchPublicHolidays(year);
    if (holidays.length === 0) {
      return { ok: false, error: `Google's calendar lists no public holidays for ${year}.` };
    }

    const dbc = await createClient();

    // Skip dates already present (any branch) so the import never duplicates or
    // overwrites a hand-entered holiday.
    const { data: existing, error: readErr } = await dbc
      .from('holidays')
      .select<{ holiday_date: string }[]>('holiday_date')
      .gte('holiday_date', `${year}-01-01`)
      .lte('holiday_date', `${year}-12-31`);
    if (readErr) return { ok: false, error: `Could not read existing holidays: ${readErr.message}` };

    const taken = new Set(
      (existing ?? []).map((h: { holiday_date: string }) => String(h.holiday_date).slice(0, 10)),
    );

    const rows = holidays
      .filter((h) => !taken.has(h.date))
      .map((h) => ({ holiday_date: h.date, name: h.name, ...ALL_BRANCHES }));

    const skipped = holidays.length - rows.length;

    if (rows.length === 0) {
      return { ok: true, imported: 0, skipped, tentative: [], year };
    }

    const { data, error } = await dbc.from('holidays').insert(rows).select('id');
    if (error) return { ok: false, error: error.message };
    if (wroteNothing(data)) {
      return { ok: false, error: 'No holidays were added — your role may lack permission.' };
    }

    const tentative = holidays
      .filter((h) => h.tentative && !taken.has(h.date))
      .map((h) => `${h.name} (${h.date})`);

    revalidatePath('/holidays');
    return { ok: true, imported: data!.length, skipped, tentative, year };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The holiday import failed.' };
  }
}

/** Delete a holiday by id. */
export async function deleteHoliday(id: string) {
  const gate = await requireStaff('Deleting a holiday');
  if (!gate.ok) return gate;

  const dbc = await createClient();
  const { data, error } = await dbc.from('holidays').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The holiday was not removed — it may already be gone, or your role lacks permission.',
    };
  }

  revalidatePath('/holidays');
  return { ok: true };
}
