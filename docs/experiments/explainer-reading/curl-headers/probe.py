"""Distinguish HTTP method, downloaded body and displayed output on loopback."""
import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

BODY = b"alpha\n"
requests = []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def respond(self):
        requests.append({"method": self.command, "path": self.path})
        self.send_response_only(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(BODY)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(BODY)
        self.close_connection = True

    do_GET = respond
    do_HEAD = respond

    def log_message(self, *_):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    url = f"http://127.0.0.1:{server.server_port}/item"
    common = ["-q", "--silent", "--show-error", "--noproxy", "*", "--max-time", "5",
              "--write-out", "%{stderr}%{size_download}\n"]
    cases = [("plain", [], "GET", 6, False, True),
             ("include", ["-i"], "GET", 6, True, True),
             ("head", ["-I"], "HEAD", 0, True, False),
             ("discard-body", ["-D", "-", "-o", "/dev/null"], "GET", 6, True, False)]
    output = {"curl_version": subprocess.run(["/usr/bin/curl", "--version"], check=True, capture_output=True, text=True).stdout,
              "scope": "Authored HTTP/1.1 fixture on loopback. Default curl config disabled; proxy bypassed; no redirects or external server.",
              "common_arguments": common, "fixture_body": BODY.decode(), "cases": []}
    for name, flags, method, downloaded, shows_headers, shows_body in cases:
        before = len(requests)
        result = subprocess.run(["/usr/bin/curl", *common, *flags, url], capture_output=True, timeout=8)
        assert result.returncode == 0, (name, result.stderr)
        observed_download = int(result.stderr.strip())
        observed = requests[before:]
        assert len(observed) == 1 and observed[0]["method"] == method, (name, observed)
        assert observed_download == downloaded, (name, observed_download)
        assert result.stdout.startswith(b"HTTP/1.1 200 OK\r\n") == shows_headers
        assert (BODY in result.stdout) == shows_body
        if shows_headers:
            header, _, body = result.stdout.partition(b"\r\n\r\n")
            assert b"Content-Length: 6" in header
            assert body == (BODY if shows_body else b""), (name, body)
        else:
            assert result.stdout == BODY
        output["cases"].append({"name": name, "arguments": flags, "request": observed[0],
                                "exit": result.returncode, "curl_reported_body_bytes": observed_download,
                                "stdout": result.stdout.decode("ascii"), "stderr_download_counter": result.stderr.decode("ascii")})
    print(json.dumps(output, indent=2))
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
    assert not thread.is_alive(), "fixture server did not stop"
