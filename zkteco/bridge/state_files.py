"""Private JSON snapshots and serial-bound employee code aliases."""
import json
import os
import time
from pathlib import Path


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def read_aliases(directory, serial):
    path = directory / "user-aliases.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data["serialNumber"] != serial:
        raise ValueError("User aliases belong to a different terminal. Use its original stateDir.")
    return data["users"]


def save_aliases(directory, serial, plan):
    aliases = read_aliases(directory, serial)
    for row in plan:
        if "before" not in row:
            continue
        prefix = f"{row['uid']}:"
        for key in list(aliases):
            if key.startswith(prefix):
                aliases[key] = row["userId"]
        aliases[prefix + str(row["before"]["user_id"])] = row["userId"]
    temporary = directory / f"user-aliases-{time.time_ns()}.tmp"
    save_json(temporary, {"serialNumber": serial, "users": aliases})
    os.replace(temporary, directory / "user-aliases.json")
