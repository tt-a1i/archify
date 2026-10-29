#!/usr/bin/env python3
"""Measure four exact gzip inputs; no files, network, or timing measurements."""

import gzip
import hashlib
import json
import platform
import struct
import zlib


def compress(data):
    return gzip.compress(data, compresslevel=9, mtime=0)


def observe(name, data):
    packed = compress(data)
    raw = zlib.compress(data, level=9, wbits=-15)
    # FLG=0 excludes all optional header fields in these fixtures.
    assert packed[:4] == b"\x1f\x8b\x08\x00"
    assert struct.unpack("<I", packed[4:8])[0] == 0
    assert packed[10:-8] == raw
    assert len(packed) == 10 + len(raw) + 8
    assert gzip.decompress(packed) == data
    assert zlib.decompress(raw, wbits=-15) == data
    crc, size = struct.unpack("<II", packed[-8:])
    assert crc == zlib.crc32(data)
    assert size == len(data) % (2**32)
    return {
        "name": name,
        "input_bytes": len(data),
        "input_sha256": hashlib.sha256(data).hexdigest(),
        "raw_deflate_bytes": len(raw),
        "gzip_header_bytes": 10,
        "gzip_trailer_bytes": 8,
        "gzip_bytes": len(packed),
        "delta_bytes": len(packed) - len(data),
        "gzip_sha256": hashlib.sha256(packed).hexdigest(),
        "flags": packed[3],
        "crc32_hex": f"{crc:08x}",
        "isize": size,
        "round_trip": True,
        "raw_payload_matches": True,
    }


def main():
    repeated = b"A" * 1024
    fixtures = [
        ("one-ascii-A", b"A"),
        ("1024-ascii-As", repeated),
        ("1024-shake256-derived-bytes", hashlib.shake_256(b"Archify gzip fixture v1").digest(1024)),
        ("gzip-of-1024-ascii-As", compress(repeated)),
    ]
    result = {
        "python": platform.python_version(),
        "zlib_compile": zlib.ZLIB_VERSION,
        "zlib_runtime": zlib.ZLIB_RUNTIME_VERSION,
        "settings": {"compresslevel": 9, "mtime": 0, "raw_wbits": -15},
        "scope": "Four synthetic byte inputs; one gzip member without optional header fields. No performance measurement or general compression ratio claim.",
        "fixtures": [observe(name, data) for name, data in fixtures],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
