# Code Analysis technical guide: what is behind the code

Written for someone reading this module for the first time. Each section answers four questions: what this is, where it is in the code, why it is used, and where it bites. When you meet something unfamiliar while reading the code, come back here.

The suggested reading order follows the pipeline: the runtime first (Node, ESM), then the contracts (JSON Schema), then the technology behind each stage in the order extract → graphs → evaluate → overlay, then the `serve` process that ties them to the click, and finally tests and cross-platform issues.

---

## 1. Runtime: Node.js and ES modules

### What it is

Bauify is a Node.js command-line program. The `.mjs` extension means the files are **ES modules** (ESM), JavaScript's official module system, using `import` / `export` statements rather than CommonJS's `require()` / `module.exports`.

```js
// extract/py/index.mjs
import { spawnSync } from 'node:child_process';   // a Node built-in, with the node: prefix
import { fail } from '../shared/diagnostics.mjs';  // a file in this repository; the extension is mandatory
export const id = 'py';
export function extract(root, config) { … }
```

### Why

`"type": "module"` in `package.json` makes the whole package ESM by default. ESM was chosen over CommonJS for two reasons: Archify is ESM too, so the style matches; and an ESM `import` is static, which is exactly the "statically analysable dependency" property Bauify relies on when it analyses other people's code.

### Where it bites

- Relative imports in ESM **must include the extension**: `'./files.mjs'`, not `'./files'`.
- There is no `__dirname` in ESM. To find the directory of the current file use `fileURLToPath(import.meta.url)`; the top of `extract/py/index.mjs` does exactly that to locate `extract.py`.
- `import()` with parentheses is a **dynamic import**: it returns a Promise and its argument can be any expression. This comes back in the "opaque" section below.

---

## 2. Contracts: JSON Schema and ajv

### What it is

**JSON Schema** is a standard for describing, in JSON, what a JSON document should look like. Each JSON-producing stage of Bauify has a schema for its output: `schemas/raw-facts.schema.json`, `schemas/module-graph.schema.json`, `schemas/findings.schema.json`.

**ajv** is the most widely used JSON Schema validator for Node. The code is in `extract/shared/schema.mjs`:

```js
import Ajv2020 from 'ajv/dist/2020.js';           // the draft 2020-12 flavour
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(schema);              // compile the schema into a validation function
if (!validate(data)) console.log(validate.errors); // each error carries instancePath and message
```

### Why

The contract comes before the code. Once a schema is written, extract's output is validated **before it is written to disk**, and graphs' input is validated **as soon as it is read**. A stage that emits non-conforming JSON fails immediately with `extract/schema-invalid` instead of making the next stage crash mysteriously.

Two constructs in the schemas worth a look:

```json
"if":   { "properties": { "resolved": { "const": true } } },
"then": { "required": ["to"] },
"else": { "not": { "required": ["to"] } }
```

This is a **conditional constraint**: when `resolved` is true, `to` must be present; when false, it must not be. The invariant used to live in a comment; a reviewer pointed out that a comment is not a constraint, so it became something the schema enforces.

`"additionalProperties": false` forbids fields the schema does not list, so an adapter cannot quietly smuggle private fields into the public contract.

### Where it bites

- Draft 2020-12 must be imported from `ajv/dist/2020.js`; the default `ajv` export only knows draft-07 and reports "no schema with key or ref".
- ajv's `strict: true` rejects a `then` that `required`s a property defined one level up (`strictRequired`). We switch `strictRequired` off and keep every other strict check.

---

## 3. extract/ts: the TypeScript Compiler API

### What it is

TypeScript is a language, but the `typescript` package also exposes the compiler as an API that parses source into an **AST** (abstract syntax tree) and performs type analysis. It parses plain JavaScript too (`allowJs: true`), so Bauify uses it for both JS and TS.

### What an AST is

