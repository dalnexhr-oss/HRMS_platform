-- ============================================================================
-- 0013 — Security hardening. Closes findings from the 2026-07-21 adversarial
-- audit. Read the reasoning: each of these is exploitable from a browser
-- devtools console by an ordinary employee, because the publishable key and the
-- session cookie are both present client-side and PostgREST is a public API.
-- The Server Actions in src/lib/actions are NOT the security boundary — RLS is.
-- ============================================================================


-- ============================================================================
-- §1  CRITICAL — self-service privilege escalation via profiles.role
-- ----------------------------------------------------------------------------
-- 0003 defined:
--     create policy profiles_self_update on profiles
--       for update using (id = auth.uid()) with check (id = auth.uid());
--
-- RLS cannot express COLUMN grants, so that policy authorises a user to change
-- ANY column of their own row — including `role`. Any signed-in employee could
-- run, from the browser:
--
--     await supabase.from('profiles').update({ role: 'admin' }).eq('id', myUid)
--
-- and become an admin: middleware routes them to /today, auth_role() returns
-- 'admin', is_staff()/is_portal() become true, and every policy in 0003/0004/0009
-- opens — all salaries, PAN, PF UAN, payslips, plus the service-role-backed user
-- admin actions. A quieter variant repoints `employee_id` at a colleague, so
-- current_employee_id() hands over THAT person's payslips and attendance while
-- the attacker's role still looks innocuous.
--
-- Fixed in depth, because one layer is not enough for a total-compromise bug:
--   (a) the policy now pins every privileged column to its committed value,
--   (b) a fail-closed trigger rejects the change even if a future policy re-opens it,
--   (c) the column-level UPDATE grant is revoked from `authenticated` outright.
-- Legitimate role changes are unaffected: src/lib/actions/users.ts performs them
-- through createServiceClient(), which bypasses RLS and grants alike.
drop policy if exists profiles_self_update on profiles;

create policy profiles_self_update on profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Privileged columns must equal what is already committed for this row.
    and role        =                (select p.role        from public.profiles p where p.id = auth.uid())
    and employee_id is not distinct from (select p.employee_id from public.profiles p where p.id = auth.uid())
    and branch_id   is not distinct from (select p.branch_id   from public.profiles p where p.id = auth.uid())
  );

create or replace function fn_guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The service-role client has no JWT, so auth.uid() is null there: that is the
  -- legitimate administrative path (users.ts) and is allowed through.
  if auth.uid() is null then
    return new;
  end if;

  if (new.role is distinct from old.role)
     or (new.employee_id is distinct from old.employee_id)
     or (new.branch_id is distinct from old.branch_id)
  then
    if coalesce(auth_role() = 'admin', false) then
      return new;   -- a real admin may re-assign roles
    end if;
    raise exception
      'Not permitted: role, employee_id and branch_id can only be changed by an administrator.'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard_privileges on profiles;
create trigger profiles_guard_privileges
  before update on profiles
  for each row execute function fn_guard_profile_privileges();

-- Belt and braces: even a mistaken future policy cannot grant what the role
-- does not hold. (Table-level UPDATE stays, so full_name remains self-editable.)
revoke update (role, employee_id, branch_id) on profiles from authenticated;


-- ============================================================================
-- §2  HIGH — employees could INSERT rows that were already "approved"
-- ----------------------------------------------------------------------------
-- The employee INSERT policies pinned only ownership. Because PostgREST accepts
-- any column the policy does not constrain, an employee could POST directly:
--
--     POST /rest/v1/reimbursement_claims
--     { "employee_id": "<mine>", "purpose": "material_purchase",
--       "amount": 250000, "status": "approved", "reviewed_by": "<an HR uuid>" }
--
-- landing a self-approved ₹2.5L claim in finance's "Approved" tab with a forged
-- reviewer. markReimbursementPaid only checks status='approved', so it would be
-- paid. Choosing a non-travel purpose also skips the server-side kms x rate
-- recomputation, defeating "a tampered amount can't be approved".
--
-- The same shape on `requests` produces a forged approved leave that never
-- appears in /approvals (that queue filters status='pending') and therefore
-- cannot even be rejected through the UI.
--
-- Fix: pin the review columns at the door. A row may only be BORN pending.
drop policy if exists reimbursements_employee_insert on reimbursement_claims;
create policy reimbursements_employee_insert on reimbursement_claims
  for insert with check (
    employee_id = current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

drop policy if exists requests_employee_insert on requests;
create policy requests_employee_insert on requests
  for insert with check (
    employee_id = current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and balance_after is null
  );

-- An employee had NO update policy on requests, so cancelRequest matched zero
-- rows for every employee — the "Cancel" button could never work. Grant exactly
-- that one transition and nothing else.
drop policy if exists requests_employee_cancel on requests;
create policy requests_employee_cancel on requests
  for update
  using (employee_id = current_employee_id() and status = 'pending')
  with check (employee_id = current_employee_id() and status = 'cancelled');

-- Employees must never edit a filed claim (amount, status, …) after the fact.
-- No employee UPDATE policy on reimbursement_claims is intentional; the staff
-- policy from 0009 remains the only write path after insert.


-- ============================================================================
-- §3  MEDIUM-HIGH — reporting views bypassed RLS
-- ----------------------------------------------------------------------------
-- A Postgres view runs with its OWNER's privileges by default, so these three
-- views returned every employee's data to ANY signed-in user regardless of the
-- RLS on the underlying tables — the whole staff directory and per-employee
-- attendance summaries, readable by an ordinary employee straight from
-- PostgREST. security_invoker makes them execute as the caller, so the base
-- tables' policies apply again.
alter view v_monthly_attendance_summary set (security_invoker = on);
alter view v_today_board                set (security_invoker = on);
alter view v_celebrations               set (security_invoker = on);

-- Nothing in the app reads these anonymously.
revoke all on v_monthly_attendance_summary from anon;
revoke all on v_today_board               from anon;
revoke all on v_celebrations              from anon;


-- ============================================================================
-- §4  Consistency constraint behind §2
-- ----------------------------------------------------------------------------
-- Makes "reviewed" and "has a reviewer" inseparable at the storage layer, so a
-- future policy or a direct staff write cannot produce a reviewed-but-unowned
-- decision. 'cancelled' is exempt: an employee withdraws their own request and
-- there is no reviewer.
alter table requests drop constraint if exists requests_reviewed_consistency;
alter table requests add constraint requests_reviewed_consistency check (
  status = 'cancelled'
  or (status = 'pending') = (reviewed_at is null)
);
