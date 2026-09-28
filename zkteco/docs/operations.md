# ZKTeco attendance integration

Run the Python bridge on the computer connected to the terminal over Ethernet. The Next.js server may run on the same computer or be hosted elsewhere. This integration uses `pyzk 0.9` and the ZKTeco network protocol, normally port 4370. Install the Python dependency on a new bridge computer with `python -m pip install -r zkteco/requirements.txt`.

Device and web punches share `punch_events`, the existing `attendance_days` summaries, and IST session calculations. Web session checks, location policy and buttons remain in place. Device requests use a separate secret, never an employee login. Device punches have source `zkteco`; their coordinates come from the server's registered fixed terminal location and are labelled `location_source: fixed_terminal`. They use the same branch/company geofence classifier as web punches. All punch writes, duplicate receipts and attendance totals commit together in MongoDB transactions, so a replica set is required as it is for existing web punches.

## Start the application and bridge

The connected terminal is configured locally in `.local/zkteco/config.json`. After configuration, choose one startup method:

| Situation                                                      | Command                 |
| -------------------------------------------------------------- | ----------------------- |
| Develop locally with device punching                           | `npm run dev:device`    |
| Run an already built local production app with device punching | `npm run start:device`  |
| Run the bridge beside an existing or hosted HRMS server        | `npm run device:bridge` |
| View queued scans and errors without contacting the machine    | `npm run device:status` |

The combined commands run Next.js on the port specified in the bridge's localhost `apiUrl`. Do not also start a second copy of Next.js on that port. The usual `npm run dev` and `npm start` still work independently. A failed bridge does not stop the web app. Ctrl+C stops the combined session. Set `ZKTECO_PYTHON` to an absolute Python executable path if `python` is not on PATH; set `ZKTECO_CONFIG` to use a different local configuration file.

The bridge is a long-running process; keep it running while employees scan. It is not embedded in Next.js request handling, so an offline terminal does not block web punches. No persistent background job is installed automatically.

## Configure

1. Run `npm run device:roster -- --file "C:/Users/dalne/Downloads/Employee.xlsx" --check-hrms`. This reads the workbook and creates `.local/zkteco/employees.json` plus a private HRMS matching plan. It extracts ID, cleaned name, designation and email for identity matching, without phone numbers or birth dates. Employee.xlsx is the identity source of truth. Use the linking step below to update both employee and login display names together. Missing HRMS employees need normal onboarding (branch, joining date, salary and other required fields); the scripts do not fabricate payroll records or create logins.
2. Copy the example below to `.local/zkteco/config.json`, set the device IP, then run `npm run device:inspect`. Set `serialNumber` to the returned hardware serial. Inspection is read-only. Enter the actual communications password if configured on the device; `0` is the library default.
3. Run `npm run device:configure`. It creates or reuses a random shared secret, saves the server's device settings in `.env.local`, and saves the matching secret in the local bridge configuration without printing it. It preserves the other environment settings and does not connect to the device or database. Restart an existing Next.js server to load the new settings. For first-time configuration without a local config, pass `-- --host DEVICE_IP --serial DEVICE_SERIAL`. To change the app destination, pass `-- --api-url https://hrms.example.com`.
4. For a hosted server, set `ZKTECO_DEVICE_ID`, `ZKTECO_API_TOKEN`, `ZKTECO_PUNCH_MODE`, and `ZKTECO_DEBOUNCE_SECONDS` in its deployment environment using the values in your private `.env.local`; restart/redeploy it separately. Local configuration alone cannot change a hosted server's environment. Keep all secrets out of source control.

```json
{
  "host": "DEVICE_IP",
  "port": 4370,
  "password": 0,
  "forceUdp": false,
  "serialNumber": "SERIAL_FROM_INSPECT",
  "deviceId": "office-terminal",
  "apiUrl": "http://localhost:3000",
  "apiToken": "RANDOM_SECRET_MATCHING_THE_SERVER",
  "pollSeconds": 5,
  "stateDir": ".local/zkteco"
}
```

Use HTTPS when HRMS is hosted remotely. The terminal clock must be set to IST; the bridge converts scans to UTC. It refuses reads if the device clock is more than two minutes off. It never changes the device clock automatically.

## Link HRMS identities and register the terminal location

After a read-only device inspection, run `npm run device:link -- --inventory .local/zkteco/inventory-TIMESTAMP.json --file "C:/Users/dalne/Downloads/Employee.xlsx"`. The preview reads every employee and user record, excluding password hashes, and saves a private backup and matching plan. It compares employee codes, full names and workbook email against employee/login records. Ambiguous identities require an explicit JSON map of workbook code to the existing MongoDB employee ID, passed with `--mapping PATH` (this is different from the device UID map).

Append `--branch Pune --apply` only when Pune is the terminal's actual office. This saves its fixed coordinates from the existing branch, provisions the three internal device collections and applies the resolved identity links in a transaction. It does not import attendance. Without a confirmed location, a location-required policy keeps scans queued. Unresolved employees are listed without modifying them. `--defer CODE` defers an unresolved choice; `--ignore-employee EMPLOYEE_UUID` permanently excludes that employee record from this terminal's identity import and attendance processing. Exclusions persist in the terminal registry.

