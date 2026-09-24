"""Long-running polling and queued delivery; no employee administration."""
import math
import os
import sys
import time

from .delivery import api_endpoint, deliver
from .files import read_aliases
from .poller import poll_device
from .queue import open_queue


def bridge(config, args, directory):
    if not config.get("deviceId") or not config.get("serialNumber") or not config.get("apiUrl"):
        raise ValueError("deviceId, serialNumber and apiUrl are required.")
    token = os.environ.get("ZKTECO_API_TOKEN") or config.get("apiToken", "")
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError(
            "Set a matching ZKTECO_API_TOKEN (at least 32 characters) "
            "in HRMS and bridge config/environment."
        )
    api_endpoint(config)
    interval = float(config.get("pollSeconds", 5))
    if not math.isfinite(interval) or interval < 2:
        raise ValueError("pollSeconds must be at least 2.")
    queue = open_queue(directory / "queue.sqlite3", config)
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
                poll_device(queue, config)
            except Exception as error:
                print(
                    f"Device read failed; queued punches retained: {error}",
                    file=sys.stderr,
                    flush=True,
                )
                if args.once:
                    raise
            aliases = read_aliases(directory, config["serialNumber"])
            deliver(queue, config, token, aliases)
            if args.once:
                if queue.execute("SELECT COUNT(*) FROM events WHERE delivered=0").fetchone()[0]:
                    raise RuntimeError("Some punches remain queued. Resolve the reported error and retry.")
                return
            time.sleep(interval)
    finally:
        queue.close()
