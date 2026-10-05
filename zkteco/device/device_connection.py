"""pyzk connection and hardware identity verification."""


def connect_device(config):
    """Open a short-lived pyzk session; callers own disconnect in a finally block."""
    from zk import ZK

    if not config.get("host"):
        raise ValueError("Set the device host in the local JSON config.")
    return ZK(
        config["host"],
        port=int(config.get("port", 4370)),
        timeout=10,
        password=int(config.get("password", 0)),
        force_udp=bool(config.get("forceUdp", False)),
        ommit_ping=True,
        encoding=config.get("encoding", "UTF-8"),
    ).connect()


def verify_device_serial(connection, config):
    serial = str(connection.get_serialnumber()).strip()
    if not config.get("serialNumber") or serial != str(config["serialNumber"]).strip():
        raise ValueError(
            f"Device serial mismatch/unconfigured. Observed serial: {serial}. "
            "Run inspect and set serialNumber."
        )
    return serial
