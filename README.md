# Dalnex HRMS — Admin Portal

Attendance & payroll admin portal for Dalnex (two branches: Pune · Maharashtra,
Vadodara · Gujarat). Converted from the single-file design prototype
`dalnex-admin-portal.html` into **Next.js (App Router) + TypeScript** backed by
**Supabase Postgres**. The visual design is preserved verbatim in `globals.css`.

## Stack

- **Next.js 15** (App Router, Server Components, Server Actions)
- **TypeScript** (strict)
- **Supabase** — Postgres + Auth + Row Level Security
- `@supabase/ssr` for cookie-based sessions across server/client

## Screens

| Route         | What it shows                                                            |
| ------------- | ------------------------------------------------------------------------ |
| `/today`      | Live dashboard: present/absent KPIs, punch log, celebrations, marks, feed |
| `/register`   | Monthly attendance register (employee × day grid, expandable punches)     |
| `/payroll`    | Payslips with PF / ESIC / Professional-tax breakdown + manual adjustments |
| `/employees`  | Roster + search + Add-employee drawer                                      |
| `/approvals`  | Pending leave / outdoor-duty requests                                      |
| `/policies`   | Admin: create/publish company policies shown on employee dashboards       |
| `/login`      | Shared sign-in for admin/staff and employees (role-based redirect)         |
| `/me`         | Employee self-service dashboard: personal snapshot + company policies      |
| `/holidays` `/notices` `/helpdesk` `/settings` | Placeholder screens                    |

## Project layout

```
src/
  app/
    (portal)/            # authenticated shell (sidebar + topbar)
      today/ register/ payroll/ employees/ approvals/ …
    layout.tsx           # fonts + globals
    globals.css          # design tokens & styles (ported from the prototype)
  components/            # shell/, ui/, register/, payroll/, employees/
  lib/
    supabase/            # browser, server & service-role clients + middleware
    queries.ts           # data access (Supabase)
    format.ts constants.ts
    actions/             # Server Actions (mutations)
  types/                 # database.ts (schema types) + domain.ts (UI shapes)
supabase/
  migrations/            # 0001 schema · 0002 views/fns · 0003 RLS · 0004 auth ·
                         # 0005 payroll fixes · 0006 comp-off/import ·
                         # 0007 payable-days/targets · 0008 auth hardening
  seed.sql               # June 2026 data ported from the prototype
  HOSTED_SETUP.md        # applying migrations via the Supabase SQL Editor (no CLI)
  config.toml
```

## Getting started

```bash
npm install

# 1. Database (local Supabase stack via Docker)
npx supabase start          # boots Postgres + Studio + Auth
npx supabase db reset       # applies migrations/*.sql then seed.sql
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY

# 3. App
npm run dev                 # http://localhost:3000  (redirects to /login)
```

Supabase is required to run the app. With missing env vars every request fails
closed (HTTP 503) rather than serving anything — there is no offline/no-database
fallback.

## Auth & roles

Sign-in is Supabase email/password. A `profiles` row carries the user's `role`
and, for employees, an `employee_id` linking to their `employees` record.

| Role                                                              | Lands on | Sees                                           |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------- |
| `super_admin` / `admin` / `hr` / `manager` / `viewer`             | `/today` | The full admin portal                          |
| `employee`                                                        | `/me`    | Own attendance/pay snapshot + company policies |

Write access narrows inside the portal. `_guard.ts` `WRITE_ROLES` is
`super_admin`/`admin`/`hr`: a `viewer` may read but never write, and a `manager`
reads the portal without the attendance, payroll or import write paths. User
administration is tiered on top of that (`ROLE_TIER` in `lib/actions/users.ts`) —
you may only grant, or act on, a role at or below your own, so only a
`super_admin` can create, promote to, or delete another `super_admin`.

The first `super_admin` must be promoted directly in SQL, since the rule above
means no lower tier can mint one:

```sql
update profiles set role = 'super_admin' where id = '<auth-user-uuid>';
```

`middleware.ts` refreshes the session and routes each role to its area (employees
can't reach the portal; staff can't reach `/me`). Seed accounts (both `password123`):

```
admin@dalnex.test      → admin portal
employee@dalnex.test   → employee dashboard (linked to DN001 Rajesh Kumar)
```

Row Level Security (migration `0004`) tightens employee access: an employee reads
only their own attendance, payslips, requests and leave — plus any **published**
policy. Staff read everything; batch jobs use the service-role key.

### Managing users

Admin/HR add login accounts at **`/users`** (create with a temporary password, set
roles, link an employee, set/reset passwords). Only an **admin** can create or grant
the `admin` role. Signed-in users change their own password at **`/users` → My
account** (`/account`), employees on `/me`; anyone can use **Forgot your password?**
on `/login`.

> `/users` calls Supabase's admin API, so the server needs `SUPABASE_SECRET_KEY`
> (`sb_secret_…`) — or the legacy `SUPABASE_SERVICE_ROLE_KEY` — in `.env.local`.
> Without it the screen explains what's missing instead of showing an empty list.

## Company policies

Admins create/publish policies at `/policies`. Published policies appear on every
employee's `/me` dashboard, where each can be **acknowledged** ("Mark as read");
acknowledgements are recorded per employee in `policy_acknowledgements`.

## Data model highlights

- **`employees`** — salary structure with a CHECK that `basic_da + hra + special = gross`.
- **`attendance_days`** — one resolved row per employee per day (status + in/out +
  worked minutes); raw `punch_events` kept as the audit source.
- **`payroll_runs` / `payslips`** — draft → in_review → locked → paid. Payslips are
  computed by `fn_compute_run()` from attendance + salary + statutory rules:
  - PF = 12% of earned Basic+DA
  - ESIC = 0.75% of earned gross, only when monthly gross ≤ ₹21,000
  - Professional tax resolved from `pt_slabs` (`fn_professional_tax`)
- **RLS** — read for any authenticated staff/viewer; writes for `admin`/`hr`/`manager`.
  Batch jobs (night sweep, payroll compute) use the service-role key and bypass RLS.

## Regenerating DB types

```bash
npm run db:types            # supabase gen types typescript --local > src/types/database.ts
```

## Notes & assumptions

- `fn_compute_payslip` recomputes payroll values from first principles
  (rounding may differ by ₹1 on pro-rated lines).
- Auth is live: `src/middleware.ts` refreshes the session and gates every route by
  role. New self-service logins default to the non-portal `employee` role
  (migration `0008`); staff/`viewer` access is only ever assigned deliberately.
- The original prototype is kept at `dalnex-admin-portal.html` for reference.
```
