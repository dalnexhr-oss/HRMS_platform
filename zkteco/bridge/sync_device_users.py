"""Apply a reviewed user plan, preserving credentials and fingerprint templates."""
import json
import time
from pathlib import Path

from .device_connection import connect, verify_serial
from .state_files import save_aliases, save_json
from .device_inventory import fingerprint_signatures, user_record
from .user_sync_plan import build_plan


def sync_users(config, args, directory):
    """Preview by default; --apply writes only after identity and backup checks."""
    roster = json.loads(Path(args.roster).read_text(encoding="utf-8"))
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8")) if args.mapping else {}
    conn = connect(config)
    disabled = False
    try:
        serial = verify_serial(conn, config)
        users = [user_record(user) for user in conn.get_users()]
        plan = build_plan(
            roster, users, conn.user_packet_size, config.get("encoding", "UTF-8"), mapping
        )
        output = directory / f"sync-plan-{time.time_ns()}.json"
        save_json(output, {"serialNumber": serial, "employees": plan})
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
        conn.disable_device()
        current = [user_record(user) for user in conn.get_users()]
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
            for row in conn.get_attendance()
        ]
        backup = directory / f"backup-{time.time_ns()}.json"
        fingerprints = fingerprint_signatures(conn)
        save_json(backup, {
            "serialNumber": serial,
            "users": users,
            "attendance": attendance,
            "fingerprintDigests": fingerprints,
        })
        save_aliases(directory, serial, plan)
        conn.read_sizes()
        finger_count = conn.fingers
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
            conn.set_user(uid=row["uid"], **expected)
            # Keep the internal UID, password, group and card; no delete/enroll/template command.
            actual = next(
                (user_record(user) for user in conn.get_users() if user.uid == row["uid"]),
                None,
            )
            if not actual or any(actual[key] != value for key, value in expected.items()):
                raise RuntimeError(
                    f"Device read-back failed for {row['userId']}. "
                    f"Stop and inspect backup {backup}."
                )
        conn.read_sizes()
        if conn.fingers != finger_count:
            raise RuntimeError(f"Fingerprint count changed unexpectedly. Inspect backup {backup}.")
        if fingerprint_signatures(conn) != fingerprints:
            raise RuntimeError(f"Fingerprint contents changed unexpectedly. Inspect backup {backup}.")
        final_users = {user.uid: user_record(user) for user in conn.get_users()}
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
                conn.enable_device()
        finally:
            conn.disconnect()
