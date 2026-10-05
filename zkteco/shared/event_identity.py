"""Stable event identities shared with server/punch-protocol.ts."""
import hashlib
import json


def device_event_id(event):
    if event.get("source") == "adms":
        values = ["adms", *[event[key] for key in (
            "deviceId", "userId", "timestamp", "punch", "status"
        )]]
    else:
        # Preserve every previously stored pull receipt and queue identifier.
        values = [event[key] for key in ("deviceId", "uid", "timestamp", "punch", "status")]
    payload = json.dumps(values, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def resolve_employee_alias(event, aliases):
    # Alias keys use enrollment UIDs, while attendance UIDs can be log IDs.
    # Resolve only an unambiguous old user code across those record formats.
    targets = {
        target for key, target in aliases.items()
        if key.split(":", 1)[-1] == event["userId"]
    }
    return dict(event, userId=next(iter(targets))) if len(targets) == 1 else event
