#!/usr/bin/env python3
"""Fix the /; bug in render-lifecycle.mjs line 522"""
p = 'archify/renderers/lifecycle/render-lifecycle.mjs'
with open(p) as f:
    lines = f.readlines()
# Line 522 (index 521) has /;`;` instead of />`;`
for i, line in enumerate(lines):
    if 'data-decorative="lifecycle-rail"' in line and '/;`;' in line:
        lines[i] = line.replace('/;`;', '/>`;')
        print(f"Fixed line {i+1}: {lines[i].rstrip()}")
        break
with open(p, 'w') as f:
    f.writelines(lines)
