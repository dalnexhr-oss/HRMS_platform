-- ============================================================================
-- 0030 — helpdesk ticket chat: author role + live updates
--
-- The follow-up thread (0021) becomes a real-time conversation window. Two
-- changes: store the author's ROLE on each message (so the UI can label it
-- "Admin Deepa Rade"), and add the comments table to the Realtime publication so
-- both sides see new messages live over Supabase's WebSocket. RLS
-- (helpdesk_ticket_comments_read, 0021) is applied per socket, so an employee
-- only ever receives their own tickets' messages.
-- ============================================================================
alter table helpdesk_ticket_comments
  add column if not exists author_role text;

-- Enable Realtime on the table. `alter publication ... add table` errors if the
-- table is already a member, so guard it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'helpdesk_ticket_comments'
  ) then
    alter publication supabase_realtime add table helpdesk_ticket_comments;
  end if;
end $$;
