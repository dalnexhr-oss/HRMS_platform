-- ============================================================================
-- 0018 — helpdesk written replies
--
-- Staff could only change a ticket's status. This adds a free-text reply so they
-- can actually answer the employee; the note rides along on the status-change
-- notification and shows on the employee's ticket.
-- ============================================================================
alter table helpdesk_tickets
  add column if not exists resolution_note text;
