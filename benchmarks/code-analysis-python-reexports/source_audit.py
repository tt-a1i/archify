#!/usr/bin/env python3
"""Review the fixed introduced-target inventory against explicit source anchors.
This does not infer runtime names or reuse the product's import resolver.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--samples-root', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
here = Path(__file__).parent
manifest = json.loads((here / 'source-first.json').read_text())
# Anchors inspected from package exports and definitions after the candidate.
anchors = {
    'jinja': {'is_undefined': ('src/jinja2/utils.py', 104, 32), 'make_logging_undefined': ('src/jinja2/runtime.py', 912, 28)},
    'flask': {'render_template': ('src/flask/templating.py', 138, 38), 'jsonify': ('src/flask/json/__init__.py', 138, 27), 'url_for': ('src/flask/helpers.py', 195, 26), 'redirect': ('src/flask/helpers.py', 249, 22), 'flash': ('src/flask/helpers.py', 318, 18), 'stream_template': ('src/flask/templating.py', 188, 40)},
}
rows = []
for item in json.loads((here / 'evidence/introduced-targets.json').read_text()):
    project, call = item['project'], item['call']; root = a.samples_root / project
    assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == manifest['projects'][project]['commit']
    package = 'jinja2' if project == 'jinja' else 'flask'
    source = (root / call['file']).read_text(); tree = ast.parse(source)
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and n.lineno == call['line'] and n.col_offset + 1 == call['column']]
    assert len(calls) == 1 and isinstance(calls[0].func, ast.Name)
    node = calls[0]; name = node.func.id
    imports = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.level == 0 and n.module == package and any((v.asname or v.name) == name for v in n.names)]
    assert len(imports) == 1
    imported = next(v.name for v in imports[0].names if (v.asname or v.name) == name)
    target_file, target_line, export_line = anchors[project][imported]
    assert call['target'] == dict(file=target_file, line=target_line, column=1, name=imported)
    export_file = 'src/' + package + '/__init__.py'; exports = (root / export_file).read_text()
    export = next(n for n in ast.parse(exports).body if isinstance(n, ast.ImportFrom) and n.lineno == export_line)
    assert export.level == 1 and any(v.name == imported and (v.asname or v.name) == imported for v in export.names)
    # Match the reviewed relative module path, allowing a package __init__ target.
    target_module = target_file.removeprefix('src/' + package + '/').removesuffix('.py').removesuffix('/__init__').replace('/', '.')
    assert export.module == target_module
    definition_text = (root / target_file).read_text()
    definition = next(n for n in ast.parse(definition_text).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == imported)
    assert definition.lineno == target_line and not definition.decorator_list
    rows.append(dict(project=project, call=call, callText=ast.get_source_segment(source,node), importLine=imports[0].lineno, importText=ast.get_source_segment(source,imports[0]), exportFile=export_file, exportLine=export_line, exportText=ast.get_source_segment(exports,export), targetHeader=definition_text.splitlines()[target_line-1], sha256={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in [call['file'],export_file,target_file]}))
receipt = dict(kind='post-design explicit source-chain anchor review', count=len(rows), limitation='Source-only agreement, not independent compiler attribution, complete scope analysis, runtime initialization proof or a precision/recall denominator. Includes the four selected cases; do not add counts.', rows=rows)
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(sourceChains=len(rows))))
