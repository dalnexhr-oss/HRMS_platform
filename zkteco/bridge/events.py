"""Convert IST scans to UTC and retain stable retry identities across code changes."""
import datetime as dt
import hashlib
import json

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def attendance_event(row, config):
    # Keep the raw attendance UID for retry identity. On 40-byte packets it can differ from
    # get_users().uid; the server resolves the employee from the registered user ID.
    instant = row.timestamp.replace(tzinfo=IST).astimezone(dt.timezone.utc)
    return {
        "deviceId": config["deviceId"],
        "uid": str(row.uid),
        "userId": str(row.user_id),
        "timestamp": instant.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "punch": int(row.punch),
        "status": int(row.status),
    }


def event_key(event):
    """Must match server/protocol.ts exactly; mutable userId is deliberately excluded."""
    values = [event[key] for key in ("deviceId", "uid", "timestamp", "punch", "status")]
    payload = json.dumps(values, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def remap_user(event, aliases):
    # Alias keys contain enrollment UIDs, while attendance UIDs can instead be log IDs.
    # Resolve only unambiguous old user codes across those record formats.
    targets = {
        target
        for key, target in aliases.items()
        if key.split(":", 1)[-1] == event["userId"]
    }
    if len(targets) == 1:
        return dict(event, userId=next(iter(targets)))
    return event
