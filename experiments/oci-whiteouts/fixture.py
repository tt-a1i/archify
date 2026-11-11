"""Original fixed OCI reading fixture. No arbitrary archive input or filesystem extraction."""
import hashlib
import io
import itertools
import json
import tarfile

LOWER = {"app/config.txt": b"config-v1\n", "app/cache/old.txt": b"old-cache\n", "app/keep.txt": b"keep-me\n"}
UPPER = {"app/cache/new.txt": b"new-cache\n", "app/.wh.config.txt": b"", "app/cache/.wh..wh..opq": b""}
EXPECTED = {"app/keep.txt": "lower", "app/cache/new.txt": "upper"}
sha256 = lambda data: hashlib.sha256(data).hexdigest()


def archive(files, order=None):
    """Create only these declared entries; metadata is deliberately deterministic."""
    order = list(files) if order is None else list(order)
    if len(order) != len(files) or set(order) != set(files):
        raise ValueError("Order must name each declared entry exactly once")
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name in ["app/", "app/cache/"] + order:
            info = tarfile.TarInfo(name)
            info.mtime = info.uid = info.gid = 0
            info.uname = info.gname = ""
            if name.endswith("/"):
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                payload = files[name]
                info.mode = 0o644
                info.size = len(payload)
                tar.addfile(info, io.BytesIO(payload))
    return stream.getvalue()


def inventory(data):
    """Read members of our in-memory tar, never extract files or execute their contents."""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
        result = []
        for member in tar.getmembers():
            if not (member.isdir() or member.isfile()):
                raise ValueError("This fixed example only uses directories and regular files")
            payload = tar.extractfile(member).read() if member.isfile() else None
            result.append({"path": member.name, "type": "directory" if member.isdir() else "regular",
                           "size": member.size, "payloadSha256": sha256(payload) if payload is not None else None})
        return result


def project_known_fixture(lower, upper):
    """Small SPEC-DERIVED model for six fixed regular paths, NOT an OCI layer applier."""
    def regular(rows, declared):
        files = [row for row in rows if row["type"] == "regular"]
        if len(files) != len(declared) or {row["path"] for row in files} != set(declared):
            raise ValueError("Only the six declared fixture paths are supported")
        for row in files:
            if row["size"] != len(declared[row["path"]]) or row["payloadSha256"] != sha256(declared[row["path"]]):
                raise ValueError("Fixture payload changed")
        return {row["path"]: row for row in files}
    below = regular(lower, LOWER)
    above = regular(upper, UPPER)
    # The two known upper markers affect lower entries only, independent of tar order.
    visible = {name: "lower" for name in below
               if name != "app/config.txt" and not name.startswith("app/cache/")}
    visible.update({name: "upper" for name in above if name == "app/cache/new.txt"})
    return visible


def verify_projection(visible):
    if visible != EXPECTED:
        raise ValueError("Spec-derived visible projection differs from keep + same-layer new")


def observe():
    lower, upper = archive(LOWER), archive(UPPER)
    rows = {"lower": inventory(lower), "upper": inventory(upper)}
    visible = project_known_fixture(rows["lower"], rows["upper"])
    verify_projection(visible)
    variants = []
    for order in itertools.permutations(UPPER):
        data = archive(UPPER, order)
        view = project_known_fixture(rows["lower"], inventory(data))
        verify_projection(view)
        variants.append({"upperRegularOrder": list(order), "tarSha256": sha256(data), "projection": view})
    return lower, upper, {"kind": "original-synthetic-fixture", "measured": "Archive inventory, order and payload hashes only",
        "projectionEvidence": "SPEC-DERIVED fixed model; no Docker, OCI runtime, mount or extracted filesystem was observed",
        "archives": {"lower": {"sha256": sha256(lower), "bytes": len(lower)}, "upper": {"sha256": sha256(upper), "bytes": len(upper)}},
        "inventory": rows, "specDerivedVisibleRegularPaths": visible, "orderVariants": variants,
        "notMeasured": ["runtime filesystem", "disk allocation", "compressed image size", "space savings", "OCI conformance"]}
