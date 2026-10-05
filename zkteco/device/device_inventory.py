"""Read device users and biometric digests; export a credential-free inventory."""
import hashlib
import json
import time

from .device_connection import connect_device
from shared.state_files import save_private_json


def serialize_device_user(user):
    fields = ("uid", "name", "privilege", "password", "group_id", "user_id", "card")
    return {key: getattr(user, key) for key in fields}


def read_fingerprint_digests(connection):
    return sorted(
        (
            int(finger.uid),
            int(finger.fid),
            int(finger.valid),
            hashlib.sha256(finger.template).hexdigest(),
        )
        for finger in connection.get_templates()
    )


def inspect_device(config, directory):
    connection = connect_device(config)
    try:
        users = [serialize_device_user(user) for user in connection.get_users()]
        serial = str(connection.get_serialnumber()).strip()
        output = directory / f"inventory-{time.time_ns()}.json"
        # Passwords/card numbers stay out of the inventory and console.
        inventory = {
            "serialNumber": serial,
            "name": connection.get_device_name(),
            "firmware": connection.get_firmware_version(),
            "deviceTime": connection.get_time().isoformat(),
            "userPacketSize": connection.user_packet_size,
            "users": [
                {key: user[key] for key in ("uid", "user_id", "name", "privilege")}
                for user in users
            ],
        }
        save_private_json(output, inventory)
        print(json.dumps({
            "inventory": str(output),
            "serialNumber": serial,
            "users": len(users),
            "userPacketSize": connection.user_packet_size,
        }))
    finally:
        connection.disconnect()