An AST is a tree representation of source code. The line `import { a } from './x.mjs'` becomes an `ImportDeclaration` node with an `ImportClause` (what is imported) and a `StringLiteral` (where from) underneath. Analysing code means finding nodes of particular kinds in the tree.

The traversal in `extract/ts/index.mjs` (`collectImports`):

```js
const visit = (node) => {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    found.push({ specifier: node.moduleSpecifier.text, kind: 'static', line: lineOf(source, node), … });
  } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    // import(...) — dynamic import
  }
  ts.forEachChild(node, visit);   // recurse into every child
};
visit(sourceFile);
```

The `ts.isXxx(node)` functions are type guards that test a node's kind; `ts.forEachChild` walks depth-first.

### Program and type checker

At first Bauify parsed one file at a time with `ts.createSourceFile`. The upstream reviewer changed it to `ts.createProgram(files, { noResolve: true, noLib: true })` plus `program.getTypeChecker()` because of a real bug:

```js
function local() { require('./dep'); var require = (s) => s; }
```

Here `require` is a local variable, not the CommonJS loader. Syntax alone cannot tell; the type checker's `getSymbolAtLocation(identifier)` says which declaration an identifier is bound to — no declaration means the global `require`, a declaration means a local. `noResolve` and `noLib` make the Program do lexical binding only, without resolving modules or the standard library, so the cost stays acceptable.

### Module resolution

`ts.resolveModuleName(specifier, containingFile, options, ts.sys)` resolves `'../shared/cli.mjs'` to an absolute path by Node's rules. Bauify then checks whether that path is inside the analyzed root and in the file set, and classifies the import as resolved / outside / unknown.

### Why not dependency-cruiser or Babel

They only give import edges. The symbol and call graphs in M2 need references and calls, which the TS API yields in the same traversal, so there is no need for a second parser.

### Where it bites

- `node.getStart(source)` needs the sourceFile argument; without it, positions are wrong in Program mode.
- Sorting with `localeCompare` depends on the operating system locale and differs between machines — see section 9.

---

## 4. extract/py: Python's standard-library `ast` in a subprocess

### What it is

Python ships an `ast` module that does what the TS parser does: `ast.parse(source)` gives the tree, `ast.walk(tree)` traverses it. `extract/py/extract.py` uses only the standard library; nothing needs to be pip-installed.

```python
for node in ast.walk(tree):
    if isinstance(node, ast.Import):          # import a.b as c
        …
    elif isinstance(node, ast.ImportFrom):    # from ..pkg import x, y
        level = node.level                    # number of leading dots: 0 absolute, 1 this package, 2 the parent
        module = node.module or ""            # None for `from . import x`
```

The script also records two things the rules need later: whether an import sits inside a function body (`lazy`, decided by the line ranges of every `def`), and every name bound at module scope with the line where it becomes bound (`symbols`: functions, classes, assignments, import aliases; it walks into top-level `if` / `try` / `with` blocks but not into function or class bodies).

### Subprocess and inter-process communication

Node cannot run Python code directly, so `extract/py/index.mjs` starts a Python process with `child_process.spawnSync`, writes the file list as JSON to its **stdin**, and reads JSON back from its **stdout**:

```js
const result = spawnSync('python3', [SCRIPT], { input: JSON.stringify(request), encoding: 'utf8' });
const output = JSON.parse(result.stdout);
```

`spawnSync` is synchronous: Node waits for Python to finish. For a command-line tool that is the simplest option; no concurrency to manage.

The interpreter is usually `python` on Windows and `python3` on Linux / macOS, and Windows also has the `py -3` launcher. The code tries the three in order and reports `extract/python-unavailable` only when all fail; `BAUIFY_PYTHON` names an interpreter explicitly.

### Why resolution happens on the Node side

The Python script only emits raw import statements; turning `from utils import logger` into `utils/logger.py` happens in Node. That way the definitions of external / outside / unknown / opaque exist once, and the two languages cannot drift apart.

