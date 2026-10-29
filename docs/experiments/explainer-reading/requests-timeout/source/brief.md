# Verified Requests timeout case

Requests 2.34.2 / tag v2.34.2 / commit 6e83187b8feb273ed4c6cdab5efd8d54901dfab3. Python 3.12.13 and urllib3 2.8.0. Installed adapters.py and models.py bytes match the pinned upstream files (identity.json); this is not full wheel build reproduction.

Primary sources:
- Whole-download distinction: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/quickstart.rst#L543-L550
- Connect/read meaning, single-value and tuple behavior, wall-clock qualification: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/advanced.rst#L1094-L1133
- Float applied to both timeout fields: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/adapters.py#L681-L693
- Body consumption converts urllib3 ReadTimeoutError to Requests ConnectionError: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L933-L943
- Adapter maps response-read timeout to ReadTimeout: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/adapters.py#L737-L742
- Response.elapsed describes response-header timing, not full body consumption: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L797-L804

The actual self-contained probe is source/probe.py. It binds an ephemeral localhost HTTP/1.1 server, runs three finite cases using Session.get(timeout=0.4, stream=False default), disables environment proxies and redirects, and closes the server/threads. No external request. The complete script is the reproducible artifact; do not invent a fixed localhost port or public endpoint that reproduces it. A short API call may be shown inline; link the actual probe if the full script would distract from the explanation.

Two observed runs (probe-1.json and probe-2.json):
- steady: response headers immediately, then five bytes ABCDE with a requested 0.15 s delay before each write. Both complete: 783.884 ms and 787.644 ms, exceeding the configured 400 ms timeout. This is one local observation, not guaranteed performance. The server delays are requested sleeps, not precise receive timestamps.
- body_gap: first byte after a requested 0.05 s, then requested 0.7 s idle gap. Both raise ConnectionError containing a read-timeout message, at 460.036 ms and 456.114 ms; this exception is not a Requests Timeout subclass in this path. It is not a completed zero-byte body result.
- header_gap control: requested 0.7 s before headers. Both raise ReadTimeout at 401.456 ms and 403.210 ms, which is a Timeout subclass.

elapsedMs uses perf_counter around Session.get, including default body consumption, or until the exception. headerElapsedMs values 1.239/1.115 ms on successful runs are Response.elapsed; do not label them full-download duration. Server event times record write calls returning, not reception at the client. Timings/ports differ between runs; qualitative outcomes agree. No byte-identical timing claim.

A single timeout value configures both connect and read waits, not a whole-call deadline. The main story concerns read waits after a quick loopback connection. Do not generalize the local elapsed values to DNS/TLS/proxies/redirects/retries, other transports or strict wall-clock deadlines. Do not state that every read timeout is catchable solely with requests.exceptions.Timeout; the body-gap probe demonstrates the ConnectionError boundary. Keep that qualification concise and secondary to the main timing distinction. Do not repeat the documentation's unsupported 99.9% phrase as measured evidence.
