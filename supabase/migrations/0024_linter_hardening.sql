-- ============================================================================
-- 0024 — Supabase database-linter hardening.
-- Clears the SECURITY advisories from the 2026-07-24 linter run. No behaviour
-- change: search_path is pinned to `public` (the schema every one of these
-- functions already resolves against), and EXECUTE is revoked only from
-- trigger functions that were never meant to be RPC-callable.
--
-- Deliberately NOT touched:
--   * auth_role() / current_employee_id() — used inside RLS policy expressions,
--     which require EXECUTE by the invoking role. Revoking would break RLS for
--     every authenticated query. They take no args and return only the caller's
--     own role/employee_id (anon → null), so RPC exposure leaks nothing.
--   * auth_leaked_password_protection — a dashboard toggle, not SQL. Enable at
--     Authentication → Sign In / Providers → Passwords.
-- ============================================================================

-- §1  Function Search Path Mutable — pin search_path on the ten flagged funcs.
--     (auth_role, current_employee_id, handle_new_user already set it.)
alter function public.set_updated_at()                                    set search_path = public;
alter function public.fn_professional_tax(indian_state, numeric, gender_type, integer)
                                                                          set search_path = public;
alter function public.is_staff()                                          set search_path = public;
alter function public.is_authenticated()                                  set search_path = public;
alter function public.is_portal()                                         set search_path = public;
alter function public.fn_setting_numeric(text, numeric)                   set search_path = public;
alter function public.fn_compute_payslip(uuid, uuid)                      set search_path = public;
alter function public.fn_compute_run(uuid)                                set search_path = public;
alter function public.fn_lock_run(uuid)                                   set search_path = public;
alter function public.fn_mark_run_paid(uuid)                              set search_path = public;

-- §2  SECURITY DEFINER trigger functions must not be exposed via PostgREST RPC.
--     Revoking EXECUTE does not affect trigger firing (triggers run as the
--     table owner). These also cannot be called via RPC at all — Postgres
--     rejects direct calls to trigger functions — so this is belt-and-braces.
revoke execute on function public.handle_new_user()            from anon, authenticated;
revoke execute on function public.fn_guard_profile_privileges() from anon, authenticated;
