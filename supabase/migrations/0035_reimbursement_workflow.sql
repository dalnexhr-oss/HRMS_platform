-- ============================================================================
-- 0035 — Reimbursement workflow: receipts, payment detail, finance stage,
-- edit & resubmit, and a full event timeline.
--
-- Today a claim is single-stage (one staff approve → straight into payroll),
-- 'paid' records no who/when/how, edits overwrite in place with no history, and
-- a rejection is terminal. This adds:
--   * receipt_path            — attachment in the reimbursement-receipts bucket (0032)
--   * paid_at/paid_by/payment_ref — a verifiable payment record
--   * finance_reviewed_by/at + enum 'finance_review' — an OPTIONAL second stage
--   * reimbursement_events    — submitted/edited/approved/paid audit timeline
--   * edit & resubmit         — a rejected claim can be corrected and re-filed
--
-- The finance stage is opt-in via settings.reimbursement_finance_stage so
-- existing single-stage behaviour is unchanged until it is switched on. When ON,
-- payroll is only credited after FINAL (finance) approval — never after the first.
--
-- 'finance_review' is added here and only USED at runtime (a later transaction):
-- Postgres forbids using a freshly added enum value in the same transaction.
-- ============================================================================

alter type reimbursement_status add value if not exists 'finance_review';

alter table reimbursement_claims
  add column if not exists receipt_path         text,
  add column if not exists paid_at              timestamptz,
  add column if not exists paid_by              uuid references profiles(id) on delete set null,
  add column if not exists payment_ref          text,
  add column if not exists finance_reviewed_by  uuid references profiles(id) on delete set null,
  add column if not exists finance_reviewed_at  timestamptz;

comment on column reimbursement_claims.receipt_path is
  'Object path in the private reimbursement-receipts bucket (0032). Signed-URL access only.';
comment on column reimbursement_claims.payment_ref is
  'UTR / cheque / transfer reference recorded when the claim is marked paid.';

-- Opt-in second approval stage. Default false = today''s single-stage flow.
insert into settings (key, value, label, description)
values (
  'reimbursement_finance_stage',
  'false'::jsonb,
  'Reimbursement finance approval',
  'When on, an approved claim goes to Finance for a second approval before it is credited to payroll.'
)
on conflict (key) do nothing;

-- --- event timeline --------------------------------------------------------
create table if not exists reimbursement_events (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references reimbursement_claims(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,                      -- snapshot, survives profile deletion
  action      text not null,             -- 'submitted' | 'edited' | 'resubmitted' | 'approved' | …
  from_status text,
  to_status   text,
  remark      text,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists reimbursement_events_claim_idx
  on reimbursement_events (claim_id, occurred_at desc);
comment on table reimbursement_events is
  'Append-only lifecycle timeline for a claim (submit/edit/review/pay). Doubles as the revision history.';

alter table reimbursement_events enable row level security;

-- Staff see every event; an employee sees only their own claim''s events.
drop policy if exists reimbursement_events_read on reimbursement_events;
create policy reimbursement_events_read on reimbursement_events
  for select using (
    is_staff()
    or exists (
      select 1 from reimbursement_claims c
      where c.id = reimbursement_events.claim_id
        and c.employee_id = current_employee_id()
    )
  );

-- Anyone who may act on a claim may append its events (the action itself is
-- already gated); events are never updated or deleted.
drop policy if exists reimbursement_events_insert on reimbursement_events;
create policy reimbursement_events_insert on reimbursement_events
  for insert with check (
    is_staff()
    or exists (
      select 1 from reimbursement_claims c
      where c.id = reimbursement_events.claim_id
        and c.employee_id = current_employee_id()
    )
  );

-- --- edit & resubmit -------------------------------------------------------
-- Widen 0020''s employee-update policy: a REJECTED claim may also be corrected,
-- but the row must land back in 'pending' with the review stamps CLEARED — so a
-- resubmission cannot carry a stale approval, and self-approval stays impossible.
drop policy if exists reimbursements_employee_update on reimbursement_claims;
create policy reimbursements_employee_update on reimbursement_claims
  for update
  using (employee_id = current_employee_id() and status in ('pending', 'rejected'))
  with check (
    employee_id = current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and finance_reviewed_by is null
    and finance_reviewed_at is null
  );
