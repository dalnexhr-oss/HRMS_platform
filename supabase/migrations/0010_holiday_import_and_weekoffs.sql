-- ============================================================================
-- 0010 — Holiday de-duplication + the week-off schedule rule.
--
--   1. A unique index so importing the public holiday calendar twice cannot
--      create duplicate rows.
--   2. Settings describing which days are scheduled week-offs. Dalnex works the
--      2nd and 4th Saturday of every month; the 1st/3rd/5th are off, and every
--      Sunday is off. This was previously implicit in the seeded demo data and
--      nowhere in the code.
-- ============================================================================


-- ============================================================================
-- §1  ONE HOLIDAY PER DATE PER BRANCH
-- ----------------------------------------------------------------------------
-- branch_id is nullable ("all branches"), and Postgres treats NULLs as DISTINCT
-- in a plain UNIQUE constraint — so `unique (holiday_date, branch_id)` would
-- happily allow ten identical all-branch rows for 15 August. COALESCE to a
-- sentinel uuid makes the all-branches case collide properly.
--
-- `NULLS NOT DISTINCT` would be tidier but needs PG15+; the COALESCE form works
-- on every version Supabase has shipped.
--
-- Any pre-existing duplicates are collapsed first, keeping the earliest row, or
-- the index creation would fail on a database that already has them.
delete from holidays h
using holidays keep
where h.holiday_date = keep.holiday_date
  and coalesce(h.branch_id,    '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(keep.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  and (h.created_at, h.id) > (keep.created_at, keep.id);

create unique index if not exists holidays_date_branch_uniq
  on holidays (
    holiday_date,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

comment on index holidays_date_branch_uniq is
  'One holiday per date per branch (NULL branch = all branches, collapsed via '
  'COALESCE so duplicate all-branch rows cannot be inserted). Lets the Google '
  'Calendar holiday import be re-run safely.';


-- ============================================================================
-- §2  WEEK-OFF SCHEDULE
-- ----------------------------------------------------------------------------
-- `week_off_weekdays`   ISO-ish weekday numbers that are always off, using
--                       JavaScript's getUTCDay(): 0=Sunday … 6=Saturday.
-- `working_saturdays`   Which Saturdays of the month ARE worked (1st..5th).
--                       Dalnex works the 2nd and 4th, so the 1st, 3rd and 5th
--                       Saturdays are week-offs.
--
-- Read together: a day is a scheduled week-off when its weekday is in
-- week_off_weekdays, EXCEPT a Saturday whose ordinal appears in
-- working_saturdays. See src/lib/week-off.ts, which is the single implementation.
insert into settings (key, value, label, description) values
  ('week_off_weekdays', '[0, 6]'::jsonb,
   'Week-off days',
   'Weekdays that are scheduled off (0=Sunday … 6=Saturday). Saturdays listed in "Working Saturdays" are excluded.'),
  ('working_saturdays', '[2, 4]'::jsonb,
   'Working Saturdays',
   'Which Saturdays of the month are worked (1=first … 5=fifth). Dalnex works the 2nd and 4th; the rest are week-offs.')
on conflict (key) do nothing;
