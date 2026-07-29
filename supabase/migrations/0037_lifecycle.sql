-- ============================================================================
-- 0037 — Employee lifecycle: onboarding checklists, HR document verification,
-- in-app e-sign, and the full exit workflow (clearance → F&F → deactivation).
--
-- Today an employee is created and later flipped to 'inactive', and that is the
-- entire lifecycle. Nothing records WHAT was collected on joining, WHO verified
-- it, what is still in the leaver's hands, or what they are owed. The two
-- expensive failure modes this closes:
--   * a joiner starts with no ID proof / no signed policy and nobody notices
--     until an audit — there was no checklist and no verification stamp;
--   * a leaver walks out still holding a laptop and a toolkit, and the final
--     settlement is paid anyway — asset recovery was never reconciled against
--     the asset/item registers because nothing joined them to the exit.
--
-- What this adds:
--   * employees.resignation_date / last_working_day / notice_period_days /
--     exit_reason — the notice window, on the employee row where every screen
--     already reads from
--   * employee_documents   — uploads in the employee-documents bucket (0032)
--                            plus a verified_by/verified_at HR stamp
--   * onboarding_templates / _template_items / onboarding_tasks — a reusable
--                            checklist instantiated per joiner
--   * acknowledgements     — lightweight in-app e-sign (name + time + IP)
--   * exit_cases + exit_clearance_items + exit_interviews +
--     knowledge_transfer_items — the staged exit
--   * full_and_final       — the settlement sheet, draft → approved → paid
--   * v_exit_clearance_pending — un-returned assets/items per exit case, the
--                            gate the F&F screen must respect
--   * fn_lifecycle_reminders() on pg_cron (0031) — nags HR about exits whose
--                            clearance is still open and overdue onboarding tasks
--
-- Deliberately NOT altered here: employee_status already carries 'on_notice'
-- (0001; unused to date — the app writes it when a resignation is recorded) and
-- notification_kind already carries 'system' (0012). Because this migration adds
-- NO enum value, the reminder function below may reference 'system' in this same
-- transaction — the restriction that forced 0029/0034/0035 to split enum-add
-- from enum-use does not bite here.
--
-- Sequencing note for the app layer: deactivation is the LAST step of an exit.
-- Completing a case must go clearance → F&F paid → employees.status='inactive'
-- → revoke the login. Note that nothing in this schema keys RLS on
-- employees.status, so flipping it early does not itself lock the leaver out at
-- the database (current_employee_id() reads profiles, not employees) — it is the
-- login revocation that does. Doing either first strands a leaver who still owes
-- an exit interview and a signature with no way to give them.
-- ============================================================================

-- ============================================================================
-- §1  Exit fields on the employee row + lifecycle settings
-- ============================================================================
alter table employees
  add column if not exists resignation_date   date,
  add column if not exists last_working_day   date,
  add column if not exists notice_period_days integer,
  add column if not exists exit_reason        text;

comment on column employees.resignation_date is 'Date the resignation was tendered/accepted. Start of the notice window.';
comment on column employees.last_working_day is 'Final working day. Payroll, clearance and F&F are all cut against this date.';
comment on column employees.notice_period_days is 'Contractual notice in days; falls back to settings.default_notice_period_days when null.';
comment on column employees.exit_reason is 'Free-text reason (resignation, termination, end of contract, absconding, …).';

-- The reminder job and every "who is leaving soon" screen filter on this, and
-- it is null for the overwhelming majority of rows — a partial index keeps it
-- tiny instead of indexing the whole employee table for a handful of leavers.
create index if not exists employees_last_working_day_idx
  on employees (last_working_day) where last_working_day is not null;

insert into settings (key, value, label, description) values
  ('default_notice_period_days', '60'::jsonb, 'Default notice period (days)',
   'Used to prefill the last working day when a resignation is recorded and the employee has no contractual notice period of their own.'),
  ('onboarding_default_template', '"Standard Onboarding"'::jsonb, 'Default onboarding checklist',
   'Name of the onboarding template auto-applied to a newly created employee. Blank disables auto-assignment.'),
  ('exit_auto_deactivate', 'true'::jsonb, 'Deactivate on exit completion',
   'When on, completing an exit case sets the employee to inactive and revokes portal login. Always the LAST step — it runs only after clearance is done and the F&F is marked paid.')
