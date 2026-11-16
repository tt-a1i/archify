"""Frozen-input C/C++ extraction through libclang's C API Python binding.

The compilation database is copied to a private directory solely for libclang
to decode command/arguments. No compiler or project command is executed.
"""

import base64
from collections import defaultdict
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path


def fail(code, message, evidence=None, fixes=None):
    raise ScopeError(code, message, evidence or {}, fixes or [])


class ScopeError(Exception):
    def __init__(self, code, message, evidence, fixes):
        super().__init__(message)
        self.code, self.evidence, self.fixes = code, evidence, fixes


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relative(root, name):
    if not name:
        return None
    full = Path(name).resolve()
    try:
        return full.relative_to(root).as_posix()
    except ValueError:
        return None


def source_point(data, location):
    offset = location.offset
    before = data[:offset]
    start = max(before.rfind(b"\n"), before.rfind(b"\r")) + 1
    column = len(before[start:].decode("utf-8").encode("utf-16-le")) // 2 + 1
    return location.line, column


def flags(command, source, directory, sysroot):
    argv = list(command.arguments)
    if len(argv) < 2:
        fail("extract/cpp-command-invalid", "Compilation command has no parser arguments.", {"file": source})
    args = []
    next_path = {"-I", "-isystem", "-iquote", "-idirafter", "-isysroot", "--sysroot", "-F", "-iframework"}
    joined_path = ("-iframework", "-isystem", "-iquote", "-idirafter", "-isysroot", "-I", "-F")
    drop_next = {"-o", "-MF", "-MT", "-MQ", "-MJ"}
    unsafe = ("-Xclang", "-Xpreprocessor", "--config", "-load", "-plugin", "-fplugin", "-include", "-imacros",
              "-ivfsoverlay", "-fmodule", "-fprebuilt-module", "-fprofile-instr-use",
              "-fprofile-sample-use", "-fprofile-use", "-fprofile-list",
              "-fprofile-remapping-file", "-index-store-path", "-fmodules-cache-path")
    index = 1
    while index < len(argv):
        arg = argv[index]
        if arg.startswith("@") or any(arg.startswith(bad) for bad in unsafe):
            fail("extract/cpp-command-unsupported", "Compilation command contains an unsupported file-loading or plugin option.", {"file": source, "option": arg})
        if arg in drop_next:
            index += 2
            continue
        if arg in next_path:
            if index + 1 >= len(argv):
                fail("extract/cpp-command-invalid", "Compilation command has an option without a path.", {"file": source, "option": arg})
            value = argv[index + 1]
            args += [arg, str(Path(directory, value).resolve()) if not os.path.isabs(value) else value]
            index += 2
            continue
        prefix = next((flag for flag in joined_path if arg.startswith(flag) and len(arg) > len(flag)), None)
        if prefix:
            value = arg[len(prefix):]
            args.append(prefix + (str(Path(directory, value).resolve()) if not os.path.isabs(value) else value))
        elif arg.startswith("--sysroot="):
            value = arg[len("--sysroot="):]
            args.append("--sysroot=" + (str(Path(directory, value).resolve()) if not os.path.isabs(value) else value))
        elif arg.startswith("-o") and len(arg) > 2 or any(arg.startswith(flag) and len(arg) > len(flag) for flag in ("-MF", "-MT", "-MQ", "-MJ")):
            pass
        elif arg == "-c" or Path(directory, arg).resolve() == Path(source):
            pass
        else:
            args.append(arg)
        index += 1
    if sysroot and not any(arg == "-isysroot" or arg.startswith("--sysroot") for arg in args):
        args += ["-isysroot", sysroot]
    return args