### Python import semantics (the part newcomers find hardest)

- **Package**: a directory with `__init__.py`. `import pkg` actually loads `pkg/__init__.py`.
- **Relative import**: the dots in `from .a import x` mean "relative to the package this file is in". `level=1` is the same directory, `level=2` the parent. Leaving the analyzed root is recorded as `outside`.
- **`from pkg import name`** has two readings: `name` is `pkg/name.py` (a submodule) or a variable defined in `pkg/__init__.py` (an attribute). The code tries the submodule first and falls back to the attribute, pointing at `__init__.py`.
- **PEP 420 namespace packages**: since Python 3.3 a directory **without** `__init__.py` can be a package. ai-voice's `utils/` and `asr/` are of this kind. It has no file of its own, so only `from ns import submodule` yields an edge; `from ns import attribute` is `unknown`. This was discovered on a real repository: the first version had 56 resolution failures.
- **Search path for absolute imports**: real Python searches `sys.path`; Bauify cannot know the user's runtime, so it follows the common convention: the repository root first, then `src/`.
- **Dynamic imports**: `importlib.import_module("a.b")` resolves when the argument is a literal; a variable is recorded as `opaque`.
- **Partial initialisation**: when A imports B and B imports A, Python does not fail by itself. The module being loaded is already in `sys.modules`, so the second `import a` simply returns the half-built module. It only fails when B does `from a import X` and A has not yet executed the line that binds `X`. This distinction is what the `import-cycle` rule's tiers are built on (section 8).

---

## 5. The four kinds of "unresolved": why they are counted separately

`raw-facts.json` has four counters under `unresolved`, all `required`:

| category | meaning | expectation |
|---|---|---|
| `external` | a bare module name or `node:` prefix: third-party or standard library | mostly normal |
| `outside` | resolved, but the file is outside the analyzed root | usually a test referencing a script one level up |
| `unknown` | looks like a path but no file is there | **should be 0**; non-zero means a resolution gap or a broken reference in the code |
| `opaque` | the argument of `import()` / `require()` / `import_module()` is not a string literal | the blind spot of static analysis; it must stay visible |

`opaque` is the important one. Archify's `bin/archify.mjs` starts renderers with `spawnSync(process.execPath, [rendererPath])` and loads the delta module with `import(pathToFileURL(path.join(...)))` — both are calls whose target is only known at run time. The diagram has **no edge** from `bin` to the renderers, and that is a fact; but if the edge were merely missing, a reader would assume `bin` does not depend on the renderers. The count says "there are 3 dynamic loads here that cannot be seen", which is what ARCHITECTURE.md means by "omissions stay visible".

---

## 6. Small utilities: glob matching, file roles, Git

### glob → regular expression

`**/test/**` and `**/*.{js,mjs}` in `config/defaults.json` are **glob** patterns, a shorthand for paths. Node 18 has no stable built-in glob, so `extract/shared/glob.mjs` hand-writes a translator from glob to regular expression: `**` → any number of directory levels, `*` → any characters within one segment, `{a,b}` → either. A reviewer added one edge case: an unclosed `{` used to loop forever and now reports `cli/config-invalid`.

### File roles

Every file is tagged `source` / `test` / `generated`. The rules are globs, with precedence **test > generated > source**: `test/generated-artifact-xml.test.mjs` matches two of them and is a test. The precedence was decided after a test caught the ambiguity.

### Git

`extract/shared/git.mjs` runs three **read-only** commands through `spawnSync('git', [...])`: `rev-parse --show-toplevel` (repository root), `rev-parse HEAD` (contextual `baseRevision`), and `remote get-url origin` (the remote URL). Extraction reads the working tree, so `sourceKind` is `working-tree` and `revision` is null, even in a clean checkout. Without Git, the base revision and URL are null and analysis still proceeds. Each file retains the text parsed by its adapter; `extractFacts` hashes the captured facts into `snapshotId`, propagated to graphs and findings. Source panels use the captured text instead of rereading changed files, and working-tree results do not produce commit-based source links.

