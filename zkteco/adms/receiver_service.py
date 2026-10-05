"""Run the HTTP receiver and delivery worker with one shared shutdown lifecycle."""
import logging
from pathlib import Path
import signal
import threading

from .attendance_queue import AttendanceQueue
from .delivery_worker import run_delivery_worker
from .http_receiver import create_http_application
from shared.state_directory_lock import StateDirectoryLock


def serve_attendance(config, token):
    from waitress import create_server

    state_directory = Path(config["stateDir"])
    state_directory.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with StateDirectoryLock(state_directory):
        attendance_queue = AttendanceQueue(config)
        stop_event = threading.Event()
        failure_event = threading.Event()
        server = create_server(
            create_http_application(config, attendance_queue),
            host=config["listenHost"], port=config["listenPort"],
            threads=4, connection_limit=32, channel_timeout=30, cleanup_interval=5,
            max_request_body_size=config["maxBodyBytes"], max_request_header_size=8192,
            clear_untrusted_proxy_headers=True,
        )
        delivery_thread = threading.Thread(
            target=run_delivery_worker,
            args=(attendance_queue, config, token, stop_event, failure_event),
            name="adms-delivery",
        )

        def stop_receiver(signum=None, frame=None):
            stop_event.set()
            server.close()

        def watch_delivery_worker():
            stop_event.wait()
            server.close()

        signal.signal(signal.SIGINT, stop_receiver)
        signal.signal(signal.SIGTERM, stop_receiver)
        delivery_thread.start()
        threading.Thread(target=watch_delivery_worker, daemon=True).start()
        logging.info("ADMS listening on %s:%s; cutoff %s", config["listenHost"], config["listenPort"], config["since"])
        try:
            server.run()
        finally:
            stop_receiver()
            delivery_thread.join(timeout=20)
        if failure_event.is_set():
            raise RuntimeError("ADMS delivery worker failed; restart after checking service logs and storage.")
