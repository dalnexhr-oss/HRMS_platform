"""Deliver committed uploads in employee order without blocking device requests."""
import json
import logging
import urllib.error

from shared.hrms_delivery import describe_delivery_error, send_punch_event

LOGGER = logging.getLogger("zkteco.adms")


def deliver_pending_events(attendance_queue, config, token, stop_event=None):
    for row in attendance_queue.read_pending_events():
        if stop_event and stop_event.is_set():
            return
        try:
            event = json.loads(row["payload"])
            result = send_punch_event(event, config, token)
        except (OSError, ValueError) as error:
            message = describe_delivery_error(error)
            attendance_queue.schedule_retry(row["id"], message)
            LOGGER.warning("Delivery pending for event %s: %s", row["id"][:12], message)
            if not isinstance(error, urllib.error.HTTPError) or error.code != 422:
                break
        else:
            attendance_queue.mark_delivered(row["id"], result)
            if result.get("duplicate"):
                LOGGER.info(
                    "Punch already processed | employee=%s | status=%s | event=%s",
                    event["userId"], result["status"], row["id"][:12],
                )
            elif result["status"] == "recorded":
                label = {"in": "Punch IN", "out": "Punch OUT"}.get(result.get("kind"), "Punch")
                LOGGER.info(
                    "%s recorded successfully | employee=%s | timestamp=%s | event=%s",
                    label, event["userId"], event["timestamp"], row["id"][:12],
                )
            else:
                LOGGER.info(
                    "Punch %s | employee=%s | reason=%s | event=%s",
                    result["status"], event["userId"], result.get("reason") or "Not provided",
                    row["id"][:12],
                )


def run_delivery_worker(attendance_queue, config, token, stop_event, failure_event=None):
    while not stop_event.is_set():
        try:
            deliver_pending_events(attendance_queue, config, token, stop_event)
        except Exception:
            # A storage error must not silently kill the worker while HTTP stays healthy.
            LOGGER.exception("ADMS delivery worker failed; stopping the receiver for restart")
            if failure_event is not None:
                failure_event.set()
            stop_event.set()
            return
        stop_event.wait(1)
