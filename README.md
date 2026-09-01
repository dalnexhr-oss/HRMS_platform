# Dalnex HRMS — Admin Portal

Attendance & payroll admin portal for Dalnex (Pune · Maharashtra, Vadodara ·
Gujarat). **Next.js (App Router) + TypeScript** backed by **MongoDB**. The
visual design is preserved verbatim in `globals.css`.

Originally built on Supabase Postgres; the migration to MongoDB is complete and
nothing in `src/` imports a Supabase package. `supabase/migrations/` is kept as
the reference specification for the schema and the business rules — several
files still cite it, and it is the authority when behaviour is in question.

## Stack

- **Next.js 15** (App Router, Server Components, Server Actions)
- **TypeScript** (strict)
- **MongoDB** — collections, `$jsonSchema` validators, GridFS for files
- **jose** — HS256 session JWTs, verified in edge middleware
- Passwords hashed with scrypt from `node:crypto` (no native module to build)

## Getting started

```bash
npm install

# 1. MongoDB must be running. The URI names the database:
#      MONGO_URI=mongodb://localhost:27018/hrms
#    A SINGLE-NODE REPLICA SET is strongly recommended — see below.

# 2. Create .env.local
cat > .env.local <<'EOF'
MONGO_URI=mongodb://localhost:27018/hrms
AUTH_SECRET=<32+ random characters>
SESSION_MAX_AGE_DAYS=365
CRON_SECRET=<16+ random characters>
EOF
#    Generate a secret with:
#      node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Collections, validators, indexes, and the first admin
npm run db:setup -- --admin --email you@dalnex.com

# 4. Run
npm run dev                 # http://localhost:3000 (redirects to /login)
```

### Replica set, and why it matters

A standalone `mongod` cannot do **multi-document transactions** or **change
streams**. Both are used:

| Needs a replica set        | Where                                              |
| -------------------------- | -------------------------------------------------- |
| Transactions               | payroll runs, punch in/out, exit F&F, branch rename |
| Change streams             | live helpdesk chat (`/api/helpdesk/<id>/stream`)    |

The app degrades rather than breaking on a standalone: writes still happen but
are not atomic (with a loud one-time warning), and the chat falls back to
polling. Converting is three steps and is best done while the database is empty:

```
1. add to mongod.cfg:   replication:
                          replSetName: rs0
2. restart mongod
3. mongosh --port 27018 --eval "rs.initiate()"
4. append to MONGO_URI: ?replicaSet=rs0&directConnection=true
```

`npm run db:setup` reports which mode the server is in every time it runs.

## Scripts

| Command                 | What it does                                                |
| ----------------------- | ----------------------------------------------------------- |
| `npm run dev`           | Development server                                          |
| `npm run build`         | Production build                                            |
| `npm run typecheck`     | `tsc --noEmit`                                              |
| `npm run db:setup`      | Create collections, validators and indexes (idempotent)     |
| `npm run db:setup -- --admin --email …` | …and create/reset the first super admin     |
| `npm run db:gen-schema` | Re-derive `scripts/schema.generated.mjs` from the SQL DDL   |

## Project layout

```
src/
  app/
    (portal)/            # authenticated staff shell (sidebar + topbar)
    (employee)/me/       # employee self-service
    api/
      files/…            # serves GridFS objects, session-checked per request
      helpdesk/…/stream  # SSE: change stream, or polling on a standalone
      cron               # runs scheduled jobs; bearer-secret authenticated
  lib/
    auth/                # jwt · session · password · reset-tokens · middleware
    db/
      mongo.ts           # connection + withTransaction
      collections.ts     # collection registry + document shapes
      scope.ts           # who is asking (was auth.uid/auth_role/is_staff)
      policies.ts        # per-collection access rules  ← the security boundary
      repo.ts            # applies them to every query
      money.ts           # Decimal128 + exact paise arithmetic
      views.ts           # the 5 SQL views as aggregation pipelines
      functions.ts       # the plpgsql functions, in TypeScript
      payroll.ts         # fn_compute_payslip
      scheduler.ts       # the 7 pg_cron jobs
      gridfs.ts          # file storage
      pgcompat.ts        # PostgREST-shaped adapter (see below)
    queries.ts           # data access
    actions/             # Server Actions (mutations)
scripts/
  db-setup.mjs           # applies the schema
  schema.mjs             # generated translation + hand-written overrides
  gen-schema.mjs         # regenerates the translation from the SQL
supabase/migrations/     # kept as the reference specification
```

### About `pgcompat.ts`

Roughly 500 call sites were written in PostgREST's idiom
(`.from(t).select(c).eq(a, b)` returning `{ data, error }`). Rewriting each one
by hand is not a reliable operation at that volume — the failure mode is a
single dropped `.eq()` that silently widens a query, with no compiler check to
catch it. So that idiom is translated to MongoDB instead.

Crucially it runs **through** `repo.ts`, so every query it issues still has the
collection's access policy ANDed in. The adapter cannot be used to escape
scoping. It is not the destination: the auth layer, org core, payroll, views and
scheduled jobs all use `scoped()` directly, and files still on the adapter can
be moved over one at a time.

