# Maintenance guide

## Where to make a change

| Change                                                    | Files                                                 |
| --------------------------------------------------------- | ----------------------------------------------------- |
| Startup, subprocesses, Python executable                  | `cli/run.mjs`                                         |
| Local config and server environment                       | `cli/configure.mjs`                                   |
| Python command arguments                                  | `bridge/cli.py`, launched through `cli/device.py`     |
| Device connection and serial verification                 | `bridge/connection.py`                                |
| Device roster matching and length limits                  | `bridge/user_plan.py`                                 |
| Apply user updates and preserve biometrics                | `bridge/user_sync.py`, `bridge/inventory.py`          |
| Private snapshots and old code aliases                    | `bridge/files.py`                                     |
| Scan timestamps and duplicate identity                    | `bridge/events.py`, `server/punch-protocol.ts`              |
| Queue schema and local status                             | `bridge/queue.py`                                     |
| Reading attendance from the device                        | `bridge/poller.py`                                    |
| HTTP delivery, acknowledgements, and retries              | `bridge/delivery.py`                                  |
| Continuous polling loop                                   | `bridge/service.py`                                   |
| Workbook names, dates, and columns                        | `admin/roster/normalize-employee-names.mjs`, `dates.mjs`, `workbook.mjs` |
| Match device users to existing employees                  | `admin/link/plan-employee-links.mjs`                                 |
| Existing employee/login updates and terminal registration | `admin/link/save-employee-links.mjs`                              |
| Employee import rules and fields                          | `admin/onboard/salary-rules.mjs`, `plan.mjs`                |
| New employee defaults, leave, and onboarding tasks        | `admin/onboard/create-employee.mjs`                   |
| Device authentication and HTTP responses                  | `server/punch-endpoint.ts`, `server/punch-protocol.ts`            |
| Registered terminal and employee eligibility              | `server/employee-mapping.ts`                                  |
| Punch transaction and attendance policy integration       | `server/record-device-punch.ts`                                    |
| Internal validators and indexes                           | `server/device-collection-schema.mjs`, `server/provision-device-collections.mjs`           |

All paths in the table are relative to `zkteco/`. Administration `workflow.mjs`
files read inputs, gather snapshots, save previews, and call persistence only for
`--apply`. `verify.mjs` files perform the original post-write read-back. Importing
these modules does not automatically start a command.

Keep each module focused on its responsibility. Shared attendance policy belongs
in the existing HRMS helpers, rather than a second policy implementation here.

## Identity and retry contracts

Three IDs have different meanings:

1. The device's enrolled internal UID identifies its stored user and fingerprints.
2. The visible user ID, such as `DX060`, is the registered employee-code alias.
3. The raw attendance UID identifies a log packet. On this device it can differ
   from the enrolled UID, such as attendance UID `2054` versus enrolled UID `14`.

`server/employee-mapping.ts` selects exactly one enabled link using device ID, registered
serial number, and the visible user-ID alias. It then uses the employee's permanent
MongoDB `_id`. Ambiguous aliases, excluded employees, inactive employees, and
disabled linked accounts are refused. Employee UUIDs and login associations are
not replaced by workbook codes.

Python `event_key` and TypeScript `deviceEventId` must keep the same SHA-256 input:
`[deviceId, rawAttendanceUid, timestamp, punch, status]`. Timestamps use UTC with
milliseconds. Changing a name or visible code must not change a pending event's
identity. Do not substitute the enrolled UID into that hash.

The queue preserves its original cutoff and device/serial binding. HTTP success
is acknowledged only when the response event ID matches and its status is
`recorded`, `ignored`, or `needs_review`. A 422 failure holds later scans for that
employee while allowing other employees through. Transport and authentication
failures stop the current delivery pass and leave pending scans for retry.

## Attendance boundaries

`src/lib/punch-access.ts` defines the shared per-account web/device access policy.
The user form and guarded user action save `users.punch_access`. Missing legacy
values mean both methods; invalid values are refused. `readPunchStatus` includes
the current setting, and `recordPunch` refuses disabled web access before any write.
Device ingestion reads the linked login's current setting and acknowledges refused
web-only scans as `ignored`, without adding a punch or daily summary. Those receipts
prevent a later permission change from replaying a refused scan.

The endpoint uses one required MongoDB transaction for the employee lock, accepted
punch, daily totals, and permanent receipt. `server/record-device-punch.ts` reuses:

- `src/lib/punch.ts`: location policy, geofence classification, and daily resolution.
- `src/lib/punch-day.ts`: IST work-day and session calculations.
- `src/lib/punch-storage.ts`: serialization, prior events, and correction/sweep/payroll guards.

The existing scheduler and HR sweep remain the only sweep implementations. Late
previous-day scans and changes blocked by HR corrections, sweep closures, or
payroll locks become review receipts rather than reopening attendance. Device
coordinates come from the registered fixed office, not the incoming payload.

The integration adds `attendance_devices`, `device_employee_links`, and
`device_punch_receipts`. It continues using the application's existing
`punch_events` and `attendance_days`, with their normal supporting collections.
Collection provisioning is imported by general DB setup and by the link command;
normal bridge startup does not alter schemas or employees.

## Refactor boundaries and deferred validation

The old `scripts/zkteco-*` entry points were replaced by `zkteco/cli/`. Public npm
command names are retained. If an external Task Scheduler job used the old direct
path, update it to `node zkteco/cli/run.mjs bridge` with the repository as its
working directory. No scheduled task was installed or edited during this work.

The private `.local/zkteco/` data, MongoDB identities, device users, fingerprints,
and credentials were not changed by this source refactor. The old diagnostic
artifacts and backup reports remain private with the runtime data.

No tests, builds, lint, type checks, or live scans were run for this refactor.
Existing test files moved with their code and their imports were updated. When
testing is authorized, the existing `npm test` and `npm run test:db` commands
include the relocated JavaScript suites. The Python suite is at
`zkteco/tests/test_bridge.py`. Database tests require their existing isolated
database fixture; do not replace it with live HRMS collections.