The linking script changes only employee code, full name and designation, and the linked user's display name. MongoDB employee IDs, `users.employee_id`, passwords, roles, account status and existing attendance/payroll references remain intact. The enrolled UID + terminal serial is bound to the permanent employee ID in `device_employee_links`, with permitted visible user IDs. Attendance delivery resolves a unique registered user-ID alias within that terminal and serial; ambiguous aliases are refused. The raw attendance packet UID can differ from the enrolled user UID on the K45 Pro. It is retained for duplicate detection and audit, never used to select an employee. Disabled linked logins and inactive/deleted employees cannot receive device attendance. Active employees without a web login can still scan, but there is no login to receive a notification.

For this installation, Deepa's DX012 binding uses the employee behind `deepa.rade@dalnex.com`. The separate DN002/admin identity must remain excluded and untouched. Sanjyot's existing record is corrected to DX059 / Sanjyot Solanke. Lakshya's existing terminal ID remains an alias for his HRMS record because he is not listed in the workbook.

For explicitly authorized bulk onboarding, use `npm run device:onboard -- --file "C:/Users/dalne/Downloads/Employee.xlsx" --inventory .local/zkteco/inventory-TIMESTAMP.json --rules .local/zkteco/employee-import-rules.json --branch Pune` to prepare the private import plan, then append `--apply`. The rules file contains `gross`, `basic`, `hra`, `special` as rupee strings, the explicitly confirmed `femaleCodes`, and `otherGender: "Male"`. These are supplied instructions, never guesses from names. The current authorized amounts are gross 40000, basic 25000, HRA 15000 and special allowance 0. Female codes are DX003, DX012, DX040, DX067, DX068 and DX069; the other workbook employees are male as instructed.

The onboarding import creates only missing employee codes, preserves IDs on existing records, imports workbook contacts and dates, and writes device links in the same transaction. Optional blank cells do not erase existing fields. New employees receive the existing active/employee defaults, the confirmed branch, current-year paid-leave balances under the configured annual allowance, and onboarding tasks if an active template exists. Existing balances, payroll history and login accounts are preserved. It does not create login credentials or send welcome messages. Keep the private pre-import snapshot for recovery; rerunning uses the same existing employee codes rather than creating duplicates.

## Synchronize terminal users

Run `npm run device:sync-users` to inspect the generated plan, then `npm run device:sync-users -- --apply` to apply it. Stop the bridge and other terminal administration tools during identity updates.

Matching uses employee codes and exact names, including the device's length-limited display name. Partial or duplicate names stop the apply operation. Resolve those using a private JSON object such as `{"DX007": 7}` where `7` is the existing **internal UID**, and pass `--mapping .local/zkteco/uid-map.json`. Do not confuse internal UID with the visible user ID. Review code matches where an existing name differs before applying.

The sync changes only the visible employee ID and name for existing users. It preserves their internal UIDs, passwords, privileges, cards, groups, and fingerprints. New users receive unused internal UIDs and privilege `0` (normal user). Unlisted device users remain unchanged. Names exceeding the installed library's 24-byte field are explicitly shortened in the plan; full names and designations remain in the roster and linked HRMS records. Old 28-byte user-packet devices allow only numeric IDs and shorter names; alphanumeric IDs are rejected before any writes. A serial-bound alias file maps old user IDs in retained logs and pending deliveries to the corrected code without changing their retry identity.

Before writing, the script saves the existing user metadata and attendance logs in `.local/zkteco/backup-*.json`. These contain private device data: protect that directory and exclude it from sharing. It briefly disables scanning during the update and re-enables scanning in `finally`, reads each user back, and compares fingerprint counts and hashes. It never deletes users, clears attendance or writes fingerprint templates. Newly added users still need fingerprint/card enrollment at the terminal. If a write fails, the script stops with its backup location; the terminal may have a partially applied roster, so inspect it and rerun after resolving the error. An operating-system file lock prevents a second bridge or user-sync process from using the same state directory concurrently.

## Repeated device configuration error

`Device is not configured for this endpoint` means the incoming `deviceId` differs from the running HRMS server's `ZKTECO_DEVICE_ID`, or that server setting is missing. It occurs before employee lookup; the reported employee code and attendance UID are not the cause. For this installation, `.local/zkteco/config.json` and `.env.local` must both identify `office-terminal`. Keep the existing bridge ID because the queue and MongoDB employee links belong to it.

For a local server, `npm run device:configure` preserves the saved bridge ID and repairs the matching server settings without contacting the terminal or database. Restart HRMS after changing its environment. If using two terminals, restart `npm run dev` and `npm run device:bridge`; no third process is needed. Hosted servers need the matching setting in their own deployment environment. A delivery failure stays queued and retries on each poll. Do not delete the queue, rename the terminal, or recreate employees to clear this error.

## Run attendance delivery