---

## 7. graphs/module: graph basics and metrics

### From a file graph to a module graph

Edges in raw-facts go from file to file. `graphs/module.mjs` maps every file to a module (by configured groups, package boundary, or directory depth; root-level files become modules of their own) and **merges** file edges into module edges: several file edges between the same pair of modules become one, `weight` is the count, `kinds` counts static versus dynamic, and `evidence` keeps up to five file:line entries.

Deduplicating with a `Map` is the idiomatic JS pattern:

```js
const key = `${from} ${to}`;
if (!edgeMap.has(key)) edgeMap.set(key, { from, to, weight: 0, … });
edgeMap.get(key).weight += 1;
```

### fan-in, fan-out, instability

- **fan-in**: how many other modules depend on me (incoming edges). High = widely used, change with care.
- **fan-out**: how many other modules I depend on (outgoing edges). High = fragile, I follow whenever they change.
- **instability** I = fanOut / (fanIn + fanOut). 0 is a pure sink (only depended on), 1 a pure source (only depends). The metric is Robert C. Martin's, from *Agile Software Development*; the healthy direction is "unstable depends on stable".

With no edges at all I is `null`, not 0: no data is not pretended into a number.

### Why test and generated files are excluded

Test files import almost everything; keeping them would push every module's fan-in up and make the metric meaningless. Generated files (`generated-validators.mjs`) are build products and reflect no design. They are excluded but **counted** (`excluded.files`), so the diagram's card can say "102 files not drawn".

---

## 8. evaluate: rules, Tarjan, and the partial-initialisation proof

### The rule engine

`evaluate/index.mjs` loads each rule module, runs it with the module graph, the raw facts, and the configuration, and gives every finding a stable id (`COUP-0001`) after a deterministic sort. Rules do not read each other's output. A suppressed rule is counted in `summary.suppressed` rather than silently skipped.

### Strongly connected components

A cycle in a directed graph is a set of nodes that can all reach each other. **Tarjan's algorithm** finds every such set (a strongly connected component, SCC) in one depth-first pass, keeping a stack and, for each node, the lowest index reachable from it. A singleton SCC is a cycle only when its node has a self-edge. Both rules use the same implementation, but `coupling/import-cycle` includes singleton file self-imports while `coupling/cycle` reports only multi-module SCCs. A second BFS then picks the **shortest** cycle inside the SCC so the message can quote one concrete loop rather than the whole component.

### Why the tiers

`import-cycle` excludes type-only imports from runtime analysis, then runs
Tarjan over all runtime edges and over the module-scope, unconditional subset.
Mixed components are informational with `loading: not-proven`: a deferred
function can still run during module initialization. Module-scope components
warn with `potential-at-import`. `findPartialInitCandidate` may attach a
binding-order hypothesis under `partialInitCandidate`, setting
`potential-partial-init`; this is not an execution proof and never raises the
severity to error. Tests compare small authored fixtures with real Python/JS
loading, including counterexamples to the former safety and failure claims.
Runtime-risk confidence 0.7 is an ordinal heuristic, not a measured probability.

Python uses an AST visitor to distinguish function bodies from enclosing
default/decorator expressions, mark TYPE_CHECKING-only and conditional edges,
and include the package initializers a submodule import loads. TypeScript
marks explicit type-only edges and deferred import()/require() calls, and
uses tsconfig options when resolving aliases and inline type specifiers. Source
text, in-root JSON configuration/package metadata, and the resolution file
inventory are captured before compiler setup. Configuration parsing and module
resolution use that inventory, including negative lookups, rather than rereading
the working tree. Installed configuration packages and unusual configuration
extensions are memoized on first use and checked again before returning; a
change rejects extraction with `extract/source-changed`. This consistency check
does not claim an OS-atomic filesystem snapshot.
The graph keeps structural dependencies, assigns collision-safe module IDs,
and stores exact file ownership for the overlay. After schema shape checks,
semantic validation verifies uniqueness and cross-record references.