def command_scope(args):
    values = {"standards": [], "defines": [], "includePaths": [], "target": None}
    for index, arg in enumerate(args):
        if arg.startswith("-std="):
            values["standards"].append(arg[5:])
        if arg == "-D" and index + 1 < len(args):
            values["defines"].append(args[index + 1].split("=", 1)[0])
        elif arg.startswith("-D") and len(arg) > 2:
            values["defines"].append(arg[2:].split("=", 1)[0])
        if arg in ("-I", "-isystem", "-iquote", "-idirafter", "-F", "-iframework") and index + 1 < len(args):
            values["includePaths"].append(args[index + 1])
        else:
            prefix = next((flag for flag in ("-iframework", "-isystem", "-iquote", "-idirafter", "-I", "-F")
                           if arg.startswith(flag) and len(arg) > len(flag)), None)
            if prefix:
                values["includePaths"].append(arg[len(prefix):])
        if arg.startswith("--target="):
            values["target"] = arg[9:]
    return values


def include_specifier(data, line, fallback):
    lines = data.splitlines()
    if 0 < line <= len(lines):
        match = re.match(rb"\s*#\s*include(?:_next)?\s*(?:[<\"]([^>\"]+)[>\"]|(\S+))", lines[line - 1])
        if match:
            return (match.group(1) or match.group(2)).decode("utf-8", "replace")
    return fallback


def collect_functions(cursor, context, root, sources, kinds, branches, nesting_kinds, output, template_points):
    if cursor.kind in kinds and cursor.is_definition():
        extent = cursor.extent
        start_file = relative(root, extent.start.file.name if extent.start.file else None)
        end_file = relative(root, extent.end.file.name if extent.end.file else None)
        if start_file and start_file == end_file and start_file in sources:
            data = sources[start_file]
            first, last = extent.start.offset, extent.end.offset
            if 0 <= first < last <= len(data):
                parents = []
                parent = cursor.semantic_parent
                while parent and parent.kind != parent.kind.TRANSLATION_UNIT:
                    if parent.spelling:
                        parents.append(parent.spelling)
                    parent = parent.semantic_parent
                name = cursor.spelling or cursor.displayname
                qualname = "::".join(reversed(parents)) + ("::" if parents else "") + (cursor.displayname or name)
                line, column = source_point(data, extent.start)
                end_line, end_column = source_point(data, extent.end)
                complexity, nesting, deepest = measure(cursor, kinds, branches, nesting_kinds)
                record = {"file": start_file, "name": name, "qualname": qualname,
                          "line": line, "endLine": end_line, "complexity": complexity,
                          "nesting": nesting, "deepestLine": deepest,
                          "sourceRange": {"line": line, "column": column, "endLine": end_line,
                                          "endColumn": end_column, "sha256": digest(data[first:last])},
                          "definition": {"kind": "ClangFunction", "sourceRange": {"line": line, "column": column,
                            "endLine": end_line, "endColumn": end_column, "sha256": digest(data[first:last])}}}
                output.append((record, context))
                if template_owned(cursor):
                    template_points.add((start_file, line, column, name))
    for child in cursor.get_children():
        collect_functions(child, context, root, sources, kinds, branches, nesting_kinds, output, template_points)


def measure(cursor, functions, branches, nesting_kinds):
    complexity, deepest, deepest_line = 1, 0, cursor.location.line

    def walk(node, depth):
        nonlocal complexity, deepest, deepest_line
        for child in node.get_children():
            if child.kind in functions or child.kind == child.kind.LAMBDA_EXPR:
                continue
            nested = depth + (child.kind in nesting_kinds)
            if child.kind in branches:
                complexity += 1
                if nested > deepest:
                    deepest, deepest_line = nested, child.location.line
            walk(child, nested)

    walk(cursor, 0)
    return complexity, deepest, deepest_line


def template_owned(cursor):
    while cursor and cursor.kind.name != "TRANSLATION_UNIT":
        if cursor.kind.name in ("FUNCTION_TEMPLATE", "CLASS_TEMPLATE", "CLASS_TEMPLATE_PARTIAL_SPECIALIZATION"):
            return True
        cursor = cursor.semantic_parent
    return False


