"""Run device inspection, employee synchronization, or optional attendance polling."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from device.device_inventory import inspect_device
from device.sync_device_users import sync_device_users
from polling.attendance_queue import print_polling_status
from polling.polling_service import run_polling_service
from shared.runtime_dependencies import check_runtime_dependencies
from shared.state_directory_lock import StateDirectoryLock


def run_device_command():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "sync-users", "bridge", "status"))
    parser.add_argument("--config", default=".local/zkteco/config.json")
    parser.add_argument("--employees", default=".local/zkteco/employees.json")
    parser.add_argument("--mapping", help="JSON mapping employee codes to existing device UIDs")
    parser.add_argument("--apply", action="store_true", help="Apply the reviewed employee sync")
    parser.add_argument("--once", action="store_true", help="Poll and deliver once, then exit")
    arguments = parser.parse_args()
    config = json.loads(Path(arguments.config).read_text(encoding="utf-8-sig"))
    state_directory = Path(config.get("stateDir", ".local/zkteco"))
    if arguments.command == "status":
        print_polling_status(config, state_directory)
        return
    check_runtime_dependencies({"pyzk"})
    state_directory.mkdir(parents=True, exist_ok=True)
    with StateDirectoryLock(state_directory):
        if arguments.command == "inspect":
            inspect_device(config, state_directory)
        elif arguments.command == "sync-users":
            sync_device_users(config, arguments, state_directory)
        else:
            run_polling_service(config, arguments, state_directory)


if __name__ == "__main__":
    try:
        run_device_command()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
