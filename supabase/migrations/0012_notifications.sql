-- ============================================================================
-- 0012 — In-app notifications.
--
-- One row per RECIPIENT per event (fan-out on write), which is what makes
-- "unread count" a cheap indexed query instead of a join against every event
-- table. System-generated: rows are inserted by the server (service role), never
-- by the recipient — so there is no INSERT policy for normal users.
-- ============================================================================

create type notification_kind as enum (
  'notice',        -- a notice was published
  'policy',        -- a policy was published (needs acknowledgement)
  'request',       -- a leave / duty / comp-off request was raised (-> approvers)
  'approval',      -- your request was approved or rejected (-> employee)
  'reimbursement', -- claim filed (-> approvers) or reviewed (-> employee)
  'comp_off',      -- a comp-off credit was granted to you
  'ticket',        -- helpdesk ticket raised (-> staff) or updated (-> employee)
  'payroll',       -- payslip available / run locked
  'system'         -- night sweep, imports, anything operational
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references profiles(id) on delete cascade,
  kind          notification_kind not null,
  title         text not null,
  body          text,
  -- In-app destination, e.g. '/approvals'. Relative paths only; rendered as a
  -- <Link>, never as an external URL.
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Drives both the unread badge and the newest-first list for one recipient.
create index notifications_recipient_idx
  on notifications (recipient_id, created_at desc);

-- Partial index: the badge only ever counts unread rows, and this stays small
-- as history grows because read rows drop out of it entirely.
create index notifications_unread_idx
  on notifications (recipient_id)
  where read_at is null;

comment on table notifications is
  'In-app notifications, fanned out one row per recipient. Inserted server-side '
  '(service role) only; recipients may read and mark their own as read.';


-- ---------------------------------------------------------------------- RLS ---
alter table notifications enable row level security;

-- You can only ever see your own notifications — including staff. There is no
-- is_portal() escape hatch here: a notification can quote payslip or claim
-- details, so cross-user reads would leak exactly what RLS elsewhere protects.
create policy notifications_own_read on notifications
  for select using (recipient_id = auth.uid());

-- Marking read is the only mutation a recipient may perform, and only on their
-- own rows. (Postgres RLS cannot restrict WHICH columns are updated; the app
-- only ever sets read_at, and no other column is user-meaningful.)
create policy notifications_own_update on notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Let a recipient clear their own history.
create policy notifications_own_delete on notifications
  for delete using (recipient_id = auth.uid());

-- NOTE: deliberately NO insert policy. Inserts happen through the service-role
-- client in src/lib/notify.ts, which bypasses RLS. That prevents a user from
-- forging a notification (e.g. a fake "your leave was approved") for anyone.
