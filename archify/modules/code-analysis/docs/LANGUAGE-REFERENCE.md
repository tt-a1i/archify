# Language Reference

Each run selects one language. Run these commands from the repository root. The
JavaScript/TypeScript, Python and Java examples use checked-in fixtures and do
not build or execute the fixture projects. Go and Rust use a project path you
supply because those adapters require their respective project metadata and
installed toolchains.

## JavaScript and TypeScript

```sh
node archify/bin/archify.mjs code-analysis check archify/modules/code-analysis/test/fixtures/ts-basic --language ts --out out/ts
```

`src/index.mjs` records static imports, re-exports, namespace imports and
literal dynamic imports. Function bodies and deferred imports remain distinct
from module-scope edges. The computed dynamic import in the fixture is retained
as unresolved evidence rather than guessed as a file edge. TypeScript uses the
project's captured `tsconfig` and path aliases; type-only imports do not become
runtime dependencies.

## Python

```sh
BAUIFY_PYTHON=/path/to/python node archify/bin/archify.mjs code-analysis check archify/modules/code-analysis/test/fixtures/py-basic --language py --out out/py --fail-on never
```

The fixture can report warnings. `--fail-on never` keeps this demonstration
from failing the findings gate; it does not mean the default gate would pass.
The adapter records package-relative imports and measures functions. Namespace
packages and `__init__.py` package initialization affect dependency resolution.
The `py-basic` fixture includes malformed source and a namespace package to
show that parse failures and unresolved imports remain visible in coverage.
Python code is parsed by the configured interpreter; a parser error is not
recovered by silently choosing another interpreter.

## Java

```sh
node archify/bin/archify.mjs code-analysis check archify/modules/code-analysis/test/fixtures/java-basic --language java --out out/java --fail-on never
```

As with the Python example, `--fail-on never` demonstrates the analysis without
asserting that the default findings gate passes. The adapter records
unambiguous source-level type dependencies and method
complexity without running a JDK, Maven, Gradle or project tests. The fixture
includes declarations, imports and an external-supertype case whose inherited
member type is deliberately left unresolved. Java cycles are structural
dependencies; they do not claim class-initialization failure. See
[Java support and limitations](JAVA.md) for parser and resolution boundaries.

## Go

```sh
node archify/bin/archify.mjs code-analysis check /path/to/go-module --language go --out out/go
```

Go analysis requires a root `go.mod` and an installed Go 1.18+ compiler. It
captures root-module source scope, function definitions and conservative direct
function bindings. Build selection, excluded files, parse failures and
incomplete typing remain explicit; it does not download modules or establish a
complete build or runtime call graph. See [Go support and limitations](GO.md)
for toolchain selection, commands and source-question examples.

## Rust

```sh
node archify/bin/archify.mjs code-analysis check /path/to/rust-workspace --language rust --out out/rust
```

Rust analysis requires Cargo/rustc 1.71+ and captures declared local workspace
targets, function ranges and bounded direct-reference evidence. Its first use
compiles the bundled parser helper and may fetch that helper's locked
dependencies; project build scripts and macros are not executed. Conditional
compilation, unsupported paths, macros and unresolved dispatch retain explicit
uncertainty. See [Rust support and limitations](RUST.md) for toolchain,
workspace, call-model and source-question details.

## Evidence

For every language, `raw-facts.json` records parsed files, source locations,
language-specific facts and unresolved or excluded scope. `findings.json`
records the selected adapter, rule versions, configuration digest and coverage.
A clean run only describes the checks that ran; it does not establish that
unmodeled dependencies or runtime behavior are absent.
