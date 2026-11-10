# Independent verification of the IPv6 netloc case

Repository: `encode/httpx` at tag `0.27.0`,
commit `326b9431c761e1ef1e00b9f760d1f654c8db48c6`.

## Reproduce the defect (unpatched)

```sh
.venv/bin/python - <<'PY'
from httpx import URL
u = URL("http://[::1]:8080/a")
print(u.netloc)          # b'[::1]:8080'
print(u.copy_with(netloc=u.netloc))
PY
```

Output:

```text
b'[::1]:8080'
httpx.InvalidURL: Invalid port: ':1]:8080'
```

`URL(netloc=b"[::1]", scheme="http")` also raises `InvalidURL: Invalid port:
':1]'`.

## Before the fix

```sh
.venv/bin/python -m pytest tests/models/test_url.py -k netloc \
  --noconftest -o filterwarnings= -q
```

```text
1 failed, 1 passed, 85 deselected
httpx.InvalidURL: Invalid port: ':1]:8080'
```

The passing test is the existing `test_url_copywith_netloc` with
`b"example.net:444"`. The failure is the new
`test_url_copywith_netloc_ipv6`.

## After the fix

```sh
.venv/bin/python -m pytest tests/models/test_url.py \
  --noconftest -o filterwarnings= -q
```

```text
87 passed in 0.08s
```

Edge behavior on the patched copy:

```text
http://[::1]:8080/a                 -> http://[::1]:8080/a | port 8080
http://[::ffff:192.168.0.1]:5678/a  -> unchanged        | port 5678
http://[::1]/a                      -> unchanged        | port None
http://[::1]:80/a                   -> http://[::1]/a   | port None
http://u:p@example.com:8080/a       -> http://u:p@[::1]:8080/a | userinfo kept
b"[::1"                             -> InvalidURL Invalid netloc: '[::1'
b"[::1]junk"                        -> InvalidURL Invalid port: 'junk'
```

## Current upstream

Upstream `0.28.1` (`b5addb64f0161ff6bfe94c124ef76f6a1fba5254`, 2026-02-23)
still contains the first-colon split at `httpx/_urlparse.py:240-242` and fails
the same round-trip with `InvalidURL: Invalid port: ':1]:8080'`.

## Patch

[httpx-netloc-ipv6.patch](httpx-netloc-ipv6.patch) applies cleanly to pristine
0.27.0 (`git apply --check` passes). The patch changes the parser to split a
bracketed host before the port, rejects an unterminated bracket, and adds the
regression test. It was not submitted upstream; this is review evidence only.