## Auth & roles

Sign-in is email + password. A single `users` collection carries credentials,
role and, for employees, `employee_id` — what used to be `auth.users` (GoTrue)
plus `public.profiles` plus `public.user_tab_access`.

| Role                                  | Lands on | Sees                                           |
| ------------------------------------- | -------- | ---------------------------------------------- |
| `super_admin` / `admin` / `hr`        | `/today` | The full admin portal                          |
|  / `employee`                | `/me`    | Own attendance/pay snapshot + company policies |

**Sessions are year-long JWTs, and they are revocable.** An expiry a year out
means a token cannot be recalled by waiting, so every session carries a `ver`
claim checked against `users.token_version` on each request. Bumping that
counter invalidates every token an account holds — which is what makes sign-out,
password change, and disabling a login actually take effect. Set
`SESSION_MAX_AGE_DAYS` to change the lifetime.

`users.disabled` blocks sign-in and kills live sessions immediately; it is the
right tool for a departing employee, because it preserves the account and its
audit trail where deleting does not.

User administration is tiered (`ROLE_TIER` in `lib/actions/users.ts`): you may
only grant, or act on, a role at or below your own, so only a `super_admin` can
create, promote to, or delete another `super_admin`. Create the first one with
`npm run db:setup -- --admin --email …`.

## Where Row Level Security went

Postgres enforced 114 RLS policies across 48 tables, and that was the security
boundary — not the middleware. MongoDB has no per-document authorization, so the
rules moved to **`src/lib/db/policies.ts`**, which `repo.ts` applies to every
query. Three properties are worth knowing:

- **Declarative.** Each entry mirrors the SQL policy it replaces, so the two can
  be read side by side.
- **Fail closed.** A collection with no entry is denied to everyone. Porting a
  collection *requires* deciding who may read it.
- **Read, write and insert are separate.** An employee may read their own
  reimbursement claim but only edit it while it is pending — one predicate
  cannot express that, and collapsing them is how "edit an approved claim" gets
  written.

Filters combine with `$and`, never a spread: a spread would let a caller's own
filter on `employee_id` overwrite the policy's constraint on the same field.

## Data model notes

- **Money** is `Decimal128`, never a JS number, and all arithmetic runs in
  integer **paise** (`lib/db/money.ts`). Postgres `numeric` is exact; float64 is
  not, and a payroll run is thousands of operations.
- **Calendar days** (`work_date`, `date_of_joining`) are `"YYYY-MM-DD"` strings,
  not BSON Dates. A BSON Date is a UTC instant; round-tripping a calendar day
  through one shifts it in IST. Timestamps that really are instants stay Dates.
- **Times** (`punch_in`, `punch_out`) are `"HH:MM"` — BSON has no time type.
- **Keys are the original UUIDs**, so every foreign-key value carried over
  unchanged.
- **Display names are denormalised** (`employees.branch_name`,
  `activity_log.actor_name`) because list screens read them constantly and they
  change once a year. Renaming a branch refreshes the copies in a transaction.
- **Constraints** live in `$jsonSchema` validators, plus `$expr` for the
  cross-field ones — `gross_monthly = basic_da + hra + special_allowance` is
  still enforced by the database, and a one-paisa mismatch is rejected.

## Scheduled jobs

The seven pg_cron jobs are now plain functions in `lib/db/scheduler.ts`, fired
by whatever you point at `/api/cron`:

```
0 2 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron
```

`?job=<name>` runs one job. Every job claims its work in `cron_run_log` (unique
on `job, run_key`), so a retry or a double fire does the work once and sends no
duplicate notifications. Without `CRON_SECRET` the endpoint refuses rather than
defaulting to open.

## Files

Stored in GridFS in the same database, under the original
`<employeeId>/<uuid>-<filename>` keys, so every stored path still resolves.

There are **no signed URLs**. Supabase minted URLs that carried their own
authorization, so a leaked link was a leaked file until it expired. Files are
served by `/api/files/<bucket>/<path>`, which checks the session and re-verifies
ownership on every request — a copied link is inert for anyone else.

## Payroll

`fn_compute_payslip` is ported in `lib/db/payroll.ts`, line by line from
migration 0042. Two rounding behaviours are carried over deliberately because
they change the figures:

- Postgres `round()` rounds **half away from zero**; `Math.round` rounds half
  up, which differs for negatives.
- The shortfall uses **`floor()`, not `round()`** — the SQL is explicit that this
  matches the company register.

Components are rounded **individually and then summed**, not rounded as a total.

```
working days (col AP) = P + CO + OH + T + S + LM + 0.5 × HD
payable days (col AQ) = working days + WO       (week-offs ARE paid)
PF   = 12% of earned Basic+DA
ESIC = 0.75% employee / 3.25% employer, only when monthly gross ≤ ₹21,000
PT   = resolved from pt_slabs (month-specific beats gender-specific beats broadest)
```

## Notes

- `supabase/migrations/` is documentation now, not something to run. It remains
  the reference for what the rules are.
- The original prototype is kept at `dalnex-admin-portal.html` for reference.
