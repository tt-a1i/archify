import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import platform
import threading
import time
import requests
import urllib3

TIMEOUT = 0.4
BODY = b"ABCDE"
SCHEDULES = {
    "steady": {"headerDelay": 0.0, "bodyDelays": [0.15] * 5},
    "body_gap": {"headerDelay": 0.0, "bodyDelays": [0.05, 0.7, 0.0, 0.0, 0.0]},
    "header_gap": {"headerDelay": 0.7, "bodyDelays": [0.0] * 5},
}
origins = {}
events = {}

class Server(ThreadingHTTPServer):
    daemon_threads = False

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        name = self.path.removeprefix("/")
        schedule = SCHEDULES[name]

        def event(kind, **fields):
            events[name].append({"kind": kind, "clientStartMs": round((time.perf_counter() - origins[name]) * 1000, 3), **fields})

        event("server_received_request")
        try:
            time.sleep(schedule["headerDelay"])
            self.send_response(200)
            self.send_header("Content-Length", str(len(BODY)))
            self.send_header("Content-Type", "text/plain")
            self.send_header("Connection", "close")
            self.end_headers()
            event("server_sent_headers")
            for byte, delay in zip(BODY, schedule["bodyDelays"]):
                time.sleep(delay)
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
                event("server_write_returned", byte=chr(byte))
        except (BrokenPipeError, ConnectionResetError) as exc:
            event("server_transport_error", exception=type(exc).__name__)
        finally:
            self.close_connection = True

server = Server(("127.0.0.1", 0), Handler)
worker = threading.Thread(target=server.serve_forever)
worker.start()
results = []
try:
    with requests.Session() as session:
        session.trust_env = False
        for name in SCHEDULES:
            events[name] = []
            origins[name] = time.perf_counter()
            try:
                response = session.get(f"http://127.0.0.1:{server.server_port}/{name}", timeout=TIMEOUT, allow_redirects=False)
                results.append({"case": name, "outcome": "complete", "elapsedMs": round((time.perf_counter() - origins[name]) * 1000, 3), "body": response.content.decode("ascii"), "bodyBytes": len(response.content), "headerElapsedMs": round(response.elapsed.total_seconds() * 1000, 3)})
                response.close()
            except requests.exceptions.RequestException as exc:
                results.append({"case": name, "outcome": "exception", "elapsedMs": round((time.perf_counter() - origins[name]) * 1000, 3), "exception": type(exc).__name__, "message": str(exc), "isTimeoutSubclass": isinstance(exc, requests.exceptions.Timeout)})
finally:
    server.shutdown()
    server.server_close()
    worker.join()

by_name = {row["case"]: row for row in results}
assert by_name["steady"]["body"] == "ABCDE"
assert by_name["steady"]["elapsedMs"] > TIMEOUT * 1000
assert by_name["body_gap"]["exception"] == "ConnectionError"
assert by_name["header_gap"]["exception"] == "ReadTimeout"
root = Path(requests.__file__).parent
identity = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ["adapters.py", "models.py"]}
print(json.dumps({"environment": {"python": platform.python_version(), "requests": requests.__version__, "urllib3": urllib3.__version__, "sourceSha256": identity}, "configuration": {"timeoutSeconds": TIMEOUT, "body": BODY.decode(), "stream": False, "trustEnv": False, "allowRedirects": False, "server": "ephemeral 127.0.0.1 HTTP/1.1, finite body, no TLS", "schedules": SCHEDULES}, "measurement": "elapsedMs surrounds Session.get with default stream=False, including body consumption; headerElapsedMs is Response.elapsed and is not the complete download. Server write events are not client receive timestamps. Sleep settings are requested delays, not exact network timing.", "results": results, "serverEvents": events}, indent=2))
