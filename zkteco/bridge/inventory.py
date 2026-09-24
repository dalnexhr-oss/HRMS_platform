"""Read device users and biometric digests; export a credential-free inventory."""
import hashlib
import json
import time

from .connection import connect
from .files import save_json


def user_record(user):
    fields = ("uid", "name", "privilege", "password", "group_id", "user_id", "card")
    return {key: getattr(user, key) for key in fields}


def fingerprint_signatures(conn):
    return sorted(
        (
            int(finger.uid),
            int(finger.fid),
            int(finger.valid),
            hashlib.sha256(finger.template).hexdigest(),
        )
        for finger in conn.get_templates()
    )


def inspect_device(config, directory):
    conn = connect(config)
    try:
        users = [user_record(user) for user in conn.get_users()]
        serial = str(conn.get_serialnumber()).strip()
        output = directory / f"inventory-{time.time_ns()}.json"
        # Passwords/card numbers stay out of the inventory and console.
        inventory = {
            "serialNumber": serial,
            "name": conn.get_device_name(),
            "firmware": conn.get_firmware_version(),
            "deviceTime": conn.get_time().isoformat(),
            "userPacketSize": conn.user_packet_size,
            "users": [
                {key: user[key] for key in ("uid", "user_id", "name", "privilege")}
                for user in users
            ],
        }
        save_json(output, inventory)
        print(json.dumps({
            "inventory": str(output),
            "serialNumber": serial,
            "users": len(users),
            "userPacketSize": conn.user_packet_size,
        }))
    finally:
        conn.disconnect()
