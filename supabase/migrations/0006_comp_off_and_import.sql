-- ============================================================================
-- Dalnex HRMS — Comp Off status + attendance-register import support
-- ----------------------------------------------------------------------------
-- Driven by the company's real monthly attendance register
-- ("reference for desktop app (1).xlsx", Sheet1, 848 rows / ~210 employee
-- blocks). Two things came out of decoding it:
--
--   1. The register stamps a 'CO' (Comp Off) status that the DB enum does not
--      have. Importing the real file fails without it. Fixed below.
--   2. The register's own payable-days formula does NOT agree with
--      fn_compute_payslip. That is a money question, not a schema question, so
--      this migration DOCUMENTS the divergence and changes nothing. See §2.
-- ============================================================================


-- ============================================================================
-- §1  ADD 'CO' (Comp Off) TO attendance_status
-- ----------------------------------------------------------------------------
-- !! TRANSACTION HAZARD — READ BEFORE EDITING THIS SECTION !!
--
-- Postgres will not let a newly added enum value be USED in the same
-- transaction that added it. It must be committed first:
--     ERROR:  unsafe use of new value "CO" of enum type attendance_status
--     HINT:   New enum values must be committed before they can be used.
--
-- Do NOT rely on the widely-repeated "...unless the type was created in the
-- same transaction" exemption. It does not hold. Verified on PostgreSQL 15.18:
--     create type zz_t as enum ('a');
--     alter type zz_t add value 'b';
--     select 'b'::zz_t;          -- ERROR: unsafe use of new value "b"
-- all in one transaction still fails. There is no exemption to lean on.
--
-- Therefore:
--   * This ALTER TYPE stands alone in its own section, at the TOP of the file.
--   * If you ever need to reference 'CO' in DDL/DML, put it in migration 0007
--     — a separate transaction — not here.
--
-- What may and may not name 'CO' in THIS migration (each verified on PG 15.18,
-- in one transaction, immediately after the ALTER TYPE below):
--     OK    plpgsql function body  — not parsed until called
--     OK    COMMENT ON TYPE / COMMENT ON FUNCTION
--     FAILS any SELECT / DML / WHERE / cast
--     FAILS `language sql` function body — parsed at CREATE time
--     FAILS CREATE VIEW / CREATE OR REPLACE VIEW — parsed at CREATE time
--
-- That last one is the trap, and it is exactly what §2(e) invites someone to
-- do: adding `count(*) filter (where status = 'CO')` to
-- v_monthly_attendance_summary MUST happen in a later migration, not here.
-- This is also why §2 below is comments only.
--
-- Status codes now in the enum, and how the register writes them:
--   P  Present        LM Late Mark      HD Half Day       L  Leave
--   WO Week Off       OH Official Hol.  AB Absent         S  Site
--   T  Travelling     CO Comp Off  <-- new
--
-- Register-cell quirks the importer must normalise BEFORE casting to this enum
-- (the enum cannot absorb them):
--   'P '         (trailing space)  -> 'P'   — legend calls it "Present with CO"
--   'P Adjusted'                   -> 'P'
--   lower/mixed case               -> upper
--   blank / '-'                    -> no row, or 'AB' per policy
-- i.e. TRIM + UPPER every status cell, then map, then cast.
alter type attendance_status add value if not exists 'CO';


