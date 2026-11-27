"""Select the first CMake command for each resolved source path."""

import json
import sys
from pathlib import Path


if len(sys.argv) != 3:
    sys.exit("Usage: python3 select-commands.py <cmake-compile_commands.json> <selected-compile_commands.json>")
source, output = map(Path, sys.argv[1:])
rows = json.loads(source.read_text())
groups = {}
for index, row in enumerate(rows):
    file = str((Path(row["directory"]) / row["file"]).resolve())
    groups.setdefault(file, []).append((index, row))
selected = [choices[0][1] for _, choices in sorted(groups.items())]
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(selected, indent=2) + "\n")
print(json.dumps({"inputEntries": len(rows), "selectedEntries": len(selected),
                  "alternatesOmitted": len(rows) - len(selected),
                  "selectedInputIndexes": {file: choices[0][0] for file, choices in sorted(groups.items())}}, indent=2))
