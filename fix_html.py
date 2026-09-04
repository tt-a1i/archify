#!/usr/bin/env python3
"""Apply data-decorative=lifecycle-rail fix to all HTML files"""
import subprocess, os

old_line = '<path d="M 154 157 L 748 157" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>'
new_line = '<path data-decorative="lifecycle-rail" d="M 154 157 L 748 157" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>'

files = [
    "archify/examples/lifecycle-agent-run.html",
    "examples/lifecycle-agent-run.html",
    "docs/gallery/artifacts/agent-run.lifecycle.html",
    "docs/gallery/artifacts/deployment-release.lifecycle.html",
]

fixed = 0
for f in files:
    if not os.path.exists(f):
        print(f"Missing: {f}")
        continue
    with open(f) as fh:
        content = fh.read()
    if old_line in content:
        content = content.replace(old_line, new_line)
        with open(f, 'w') as fh:
            fh.write(content)
        print(f"Fixed: {f}")
        fixed += 1
    else:
        print(f"Already fixed or not found: {f}")

print(f"\nTotal files fixed: {fixed}")