def collect_calls(cursor, context, root, sources, kinds, definitions, template_points, output, caller=None):
    location = cursor.extent.start
    file = relative(root, location.file.name if location.file else None)
    if cursor.kind in kinds and cursor.is_definition() and file in sources:
        data = sources[file]
        line, column = source_point(data, location)
        fn = definitions.get((file, line, column, cursor.spelling))
        if fn:
            caller = {"file": file, "name": fn["name"], "qualname": fn["qualname"],
                      "kind": "method" if cursor.kind.name in ("CXX_METHOD", "CONSTRUCTOR", "DESTRUCTOR") else "function",
                      "line": line, "column": column}
    if cursor.kind.name == "CALL_EXPR" and file in sources:
        data = sources[file]
        end_file = relative(root, cursor.extent.end.file.name if cursor.extent.end.file else None)
        first, last = location.offset, cursor.extent.end.offset
        if end_file == file and 0 <= first < last <= len(data):
            line, column = source_point(data, location)
            end_line, end_column = source_point(data, cursor.extent.end)
            record = {"file": file, "line": line, "column": column,
                      "endLine": end_line, "endColumn": end_column,
                      "resolution": "unresolved", "reason": "cpp-unbound"}
            if caller:
                record["directCaller"] = caller
            referenced = cursor.referenced
            if referenced and referenced.kind.name == "CXX_METHOD" and referenced.is_virtual_method():
                record["reason"] = "cpp-virtual-dispatch"
            elif referenced and template_owned(referenced):
                record["reason"] = "cpp-template"
            elif referenced and referenced.kind.name in ("FUNCTION_DECL", "CXX_METHOD"):
                definition = referenced.get_definition()
                if definition and template_owned(definition):
                    record["reason"] = "cpp-template"
                elif definition and definition.kind.name in ("FUNCTION_DECL", "CXX_METHOD"):
                    target_file = relative(root, definition.extent.start.file.name if definition.extent.start.file else None)
                    if target_file in sources:
                        target_data = sources[target_file]
                        target_line, target_column = source_point(target_data, definition.extent.start)
                        target_key = (target_file, target_line, target_column, definition.spelling)
                        target = definitions.get(target_key)
                        text = data[first:last].decode("utf-8")
                        if target_key in template_points:
                            record["reason"] = "cpp-template"
                        elif target and re.search(r"\b" + re.escape(definition.spelling) + r"\s*\(", text):
                            record.pop("reason")
                            record["resolution"] = "cpp-direct-source"
                            record["target"] = {"file": target_file, "name": definition.spelling,
                                                "line": target_line, "column": target_column}
                        elif target:
                            record["reason"] = "cpp-macro-expansion"
            elif referenced and referenced.kind.name in ("VAR_DECL", "PARM_DECL", "FIELD_DECL"):
                record["reason"] = "cpp-function-pointer"
            output.append((record, context))
    for child in cursor.get_children():
        collect_calls(child, context, root, sources, kinds, definitions, template_points, output, caller)


