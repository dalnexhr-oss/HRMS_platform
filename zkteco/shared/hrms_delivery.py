"""Authenticated HRMS delivery with acknowledgements and per-employee ordering."""
import json
import urllib.error
import urllib.parse
import urllib.request

from .event_identity import device_event_id


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_punch_endpoint(config):
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


def send_punch_event(event, config, token):
    """Send one event; redirects and mismatched acknowledgements never count as delivery."""
    request = urllib.request.Request(
        build_punch_endpoint(config),
        data=json.dumps(event).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.build_opener(RejectRedirects).open(request, timeout=15) as response:
        result = json.loads(response.read(8192))
    if (
        not isinstance(result, dict)
        or result.get("eventId") != device_event_id(event)
        or result.get("status") not in ("recorded", "ignored", "needs_review")
    ):
        raise ValueError("Unexpected ingestion acknowledgement.")
    return result


def describe_delivery_error(error):
    """Extract the bounded HRMS error message and release any failed HTTP response."""
    message = str(error)
    if isinstance(error, urllib.error.HTTPError):
        try:
            response_body = json.loads(error.read(8192))
            if isinstance(response_body, dict) and isinstance(response_body.get("error"), str):
                message = response_body["error"][:500]
        except (OSError, ValueError):
            pass
        finally:
            error.close()
    return message
