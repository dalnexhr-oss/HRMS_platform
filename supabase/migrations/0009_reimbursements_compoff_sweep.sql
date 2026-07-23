-- ============================================================================
-- 0009 — Reimbursement claims, comp-off lifecycle, and auto punch-out settings.
--
-- Three features land here:
--   1. reimbursement_claims — employee submits, staff approves; approved claims
--      feed the payslip's existing reimbursement_bonus adjustment.
--   2. comp_offs — a credit earned by working an off day (WO/OH), applied for
--      through the normal requests queue, and marked used on approval.
--   3. settings for the km reimbursement rate and the auto punch-out time.
-- ============================================================================


-- ============================================================================
-- §1  ADD 'comp_off' TO request_type   ** MUST STAY AT THE TOP, ALONE **
-- ----------------------------------------------------------------------------
-- Same transaction hazard documented at length in 0006 §1: Postgres refuses to
-- USE a newly added enum value in the transaction that added it —
--     ERROR: unsafe use of new value "comp_off" of enum type request_type
-- Nothing below may reference 'comp_off' in any SELECT / DML / WHERE / cast /
-- `language sql` body / CREATE VIEW. The rest of this file only creates NEW
-- types and tables, none of which name it, so it is safe. Application code
-- (TypeScript) uses the value at runtime, after this migration has committed.
alter type request_type add value if not exists 'comp_off';


-- ============================================================================
-- §2  REIMBURSEMENT CLAIMS
-- ----------------------------------------------------------------------------
-- Mirrors the company's claim sheet columns: Sr.No (derived at render time from
-- ordering — never stored, so deleting a row can't leave a gap), Description,
-- Purpose, Date, Source/Medium, Kms, Mode of payment, Amount, Remarks.
--
-- `amount` is stored, not computed, because only travel claims derive from kms;
-- material/other claims carry a typed amount. For travel the app computes
-- kms * reimbursement_rate_per_km and writes the result here, so the stored
-- amount is always the authoritative one that was approved.
create type reimbursement_purpose as enum ('travel', 'material_purchase', 'other');
create type reimbursement_status  as enum ('pending', 'approved', 'rejected', 'paid');

create table reimbursement_claims (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid        not null references employees(id) on delete cascade,
  claim_date      date        not null,
  description     text        not null,
  purpose         reimbursement_purpose not null,
  source_medium   text,
  kms             numeric(8,1),
  mode_of_payment text,
  amount          numeric(12,2) not null default 0,
  remarks         text,
  status          reimbursement_status not null default 'pending',
  reviewed_by     uuid        references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint reimbursement_amount_non_negative check (amount >= 0),
  constraint reimbursement_kms_non_negative    check (kms is null or kms >= 0),
  -- A travel claim must say how far; a non-travel claim must not pretend to.
  constraint reimbursement_travel_has_kms
    check (purpose <> 'travel' or kms is not null)
);

create index reimbursement_claims_emp_idx    on reimbursement_claims(employee_id, claim_date desc);
create index reimbursement_claims_status_idx on reimbursement_claims(status);

comment on table reimbursement_claims is
  'Employee expense claims. Employees insert their own (RLS); admin/hr/manager '
  'approve or reject. On approval the app adds the amount to the matching '
  'payslip_adjustments.reimbursement_bonus for the claim month and recomputes '
  'that payslip, so an approved claim is paid with salary.';


-- ============================================================================
-- §3  COMP OFFS
-- ----------------------------------------------------------------------------
-- A credit is EARNED when an employee works an off day (a WO/OH-stamped day that
-- carries punches). It is then APPLIED for through the normal requests queue and
-- becomes USED once that request is approved and the taken day is stamped 'CO'.
create type comp_off_status as enum ('available', 'applied', 'used', 'expired');

create table comp_offs (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  -- The off day that was worked. One credit per employee per earned day.
  earned_date   date not null,
  status        comp_off_status not null default 'available',
  -- The day actually taken off, set when the credit is consumed.
  used_date     date,
  -- The leave request through which it was applied for / consumed.
  request_id    uuid references requests(id) on delete set null,
  granted_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  unique (employee_id, earned_date)
);

create index comp_offs_emp_status_idx on comp_offs(employee_id, status);

comment on table comp_offs is
  'Comp-off credits. Earned by working a week-off/holiday (granted from the '
  'register), applied for via requests(type=''comp_off''), and marked used when '
  'that request is approved and the taken day is stamped ''CO''.';


-- ============================================================================
-- §4  RLS — employees see/insert their own; staff see and manage all
-- ----------------------------------------------------------------------------
alter table reimbursement_claims enable row level security;
alter table comp_offs            enable row level security;

-- Reimbursements: an employee reads and files their own; staff read everything.
create policy reimbursements_read on reimbursement_claims
  for select using (is_portal() or employee_id = current_employee_id());

create policy reimbursements_employee_insert on reimbursement_claims
  for insert with check (employee_id = current_employee_id());

-- Only staff may review (approve/reject/pay) or remove a claim.
create policy reimbursements_staff_update on reimbursement_claims
  for update using (is_staff()) with check (is_staff());

create policy reimbursements_staff_delete on reimbursement_claims
  for delete using (is_staff());

-- Comp offs: employee reads their own; only staff grant/modify them.
create policy comp_offs_read on comp_offs
  for select using (is_portal() or employee_id = current_employee_id());

create policy comp_offs_staff_insert on comp_offs
  for insert with check (is_staff());

create policy comp_offs_staff_update on comp_offs
  for update using (is_staff()) with check (is_staff());

create policy comp_offs_staff_delete on comp_offs
  for delete using (is_staff());


-- ============================================================================
-- §5  SETTINGS — km rate and auto punch-out time
-- ----------------------------------------------------------------------------
-- Seeded idempotently so re-running the migration never clobbers an operator's
-- tuned value.
insert into settings (key, value, label, description) values
  ('reimbursement_rate_per_km', '3.5'::jsonb,
   'Reimbursement rate per km',
   'Rupees per kilometre used to auto-calculate travel reimbursement claims.'),
  ('auto_punch_out_time', '"18:00"'::jsonb,
   'Auto punch-out time',
   'Punch-out written when an employee has a punch-in but no punch-out — applied by the night sweep and by the register import.')
on conflict (key) do nothing;