-- ============================================================================
-- §2  PAYABLE-DAYS DIVERGENCE — DOCUMENTED, NOT "FIXED"
-- ----------------------------------------------------------------------------
-- Nothing in this section executes. It exists so a human decides, because the
-- difference is real money on every payslip.
--
-- ---------------------------------------------------------------------------
-- (a) WHAT THE COMPANY'S SPREADSHEET DOES
-- ---------------------------------------------------------------------------
-- Row 5 of Sheet1 carries the payroll header row. Verbatim:
--
--     AP  =  'P+CO+HD+OH+T+S+LM'                       (row 4 labels AP 'Working Days')
--     AQ  =  'to pay for (Working days + official Holidays + WO)'
--
-- Worked example — employee block #1, Rajesh Kumar, June 2026 (30 days).
-- Counts in AG..AO:  P:22  HD:1  L:1  WO:6   (22+1+1+6 = 30 ✓)
--     AP = 22.5   which reconciles as  P(22) + 0.5*HD(1)          = 22.5
--     AQ = 28.5   which reconciles as  AP(22.5) + OH(0) + WO(6)   = 28.5
--
-- So, as actually computed by the business:
--     working_days = P + CO + LM + S + T + 0.5*HD          [ L is NOT included ]
--     PAID days    = working_days + OH + WO                [ WO IS paid       ]
--
-- Two things the worked example proves:
--   * HD contributes 0.5, not 1. The header string 'P+CO+HD+...' is shorthand;
--     the cell arithmetic halves it.
--   * L (Leave) is excluded from AP. 22 + 0.5 + 1(L) would be 23.5, not 22.5.
--
-- ---------------------------------------------------------------------------
-- (b) WHAT fn_compute_payslip DOES  (0002, unchanged by 0005)
-- ---------------------------------------------------------------------------
--     select
--       coalesce(count(*) filter (where status in ('P','LM','S','T')), 0)
--         + 0.5 * coalesce(count(*) filter (where status = 'HD'), 0)
--         + coalesce(count(*) filter (where status = 'L'), 0)
--     into v_payable ...
--
--     v_basic_e := round(e.basic_da / days_in_mo * v_payable, 2);   -- etc.
--
-- i.e.  payable = P + LM + S + T + 0.5*HD + L ,  pro-rated over days_in_month.
--
-- ---------------------------------------------------------------------------
-- (c) THE FOUR DELTAS
-- ---------------------------------------------------------------------------
--   1. WO (Week Off) — register PAYS for it; the function does not count it.
--      This is the big one. Rajesh has 6 WO in June: 6/30 of gross, every
--      month, every employee.
--   2. OH (Official Holiday) — register PAYS for it; the function does not
--      count it. Zero-impact in the June sample (OH=0), non-zero in Aug/Oct
--      (holidays table already seeds Independence Day + Gandhi Jayanti).
--   3. CO (Comp Off) — register counts it as a working day; the function has
--      never seen the value and, after §1, still ignores it (it is absent from
--      the ('P','LM','S','T') filter). An imported CO day currently pays 0.
--   4. L (Leave) — the function ADDS paid leave; the register's AP does not.
--      The function is arguably more correct here (PL/CL/SL are paid, LWP is
--      not — and the function does not distinguish them either, see (e)).
--
--   Net effect on the June sample for Rajesh:
--       register  28.5 / 30 days paid
--       function  23.5 / 30 days paid
--   A ~17% under-payment relative to the company's own sheet. Do NOT assume
--   the sheet is wrong; do NOT assume the function is wrong. Decide.
--
-- ---------------------------------------------------------------------------
-- (d) UNRESOLVED AMBIGUITY — needs a human to confirm against a real block
-- ---------------------------------------------------------------------------
--   AP's header already lists OH ('P+CO+HD+OH+T+S+LM'), and AQ then adds
--   "official Holidays" again. Read literally, OH is double-counted. The June
--   sample cannot settle it because every OH count in the verified block is 0.
--   ACTION: pull a month containing a holiday (August or October 2026) from
--   the client's register and check whether AQ = AP + OH + WO or AQ = AP + WO.
--
-- ---------------------------------------------------------------------------
-- (e) IF THE BUSINESS CONFIRMS THE REGISTER IS AUTHORITATIVE
-- ---------------------------------------------------------------------------
--   Then a FUTURE migration (0007+, separate transaction — 'CO' is legal to
--   reference there) would replace the v_payable block with roughly:
--
--     select
--       coalesce(count(*) filter (where status in ('P','LM','S','T','CO','OH','WO')), 0)
--         + 0.5 * coalesce(count(*) filter (where status = 'HD'), 0)
--         + coalesce(count(*) filter (where status = 'L'), 0)   -- keep? see (c)(4)
--     into v_payable ...
--
--   and v_monthly_attendance_summary.working_days in 0002 would need the same
--   treatment to stay consistent with the payslip.
--
--   Before doing that, settle these with HR/Finance IN WRITING:
--     * Is WO genuinely paid, or is gross already a 30-day figure that
--       implicitly includes week-offs? If the latter, adding WO to a
--       days_in_mo pro-rate DOUBLE-PAYS week-offs and the function is right.
--       (Note: v_perday := gross_monthly / days_in_mo — a 30-day divisor —
--       which is consistent with "gross already covers WO". This is the single
--       strongest argument that the current function is intentional.)
--     * Does LWP leave map to 'L' or 'AB' on import? Today 'L' is paid by the
--       function regardless of leave_kind, so an LWP day imported as 'L' is
--       paid in full. requests.leave_kind knows the difference;
--       attendance_days.status does not.
--     * Does OH get counted once (AQ = AP + WO) or twice (AQ = AP + OH + WO)?
--
--   Until all three are answered, the statutory math stays exactly as it is.
--
-- Make the divergence visible from inside the database too, so anyone reading
-- the function in psql/Studio sees the warning without finding this file:
comment on function fn_compute_payslip(uuid, uuid) is
  'Computes one draft payslip. payable_days = P+LM+S+T + 0.5*HD + L, pro-rated '
  'over days-in-month. NOTE: this DIVERGES from the company attendance '
  'register, whose header row reads AP=''P+CO+HD+OH+T+S+LM'' and AQ=''to pay '
  'for (Working days + official Holidays + WO)'' — i.e. the register also pays '
  'for WO, OH and CO, and excludes L. See migration '
  '0006_comp_off_and_import.sql §2 for the reconciliation and the open '
  'questions. Do not change this formula without written HR/Finance sign-off.';

