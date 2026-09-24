"""Durable SQLite delivery state; keep the original import cutoff on restart."""
import datetime as dt
import json
import sqlite3


def open_queue(path, config):
    """Open the existing queue without resetting its identity or import cutoff."""
    queue = sqlite3.connect(path)
    queue.execute("PRAGMA journal_mode=WAL")
    queue.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    queue.execute(
        "CREATE TABLE IF NOT EXISTS events ("
        "id TEXT PRIMARY KEY, uid TEXT NOT NULL, timestamp TEXT NOT NULL, "
        "payload TEXT NOT NULL, delivered INTEGER DEFAULT 0, result TEXT)"
    )
    queue.execute("CREATE INDEX IF NOT EXISTS pending_events ON events (delivered, timestamp, id)")
    identity = json.dumps([config["deviceId"], config["serialNumber"]])
    stored = queue.execute("SELECT value FROM meta WHERE key='identity'").fetchone()
    if stored and stored[0] != identity:
        queue.close()
        raise ValueError("This queue belongs to another device. Use a different stateDir.")
    since = config.get("since") or dt.datetime.now(dt.timezone.utc).isoformat()
    parsed = dt.datetime.fromisoformat(since.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        queue.close()
        raise ValueError("since must include a timezone offset.")
    queue.execute("INSERT OR IGNORE INTO meta VALUES ('identity', ?)", (identity,))
    queue.execute(
        "INSERT OR IGNORE INTO meta VALUES ('since', ?)",
        (parsed.astimezone(dt.timezone.utc).isoformat(),),
    )
    queue.commit()
    return queue


def queue_status(config, directory):
    """Read local delivery state without a terminal connection or any new delivery."""
    path = directory / "queue.sqlite3"
    if not path.exists():
        print(json.dumps({
            "deviceId": config.get("deviceId"),
            "queueCreated": False,
            "message": (
                "The bridge has not created a queue yet. "
                "No terminal connection was attempted."
            ),
        }))
        return
    queue = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        counts = dict(queue.execute(
            "SELECT delivered, COUNT(*) FROM events GROUP BY delivered"
        ).fetchall())
        cutoff = queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()
        rows = queue.execute(
            "SELECT payload, result FROM events "
            "WHERE delivered=0 ORDER BY timestamp LIMIT 10"
        ).fetchall()
        pending = [
            {
                "userId": json.loads(payload)["userId"],
                "timestamp": json.loads(payload)["timestamp"],
                "lastAttempt": json.loads(result) if result else None,
            }
            for payload, result in rows
        ]
        reviews = queue.execute(
            "SELECT payload, result FROM events WHERE delivered=1 "
            "AND json_extract(result, '$.status')='needs_review' "
            "ORDER BY timestamp DESC LIMIT 10"
        ).fetchall()
        print(json.dumps({
            "deviceId": config.get("deviceId"),
            "queueCreated": True,
            "since": cutoff[0] if cutoff else None,
            "pending": counts.get(0, 0),
            "acknowledged": counts.get(1, 0),
            "oldestPending": pending,
            "recentReviews": [
                {"userId": json.loads(payload)["userId"], "result": json.loads(result)}
                for payload, result in reviews
            ],
        }, indent=2))
    finally:
        queue.close()
