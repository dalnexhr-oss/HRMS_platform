"""Convert IST scans to UTC and retain stable retry identities across code changes."""
import datetime as dt

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def build_polling_event(row, config):
    # Keep the raw attendance UID for retry identity. On 40-byte packets it can differ from
    # get_users().uid; the server resolves the employee from the registered user ID.
    punched_at = row.timestamp.replace(tzinfo=IST).astimezone(dt.timezone.utc)
    return {
        "deviceId": config["deviceId"],
        "uid": str(row.uid),
        "userId": str(row.user_id),
        "timestamp": punched_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "punch": int(row.punch),
        "status": int(row.status),
    }
