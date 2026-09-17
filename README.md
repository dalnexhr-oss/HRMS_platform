# Dalnex HRMS — Admin Portal

Attendance and payroll portal for Dalnex in Pune and Vadodara, built with
Next.js App Router, TypeScript, and MongoDB.

Collection validators and indexes live in `scripts/schema-base.mjs` and
`scripts/schema.mjs`. Insert defaults live in `src/lib/db/defaults.ts`.
All three files are maintained by hand.

See [CONTRIBUTING.md](CONTRIBUTING.md) for naming, formatting, comment conventions,
and development checks.

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
#    Use a replica set for transactions and change streams; see below.

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

| Needs a replica set | Where                                               |
| ------------------- | --------------------------------------------------- |
| Transactions        | payroll runs, punch in/out, exit F&F, branch rename |
| Change streams      | live helpdesk chat (`/api/helpdesk/<id>/stream`)    |

The app degrades rather than breaking on a standalone: writes still happen but
are not atomic (with a loud one-time warning), and the chat falls back to
polling. To configure a replica set:

```
1. add to mongod.cfg:   replication:
                          replSetName: rs0
2. restart mongod
3. mongosh --port 27018 --eval "rs.initiate()"
4. append to MONGO_URI: ?replicaSet=rs0&directConnection=true
```

`npm run db:setup` reports which mode the server is in every time it runs.

## Scripts

| Command                                 | What it does                                            |
| --------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                           | Development server                                      |
| `npm run build`                         | Production build                                        |
| `npm run typecheck`                     | `tsc --noEmit`                                          |
| `npm run lint`                          | ESLint checks                                           |
| `npm run format`                        | Format maintained source and documentation              |
| `npm run format:check`                  | Check formatting without writing files                  |
| `npm run check:names`                   | Validate source filenames and directories               |
| `npm test`                              | Route and access compatibility tests (Node.js 22.15+)   |
| `npm run check`                         | Formatting, naming, lint, types, and tests              |
| `npm run db:setup`                      | Create collections, validators and indexes (idempotent) |
| `npm run db:setup -- --admin --email …` | …and create/reset the first super admin                 |

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
      scope.ts           # caller identity and role flags
      policies.ts        # per-collection access rules  ← the security boundary
      repo.ts            # applies them to every query
      money.ts           # Decimal128 + exact paise arithmetic
      views.ts           # scoped aggregation views
      functions.ts       # the payroll/leave routines, in TypeScript
      payroll.ts         # payslip computation
      scheduler.ts       # the 7 scheduled jobs
      gridfs.ts          # file storage
      postgrest-compat.ts # PostgREST-style query adapter
    queries.ts           # data access
    actions/             # Server Actions (mutations)
  types/                 # client-safe shared types
scripts/
  db-setup.mjs           # applies the schema
  schema-base.mjs        # base collection validators and indexes
  schema.mjs             # schema overrides and buildSchema()
tests/                  # route and access compatibility tests
```

### About `postgrest-compat.ts`

The adapter translates PostgREST-style calls such as
`.from(t).select(c).eq(a, b)` into MongoDB operations and returns `{ data, error }`.
It uses `repo.ts`, which combines every query with the collection's access policy.
Native database code can use `scoped()` directly.

## Auth & roles

Sign-in uses email and password. The `users` collection holds credentials,
role, per-tab access, and an optional `employee_id`.

| Role                           | Lands on | Sees                                             |
| ------------------------------ | -------- | ------------------------------------------------ |
| `super_admin` / `admin` / `hr` | `/today` | The full admin portal                            |
| `employee` / `intern`          | `/me`    | Own attendance/pay snapshot and company policies |

**Sessions are year-long JWTs, and they are revocable.** An expiry a year out
means a token cannot be recalled by waiting, so every session carries a `ver`
claim checked against `users.token_version` on each request. Bumping that
counter invalidates every token an account holds — which is what makes sign-out,
password change, and disabling a login actually take effect. Set
`SESSION_MAX_AGE_DAYS` to change the lifetime.

`users.disabled` blocks sign-in and kills live sessions immediately. Deactivating
an employee keeps their linked login disabled for possible reactivation. Deleting
an inactive employee removes their linked accounts from Users and clears their
password-reset tokens. The employee identity, attendance, payroll, and other
historical records are retained for historical joins.

User administration is tiered (`tierOf` in `lib/roles.ts`): you may
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
  collection _requires_ deciding who may read it.
- **Read, write and insert are separate.** An employee may read their own
  reimbursement claim but only edit it while it is pending — one predicate
  cannot express that, and collapsing them is how "edit an approved claim" gets
  written.

Filters combine with `$and`, never a spread: a spread would let a caller's own
filter on `employee_id` overwrite the policy's constraint on the same field.

## Data model notes

- **Money** is `Decimal128`, never a JS number, and all arithmetic runs in
  integer  (`lib/db/money.ts`). Postgres `numeric` is exact; float64 is
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

The attendance sweep does not wait to be called. `src/instrumentation.ts` arms
an in-process timer at boot that runs `attendance-auto-punch-out` at **00:00
IST** every night, so a stock `next start` closes yesterday's open days with
nothing external configured. It sweeps once on startup too, so a night the
server was off is still caught the next time it comes up.

Set `DISABLE_INTERNAL_CRON=1` to turn that off and drive everything from
`/api/cron` instead. Running both is safe — they compete for the same
`cron_run_log` claim, and the loser does nothing. That claim IS the
idempotency guarantee, and it is the unique index that enforces it, so a
database that never had `npm run db:setup` run against it has no lock at all.

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

- Update `scripts/schema-base.mjs` or `scripts/schema.mjs` when adding fields,
  and add any insert default in `src/lib/db/defaults.ts` with the matching BSON type.
  Apply schema changes with `npm run db:setup`.
