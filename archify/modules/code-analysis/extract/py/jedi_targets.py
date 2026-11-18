"""Project Jedi's definition results onto captured CPython function facts."""

import ast
import base64
from pathlib import Path
import sys
import sysconfig
from tempfile import TemporaryDirectory
import tokenize
import unicodedata

import jedi
import parso

from calls import source_lines


def definition_anchors(file, tokens, functions):
    measured = {(fn["line"], fn["sourceRange"]["column"]): fn for fn in functions}
    anchors = {}
    for i, token in enumerate(tokens):
        if token.type != tokenize.NAME or token.string != "def":
            continue
        start = tokens[i - 1] if i and tokens[i - 1].string == "async" else token
        column = len(start.line[:start.start[1]].encode("utf-16-le")) // 2 + 1
        fn = measured.get((start.start[0], column))
        name = tokens[i + 1]
        if fn and name.type == tokenize.NAME and unicodedata.normalize("NFKC", name.string) == fn["name"]:
            anchors[name.start] = {"file": file, "name": fn["name"], "line": fn["line"], "column": column}
    return anchors


def callee_point(node, lines, names_by_end):
    if isinstance(node, ast.Name):
        line, offset = node.lineno, node.col_offset
    elif isinstance(node, ast.Attribute):
        line, offset = node.end_lineno, node.end_col_offset
    else:
        return None
    column = len(lines[line - 1].encode("utf-8")[:offset].decode("utf-8"))
    if isinstance(node, ast.Name):
        return line, column
    token = names_by_end.get((line, column))
    if token and unicodedata.normalize("NFKC", token.string) == node.attr:
        return token.start
    return None


def add_targets(sources, inputs):
    """Run Jedi on a disposable copy of the capture and the interpreter's stdlib."""
    with TemporaryDirectory(prefix="archify-python-jedi-") as scratch:
        workspace = Path(scratch).resolve()
        root = workspace / "source"
        for relative, encoded in sources.items():
            file = (root / relative).resolve()
            file.relative_to(root)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(base64.b64decode(encoded, validate=True))

        anchors = {}
        for record, tokens, _ in inputs:
            relative = record["path"]
            anchors[root / relative] = definition_anchors(relative, tokens, record["functions"])

        stdlib = Path(sysconfig.get_path("stdlib"))
        search = [root, root / "src", stdlib, stdlib / "lib-dynload"]
        jedi.settings.cache_directory = str(workspace / "cache")
        project = jedi.Project(str(root), sys_path=list(map(str, search)), smart_sys_path=False,
                               load_unsafe_extensions=False)
        environment = jedi.create_environment(sys.executable, safe=False)

        for record, tokens, queries in inputs:
            lines, _ = source_lines(record["sourceText"])
            names_by_end = {token.end: token for token in tokens if token.type == tokenize.NAME}
            queries = [(call, callee_point(callee, lines, names_by_end)) for call, callee in queries]
            if not any(point for _, point in queries):
                continue
            script = jedi.Script(record["sourceText"], path=str(root / record["path"]),
                                 project=project, environment=environment)
            if script.get_syntax_errors():
                continue
            selected = {}
            for call, point in queries:
                if point is None:
                    continue
                if point not in selected:
                    locations = {(name.module_path, name.line, name.column)
                                 for name in script.goto(*point, follow_imports=True)}
                    selected[point] = None
                    if len(locations) == 1:
                        file, line, column = locations.pop()
                        selected[point] = anchors.get(file, {}).get((line, column))
                if selected[point]:
                    call["_jedi"] = selected[point]
    return {"jedi": jedi.__version__, "parso": parso.__version__}