### Hub

`coupling/hub` is arithmetic on the module graph: fan-in and fan-out both at or above the configured thresholds. The thresholds are echoed in the finding so the reader can see what was compared.

---

## 9. overlay/inject: layering onto Archify's HTML

### What it does

`buildOverlay` takes the delivered HTML as a string, computes one record per component (modules, files, edges, indicators, findings), and inserts three blocks before `</body>`: a `<script type="application/json">` with the data, a `<style>`, and a `<script>` with the page logic. Nothing in the original markup is edited, and the result is written to a new file. Everything the page needs is embedded — it works from a file:// URL with no network.

### Mapping components to modules

A component's `sources` in the IR name files; the deepest module whose path contains that file claims the component, and descendants follow their parent unless another component claims them. `--map` replaces this with an explicit `{ componentId: [moduleId] }` table. A module no component claims is listed, not dropped.

### Indicators and the halo

For each component the indicators are computed on the Node side from the findings that touch it: the cycle indicator looks at `import-cycle` findings on its files and `cycle` findings on its modules and takes the worst tier; the hub indicator looks for `hub` findings on its modules; instability is fan-out over fan-in plus fan-out summed over its modules. The component's colour is the worst indicator. On the page, `drawLayer` draws one rounded `rect` per component in an SVG group appended to Archify's SVG, sized from `getBBox()` of the component's `g[data-node-id]`, pushed 10 px outside the box and blurred with a CSS filter so it reads as a halo rather than a second border; red animates.

### Diagrams and source excerpts

The second panel's diagrams are plain SVG strings built in the page: the cycle ring places the files of the shortest cycle on an ellipse and draws clipped arrows between them (dashed when the closing import is lazy); the hub star puts dependents on the left and dependencies on the right; instability is two bars and a marker on a 0–1 scale. `collectSnippets` reads every file a finding cites from the analyzed tree and embeds its full text, so the third panel can show the cited line inside the whole file.

### Where it bites

- The overlay script lives inside a JavaScript template literal in `inject.mjs`, so a backslash in a regular expression there has to be doubled (`\\.git$`) or the template literal eats it before the browser sees it.
- Archify's viewer defines the CSS variables the panels use (`--panel`, `--bg`, `--text`, …). A variable that does not exist (`--panel-bg` was one such guess) silently falls back to nothing and makes text invisible in one theme.

---

## 10. bin/serve: deliver first, analyze on click

### What it does

