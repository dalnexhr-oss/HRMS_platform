-- ============================================================================
-- 0021 — helpdesk follow-up thread
--
-- A ticket had a single overwriteable `resolution_note` (0018). This adds a
-- proper two-way thread: staff and the ticket owner can each post follow-up
-- comments over time. An employee posting a follow-up on a resolved/closed
-- ticket REOPENS it (handled in the action; the reopen RLS policy below grants
-- exactly that one transition).
--
-- Author name + staff flag are DENORMALISED onto each comment at insert, so
-- rendering the thread never needs to read another user's `profiles` row
-- (employees cannot, under current RLS). profiles.id = auth.uid() here.
-- ============================================================================
create table if not exists helpdesk_ticket_comments (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references helpdesk_tickets(id) on delete cascade,
  author_id       uuid references profiles(id) on delete set null,
  author_name     text,
  author_is_staff boolean not null default false,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists helpdesk_ticket_comments_ticket_idx
  on helpdesk_ticket_comments (ticket_id, created_at);

alter table helpdesk_ticket_comments enable row level security;

-- Read: staff read all; an employee reads comments on tickets they own.
drop policy if exists helpdesk_ticket_comments_read on helpdesk_ticket_comments;
create policy helpdesk_ticket_comments_read on helpdesk_ticket_comments
  for select using (
    is_portal()
    or exists (
      select 1 from helpdesk_tickets t
      where t.id = ticket_id and t.employee_id = current_employee_id()
    )
  );

-- Insert: you may only post AS yourself (author_id pinned to auth.uid()), and
-- only onto a ticket you own — or any ticket if you are staff.
drop policy if exists helpdesk_ticket_comments_insert on helpdesk_ticket_comments;
create policy helpdesk_ticket_comments_insert on helpdesk_ticket_comments
  for insert with check (
    author_id = auth.uid()
    and (
      is_portal()
      or exists (
        select 1 from helpdesk_tickets t
        where t.id = ticket_id and t.employee_id = current_employee_id()
      )
    )
  );
-- No update/delete policies: comments are immutable.

-- Employee reopen: allow the owner to set their own ticket back to 'open' (and
-- nothing else — with check pins the new status). Mirrors requests_employee_cancel.
drop policy if exists helpdesk_tickets_employee_reopen on helpdesk_tickets;
create policy helpdesk_tickets_employee_reopen on helpdesk_tickets
  for update
  using (employee_id = current_employee_id())
  with check (employee_id = current_employee_id() and status = 'open');