def main(payload):
    try:
        from clang import cindex
    except ImportError:
        fail("extract/cpp-bindings-unavailable", "Python clang bindings are unavailable.", fixes=["install matching clang Python bindings for the selected Python interpreter"])
    if os.environ.get("ARCHIFY_LIBCLANG"):
        cindex.Config.set_library_file(os.environ["ARCHIFY_LIBCLANG"])
    try:
        index = cindex.Index.create()
        version_function = cindex.conf.lib.clang_getClangVersion
        version_function.restype = cindex._CXString
        version_string = version_function()
        version = cindex.conf.lib.clang_getCString(version_string)
        if isinstance(version, bytes):
            version = version.decode("utf-8")
    except Exception as error:
        fail("extract/cpp-libclang-unavailable", "libclang could not be loaded by the Python bindings.", {"reason": str(error)}, ["install libclang matching the Python clang bindings; set ARCHIFY_LIBCLANG to the library path"])
    root = Path(payload["root"]).resolve()
    sources = {name: base64.b64decode(value) for name, value in payload["sources"].items()}
    allowed = set(payload["allowed"])
    for name, data in sources.items():
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            fail("extract/cpp-encoding-invalid", "Captured C/C++ source must be UTF-8.", {"file": name})
    unsaved = [(str(root / name), data.decode("utf-8")) for name, data in sources.items()]
    selected, excluded, units, errors = set(), [], [], []
    imports, functions, calls, conflicts = {}, {}, {}, []
    file_contexts = defaultdict(set)
    declared = set(payload["candidates"])
    kinds = {cindex.CursorKind.FUNCTION_DECL, cindex.CursorKind.CXX_METHOD,
             cindex.CursorKind.CONSTRUCTOR, cindex.CursorKind.DESTRUCTOR,
             cindex.CursorKind.FUNCTION_TEMPLATE}
    branches = {cindex.CursorKind.IF_STMT, cindex.CursorKind.FOR_STMT,
                cindex.CursorKind.WHILE_STMT, cindex.CursorKind.DO_STMT,
                cindex.CursorKind.CASE_STMT, cindex.CursorKind.CXX_CATCH_STMT,
                cindex.CursorKind.CONDITIONAL_OPERATOR}
    nesting_kinds = branches - {cindex.CursorKind.CASE_STMT}
    nesting_kinds.add(cindex.CursorKind.SWITCH_STMT)
    with tempfile.TemporaryDirectory(prefix="archify-cpp-cdb-") as temporary:
        (Path(temporary) / "compile_commands.json").write_text(payload["database"], encoding="utf-8")
        entries = json.loads(payload["database"])
        exact_files = set()
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("directory"), str) or not isinstance(entry.get("file"), str):
                fail("extract/cpp-database-invalid", "Compilation database entries need directory and file strings.")
            if not os.path.isabs(entry["directory"]):
                fail("extract/cpp-command-invalid", "Compilation command directory must be absolute.", {"directory": entry["directory"]})
            exact_files.add(str(Path(entry["directory"], entry["file"]).resolve()))
        try:
            database = cindex.CompilationDatabase.fromDirectory(temporary)
        except Exception as error:
            fail("extract/cpp-database-invalid", "libclang could not read the captured compilation database.", {"reason": str(error)})
        for name in sorted(declared):
            source = str(root / name)
            if source not in exact_files:
                excluded.append({"file": name, "reason": "no-compile-command"})
                continue
            commands = database.getCompileCommands(source)
            if not commands:
                excluded.append({"file": name, "reason": "no-compile-command"})
                continue
            choices = []
            for command in commands:
                directory = command.directory
                if not os.path.isabs(directory):
                    fail("extract/cpp-command-invalid", "Compilation command directory must be absolute.", {"file": name, "directory": directory})
                args = flags(command, source, directory, payload["sysroot"])
                choices.append(args)
            unique = {json.dumps(args, separators=(",", ":")): args for args in choices}
            if len(unique) != 1:
                fail("extract/cpp-command-ambiguous", "A translation unit has multiple distinct compilation commands.", {"file": name, "commands": len(unique)}, ["select one build configuration and regenerate compile_commands.json"])
            args = next(iter(unique.values()))
            selected.add(name)
            file_contexts[name].add(name)
            unit_scope = {"file": name, "commandSha256": digest(json.dumps(args).encode("utf-8")),
                          "configuration": command_scope(args)}
            try:
                tu = index.parse(source, args=args, unsaved_files=unsaved,
                                 options=cindex.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD)
            except Exception as error:
                errors.append({"path": name, "message": str(error)})
                units.append({**unit_scope, "status": "parse-error"})
                continue
            severe = [str(item) for item in tu.diagnostics if item.severity >= 3]
            if severe:
                errors.append({"path": name, "message": "; ".join(severe[:3])})
                units.append({**unit_scope, "status": "parse-error"})
                continue
            units.append({**unit_scope, "status": "parsed"})
            for included in tu.get_includes():
                origin = relative(root, included.source.name if included.source else None)
                target = relative(root, included.include.name if included.include else None)
                if not origin or origin not in sources:
                    continue
                if target and target not in sources:
                    fail("extract/cpp-source-not-captured", "libclang read a project include absent from the frozen source inventory.", {"file": target, "translationUnit": name}, ["include this header in the analysis root and accepted source suffixes"])
                if target and target not in allowed:
                    fail("extract/cpp-header-excluded", "An active project include is excluded by the analysis configuration.", {"file": target, "translationUnit": name}, ["include this header in config.include and remove its exclude pattern"])
                if target:
                    selected.add(target)
                    file_contexts[target].add(name)
                specifier = include_specifier(sources[origin], included.location.line,
                                              Path(included.include.name).name if included.include else "unknown")
                row = {"from": origin, "specifier": specifier, "kind": "static",
                       "line": included.location.line, "resolved": bool(target),
                       **({"to": target} if target else {})}
                key = (origin, included.location.line, target, specifier)
                if key not in imports:
                    imports[key] = (row, set())
                imports[key][1].add(name)
            observed = []
            template_points = set()
            collect_functions(tu.cursor, name, root, sources, kinds, branches, nesting_kinds, observed, template_points)
            local_definitions = {}
            for record, context in observed:
                rng = record["sourceRange"]
                local_definitions[(record["file"], rng["line"], rng["column"], record["name"])] = record
                key = (record["file"], rng["line"], rng["column"], rng["endLine"], rng["endColumn"])
                value = functions.get(key)
                if value is None:
                    functions[key] = (record, {context}, False)
                else:
                    old, contexts, conflict = value
                    contexts.add(context)
                    changed = any(old[field] != record[field] for field in ("name", "qualname", "complexity", "nesting", "deepestLine", "sourceRange"))
                    functions[key] = (old, contexts, conflict or changed)
            observed_calls = []
            collect_calls(tu.cursor, name, root, sources, kinds, local_definitions, template_points, observed_calls)
            for record, context in observed_calls:
                key = (record["file"], record["line"], record["column"], record["endLine"], record["endColumn"])
                value = calls.get(key)
                if value is None:
                    calls[key] = (record, {context}, False)
                else:
                    old, contexts, conflict = value
                    contexts.add(context)
                    changed = any(old.get(field) != record.get(field) for field in ("resolution", "target", "reason", "directCaller"))
                    calls[key] = (old, contexts, conflict or changed)
    if not selected:
        fail("extract/cpp-no-commands", "No selected translation unit has a compilation database command.", fixes=["generate compile_commands.json for this root and build configuration"])
    resolved_imports = [{**row, "contexts": sorted(contexts)} for row, contexts in imports.values()]
    resolved_imports.sort(key=lambda row: (row["from"], row["line"], row["specifier"], row.get("to", "")))
    final_functions = []
    for record, contexts, conflict in functions.values():
        if conflict:
            conflicts.append({"file": record["file"], "line": record["line"], "reason": "context-dependent-definition", "contexts": sorted(contexts)})
        else:
            final_functions.append({**record, "contexts": sorted(contexts)})
    final_functions.sort(key=lambda row: (row["file"], row["line"], row["qualname"]))
    recorded_targets = {(fn["file"], fn["name"], fn["sourceRange"]["line"], fn["sourceRange"]["column"])
                        for fn in final_functions}
    final_calls = []
    for record, contexts, conflict in calls.values():
        target = record.get("target")
        missing_target = target and (target["file"], target["name"], target["line"], target["column"]) not in recorded_targets
        if conflict or missing_target:
            record = {**record, "resolution": "unresolved", "reason": "cpp-context-dependent"}
            record.pop("target", None)
        final_calls.append({**record, "contexts": sorted(contexts)})
    final_calls.sort(key=lambda row: (row["file"], row["line"], row["column"], row["endLine"], row["endColumn"]))
    return {"libclang": str(version), "selectedFiles": sorted(selected), "excludedFiles": excluded,
            "units": units, "imports": resolved_imports, "functions": final_functions,
            "calls": final_calls, "fileContexts": {file: sorted(contexts) for file, contexts in sorted(file_contexts.items())},
            "conflicts": conflicts, "parse_errors": errors,
            "unresolved": {"external": sum(not row["resolved"] for row in resolved_imports),
                           "outside": 0, "unknown": 0, "opaque": 0}}


if __name__ == "__main__":
    try:
        print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False))
    except ScopeError as error:
        print(json.dumps({"code": error.code, "error": str(error), "evidence": error.evidence,
                          "fixes": error.fixes}, ensure_ascii=False))
