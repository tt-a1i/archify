"""Project Jedi's definition results onto captured CPython function facts."""

import ast
import base64
import io
from pathlib import Path
import sys
import sysconfig
from tempfile import TemporaryDirectory
import tokenize
import unicodedata

import jedi
import parso

from calls import source_lines
from platform_view import PLATFORMS, platform_view
from receiver_types import ReceiverTypes, Source


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


def blocked_lines(script, functions):
    errors = {error.line for error in script.get_syntax_errors()}
    blocked = set()
    if errors:
        for fn in functions:
            region = range(fn["definition"]["sourceRange"]["line"], fn["endLine"] + 1)
            if any(line in region for line in errors):
                blocked.update(region)
    return blocked if errors <= blocked else None


def exact_target(anchors, names, non_callable=()):
    locations = {(name.module_path, name.line, name.column) for name in names}
    if non_callable:
        locations -= non_callable
    if len(locations) == 1:
        file, line, column = locations.pop()
        return anchors.get(file, {}).get((line, column))
    return None


def member_fallback(script, callee, point, receiver_point, declaration, anchors):
    # Jedi can report an enum method as a builtin descriptor/value. A
    # captured class and its direct declaration give a source location.
    class_value = declaration.type == "instance" and declaration.module_name == "builtins"
    # goto stops at an export assignment. Follow its value only across a
    # captured module boundary and only to a single same-named function.
    export = (declaration.type == "statement" and declaration.module_path in anchors
              and declaration.module_path != script.path)
    if not (class_value or export) or receiver_point is None:
        return None
    receivers = script.goto(*receiver_point, follow_imports=True)
    if len(receivers) != 1 or receivers[0].module_path not in anchors:
        return None
    receiver = receivers[0]
    if class_value and receiver.type == "class":
        names = [name for name in receiver.defined_names() if name.name == callee.attr]
    elif export and receiver.type == "module" and receiver.module_path == declaration.module_path:
        names = script.infer(*point)
    else:
        return None
    if len(names) == 1 and names[0].type == "function" and names[0].name == callee.attr:
        return exact_target(anchors, names)
    return None


def write_snapshot(root, sources, views=None):
    for relative, encoded in sources.items():
        file = (root / relative).resolve()
        file.relative_to(root)
        file.parent.mkdir(parents=True, exist_ok=True)
        raw = base64.b64decode(encoded, validate=True)
        if views and relative in views:
            encoding = tokenize.detect_encoding(io.BytesIO(raw).readline)[0]
            raw = views[relative].encode(encoding)
        file.write_bytes(raw)


def none_assignments(root, inputs):
    locations = set()
    for record, _, _, tree in inputs:
        path = root / record["path"]
        lines, _ = source_lines(record["sourceText"])
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and node.value.value is None:
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        line, column = target.lineno, target.col_offset
                        locations.add((path, line, len(lines[line - 1].encode("utf-8")[:column].decode("utf-8"))))
    return locations


def resolve_queries(root, search, inputs, anchors, environment, views):
    project = jedi.Project(str(root), sys_path=list(map(str, search)), smart_sys_path=False,
                           load_unsafe_extensions=False)
    non_callable = none_assignments(root, inputs)
    for record, tokens, queries, _ in inputs:
        lines, _ = source_lines(record["sourceText"])
        names_by_end = {token.end: token for token in tokens if token.type == tokenize.NAME}
        queries = [(call, callee, callee_point(callee, lines, names_by_end)) for call, callee in queries if not call.get("_jedi")]
        if not any(point for _, _, point in queries):
            continue
        code = views.get(record["path"], record["sourceText"])
        script = jedi.Script(code, path=str(root / record["path"]),
                             project=project, environment=environment)
        blocked = blocked_lines(script, record["functions"])
        if blocked is None:
            continue
        selected, retry = {}, []
        for _, callee, point in queries:
            if point is None or point[0] in blocked or point in selected:
                continue
            names = script.goto(*point, follow_imports=True)
            # A None alternative cannot be the target of a successful call.
            target = exact_target(anchors, names, non_callable if isinstance(callee, ast.Name) else ())
            if target is None and len(names) == 1 and isinstance(callee, ast.Attribute):
                receiver = callee_point(callee.value, lines, names_by_end)
                target = member_fallback(script, callee, point, receiver, names[0], anchors)
            if not names and isinstance(callee, ast.Attribute):
                retry.append(point)
            selected[point] = target
        if retry:
            # A fresh inference state can recover an empty member lookup. Keep
            # retry results grounded in static types, without array mutations.
            dynamic = jedi.settings.dynamic_array_additions
            jedi.settings.dynamic_array_additions = False
            try:
                fresh = jedi.Script(code, path=script.path, project=project, environment=environment)
                for point in reversed(retry):
                    selected[point] = exact_target(anchors, fresh.goto(*point, follow_imports=True))
            finally:
                jedi.settings.dynamic_array_additions = dynamic
        for call, _, point in queries:
            if selected.get(point):
                call["_jedi"] = selected[point]


