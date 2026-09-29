"""Device inspection, user synchronization, bridge service, and queue status commands."""
import argparse
import json
from pathlib import Path

from .device_inventory import inspect_device
from .device_lock import DeviceLock
from .attendance_queue import queue_status
from .attendance_bridge import bridge
from .sync_device_users import sync_users


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "sync-users", "bridge", "status"))
    parser.add_argument("--config", default=".local/zkteco/config.json")
    parser.add_argument("--roster", default=".local/zkteco/employees.json")
    parser.add_argument(
        "--mapping",
        help="JSON object mapping employee codes to existing internal device UIDs",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the verified roster sync; otherwise only plan",
    )
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    directory = Path(config.get("stateDir", ".local/zkteco"))
    if args.command == "status":
        queue_status(config, directory)
        return
    directory.mkdir(parents=True, exist_ok=True)
    with DeviceLock(directory):
        if args.command == "inspect":
            inspect_device(config, directory)
        elif args.command == "sync-users":
            sync_users(config, args, directory)
        else:
            bridge(config, args, directory)