on conflict (key) do nothing;

-- ============================================================================
-- §2  employee_documents — uploads + HR verification stamp
-- ============================================================================
create table if not exists employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid        not null references employees(id) on delete cascade,
  category      text,                    -- offer_letter | id_proof | education | experience | bank | other
  title         text,
  storage_path  text        not null,    -- object path in the private employee-documents bucket (0032)
  uploaded_by   uuid        references profiles(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  verified_by   uuid        references profiles(id) on delete set null,
  verified_at   timestamptz,
  verify_remark text,

  -- The bucket policies in 0032 key on (storage.foldername(name))[1], but signed
  -- URLs are minted SERVER-SIDE with the service role, which bypasses storage
  -- RLS entirely. Without this constraint a row could point at another
  -- employee's folder and the app would happily sign it. Scope the row too.
  constraint employee_documents_path_scoped
    check (split_part(storage_path, '/', 1) = employee_id::text)
);

create index if not exists employee_documents_employee_idx
  on employee_documents (employee_id, uploaded_at desc);
-- Drives the HR "awaiting verification" queue; verified rows drop straight out.
create index if not exists employee_documents_unverified_idx
  on employee_documents (employee_id) where verified_at is null;

comment on table employee_documents is
  'Employee document register (offer letter, IDs, certificates) backed by the employee-documents bucket, with an HR verified_by/verified_at stamp.';
comment on column employee_documents.storage_path is
  'Object path `<employee_id>/<uuid>-<filename>` in the private employee-documents bucket. Access via signed URL only.';

alter table employee_documents enable row level security;

drop policy if exists employee_documents_admin_hr on employee_documents;
create policy employee_documents_admin_hr on employee_documents
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

drop policy if exists employee_documents_read_own on employee_documents;
create policy employee_documents_read_own on employee_documents
  for select using (employee_id = current_employee_id());

-- An employee may upload their own paperwork, but may NOT arrive pre-verified:
-- forcing the stamps to null on insert means verification can only ever be
-- applied afterwards by an admin/HR update (no self-verification, ever). There
-- is intentionally no employee UPDATE or DELETE policy — a document, once
-- filed, is HR's record and cannot be swapped out or erased by its subject.
drop policy if exists employee_documents_insert_own on employee_documents;
create policy employee_documents_insert_own on employee_documents
  for insert with check (
    employee_id = current_employee_id()
    and verified_by is null
    and verified_at is null
  );

-- ============================================================================
-- §3  Onboarding — reusable templates instantiated into per-joiner tasks
-- ============================================================================
create table if not exists onboarding_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null unique,          -- unique so the seed below is idempotent
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table onboarding_templates is
  'Named onboarding checklists. Inactive templates stay for history but are not offered when creating a joiner.';

create table if not exists onboarding_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid    not null references onboarding_templates(id) on delete cascade,
  seq           integer not null default 0,        -- display order; ties break on title
  title         text    not null,
  assignee_role text,                              -- hr | it | admin | manager | employee

  -- Unique on TITLE, not seq: the seed re-runs cleanly, duplicate steps are
  -- meaningless, and re-ordering (rewriting seq) stays a plain update instead
  -- of a constraint dance.
  unique (template_id, title)
);
create index if not exists onboarding_template_items_tpl_idx
  on onboarding_template_items (template_id, seq);
comment on column onboarding_template_items.assignee_role is
  'Who owns the step. Free text, not app_role — ''it'' and ''employee'' are owners without being portal roles.';

