"""Read terminal logs without clearing them or disabling normal scanning."""
import datetime as dt
import json

from device.device_connection import connect_device, verify_device_serial
from shared.event_identity import device_event_id
from .attendance_events import IST, build_polling_event


def poll_device_attendance(queue, config):
    connection = connect_device(config)
    try:
        verify_device_serial(connection, config)
        device_time = connection.get_time().replace(tzinfo=IST)
        if abs((device_time - dt.datetime.now(IST)).total_seconds()) > 120:
            raise ValueError(
                "Device clock differs from IST by more than two minutes. "
                "Correct the device clock before importing."
            )
        cutoff = queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()[0]
        since = dt.datetime.fromisoformat(cutoff)
        for row in connection.get_attendance():
            event = build_polling_event(row, config)
            if dt.datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")) < since:
                continue
            key = device_event_id(event)
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
        connection.disconnect()