def resolve_receiver_types(root, search, inputs, environment, views):
    project = jedi.Project(str(root), sys_path=list(map(str, search)), smart_sys_path=False,
                           load_unsafe_extensions=False)
    sources = {root / record["path"]: Source(tree, record) for record, _, _, tree in inputs}
    tokens_by_source = {sources[root / record["path"]]: tokens for record, tokens, _, _ in inputs}
    scripts = {}

    for record, _, queries, _ in inputs:
        source = sources[root / record["path"]]
        source.targets = {source.parents[callee]: call for call, callee in queries}

    def lookup_function(source, call):
        target = source.targets.get(call, {}).get("_jedi")
        if target:
            origin = sources[root / target["file"]]
            if function := origin.functions.get((target["line"], target["name"])):
                return origin, function
        return None

    def captured_import(source, expr, scope):
        if not isinstance(expr, ast.Name) or not (binding := source.module_binding(expr.id, scope)):
            return None
        entry = binding[0]
        if not entry or entry["kind"] != "import":
            return None
        relative = Path(source.record["path"]).parent
        level = entry["level"]
        if level > len(relative.parts) + 1:
            return None
        parents = [root.joinpath(*relative.parts[:len(relative.parts) - level + 1])] if level else search[:2]
        matches = []
        for folder in parents:
            module = folder.joinpath(*entry["module"].split("."))
            candidates = [module / "__init__.py"]
            if entry["module"]:
                candidates.append(module.with_suffix(".py"))
            for candidate in candidates:
                if origin := sources.get(candidate):
                    matches.append(origin)
        if len(matches) == 1:
            origin = matches[0]
            cls = origin.local_type(entry["name"], origin.tree)
            if isinstance(cls, ast.ClassDef):
                return origin, cls
        return None

    def lookup_class(source, expr, scope):
        if captured := captured_import(source, expr, scope):
            return captured
        path = root / source.record["path"]
        if source not in scripts:
            code = views.get(source.record["path"], source.record["sourceText"])
            script = jedi.Script(code, path=str(path), project=project, environment=environment)
            tokens = {t.end: t for t in tokens_by_source[source] if t.type == tokenize.NAME}
            lines, _ = source_lines(source.record["sourceText"])
            scripts[source] = script, tokens, lines, blocked_lines(script, source.record["functions"])
        script, tokens, lines, blocked = scripts[source]
        point = callee_point(expr, lines, tokens)
        if point is None or blocked is None or point[0] in blocked:
            return None
        names = script.goto(*point, follow_imports=True)
        if len(names) == 1 and names[0].type == "class" and (origin := sources.get(names[0].module_path)):
            if cls := origin.classes.get((names[0].line, unicodedata.normalize("NFKC", names[0].name))):
                return origin, cls
        return None

    for record, _, queries, _ in inputs:
        evidence = ReceiverTypes(sources[root / record["path"]], lookup_class, lookup_function)
        for call, callee in queries:
            if not isinstance(callee, ast.Attribute):
                continue
            previous = call.get("_jedi")
            target, narrowed = evidence.target(callee, previous)
            if target and previous is None:
                call["_jedi"] = target
            elif target and target != previous and narrowed:
                owner = sources[root / previous["file"]].owners.get((previous["line"], previous["name"]))
                if owner and evidence.derives_from(narrowed, owner):
                    call["_jedi"] = target


def add_targets(sources, inputs, profile, stubs, dependencies):
    """Resolve project declarations using the captured sources and explicit type inputs."""
    with TemporaryDirectory(prefix="archify-python-jedi-") as scratch:
        workspace = Path(scratch).resolve()
        root, library = workspace / "source", workspace / "declarations"
        anchors = {root / record["path"]: definition_anchors(record["path"], tokens, record["functions"])
                   for record, tokens, _, _ in inputs}
        views = {}
        platform = profile.get("targetPlatform") or next((name for name, sys_name in PLATFORMS.items() if sys_name == sys.platform), "All")
        if platform != "All":
            for record, _, _, tree in inputs:
                text = record["sourceText"]
                code = platform_view(text, tree, platform)
                if code != text:
                    views[record["path"]] = code
        stdlib = Path(sysconfig.get_path("stdlib"))
        jedi.settings.cache_directory = str(workspace / "cache")
        environment = jedi.create_environment(sys.executable, safe=False)
        search = [root, root / "src", stdlib, stdlib / "lib-dynload"]
        root.mkdir()
        write_snapshot(root, sources, views)
        resolve_queries(root, search, inputs, anchors, environment, views)
        extra_paths = profile.get("extraPaths", [])
        if stubs or dependencies or extra_paths:
            write_snapshot(root, stubs)
            write_snapshot(library, dependencies)
            search = [root, root / "src", *(root / relative for relative in extra_paths), stdlib, stdlib / "lib-dynload", library]
            resolve_queries(root, search, inputs, anchors, environment, views)
        resolve_receiver_types(root, search, inputs, environment, views)
    return {"jedi": jedi.__version__, "parso": parso.__version__, "platform": platform if views else None}
