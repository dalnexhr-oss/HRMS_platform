"""Small WSGI application for legacy attendance PUSH requests."""
import logging
import re
import sqlite3
from urllib.parse import parse_qs

from .attendance_protocol import build_handshake_response, parse_attendance_upload
from .attendance_queue import QueueCapacityExceeded
from .receiver_config import is_allowed_source

LOGGER = logging.getLogger("zkteco.adms")


def create_http_application(config, attendance_queue):
    def application(environ, start_response):
        def respond(status, text):
            rejected = int(status.split()[0]) >= 400
            # Log request outcomes, never upload bodies, credentials, or query strings.
            # Bound and escape device-controlled values so they cannot forge log lines.
            LOGGER.log(
                logging.WARNING if rejected else logging.INFO,
                "ADMS request | peer=%r | method=%r | path=%r | status=%s%s",
                environ.get("REMOTE_ADDR", "")[:64],
                environ.get("REQUEST_METHOD", "GET")[:16],
                environ.get("PATH_INFO", "")[:128], status,
                f" | reason={text.strip()[:200]!r}" if rejected else "",
            )
            body = text.encode("utf-8")
            start_response(status, [
                ("Content-Type", "text/plain; charset=utf-8"),
                ("Content-Length", str(len(body))), ("Cache-Control", "no-store"),
            ])
            return [body]

        # Never trust X-Forwarded-For supplied by a device or internet client.
        if not is_allowed_source(environ.get("REMOTE_ADDR", ""), config):
            return respond("403 Forbidden", "Source not allowed\n")
        method = environ.get("REQUEST_METHOD", "GET")
        path = environ.get("PATH_INFO", "").rstrip("/")
        if path.endswith(".aspx"):
            path = path[:-5]
        if path == "/healthz" and method == "GET":
            return respond("200 OK", "OK\n")
        if path not in ("/iclock/cdata", "/iclock/getrequest", "/iclock/devicecmd"):
            return respond("404 Not Found", "Unsupported ADMS endpoint\n")
        try:
            if len(environ.get("QUERY_STRING", "")) > 2048:
                raise ValueError("Query too long.")
            query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True, max_num_fields=24)
            if any(len(values) != 1 for values in query.values()):
                raise ValueError("Duplicate query parameters.")
            if query.get("SN", [None])[0] != config["serialNumber"]:
                return respond("403 Forbidden", "Unknown terminal\n")
            if method == "GET":
                if path == "/iclock/getrequest":
                    # No remote administration, deletion, enrollment, or restart commands.
                    return respond("200 OK", "OK\n")
                if path == "/iclock/cdata":
                    return respond("200 OK", build_handshake_response(config, attendance_queue.read_upload_cursor()) if query.get("options") == ["all"] else "OK\n")
                return respond("405 Method Not Allowed", "Method not allowed\n")
            if method != "POST" or path == "/iclock/getrequest":
                return respond("405 Method Not Allowed", "Method not allowed\n")
            if environ.get("HTTP_CONTENT_ENCODING", "identity").lower() != "identity":
                return respond("415 Unsupported Media Type", "Encoded uploads are unsupported\n")
            length_text = environ.get("CONTENT_LENGTH", "")
            if not length_text:
                return respond("411 Length Required", "Content-Length required\n")
            if not re.fullmatch(r"\d{1,10}", length_text):
                raise ValueError("Invalid Content-Length.")
            length = int(length_text)
            if length > config["maxBodyBytes"]:
                return respond("413 Payload Too Large", "Upload too large\n")
            body = environ["wsgi.input"].read(length)
            if len(body) != length:
                raise ValueError("Incomplete upload.")
            if path == "/iclock/devicecmd":
                return respond("200 OK", "OK\n")
            table = query.get("table", [""])[0]
            if table == "options":
                # Capability reports are not employee data and are not needed for ingestion.
                return respond("200 OK", "OK\n")
            if table != "ATTLOG":
                return respond("400 Bad Request", "Only ATTLOG uploads are supported\n")
            stamp = query.get("Stamp", [None])[0]
            if stamp is not None and not re.fullmatch(r"[A-Za-z0-9_.:+-]{1,128}", stamp):
                raise ValueError("Invalid upload cursor.")
            events = parse_attendance_upload(body, config)
            count = attendance_queue.accept_upload(events, stamp)
            LOGGER.info("Accepted %d ATTLOG rows", count)
            return respond("200 OK", f"OK: {count}\n")
        except ValueError as error:
            return respond("400 Bad Request", f"{error}\n")
        except (OSError, sqlite3.Error, QueueCapacityExceeded):
            LOGGER.exception("Could not durably accept upload")
            return respond("503 Service Unavailable", "Storage unavailable; retry upload\n")
    return application
