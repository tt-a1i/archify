"""Observe default PyYAML SafeLoader scalar types and two tiny mappings."""
import hashlib
import json
import platform
from pathlib import Path

import yaml

cases = [
    ("plain_on", "flag: on\n", True, bool),
    ("quoted_on", 'flag: "on"\n', "on", str),
    ("single_quoted_on", "flag: 'on'\n", "on", str),
    ("tagged_on", "flag: !!str on\n", "on", str),
    ("plain_off", "flag: off\n", False, bool),
    ("plain_number", "flag: 42\n", 42, int),
    ("quoted_number", 'flag: "42"\n', "42", str),
    ("mixed_case_control", "flag: oN\n", "oN", str),
]
scalars = []
for name, source, expected, expected_type in cases:
    parsed = yaml.safe_load(source)
    value = parsed["flag"]
    assert type(value) is expected_type and value == expected
    node = yaml.compose(source, Loader=yaml.SafeLoader).value[0][1]
    scalars.append({
        "case": name, "input": source, "value": value,
        "repr": repr(value), "pythonType": type(value).__name__,
        "resolvedTag": node.tag,
    })

mappings = []
for name, source, expected in [
    ("plain_keys", "on: first\nyes: second\n", {True: "second"}),
    ("quoted_keys", '"on": first\n"yes": second\n', {"on": "first", "yes": "second"}),
]:
    parsed = yaml.safe_load(source)
    assert parsed == expected and list(map(type, parsed)) == list(map(type, expected))
    mappings.append({
        "case": name, "input": source, "repr": repr(parsed), "size": len(parsed),
        "entries": [
            {"keyRepr": repr(key), "keyType": type(key).__name__,
             "valueRepr": repr(value), "valueType": type(value).__name__}
            for key, value in parsed.items()
        ],
    })

package = Path(yaml.__file__).parent
print(json.dumps({
    "environment": {
        "python": platform.python_version(), "pyyaml": yaml.__version__,
        "entrypoint": "yaml.safe_load", "loader": "yaml.SafeLoader",
        "sourceSha256": {name: hashlib.sha256((package / name).read_bytes()).hexdigest()
                         for name in ["resolver.py", "constructor.py", "loader.py", "__init__.py"]},
    },
    "scalars": scalars, "mappings": mappings,
    "scope": "Default unmodified PyYAML SafeLoader in one isolated process; no custom constructors/resolvers, C loader comparison, arbitrary Python object construction or security testing.",
}, ensure_ascii=False, indent=2))