create table if not exists onboarding_tasks (
  id            uuid        primary key default gen_random_uuid(),
  employee_id   uuid        not null references employees(id) on delete cascade,
  title         text        not null,
  assignee_role text,
  status        text        not null default 'pending'
                  check (status in ('pending','done','blocked')),
  due_date      date,
  done_by       uuid        references profiles(id) on delete set null,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists onboarding_tasks_employee_idx
  on onboarding_tasks (employee_id, due_date);
-- The reminder job and the HR dashboard both scan only what is still OPEN, and
-- open means "not done" — a 'blocked' step is still outstanding work. The
-- predicate here and the filter in fn_lifecycle_reminders() must stay in step;
-- a job that looked only at 'pending' would silently never chase the parked
-- tasks, which are precisely the ones that rot.
create index if not exists onboarding_tasks_open_idx
  on onboarding_tasks (due_date) where status <> 'done';

comment on table onboarding_tasks is
  'Per-joiner checklist rows. Copied from a template at creation and then owned by the employee record — editing a template never rewrites history already in flight.';

drop trigger if exists onboarding_templates_touch on onboarding_templates;
create trigger onboarding_templates_touch before update on onboarding_templates
  for each row execute function set_updated_at();

drop trigger if exists onboarding_tasks_touch on onboarding_tasks;
create trigger onboarding_tasks_touch before update on onboarding_tasks
  for each row execute function set_updated_at();

alter table onboarding_templates      enable row level security;
alter table onboarding_template_items enable row level security;
alter table onboarding_tasks          enable row level security;

drop policy if exists onboarding_templates_admin_hr on onboarding_templates;
create policy onboarding_templates_admin_hr on onboarding_templates
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

drop policy if exists onboarding_template_items_admin_hr on onboarding_template_items;
create policy onboarding_template_items_admin_hr on onboarding_template_items
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

drop policy if exists onboarding_tasks_admin_hr on onboarding_tasks;
create policy onboarding_tasks_admin_hr on onboarding_tasks
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

-- A joiner sees their own checklist (so /me can show "what HR still needs from
-- you") but cannot tick it off — done_by/done_at must be a staff action.
drop policy if exists onboarding_tasks_read_own on onboarding_tasks;
create policy onboarding_tasks_read_own on onboarding_tasks
  for select using (employee_id = current_employee_id());

-- --- default checklist -----------------------------------------------------
-- Seeded so the feature is usable on day one; both inserts are conflict-safe so
-- a re-run neither duplicates nor overwrites an edited template.
insert into onboarding_templates (name, active)
values ('Standard Onboarding', true)
on conflict (name) do nothing;

insert into onboarding_template_items (template_id, seq, title, assignee_role)
select t.id, v.seq, v.title, v.assignee_role
  from onboarding_templates t
  cross join (values
    (10, 'Collect signed offer letter',            'hr'),
    (20, 'Collect ID proof (Aadhaar / PAN)',       'hr'),
    (30, 'Collect education & experience proofs',  'hr'),
    (40, 'Collect bank details for salary credit', 'hr'),
    (50, 'Create email account & portal login',    'it'),
    (60, 'Issue laptop / desktop and peripherals', 'it'),
    (70, 'Acknowledge company policies',           'employee'),
    (80, 'Introduce reporting manager & team',     'manager'),
    (90, 'Enrol in PF / ESIC where applicable',    'hr')
  ) as v(seq, title, assignee_role)
 where t.name = 'Standard Onboarding'
on conflict (template_id, title) do nothing;

-- ============================================================================
-- §4  acknowledgements — lightweight in-app e-sign
-- ============================================================================
-- Deliberately generic (document_kind + document_id) rather than one ack table
-- per document type: policies already have policy_acknowledgements (0004), and
-- offer letters, handbooks, asset declarations and F&F sheets all need the same
-- four facts — who, what, when, from where.
create table if not exists acknowledgements (
  id            uuid        primary key default gen_random_uuid(),
  employee_id   uuid        not null references employees(id) on delete cascade,
  document_kind text        not null,           -- policy | offer_letter | handbook | asset_declaration | fnf | …
  document_id   uuid,                           -- the signed row, when there is one
  signed_name   text        not null,           -- typed name = the signature
  signed_at     timestamptz not null default now(),
  ip            text,                           -- text, not inet: x-forwarded-for can carry a proxy chain
  user_agent    text
);

create index if not exists acknowledgements_employee_idx
  on acknowledgements (employee_id, signed_at desc);
create index if not exists acknowledgements_document_idx
  on acknowledgements (document_kind, document_id);

-- One signature per person per document. A double-clicked submit collapses to a
-- single row; a genuinely re-issued document gets a new document_id and can be
-- signed again. Partial, because free-standing acks carry no document_id.
create unique index if not exists acknowledgements_unique_signature
  on acknowledgements (employee_id, document_kind, document_id)
  where document_id is not null;

comment on table acknowledgements is
  'In-app e-signatures: typed name + timestamp + IP/user-agent. Append-only evidence — no UPDATE or DELETE policy exists for anyone but the service role, and the insert policy pins signed_at to the database clock.';

alter table acknowledgements enable row level security;

-- Staff read every signature but never write one — an acknowledgement HR could
-- forge is not evidence of anything.
drop policy if exists acknowledgements_staff_read on acknowledgements;
create policy acknowledgements_staff_read on acknowledgements
  for select using (auth_role() in ('admin','hr'));

drop policy if exists acknowledgements_read_own on acknowledgements;
create policy acknowledgements_read_own on acknowledgements
  for select using (employee_id = current_employee_id());

-- Sign for yourself, and only at the moment you actually sign. The second
-- condition is the one that matters: employee_id alone would let a signer post
-- their own acknowledgement stamped five years ago (or five years hence), and a
-- signature whose date the signer chooses is not evidence of when they signed —
-- exactly what this table exists to be. now() is the transaction clock, so the
-- happy path (omit signed_at and let the column default fire) always passes; the
-- ±5 minute window only absorbs skew between the app server and the database.
-- Service-role backfills of historic signatures bypass RLS and are unaffected.
drop policy if exists acknowledgements_insert_own on acknowledgements;
create policy acknowledgements_insert_own on acknowledgements
  for insert with check (
    employee_id = current_employee_id()
    and signed_at between now() - interval '5 minutes' and now() + interval '5 minutes'
  );

-- ============================================================================
-- §5  Exit workflow — case, clearance, interview, knowledge transfer
-- ============================================================================
create table if not exists exit_cases (
  id               uuid        primary key default gen_random_uuid(),
  employee_id      uuid        not null references employees(id) on delete cascade,
  stage            text        not null default 'initiated'
                     check (stage in ('initiated','clearance','settlement','completed')),
  resignation_date date,
  last_working_day date,
  reason           text,
  created_by       uuid        references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

-- "Unique-ish": at most ONE case in flight per employee, so a second Initiate
-- click cannot fork the clearance into two half-finished cases. Completed cases
-- are excluded from the index, which is what lets a re-hire exit again later
-- while their earlier exit stays on file.
create unique index if not exists exit_cases_open_unique
  on exit_cases (employee_id) where stage <> 'completed';
create index if not exists exit_cases_lwd_idx on exit_cases (last_working_day);

comment on table exit_cases is
  'One exit per employee at a time: initiated → clearance → settlement → completed. The dates are mirrored from employees.* so the case is self-contained once the employee row is archived.';

drop trigger if exists exit_cases_touch on exit_cases;
create trigger exit_cases_touch before update on exit_cases
  for each row execute function set_updated_at();

alter table exit_cases enable row level security;

drop policy if exists exit_cases_admin_hr on exit_cases;
create policy exit_cases_admin_hr on exit_cases
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

-- The leaver must be able to watch their own exit progress (and, crucially,
-- this read is what makes the exists() checks in the child policies below
-- resolve for them — RLS applies inside those subqueries too).
drop policy if exists exit_cases_read_own on exit_cases;
create policy exit_cases_read_own on exit_cases
  for select using (employee_id = current_employee_id());

-- --- clearance items -------------------------------------------------------
create table if not exists exit_clearance_items (
  id           uuid        primary key default gen_random_uuid(),
  exit_case_id uuid        not null references exit_cases(id) on delete cascade,
  area         text        not null,          -- asset | item | it | finance | hr | admin | kt
  reference_id uuid,                          -- assets.id / item_assignments.id / … when the row is machine-seeded
  description  text,
  cleared      boolean     not null default false,
  cleared_by   uuid        references profiles(id) on delete set null,
  cleared_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists exit_clearance_items_case_idx
  on exit_clearance_items (exit_case_id, cleared);

-- Seeding clearance rows from the asset/item registers is re-runnable (HR will
-- hit "refresh clearance" after every return), so the same asset must not be
-- able to appear twice. Manual rows carry no reference_id and stay unconstrained.
create unique index if not exists exit_clearance_items_ref_unique
  on exit_clearance_items (exit_case_id, area, reference_id)
  where reference_id is not null;

comment on table exit_clearance_items is
  'Checklist of everything the leaver must hand back or settle. Machine-seeded rows carry reference_id pointing at the asset/item/claim they came from.';

alter table exit_clearance_items enable row level security;

drop policy if exists exit_clearance_items_admin_hr on exit_clearance_items;
create policy exit_clearance_items_admin_hr on exit_clearance_items
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

drop policy if exists exit_clearance_items_read_own on exit_clearance_items;
create policy exit_clearance_items_read_own on exit_clearance_items
  for select using (
    exists (
      select 1 from exit_cases x
      where x.id = exit_clearance_items.exit_case_id
        and x.employee_id = current_employee_id()
    )
  );

-- --- exit interview --------------------------------------------------------
create table if not exists exit_interviews (
  id             uuid        primary key default gen_random_uuid(),
  exit_case_id   uuid        not null references exit_cases(id) on delete cascade,
  question       text        not null,
  answer         text,
  interviewer_id uuid        references profiles(id) on delete set null,
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists exit_interviews_case_idx on exit_interviews (exit_case_id);

comment on table exit_interviews is
  'One row per question/answer. The leaver may READ their own transcript; answers are recorded server-side by the interview flow, so a respondent can never rewrite the question they were asked.';

alter table exit_interviews enable row level security;

drop policy if exists exit_interviews_admin_hr on exit_interviews;
create policy exit_interviews_admin_hr on exit_interviews
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

drop policy if exists exit_interviews_read_own on exit_interviews;
create policy exit_interviews_read_own on exit_interviews
  for select using (
    exists (
      select 1 from exit_cases x
      where x.id = exit_interviews.exit_case_id
        and x.employee_id = current_employee_id()
    )
  );

-- --- knowledge transfer ----------------------------------------------------
create table if not exists knowledge_transfer_items (
  id           uuid        primary key default gen_random_uuid(),
  exit_case_id uuid        not null references exit_cases(id) on delete cascade,
  task         text        not null,
  handover_to  uuid        references employees(id) on delete set null,
  -- Constrained like every other status column in this migration: a free-text
  -- column would let a typo ('inprogress') sit forever outside both the "open"
  -- and the "done" filter, so the handover looks finished to nobody and unfinished
  -- to nobody.
  status       text        not null default 'pending'
                 check (status in ('pending','in_progress','done')),
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists knowledge_transfer_items_case_idx
  on knowledge_transfer_items (exit_case_id);
create index if not exists knowledge_transfer_items_handover_idx
  on knowledge_transfer_items (handover_to) where handover_to is not null;

comment on table knowledge_transfer_items is
  'What the leaver must hand over and to whom. handover_to is ON DELETE SET NULL, not CASCADE — losing the receiver must never silently delete the handover itself.';

alter table knowledge_transfer_items enable row level security;

drop policy if exists knowledge_transfer_items_admin_hr on knowledge_transfer_items;
create policy knowledge_transfer_items_admin_hr on knowledge_transfer_items
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

-- Two people legitimately need this row: the leaver handing over, and the
-- colleague receiving — who otherwise has no way to learn what is landing on
-- their desk (they cannot read the exit case itself).
drop policy if exists knowledge_transfer_items_read_own on knowledge_transfer_items;
create policy knowledge_transfer_items_read_own on knowledge_transfer_items
  for select using (
    handover_to = current_employee_id()
    or exists (
      select 1 from exit_cases x
      where x.id = knowledge_transfer_items.exit_case_id
        and x.employee_id = current_employee_id()
    )
  );

-- ============================================================================
-- §6  full_and_final — the settlement sheet
-- ============================================================================
create table if not exists full_and_final (
  id                     uuid          primary key default gen_random_uuid(),
  exit_case_id           uuid          not null unique references exit_cases(id) on delete cascade,
  salary_payable         numeric(12,2) not null default 0,
  leave_encashment       numeric(12,2) not null default 0,
  pending_reimbursements numeric(12,2) not null default 0,
  asset_recovery         numeric(12,2) not null default 0,
  other_deductions       numeric(12,2) not null default 0,
  net_payable            numeric(12,2) not null default 0,
  status                 text          not null default 'draft'
                           check (status in ('draft','approved','paid')),
  prepared_by            uuid          references profiles(id) on delete set null,
  approved_by            uuid          references profiles(id) on delete set null,
  approved_at            timestamptz,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now()
);

comment on table full_and_final is
  'One settlement per exit case (unique exit_case_id). draft → approved → paid; only a paid F&F may close the case.';
comment on column full_and_final.net_payable is
  'salary_payable + leave_encashment + pending_reimbursements − asset_recovery − other_deductions. Stored rather than generated: HR may round or override the final figure, and the sheet must show what was actually paid, not what the formula says today.';
comment on column full_and_final.asset_recovery is
  'Value recovered for equipment not returned. Reconcile against v_exit_clearance_pending before approving — that view is the only place the asset/item registers are joined to the exit.';

-- Every component defaults to 0 rather than null: one null in an untouched
-- column would turn the whole net_payable arithmetic into null downstream.

drop trigger if exists full_and_final_touch on full_and_final;
create trigger full_and_final_touch before update on full_and_final
  for each row execute function set_updated_at();

alter table full_and_final enable row level security;

drop policy if exists full_and_final_admin_hr on full_and_final;
create policy full_and_final_admin_hr on full_and_final
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

-- The leaver sees their own settlement — it is the number they are owed. Read
-- only: no employee INSERT/UPDATE policy exists, so the sheet is never editable
-- by its beneficiary.
drop policy if exists full_and_final_read_own on full_and_final;
create policy full_and_final_read_own on full_and_final
  for select using (
    exists (
      select 1 from exit_cases x
      where x.id = full_and_final.exit_case_id
        and x.employee_id = current_employee_id()
    )
  );

-- ============================================================================
-- §7  v_exit_clearance_pending — what the leaver still holds
-- ============================================================================
-- The gate for "may this F&F be approved?". Counts, per exit case:
--   * assets still stamped with the leaver as current holder (0028's
--     single-holder snapshot on assets.assigned_employee_id)
--   * item issuances not yet marked returned (0026's item_assignments)
--   * clearance rows still un-ticked
--
-- security_invoker = on, matching v_items (0026) — the view must not become a
-- hole around the base-table RLS. Consequence to know about, and it is sharper
-- than it looks: exit_cases itself is admin/HR-only, so a MANAGER or VIEWER
-- querying this view gets NO ROWS AT ALL — not rows with zeroed counts, and not
-- an error. Never read "the view came back empty" as "clearance is complete";
-- this is an admin/HR screen and the F&F gate must run in an admin/HR session.
-- An employee sees exactly their own case with correct counts, because
-- assets/item_assignments both carry read-own policies (0028).
create or replace view v_exit_clearance_pending as
select
  q.*,
  (q.assets_outstanding + q.items_outstanding + q.clearance_items_open) = 0 as clearance_complete
from (
  select
    x.id               as exit_case_id,
    x.employee_id,
    x.stage,
    x.last_working_day,
    (select count(*) from assets a
      where a.assigned_employee_id = x.employee_id)::int              as assets_outstanding,
    (select count(*) from item_assignments ia
      where ia.employee_id = x.employee_id and not ia.returned)::int  as items_outstanding,
    (select count(*) from exit_clearance_items ci
      where ci.exit_case_id = x.id and not ci.cleared)::int           as clearance_items_open
  from exit_cases x
) q;

alter view v_exit_clearance_pending set (security_invoker = on);

comment on view v_exit_clearance_pending is
  'Per exit case: un-returned assets, un-returned item issuances and open clearance rows, plus clearance_complete. Runs as the caller (security_invoker), so employees see only their own case and non-admin/HR staff see nothing at all.';

-- ============================================================================
-- §8  Reminders (pg_cron)
-- ============================================================================
-- Two nags, one job, both idempotent through cron_claim (0031):
--   a) an exit whose last working day is within the next 7 days — OR is already
--      behind us — that still has something outstanding. Claimed per
--      (case, last_working_day), so moving the LWD legitimately re-arms the
--      reminder while a daily re-fire does not. There is deliberately NO lower
--      bound on the window: resignations are routinely recorded late, with the
--      last working day already in the past, and a window that opened at
--      current_date would skip exactly those cases forever — the leaver who has
--      already walked out with the laptop is the one this migration exists for.
--   b) an onboarding task past its due date and NOT DONE — 'blocked' counts as
--      outstanding, matching onboarding_tasks_open_idx; a step somebody parked
--      is the step that rots. Claimed per (task, due_date), so a joiner's
--      stalled checklist is raised once, not every morning.
-- Recipients are the admin/HR profiles; kind 'system' already exists (0012).
create or replace function fn_lifecycle_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r  record;
  n  integer := 0;
begin
  -- (a) exits due within a week (or overdue) with clearance still open
  for r in
    select v.exit_case_id,
           v.last_working_day,
           e.full_name,
           e.code,
           (v.assets_outstanding + v.items_outstanding + v.clearance_items_open) as pending
      from v_exit_clearance_pending v
      join employees e on e.id = v.employee_id
     where v.stage <> 'completed'
       and v.last_working_day is not null
       and v.last_working_day <= current_date + 7
       and not v.clearance_complete
  loop
    if cron_claim('exit_clearance_reminder', r.exit_case_id::text || '|' || r.last_working_day::text) then
      insert into notifications (recipient_id, kind, title, body, link)
      select p.id, 'system',
             'Exit clearance still pending',
             format('%s (%s) leaves on %s with %s item(s) not cleared.',
                    r.full_name, r.code, r.last_working_day, r.pending),
             '/employees'
        from profiles p
       where p.role in ('admin','hr');
      n := n + 1;
    end if;
  end loop;

  -- (b) overdue onboarding tasks (pending OR blocked — anything not done)
  for r in
    select t.id, t.title, t.due_date, e.full_name, e.code
      from onboarding_tasks t
      join employees e on e.id = t.employee_id
     where t.status <> 'done'
       and t.due_date is not null
       and t.due_date < current_date
  loop
    if cron_claim('onboarding_task_overdue', r.id::text || '|' || r.due_date::text) then
      insert into notifications (recipient_id, kind, title, body, link)
      select p.id, 'system',
             'Onboarding task overdue',
             format('"%s" was due %s for %s (%s).',
                    r.title, r.due_date, r.full_name, r.code),
             '/employees'
        from profiles p
       where p.role in ('admin','hr');
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

comment on function fn_lifecycle_reminders() is
  'Daily nag for exits due (or overdue) within 7 days whose clearance is still open, and for onboarding tasks past due and not done. Idempotent via cron_claim.';

-- SECURITY DEFINER plus the default EXECUTE grant would expose this as a
-- PostgREST RPC: any signed-in employee could fire the whole admin/HR fan-out on
-- demand and burn the cron_claim keys for the day, so the 03:45 run would then
-- find nothing left to claim. pg_cron executes it as the owner (postgres keeps
-- its own explicit grant), so revoking costs the schedule nothing.
--
-- PUBLIC is revoked FIRST and explicitly. A new function in `public` carries the
-- implicit `=X/postgres` PUBLIC grant on top of whatever Supabase's default
-- privileges hand to anon/authenticated, so revoking from those two roles alone
-- leaves the function fully callable through PUBLIC — the 0024 §2 revokes were
-- only ever belt-and-braces because trigger functions cannot be RPC'd at all.
-- This one can be, so it needs the PUBLIC revoke to actually close.
revoke execute on function public.fn_lifecycle_reminders() from public;
revoke execute on function public.fn_lifecycle_reminders() from anon, authenticated;

-- 03:45 UTC = 09:15 IST — deliberately off the 03:00 warranty slot (0034) so the
-- two notification fan-outs do not contend for the same minute.
select cron.schedule(
  'lifecycle-reminders',
  '45 3 * * *',
  $cron$ select fn_lifecycle_reminders(); $cron$
);
