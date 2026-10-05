"""Start the ADMS receiver, validate its configuration, or inspect its queue."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adms.attendance_queue import AttendanceQueue
from adms.receiver_config import load_receiver_config
from adms.receiver_service import serve_attendance
from shared.runtime_dependencies import check_runtime_dependencies


def run_adms_command():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("serve", "check", "status"))
    parser.add_argument("--config", default=".local/zkteco/adms/config.json")
    arguments = parser.parse_args()
    config, token = load_receiver_config(arguments.config, require_token=arguments.command != "status")
    if arguments.command == "status":
        if not (Path(config["stateDir"]) / "adms.sqlite3").exists():
            print(json.dumps({"deviceId": config["deviceId"], "queueCreated": False}))
        else:
            print(json.dumps(AttendanceQueue(config).read_status(), indent=2))
        return
    check_runtime_dependencies({"waitress"})
    if arguments.command == "check":
        print(f"ADMS config valid: {config['listenHost']}:{config['listenPort']}, device {config['deviceId']}.")
        print("No device connection, database write, or listener was started.")
        return
    serve_attendance(config, token)


if __name__ == "__main__":
    try:
        run_adms_command()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
