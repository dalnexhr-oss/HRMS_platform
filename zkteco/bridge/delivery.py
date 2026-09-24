"""Authenticated HRMS delivery with acknowledgements and per-employee ordering."""
import datetime as dt
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from .events import remap_user


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_endpoint(config):
    endpoint = config["apiUrl"].rstrip("/") + "/api/devices/zkteco/punch"
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("apiUrl must not contain credentials, query parameters, or a fragment.")
    local_http = (
        parsed.scheme == "http"
        and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    )
    if parsed.scheme != "https" and not local_http:
        raise ValueError("Use HTTPS for a remote HRMS server (HTTP is allowed only on localhost).")
    return endpoint


def deliver(queue, config, token, aliases=None):
    """Acknowledge accepted/reviewed events; keep failed scans pending in user order."""
    endpoint = api_endpoint(config)
    blocked = set()
    pending = queue.execute(
        "SELECT id, uid, payload FROM events WHERE delivered=0 ORDER BY timestamp, id"
    ).fetchall()
    for key, uid, payload in pending:
        event = json.loads(payload)
        if aliases:
            event = remap_user(event, aliases)
        user_id = event["userId"]
        if user_id in blocked:
            continue
        payload = json.dumps(event)
        request = urllib.request.Request(
            endpoint,
            data=payload.encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            method="POST",
        )
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                result = json.loads(response.read(8192))
            if (
                not isinstance(result, dict)
                or result.get("eventId") != key
                or result.get("status") not in ("recorded", "ignored", "needs_review")
            ):
                raise ValueError("Unexpected ingestion acknowledgement.")
            queue.execute(
                "UPDATE events SET delivered=1, result=? WHERE id=?",
                (json.dumps(result), key),
            )
            queue.commit()
            print(f"{key[:12]}: {result['status']}", flush=True)
        except (OSError, ValueError) as error:
            blocked.add(user_id)
            message = str(error)
            if isinstance(error, urllib.error.HTTPError):
                try:
                    body = json.loads(error.read(8192))
                    if isinstance(body, dict) and isinstance(body.get("error"), str):
                        message = body["error"][:500]
                except (OSError, ValueError):
                    pass
                finally:
                    error.close()
            failure = {
                "error": message,
                "attemptedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
            queue.execute(
                "UPDATE events SET result=? WHERE id=? AND delivered=0",
                (json.dumps(failure), key),
            )
            queue.commit()
            print(
                f"Delivery pending for user {user_id} (attendance UID {uid}): {message}",
                file=sys.stderr,
                flush=True,
            )
            if not isinstance(error, urllib.error.HTTPError) or error.code != 422:
                # Transport/auth/config failures affect everyone; avoid hammering the server.
                break
