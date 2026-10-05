"""Atomic SQLite acceptance, replay detection, and ordered delivery retries."""
import datetime as dt
import json
from pathlib import Path
import sqlite3
import time

from shared.event_identity import device_event_id
from .receiver_config import parse_timestamp


class QueueCapacityExceeded(Exception):
    pass


class AttendanceQueue:
    def __init__(self, config):
        self.config = config
        directory = Path(config["stateDir"])
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "adms.sqlite3"
        with self.open_connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                    payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
                    result TEXT, received_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS delivery_order ON events(state, timestamp, id);
                CREATE INDEX IF NOT EXISTS employee_order ON events(user_id, state, timestamp, id);
            """)
            identity = json.dumps([config[key] for key in (
                "deviceId", "serialNumber", "since", "timezoneOffsetMinutes"
            )])
            old = connection.execute("SELECT value FROM meta WHERE key='identity'").fetchone()
            if old and old[0] != identity:
                raise ValueError("ADMS state belongs to another identity, cutoff or timezone. Restore its config or use a new stateDir.")
            connection.execute("INSERT OR IGNORE INTO meta VALUES ('identity', ?)", (identity,))
            connection.execute("INSERT OR IGNORE INTO meta VALUES ('stamp', '0')")

    def open_connection(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA synchronous=FULL")
        return ManagedSqliteConnection(connection)

    def accept_upload(self, events, stamp):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        cutoff = parse_timestamp(self.config["since"])
        with self.open_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for event in events:
                state = "before_cutover" if parse_timestamp(event["timestamp"]) < cutoff else "pending"
                connection.execute(
                    "INSERT OR IGNORE INTO events (id,user_id,timestamp,payload,state,received_at) VALUES (?,?,?,?,?,?)",
                    (device_event_id(event), event["userId"], event["timestamp"], json.dumps(event), state, now),
                )
            pending = connection.execute("SELECT COUNT(*) FROM events WHERE state='pending'").fetchone()[0]
            if pending > self.config["maxPendingRecords"]:
                raise QueueCapacityExceeded("Pending attendance queue is full; upload was not acknowledged.")
            if stamp is not None:
                # Preserve the device's opaque cursor only after all rows are durable.
                connection.execute("UPDATE meta SET value=? WHERE key='stamp'", (stamp,))
            connection.execute("INSERT OR REPLACE INTO meta VALUES ('lastUploadAt', ?)", (now,))
        return len(events)

    def read_upload_cursor(self):
        with self.open_connection() as connection:
            return connection.execute("SELECT value FROM meta WHERE key='stamp'").fetchone()[0]

    def read_pending_events(self, limit=100):
        with self.open_connection() as connection:
            return connection.execute("""
                SELECT e.* FROM events e
                WHERE e.state='pending' AND e.next_attempt<=?
                AND NOT EXISTS (
                    SELECT 1 FROM events older
                    WHERE older.user_id=e.user_id AND older.state='pending'
                    AND (older.timestamp<e.timestamp OR (older.timestamp=e.timestamp AND older.id<e.id))
                )
                ORDER BY e.timestamp,e.id LIMIT ?
            """, (time.time(), limit)).fetchall()

    def mark_delivered(self, key, result):
        with self.open_connection() as connection:
            connection.execute(
                "UPDATE events SET state='delivered',attempts=attempts+1,result=? WHERE id=?",
                (json.dumps(result), key),
            )

    def schedule_retry(self, key, message):
        with self.open_connection() as connection:
            connection.execute(
                "UPDATE events SET attempts=attempts+1,next_attempt=?,result=? WHERE id=?",
                (time.time() + self.config["retrySeconds"], message[:500], key),
            )

    def read_status(self):
        with self.open_connection() as connection:
            counts = {row[0]: row[1] for row in connection.execute("SELECT state,COUNT(*) FROM events GROUP BY state")}
            last = connection.execute("SELECT value FROM meta WHERE key='lastUploadAt'").fetchone()
            return {
                "deviceId": self.config["deviceId"], "counts": counts,
                "lastUploadAt": last[0] if last else None, "since": self.config["since"],
            }


class ManagedSqliteConnection:
    """sqlite3's transaction context alone does not close the connection."""
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.__enter__()
        return self.connection

    def __exit__(self, *args):
        try:
            return self.connection.__exit__(*args)
        finally:
            self.connection.close()