comment on type attendance_status is
  'Attendance stamps. Mirrors the company register''s status codes. ''CO'' '
  '(Comp Off) added in 0006; it is NOT yet counted by fn_compute_payslip — see '
  'migration 0006 §2.';


-- ============================================================================
-- §3  IMPORTER SUPPORT — INDEX VERIFICATION
-- ----------------------------------------------------------------------------
-- The importer's hot path is an upsert of ~210 employees × ~30 days per month
-- (~6,300 rows), keyed on (employee_id, work_date), plus one lookup of
-- employees by code per block.
--
-- VERIFIED — no new index is required:
--
--   1. attendance_days already has  `unique (employee_id, work_date)`
--      (0001, table attendance_days). Postgres backs that constraint with an
--      implicit unique btree index, which is exactly what
--          insert ... on conflict (employee_id, work_date) do update ...
--      needs as its arbiter. Confirmed present; nothing to add.
--
--   2. employees.code is `text not null unique` (0001) — implicit unique index.
--      Covers the importer's primary match, code = 'DN' + lpad(id::text,3,'0').
--      The documented fallback (match any employees.code whose TRAILING DIGITS
--      equal the register's integer id) cannot use that index and will seq-scan
--      — acceptable at ~210 rows, and it only runs for IDs the primary match
--      missed. Do not add an expression index for it; unmatched IDs are meant
--      to be reported to the admin, not silently resolved at speed.
--
-- NOTED — pre-existing redundancy, deliberately NOT changed here:
--
--   `attendance_days_emp_idx on attendance_days(employee_id, work_date)`
--   (0001) duplicates the implicit index behind the unique constraint above.
--   Same columns, same order. It costs a second btree write on every punch and
--   every import row, and the planner will never prefer it. Dropping it is
--   safe, but it is a live-DB maintenance decision unrelated to the import
--   feature, so it stays. If someone is doing an index cleanup pass:
--       drop index if exists attendance_days_emp_idx;
--   `attendance_days_date_idx on attendance_days(work_date)` is NOT redundant
--   (leading column differs) — keep it; the register/dashboard filter by date.
-- Label the constraint in the DB itself. Looked up by definition rather than by
-- its auto-generated name: COMMENT ON has no IF EXISTS, and a hard-coded name
-- that ever drifts would abort the migration over a docstring.
do $$
declare v_con text;
begin
  select con.conname into v_con
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'attendance_days'
     and con.contype = 'u'
     and (select array_agg(att.attname::text order by att.attname)
            from unnest(con.conkey) k
            join pg_attribute att
              on att.attrelid = con.conrelid and att.attnum = k)
         = array['employee_id','work_date']
   limit 1;

  if v_con is null then
    raise exception
      'attendance_days is missing unique(employee_id, work_date) — the register '
      'importer''s ON CONFLICT arbiter. Migration 0001 should have created it.';
  end if;

  execute format(
    'comment on constraint %I on attendance_days is %L',
    v_con,
    'One resolved row per employee per day. Also the arbiter for the register '
    'importer''s ON CONFLICT upsert — do not drop.');
end $$;