`serve` is the module's only entry point. It runs `archify deliver architecture` on the authored IR through Archify's own CLI (a child process, so Archify's checks and receipt are exactly what a person would get), reads the delivered HTML, appends one small `<script>` that adds a **Code Analysis** button to the toolbar, and serves that page on a loopback port. Nothing else happens until the button is clicked.

### The click

The button POSTs to `/analyze`. The request must come from the served page (the `Origin` header) and carry a token minted for this process; anything else is refused, so a page in another tab cannot start an analysis or pick paths. On the first accepted request the server calls `analyzeRepository` from `lib/analysis.mjs` in-process: extract → graphs → evaluate → overlay, with JSON stage outputs written to `<out>/analysis/` and validated against their schemas; the overlay produces HTML. The response is the analysis page. Concurrent clicks share the one run; later clicks get the finished page back without running again.

### Handing over to the layer

The page does not navigate to the analysis page. It parses the response, copies the three overlay blocks (`bauify-analysis`, `bauify-style`, `bauify-script`) into itself, removes its own start button — the overlay adds a **Code Analysis** toggle of its own to the toolbar — and clicks that toggle once. So the reader sees the same page, now with the layer on; the toggle then shows or hides it. A failure comes back as structured diagnostics (section 12) and is shown next to the button with the option to retry.

### Where it bites

- The client script is injected as `client.toString()`, so it must be plain, self-contained, ES5-ish JavaScript: no imports, no references to module scope, no template literals with nested backticks.
- Appending a `<script>` element with `textContent` runs it; appending the overlay's script this way is what makes the layer come alive without a reload.
- `execFile` on Windows needs `process.execPath` plus the script path, never `archify` on `PATH`.

## 11. Determinism: why "byte-identical" matters so much

"Run twice on the same input, get byte-identical output" is a hard constraint, because it makes `diff` of two analyses equivalent to `diff` of the code structure. The code is careful everywhere:

- Every array is sorted by a stable key before output (files by path, edges by from / line / specifier).
- No timestamps, no absolute paths (`repository.root` is relative to the Git root).
- **No `localeCompare`.** It sorts by the operating system's language setting; `ä` and `z` order differently under the `C` locale and `sv_SE`. Byte-order comparison `a < b ? -1 : a > b ? 1 : 0` is used instead. A reviewer found this and the fix followed.
- `JSON.stringify(value, null, 2)` emits properties in insertion order, so objects are constructed with a fixed field order.

One test runs the pipeline twice and compares bytes.

---

## 12. Failure is a structured diagnostic

Bauify never prints a Node stack trace to the user. Every failure is an object of a fixed shape (`extract/shared/diagnostics.mjs`):

```json
{ "code": "extract/adapter-ambiguous", "severity": "error",
  "message": "More than one language adapter matches; choose one explicitly.",
  "subject": { "root": "…" }, "evidence": { "detected": ["ts", "py"] },
  "supportedFixes": ["pass --language ts", "pass --language py"] }
```

Implementation: `fail(code, message, details)` throws a custom `DiagnosticError`; `serve` catches it around the click and answers the page with `{ error, diagnostics: [...] }` (HTTP 500), which the button shows with a retry. An unexpected error that is not a `DiagnosticError` takes the same path with code `internal/unclassified` — it says "unclassified" rather than inventing a fix.

The shape is identical to Archify's diagnostic contract, which is why findings could attach to Archify node cards later.

---

## 13. Tests: node:test, fixtures, self-analysis

### node:test

Node 18 ships a test runner, so there is no jest to install. `node --test test/*.test.mjs` runs every file; each `test('name', fn)` asserts with `node:assert/strict`. `{ skip: 'reason' }` skips instead of failing — that is how the Archify-dependent tests behave when no checkout is present.

### Synthetic fixtures

`test/fixtures/ts-basic/` and `py-basic/` are hand-written miniature repositories; each file is a few lines long and covers one case (relative imports, namespace packages, a syntax error, a dynamic import with a computed path, …). The `expected.json` next to them was **derived by hand first, then confirmed by running the program**. The tests are `assert.deepEqual(actual, expected)`. Their value: when a change alters one edge, you know immediately which file and line.

### Regression tests

Each test in `test/extract-regressions.test.mjs` corresponds to a bug a review caught: locale sorting, the `..generated/` misclassification, the glob infinite loop, the local `require`. Breaking one of them again reproduces instantly.

### Rule tests

`test/evaluate.test.mjs` builds tiny graphs and fact sets in memory and checks the tiers of `import-cycle` field by field; the proof case (`from b import foo` before `foo` exists) mirrors a two-file layout that really raises `ImportError` in Python.

### Self-analysis

Analysing Archify's own `archify/` package asserts the three layers `bin → renderers/* → renderers/shared`, that `shared` has fan-out 0, and that there is no static edge from bin to the renderers but `opaque ≥ 1`. This tests the module and doubles as a health check of the surrounding code structure.

### Subprocess tests

Most tests call the library directly (`extractFacts`, `buildGraph`, `evaluateGraph`, `analyzeRepository`). A few need a separate process — a different locale, a clean environment, the structured failure shape — and use `test/run-extract.mjs`, a harness that exists only for tests. The click flow is tested by starting `serve` in-process and driving it with `fetch`: the page before the click has no analysis, unauthorized requests are refused, the first accepted click writes the stages, a second click reuses them.

---

## 14. Cross-platform: what you meet on Windows

- **Path separators**: Windows uses `\`, POSIX `/`. Every path written into JSON goes through `toPosix()` and becomes `/`; otherwise the same repository yields different artifacts on two machines.
- **Line endings**: Windows Git defaults to `autocrlf=true` and converts LF to CRLF on checkout. `* text=auto eol=lf` in `.gitattributes` keeps the repository on LF; `lineCount` accepts `/\r\n|\n|\r/`.
- **Symbolic links**: an ordinary Windows user cannot create symlinks without Developer Mode. A batch of Archify's tests fails on Windows for that reason; it has nothing to do with Bauify.
- **Temporary directory**: never hard-code `/tmp`; use `os.tmpdir()`.
- **Interpreter names**: `python` / `python3` / `py -3`, see section 4.
- **ESM and Windows absolute paths**: `import('C:\\...')` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`; wrap the path with `pathToFileURL()` first. This was a real upstream Windows bug.

---

## 15. Glossary

| term | one line |
|---|---|
| AST | the tree form of source code; analysing code means finding nodes in it |
| ESM / CJS | the two JS module systems; `import` is statically analysable, `require` is a function call |
| JSON Schema | a specification of a JSON document's shape; ajv is the validator |
| raw-facts | extract's output: files, roles, import edges, symbols, the four unresolved counters |
| module graph | the file edges folded by directory into module-level edges, with fan-in/out and evidence |
| findings | evaluate's output: typed diagnostics with evidence and fixes |
| IR | intermediate representation; Archify's `architecture` JSON is its IR |
| fan-in / fan-out / instability | incoming edges / outgoing edges / out ÷ (in + out) |
| SCC / Tarjan | a set of nodes that all reach each other / the one-pass algorithm that finds them |
| lazy import | an import inside a function body; it runs when the function is called, not at load time |
| partially initialised module | a module that is in `sys.modules` but has not finished executing; the source of circular-import errors |
| DAG | directed acyclic graph; the precondition of layered layout |
| back edge | an edge to an in-progress node during DFS; marks a cycle |
| topological order / Kahn | an order of a DAG in which every predecessor comes first |
| non-planar graph | a graph that crosses however it is drawn; most real dependency graphs |
| PEP 420 | a directory without `__init__.py` is still a Python package |
| opaque | a dynamic import whose argument is not a literal; static analysis cannot see the target |
| evidence mode | an IR that carries a commit sha and source paths for Archify to verify with git |
| structured diagnostic | the six-field failure object: code / severity / message / subject / evidence / supportedFixes |
| overlay | Bauify's analysis layer injected into a copy of an Archify-delivered HTML |

---

## 16. Further reading

- TypeScript Compiler API: the official wiki page "Using the Compiler API"; printing a small tree with `ts.createSourceFile` teaches more than the docs.
- Python `ast`: the `ast` module documentation; `ast.dump(ast.parse("from . import x"), indent=2)` shows the structure in one line. For circular imports, the language reference section on the import system explains `sys.modules` and partial initialisation.
- JSON Schema: "Understanding JSON Schema" on json-schema.org, especially `if/then/else` and `additionalProperties`.
- Graph algorithms: the DFS, topological sort, and strongly connected components (Tarjan) chapters of any algorithms textbook; `coupling/cycle` and `coupling/import-cycle` are Tarjan.
- Dependency metrics: Robert C. Martin, *Agile Software Development: Principles, Patterns, and Practices*, chapter 20, "Principles of Package Design".
- Archify's contract: `archify/references/authoring-contract.md` and `delivery-contract.md`; they explain what `deliver` checks and what its receipt guarantees.
