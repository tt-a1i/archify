# C and C++ source analysis

Use `--language c` for C translation units or `--language cpp` for a C++ project.
The C++ selection also includes `.c` translation units listed in the same
compilation database. Each run still analyzes one language selection. Headers
derive their language and active preprocessor branches from an including
translation unit; their suffix alone does not select a parser mode.

## Prerequisites and command

Provide an existing `compile_commands.json` and a Python interpreter with
`clang` bindings compatible with an installed `libclang`. Archify reads the
database and source files; it never invokes the database's compiler, CMake,
Make, project tests or generators. CMake can produce a database with
`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` using Ninja or Makefile generators; run
that configuration yourself before analysis. A header-only project without a
translation-unit command is outside this adapter's scope.

For the locally verified Apple Clang 14 setup:

```sh
python3 -m venv /path/to/clang-venv
/path/to/clang-venv/bin/python -m pip install 'clang==14.0.6'
export ARCHIFY_CPP_PYTHON=/path/to/clang-venv/bin/python
export ARCHIFY_LIBCLANG=/Library/Developer/CommandLineTools/usr/lib/libclang.dylib
```

`ARCHIFY_LIBCLANG` is also the library override on Linux and Windows (point it
at the installed `libclang.so` or `libclang.dll`). `ARCHIFY_CPP_SYSROOT` can
override the system root; macOS otherwise asks `xcrun --show-sdk-path`. The
current integration has been exercised on macOS with Apple Clang 14. Linux and
Windows distribution and SDK combinations still need validation before they
are claimed as supported release environments.

Create an analysis config, for example:

```json
{
  "cpp": {
    "compileCommands": "build/compile_commands.json"
  }
}
```

The path may be absolute or relative to the analysis root; the file must be
named `compile_commands.json`. An explicit `cpp.sysroot` overrides environment
and macOS auto-detection. `cpp.timeoutMs` defaults to 180000 and accepts
10000–600000 milliseconds for larger selections. Then run:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/project --language cpp --config /path/to/analysis.config.json --out /path/to/analysis --fail-on never
```

`--fail-on never` is useful for initial inspection; it does not certify a clean
project. `check` and `prepare` expose the same captured facts in receipts and
the offline analysis view.

## Evidence and limits

Only source files with an exact, unique database command are parsed. A
database lookup's inferred fallback command is never accepted. Missing
commands, parser diagnostics and ambiguous commands are recorded or rejected
explicitly. `languageScope.build.units` gives each selected translation unit,
its command digest, standard, macro names, include paths, target and parse
status. The raw database text is not saved in `raw-facts.json`; its SHA-256 is.
If the database changes, a saved question is stale and a findings comparison
reports changed build scope.

Project source bytes are captured once and passed to libclang as unsaved files.
If an active project include was not captured or was excluded, extraction
stops instead of mixing live source with frozen facts. External SDK and
third-party headers remain parser context, not captured project files. The
adapter rejects response files, plugins, precompiled/module state and other
unverified file-loading flags. It does not prove that the project builds.
The default C/C++ input set includes `.h`, `.hh`, `.hpp`, `.hxx`, `.inc`,
`.ipp`, `.inl`, `.tcc`, `.tpp` and `.def` includes. Files excluded by the analysis
configuration are not decoded or counted toward the source-byte budget. An
active include of an excluded project file stops extraction with an explicit
diagnostic. UTF-8 validation applies to translation units with a compile
command and to active project includes; unused files do not block extraction.
Project headers reached through an external wrapper are still captured and
assigned to their including translation units.

An include edge means the directive was active in at least one recorded
translation-unit context. `contexts` names those units; the module graph is
their union. Cycle findings require a common context for every edge and are
structural warnings, never claims about runtime initialization. They list all
observed contexts and show one path from `exampleContext`; other contexts may
use a different path. Function
complexity counts `if`, loops, `case`, catch and conditional-expression nodes
plus one; nesting records branch/switch depth. A physical definition observed
with conflicting identity or measurements across contexts is omitted and listed under
`languageScope.conflicts`.

`cpp-source-direct-v1` inventories libclang call expressions and binds a
source definition only when it is visible in that same translation unit,
matches a captured function extent, and is an ordinary direct call. Virtual
dispatch, function pointers, template and macro-generated calls, and calls
requiring cross-unit linkage remain unresolved. Bound targets are source
navigation evidence, not proof of execution or a complete call graph.
Macro callee expansion is checked against Clang's preprocessing records;
macros confined to an ordinary call's arguments do not hide its direct target.
If caller identities disagree across contexts, the merged call omits
`directCaller`; an agreed caller is retained even when the target is unknown.

## Source questions

Saved questions for `.c`, `.cc`, `.cpp`, `.cxx` and `.C` entries use their own
translation unit. All captured header suffixes above are accepted as saved
question entries. For a header, pass one of its recorded contexts:

```sh
node archify/bin/archify.mjs code-analysis task /path/to/analysis --root /path/to/project --entry include/api.h --context src/main.cpp --function chosen --question 'Who calls this definition?' --format json
```

The question checks the current entry, displayed target files and the
compilation database digest before offering navigation. An unchanged database
does not prove that external SDK files are unchanged. Fresh paired questions
accept C/C++ translation-unit entries; the comparison is partial when the
observed database or parser settings differ between roots.

The full-regression CI shard installs the matching bindings and native library
from `libclang==18.1.1` and sets `ARCHIFY_CPP_REQUIRED=1`, so the C/C++ tests fail
when the parser is unavailable. Other local lanes may explicitly skip native
tests when no parser is installed. Regenerate C/C++ facts with adapter revision
4 to obtain the corrected macro and caller provenance.
