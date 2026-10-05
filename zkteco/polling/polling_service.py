"""Long-running polling and queued delivery; no employee administration."""
import math
import os
import sys
import time

from shared.hrms_delivery import build_punch_endpoint
from shared.state_files import read_employee_aliases
from .attendance_delivery import deliver_polling_events
from .attendance_poller import poll_device_attendance
from .attendance_queue import open_polling_queue


def run_polling_service(config, args, directory):
    if not config.get("deviceId") or not config.get("serialNumber") or not config.get("apiUrl"):
        raise ValueError("deviceId, serialNumber and apiUrl are required.")
    token = os.environ.get("ZKTECO_API_TOKEN") or config.get("apiToken", "")
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError(
            "Set a matching ZKTECO_API_TOKEN (at least 32 characters) "
            "in HRMS and polling config/environment."
        )
    build_punch_endpoint(config)
    interval = float(config.get("pollSeconds", 5))
    if not math.isfinite(interval) or interval < 2:
        raise ValueError("pollSeconds must be at least 2.")
    queue = open_polling_queue(directory / "queue.sqlite3", config)
    print(
        f"Bridge running for {config['deviceId']} "
        f"at {config['host']}:{config.get('port', 4370)}; polling every {interval:g}s.",
        flush=True,
    )
    cutoff = queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()[0]
    print(f"Import cutoff: {cutoff}", flush=True)
    try:
        while True:
            try:
                poll_device_attendance(queue, config)
            except Exception as error:
                print(
                    f"Device read failed; queued punches retained: {error}",
                    file=sys.stderr,
                    flush=True,
                )
                if args.once:
                    raise
            aliases = read_employee_aliases(directory, config["serialNumber"])
            deliver_polling_events(queue, config, token, aliases)
            if args.once:
                if queue.execute("SELECT COUNT(*) FROM events WHERE delivered=0").fetchone()[0]:
                    raise RuntimeError("Some punches remain queued. Resolve the reported error and retry.")
                return
            time.sleep(interval)
    finally:
        queue.close()
