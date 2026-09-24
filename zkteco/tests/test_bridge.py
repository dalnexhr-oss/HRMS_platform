import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import delivery
from bridge.events import attendance_event, event_key, remap_user
from bridge.files import read_aliases, save_aliases
from bridge.queue import open_queue
from bridge.user_plan import build_plan



class DeviceTests(unittest.TestCase):
    def user(self, **changes):
        return dict({"uid": 7, "user_id": "7", "name": "Person Name", "privilege": 14,
                     "password": "pin", "group_id": "1", "card": 123}, **changes)

    def test_existing_identity_keeps_internal_uid_and_existing_privilege(self):
        plan = build_plan([{"userId": "DX007", "name": "Person Name"}], [self.user()])
        self.assertEqual(plan[0]["uid"], 7)
        self.assertEqual(plan[0]["privilege"], 14)
        self.assertEqual(plan[0]["before"]["password"], "pin")

    def test_new_employee_does_not_reuse_a_device_uid(self):
        plan = build_plan([{"userId": "DX008", "name": "Other Employee"}], [self.user(uid=1)])
        self.assertEqual(plan[0]["uid"], 2)
        self.assertEqual(plan[0]["action"], "create")
        self.assertEqual(plan[0]["privilege"], 0)

    def test_partial_or_duplicate_names_need_mapping(self):
        roster = [{"userId": "DX007", "name": "Person Name"}]
        users = [self.user(name="Person")]
        self.assertEqual(build_plan(roster, users)[0]["action"], "conflict")
        self.assertEqual(build_plan(roster, users, mapping={"DX007": 7})[0]["action"], "update")
        self.assertEqual(build_plan(roster, [self.user(), self.user(uid=9)])[0]["action"], "conflict")

    def test_old_devices_reject_alphanumeric_ids_before_writes(self):
        with self.assertRaises(ValueError):
            build_plan([{"userId": "DX007", "name": "Person Name"}], [], 28)

    def test_multibyte_name_limit_and_full_name_are_explicit(self):
        name = "é" * 14
        entry = build_plan([{"userId": "DX007", "name": name}], [])[0]
        self.assertEqual(len(entry["name"].encode()), 24)
        self.assertEqual(entry["fullName"], name)
        self.assertIn("warning", entry)

    def test_ist_conversion_and_stable_retry_key(self):
        row = SimpleNamespace(uid=7, user_id="DX007", timestamp=dt.datetime(2026, 9, 28, 9, 30), punch=0, status=1)
        event = attendance_event(row, {"deviceId": "office"})
        self.assertEqual(event["timestamp"], "2026-09-28T04:00:00.000Z")
        self.assertEqual(event_key(event), event_key(dict(event, userId="updated")))

    def test_queue_keeps_cutoff_after_restart_and_rejects_other_device(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "queue.sqlite3"
            config = {"deviceId": "office", "serialNumber": "123", "since": "2026-09-28T00:00:00+05:30"}
            queue = open_queue(path, config)
            cutoff = queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()[0]
            queue.close()
            queue = open_queue(path, dict(config, since="2026-10-01T00:00:00Z"))
            self.assertEqual(queue.execute("SELECT value FROM meta WHERE key='since'").fetchone()[0], cutoff)
            queue.close()
            with self.assertRaises(ValueError):
                open_queue(path, dict(config, serialNumber="456"))

    def test_outage_leaves_durable_queue_undelivered(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {"deviceId": "office", "serialNumber": "123", "apiUrl": "http://localhost:3000"}
            queue = open_queue(Path(directory) / "queue.sqlite3", config)
            queue.execute("INSERT INTO events (id,uid,timestamp,payload) VALUES ('event','7','2026-09-28',?)",
                          (json.dumps({"uid": "7", "userId": "DX007"}),))
            queue.commit()
            with patch.object(delivery.urllib.request, "build_opener", side_effect=OSError("offline")):
                delivery.deliver(queue, config, "token")
            self.assertEqual(queue.execute("SELECT delivered FROM events").fetchone()[0], 0)
            queue.close()

    def test_old_logs_keep_event_identity_after_employee_id_update(self):
        event = {"deviceId": "office", "uid": "7", "userId": "7", "timestamp": "2026-09-28T04:00:00.000Z", "punch": 0, "status": 1}
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            plan = build_plan([{"userId": "DX007", "name": "Person Name"}], [self.user()])
            save_aliases(directory, "123", plan)
            aliases = read_aliases(directory, "123")
            updated = remap_user(event, aliases)
            self.assertEqual(updated["userId"], "DX007")
            self.assertEqual(event_key(updated), event_key(event))
            # The same old user code can arrive with a raw attendance UID, not enrollment UID 7.
            self.assertEqual(remap_user(dict(event, uid="2054"), aliases)["userId"], "DX007")
            self.assertEqual(remap_user(event, {"7:7": "DX007", "9:7": "DX009"})["userId"], "7")
            with self.assertRaises(ValueError):
                read_aliases(directory, "other-device")

    def test_failed_user_holds_later_scans_with_different_attendance_uids(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {"deviceId": "office", "serialNumber": "123", "apiUrl": "http://localhost:3000"}
            queue = open_queue(Path(directory) / "queue.sqlite3", config)
            for index, code in enumerate(["DX007", "DX007", "DX008"]):
                uid = str(2054 + index)
                queue.execute("INSERT INTO events (id,uid,timestamp,payload) VALUES (?,?,?,?)",
                              (uid, uid, str(index), json.dumps({"uid": uid, "userId": code})))
            queue.commit()
            attempted = []

            def refuse(request, timeout):
                attempted.append(json.loads(request.data)["userId"])
                raise delivery.urllib.error.HTTPError(request.full_url, 422, "Unlinked", {}, None)

            with patch.object(delivery.urllib.request, "build_opener", return_value=SimpleNamespace(open=refuse)):
                delivery.deliver(queue, config, "token")
            self.assertEqual(attempted, ["DX007", "DX008"])
            self.assertEqual(queue.execute("SELECT COUNT(*) FROM events WHERE delivered=0").fetchone()[0], 3)
            queue.close()


if __name__ == "__main__":
    unittest.main()
