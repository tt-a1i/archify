"""Exercise original Requests/urllib3 code; replace only the network sink.

Historical public case: https://github.com/psf/requests/issues/6586
This is a regression demonstration, not a blind discovery benchmark.
"""
import json
from pathlib import Path
import socket
import sys

sys.path[:0] = [str(Path(sys.argv[1]).resolve()), str(Path(sys.argv[2]).resolve())]
import requests
import urllib3
from urllib3.connection import HTTPConnection

assert requests.__version__ == '2.31.0'
assert urllib3.__version__ == '2.0.7'

def forbid_network(*args, **kwargs):
    raise AssertionError('This verification must not open a socket')

socket.socket = forbid_network

def observe(data):
    prepared = requests.Request('POST', 'http://example.invalid/', data=data).prepare()
    headers, chunks = {}, []
    conn = HTTPConnection('example.invalid')
    # Preserve the real body framing/encoding branch; replace socket-facing sinks.
    conn.putrequest = lambda *a, **kw: None
    conn.putheader = lambda key, value: headers.__setitem__(key.lower(), str(value))
    conn.endheaders = lambda: None
    conn.send = chunks.append
    conn.request('POST', '/', body=prepared.body, headers=prepared.headers, chunked=False)
    return {'header_bytes': int(headers['content-length']), 'wire_bytes': len(b''.join(chunks))}

cases = []
for name, kind, data, expected in [
    ('ascii', 'control', 'AB', {'header_bytes': 2, 'wire_bytes': 2}),
    ('unicode', 'trigger', '中文', {'header_bytes': 2, 'wire_bytes': 6}),
    ('encoded', 'control', '中文'.encode('utf-8'), {'header_bytes': 6, 'wire_bytes': 6}),
]:
    actual = observe(data)
    cases.append(dict(name=name, kind=kind, actual=actual, expected=expected, passed=actual==expected))
print(json.dumps({'outcome':'reproduced', 'cases':cases}, ensure_ascii=False))