`npm run device:bridge` reads scans every five seconds by default and delivers them to the authenticated `/api/devices/zkteco/punch` endpoint. For unattended operation, configure Windows Task Scheduler to run `node zkteco/cli/run.mjs bridge` at startup with this project's directory as the working directory and an account that can read its local config. The server must also be running and reachable. Neither normal attendance polling nor startup changes terminal users, fingerprints, privileges, or device settings.

The default server setting `ZKTECO_PUNCH_MODE=toggle` alternates in/out based on the employee's current state, including web punches. Use `ZKTECO_PUNCH_MODE=device` if users choose a direction on the terminal: codes 0/3/4 are in, 1/2/5 are out. Confirm those codes on the actual terminal before switching. `ZKTECO_DEBOUNCE_SECONDS=60` ignores repeated scans within one minute of the last accepted punch; set 0–300 seconds as appropriate.

On its first run, the bridge starts at the current time. To import earlier logs, set an explicit offset-bearing `since`, for example `2026-09-28T00:00:00+05:30`, before creating the queue. The queue retains that initial cutoff across restarts. Existing terminal logs are never cleared. Device polling continues without disabling scanning. A durable SQLite queue retries failed deliveries; server receipts ensure repeats do not create attendance twice. Use a separate state directory per terminal and one bridge process per terminal.

Unlinked/inactive HRMS employees remain queued and retry after onboarding and identity linking. A failed event holds later events for the same canonical user ID while other employees can continue, even when each scan has a different packet UID. `npm run device:status` reports pending scans, their last delivery errors, and recent review outcomes from the local queue without contacting the terminal. Run the linking preview again after onboarding additional employees. The integration does not invent missing employee, branch, or payroll information.

Running `npm run dev` in one terminal and `npm run device:bridge` in another is sufficient; no third process is needed. After bridge code changes, stop only the bridge with Ctrl+C and restart the same command. Next.js development mode reloads server code automatically. The saved SQLite queue and import cutoff survive restarts. Do not delete the queue or recreate device users to resolve an attendance UID/enrollment UID mismatch.

`device_punch_receipts` stores `recorded`, `ignored`, or `needs_review`, with the raw scan, employee/login IDs, work date and reason. Its schema and indexes are defined in `zkteco/server/schema.mjs` and composed by `scripts/schema.mjs`; the linking script applies only the three integration collections. Receipts do not expire because they prevent old device logs being counted again. A delayed scan older than an accepted same-day punch, a scan from a previous IST day, an unsupported code, or an impossible direction is retained for HR review. Payroll seals, HR corrections and sweep closures also prevent automatic attendance changes. Review these receipts in MongoDB and use the application's normal HR attendance correction workflow. A review receipt acknowledges retention, not a successful punch. The bridge prints these outcomes and retains each acknowledgement in SQLite.

## Existing attendance and night-sweep collections

| Collection                                                             | Integration use                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `employees`, `users`                                                   | Permanent employee identity and existing login association; visible code/name corrections retain these references.                               |
| `branches`, `settings`                                                 | The same location requirement, geofence and configured auto punch-out time used by web attendance.                                               |
| `punch_events`                                                         | Immutable accepted punches, with employee ID, timestamp, direction, source and terminal metadata.                                                |
| `attendance_days`                                                      | The same daily status/times/worked minutes used by the register, employee screen and payroll. Existing leave/comp-off/HR statuses are preserved. |
| `payroll_runs`                                                         | Locked, paid or attendance-sealed months refuse new attendance changes.                                                                          |
| `cron_run_log`                                                         | The existing scheduler's per-day sweep claim; device ingestion does not start a separate sweep.                                                  |
| `notifications`, `activity_log`                                        | Existing sweep notices and audit entries; identity reconciliation also records an audit entry.                                                   |
| `attendance_devices`, `device_employee_links`, `device_punch_receipts` | Registered fixed location, durable identity bindings and deduplication/review records.                                                           |

Web punches, device punches and both sweeps serialize their writes on the same employee within transactions. A day reopened after lunch has a null summary punch-out so the sweep sees the final open session. The sweep adds completed sessions to the final session's configured auto-close duration, excluding breaks. It retains the existing night-shift wrap and legacy summary fallback. It does not insert a fake terminal punch. The web clock displays corrected/swept totals and stops timing a session after a manual closure. Leave balances, late-mark deductions, payroll calculations and payslips continue through their existing HRMS workflows rather than being duplicated per scan.

The employee clock refreshes on focus and every 15 seconds while visible. A new device punch also refreshes its history and the employee card's server-rendered totals. The attendance board and daily summaries use the existing application logic. A repeat delivery cannot create another event. Scans ahead of the server's clock remain queued until their timestamp is valid, keeping device clock skew from introducing future punches into a web session.

## Validation status

Tests, builds, lint and type checks are deferred at the user's request. The final implementation and a physical mixed web/device punch cycle still need to be exercised when testing is authorized. Configuration does not start attendance ingestion automatically.

SDK reference: [pyzk project and API](https://github.com/fananimi/pyzk).
