"""Plan conservative name/code updates without changing biometric identities."""


def normalize(value):
    return " ".join(str(value).casefold().split())


def device_name(name, limit, encoding):
    return name.encode(encoding, errors="strict")[:limit].decode(encoding, errors="ignore")


def build_plan(roster, users, packet_size=72, encoding="UTF-8", mapping=None):
    """Return create/update/conflict rows. This function does not contact the device."""
    mapping = mapping or {}
    if not isinstance(roster, list) or not roster:
        raise ValueError("Employee roster must be a nonempty array.")
    if len({str(row["userId"]).casefold() for row in roster}) != len(roster):
        raise ValueError("Duplicate employee IDs in the roster.")
    used = set()
    occupied = {int(user["uid"]) for user in users}
    result = []
    for employee in roster:
        code, name = str(employee["userId"]), employee["name"]
        if not code or not name or len(code.encode(encoding)) > 24:
            raise ValueError(f"Invalid name or user ID for {code}.")
        if packet_size == 28 and (not code.isdecimal() or int(code) > 4294967295):
            raise ValueError(
                f"This device accepts numeric IDs only; it cannot store {code}. "
                "No users changed."
            )
        target_name = device_name(name, 8 if packet_size == 28 else 24, encoding)
        same_code = [user for user in users if str(user["user_id"]) == code]
        same_name = [
            user for user in users
            if normalize(user["name"]) in {normalize(name), normalize(target_name)}
        ]
        if code in mapping:
            matches = [user for user in users if int(user["uid"]) == int(mapping[code])]
            if len(matches) != 1 or (same_code and same_code[0]["uid"] != matches[0]["uid"]):
                raise ValueError(f"Invalid/conflicting explicit UID mapping for {code}.")
        else:
            matches = same_code or same_name
            if same_code and same_name and any(
                user["uid"] != same_code[0]["uid"] for user in same_name
            ):
                matches = same_code + same_name
        entry = {
            "userId": code,
            "fullName": name,
            "name": target_name,
            "designation": employee.get("designation", ""),
            "privilege": 0,
        }
        if target_name != name:
            entry["warning"] = (
                "Full name exceeds the device name field; "
                "full name is retained in HRMS/roster."
            )
        # A partial-name collision needs an explicit UID mapping, never a fuzzy biometric reassignment.
        candidates = [
            user for user in users
            if normalize(user["name"]) and (
                normalize(name).startswith(normalize(user["name"]))
                or normalize(user["name"]).startswith(normalize(name))
            )
        ]
        if len(matches) > 1 or (not matches and candidates):
            entry.update(
                action="conflict",
                candidates=[
                    {"uid": user["uid"], "userId": user["user_id"], "name": user["name"]}
                    for user in (matches or candidates)
                ],
            )
        elif matches:
            user = matches[0]
            if int(user["uid"]) in used:
                entry.update(action="conflict", reason="Device UID matched more than one employee.")
            else:
                used.add(int(user["uid"]))
                entry.update(
                    action="update",
                    uid=int(user["uid"]),
                    privilege=int(user["privilege"]),
                    before=user,
                )
        else:
            uid = next((candidate for candidate in range(1, 65536) if candidate not in occupied), None)
            if uid is None:
                raise ValueError("No free device UID.")
            occupied.add(uid)
            used.add(uid)
            entry.update(action="create", uid=uid)
        result.append(entry)
    return result
