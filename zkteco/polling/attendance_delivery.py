"""Deliver polling events using the shared HTTP client and existing receipt identities."""
import datetime as dt
import json
import sys
import urllib.error

from shared.event_identity import resolve_employee_alias
from shared.hrms_delivery import describe_delivery_error, send_punch_event


def deliver_polling_events(queue, config, token, aliases):
    blocked_user_ids = set()
    pending_events = queue.execute(
        "SELECT id, uid, payload FROM events WHERE delivered=0 ORDER BY timestamp, id"
    ).fetchall()
    for event_id, attendance_uid, payload in pending_events:
        event = resolve_employee_alias(json.loads(payload), aliases)
        user_id = event["userId"]
        if user_id in blocked_user_ids:
            continue
        try:
            acknowledgement = send_punch_event(event, config, token)
            if acknowledgement["eventId"] != event_id:
                raise ValueError("Unexpected ingestion acknowledgement.")
            queue.execute(
                "UPDATE events SET delivered=1, result=? WHERE id=?",
                (json.dumps(acknowledgement), event_id),
            )
            queue.commit()
            print(f"{event_id[:12]}: {acknowledgement['status']}", flush=True)
        except (OSError, ValueError) as error:
            blocked_user_ids.add(user_id)
            message = describe_delivery_error(error)
            failure = {"error": message, "attemptedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
            queue.execute(
                "UPDATE events SET result=? WHERE id=? AND delivered=0",
                (json.dumps(failure), event_id),
            )
            queue.commit()
            print(
                f"Delivery pending for user {user_id} (attendance UID {attendance_uid}): {message}",
                file=sys.stderr, flush=True,
            )
            if not isinstance(error, urllib.error.HTTPError) or error.code != 422:
                break
