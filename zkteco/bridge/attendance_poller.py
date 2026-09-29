"""Read terminal logs without clearing them or disabling normal scanning."""
import datetime as dt
import json

from .device_connection import connect, verify_serial
from .attendance_events import IST, attendance_event, event_key


def poll_device(queue, config):
    conn = connect(config)
    try:
        verify_serial(conn, config)
        device_time = conn.get_time().replace(tzinfo=IST)
        if abs((device_time - dt.datetime.now(IST)).total_seconds()) > 120:
            raise ValueError(
                "Device clock differs from IST by more than two minutes. "
                "Correct the device clock before importing."
            )
        cutoff = queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()[0]
        since = dt.datetime.fromisoformat(cutoff)
        for row in conn.get_attendance():
            event = attendance_event(row, config)
            if dt.datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")) < since:
                continue
            key = event_key(event)
            queue.execute(
                "INSERT OR IGNORE INTO events (id, uid, timestamp, payload) VALUES (?, ?, ?, ?)",
                (key, event["uid"], event["timestamp"], json.dumps(event)),
            )
            # If a missing HRMS link was corrected by a device code update, retry with the new code.
            queue.execute(
                "UPDATE events SET payload=? WHERE id=? AND delivered=0",
                (json.dumps(event), key),
            )
        queue.commit()
    finally:
        conn.disconnect()
