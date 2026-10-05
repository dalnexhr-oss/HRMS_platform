"""Legacy ZKTeco Attendance PUSH text protocol; no biometric or command provisioning."""
import datetime as dt
import re


def parse_attendance_upload(body, config):
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("ATTLOG must contain UTF-8 text.") from error
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) > config["maxBatchRecords"]:
        raise ValueError("Too many ATTLOG records in one upload.")
    events = []
    zone = dt.timezone(dt.timedelta(minutes=config["timezoneOffsetMinutes"]))
    for number, line in enumerate(lines, 1):
        fields = line.split("\t")
        if len(fields) < 4 or len(line) > 2048:
            raise ValueError(f"Malformed ATTLOG row {number}.")
        user_id, timestamp, punch, verification = fields[:4]
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", user_id):
            raise ValueError(f"Invalid employee code in ATTLOG row {number}.")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", timestamp):
            raise ValueError(f"Invalid timestamp in ATTLOG row {number}.")
        at = dt.datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=zone)
        if at.year < 2000:
            raise ValueError(f"Invalid year in ATTLOG row {number}.")
        if any(not re.fullmatch(r"\d{1,3}", value) or int(value) > 255 for value in (punch, verification)):
            raise ValueError(f"Invalid punch/verification value in ATTLOG row {number}.")
        # ADMS has a user PIN but no SDK attendance UID. Never invent an SDK UID.
        events.append({
            "source": "adms", "deviceId": config["deviceId"], "userId": user_id,
            "timestamp": at.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "punch": int(punch), "status": int(verification),
        })
    return events


def build_handshake_response(config, stamp):
    # Per the 2020 Attendance PUSH specification, half-hour timezones use minutes.
    offset = config["timezoneOffsetMinutes"]
    timezone = offset // 60 if offset % 60 == 0 and -720 < offset < 720 else offset
    return "\n".join((
        f"GET OPTION FROM: {config['serialNumber']}",
        f"Stamp={stamp}", f"ATTLOGStamp={stamp}",
        "ErrorDelay=30", "Delay=10", "TransTimes=00:00", "TransInterval=1",
        "TransFlag=TransData AttLog", f"TimeZone={timezone}",
        "Realtime=1", "Encrypt=0", "ServerVer=2.2.14", "PushProtVer=2.2.14",
        "PushOptionsFlag=0", "",
    ))
