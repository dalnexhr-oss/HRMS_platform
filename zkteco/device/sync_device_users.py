"""Apply a reviewed user plan, preserving credentials and fingerprint templates."""
import json
import time
from pathlib import Path

from .device_connection import connect_device, verify_device_serial
from shared.state_files import save_employee_aliases, save_private_json
from .device_inventory import read_fingerprint_digests, serialize_device_user
from .user_sync_plan import build_user_sync_plan


def sync_device_users(config, args, directory):
    """Preview by default; --apply writes only after identity and backup checks."""
    employees = json.loads(Path(args.employees).read_text(encoding="utf-8"))
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8")) if args.mapping else {}
    connection = connect_device(config)
    disabled = False
    try:
        serial = verify_device_serial(connection, config)
        users = [serialize_device_user(user) for user in connection.get_users()]
        plan = build_user_sync_plan(
            employees, users, connection.user_packet_size, config.get("encoding", "UTF-8"), mapping
        )
        output = directory / f"sync-plan-{time.time_ns()}.json"
        save_private_json(output, {"serialNumber": serial, "employees": plan})
        print(json.dumps({
            "plan": str(output),
            "updates": sum(row["action"] == "update" for row in plan),
            "creates": sum(row["action"] == "create" for row in plan),
            "conflicts": sum(row["action"] == "conflict" for row in plan),
            "shortenedNames": [row["userId"] for row in plan if "warning" in row],
        }))
        if not args.apply:
            return
        if any(row["action"] == "conflict" for row in plan):
            raise ValueError(
                "Resolve the plan's identity conflicts with --mapping before applying. "
                "No device users changed."
            )
        # Briefly stop scans so the identity snapshot and writes cannot race enrollment.
        disabled = True
        connection.disable_device()
        current = [serialize_device_user(user) for user in connection.get_users()]
        if sorted(current, key=lambda u: u["uid"]) != sorted(users, key=lambda u: u["uid"]):
            raise ValueError("Device users changed after planning. Rerun sync.")
        attendance = [
            {
                "uid": str(row.uid),
                "userId": str(row.user_id),
                "timestamp": row.timestamp.isoformat(),
                "punch": row.punch,
                "status": row.status,
            }
            for row in connection.get_attendance()
        ]
        backup = directory / f"backup-{time.time_ns()}.json"
        fingerprints = read_fingerprint_digests(connection)
        save_private_json(backup, {
            "serialNumber": serial,
            "users": users,
            "attendance": attendance,
            "fingerprintDigests": fingerprints,
        })
        save_employee_aliases(directory, serial, plan)
        connection.read_sizes()
        finger_count = connection.fingers
        for row in plan:
            before = row.get("before", {})
            expected = {
                "name": row["name"],
                "user_id": row["userId"],
                "privilege": row["privilege"],
                "password": before.get("password", ""),
                "group_id": before.get("group_id", ""),
                "card": before.get("card", 0),
            }
            connection.set_user(uid=row["uid"], **expected)
            # Keep the internal UID, password, group and card; no delete/enroll/template command.
            actual = next(
                (serialize_device_user(user) for user in connection.get_users() if user.uid == row["uid"]),
                None,
            )
            if not actual or any(actual[key] != value for key, value in expected.items()):
                raise RuntimeError(
                    f"Device read-back failed for {row['userId']}. "
                    f"Stop and inspect backup {backup}."
                )
        connection.read_sizes()
        if connection.fingers != finger_count:
            raise RuntimeError(f"Fingerprint count changed unexpectedly. Inspect backup {backup}.")
        if read_fingerprint_digests(connection) != fingerprints:
            raise RuntimeError(f"Fingerprint contents changed unexpectedly. Inspect backup {backup}.")
        final_users = {user.uid: serialize_device_user(user) for user in connection.get_users()}
        changed_uids = {row["uid"] for row in plan}
        for original in users:
            if (
                original["uid"] not in changed_uids
                and final_users.get(original["uid"]) != original
            ):
                raise RuntimeError(f"An unlisted user changed unexpectedly. Inspect backup {backup}.")
        print(
            f"Verified {len(plan)} users. New users have normal privilege; "
            f"existing privileges and biometric UIDs retained. Backup: {backup}."
        )
    finally:
        try:
            if disabled:
                connection.enable_device()
        finally:
            connection.disconnect()
