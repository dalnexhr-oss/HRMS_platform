"""Validate the receiver's identity, network boundary, and immutable import cutoff."""
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import re

from shared.hrms_delivery import build_punch_endpoint


def parse_timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("since must include a timezone offset.")
    return parsed.astimezone(dt.timezone.utc)


def validate_receiver_config(config, require_token=True):
    config = dict(config)
    for key in ("deviceId", "serialNumber"):
        if not isinstance(config.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", config[key]):
            raise ValueError(f"Set a valid {key} before starting ADMS.")
    if config["serialNumber"] == "SET_FROM_DEVICE_INSPECTION":
        raise ValueError("Replace the example serialNumber with the terminal's actual serial.")
    build_punch_endpoint(config)
    ipaddress.ip_address(config.get("listenHost", "127.0.0.1"))
    defaults = {
        "listenPort": (8081, 1, 65535),
        "retrySeconds": (10, 2, 3600),
        "maxBodyBytes": (1048576, 1024, 4194304),
        "maxBatchRecords": (5000, 1, 20000),
        "maxPendingRecords": (100000, 1, 1000000),
        "timezoneOffsetMinutes": (330, -720, 840),
    }
    for key, (default, lower, upper) in defaults.items():
        config.setdefault(key, default)
        value = config[key]
        if type(value) is not int or not lower <= value <= upper:
            raise ValueError(f"{key} must be an integer between {lower} and {upper}.")
    config.setdefault("listenHost", "127.0.0.1")
    sources = config.get("allowedSources")
    if not isinstance(sources, list) or not sources or len(sources) > 32:
        raise ValueError("allowedSources must contain the device IP, VPN subnet, or trusted local proxy IP.")
    for source in sources:
        network = ipaddress.ip_network(source, strict=False)
        if network.prefixlen == 0:
            raise ValueError("An unrestricted allowedSources network is not permitted.")
    if not isinstance(config.get("stateDir"), str) or not config["stateDir"]:
        raise ValueError("stateDir is required for durable ADMS storage.")
    config["since"] = parse_timestamp(config["since"]).isoformat()
    token = os.environ.get("ZKTECO_API_TOKEN") or config.get("apiToken", "")
    if require_token and (not isinstance(token, str) or len(token) < 32):
        raise ValueError("Set the same ZKTECO_API_TOKEN (at least 32 characters) in ADMS and HRMS.")
    return config, token


def load_receiver_config(path, require_token=True):
    return validate_receiver_config(json.loads(Path(path).read_text(encoding="utf-8-sig")), require_token)


def is_allowed_source(address, config):
    try:
        source = ipaddress.ip_address(address)
        if isinstance(source, ipaddress.IPv6Address) and source.ipv4_mapped:
            source = source.ipv4_mapped
        return any(source in ipaddress.ip_network(net, strict=False) for net in config["allowedSources"])
    except ValueError:
        return False
