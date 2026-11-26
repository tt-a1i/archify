# Code Analysis technical guide: what is behind the code

Written for someone reading this module for the first time. Each section answers four questions: what this is, where it is in the code, why it is used, and where it bites. When you meet something unfamiliar while reading the code, come back here.

The suggested reading order follows the pipeline: the runtime first (Node, ESM), then the contracts (JSON Schema), then the technology behind each stage in the order extract → graphs → evaluate → overlay, then the `serve` process that ties them to the click, and finally tests and cross-platform issues.

For the Java adapter, see [Java source analysis](JAVA.md): parser selection,
syntax/error coverage, conservative type-to-file resolution, method complexity,
and structural cycle semantics. Java parsing runs in Node.js; the adapter reduces
each file's CST immediately instead of retaining all project syntax trees.

---

## 1. Runtime: Node.js and ES modules

### What it is

Bauify is a Node.js command-line program. The `.mjs` extension means the files are **ES modules** (ESM), JavaScript's official module system, using `import` / `export` statements rather than CommonJS's `require()` / `module.exports`.

```js
// extract/py/index.mjs
import path from 'node:path';                   // a Node built-in, with the node: prefix
import { fail } from '../shared/diagnostics.mjs';  // a file in this repository; the extension is mandatory
export const id = 'py';
export function extract(root, config) { … }
```

### Why

`"type": "module"` in `package.json` makes the whole package ESM by default. ESM was chosen over CommonJS for two reasons: Archify is ESM too, so the style matches; and an ESM `import` is static, which is exactly the "statically analysable dependency" property Bauify relies on when it analyses other people's code.

### Where it bites

- Relative imports in ESM **must include the extension**: `'./files.mjs'`, not `'./files'`.
- There is no `__dirname` in ESM. To find the directory of the current file use `fileURLToPath(import.meta.url)`; `scripts/build-python.mjs` uses it for the build entrypoint.
- `import()` with parentheses is a **dynamic import**: it returns a Promise and its argument can be any expression. This comes back in the "opaque" section below.

---

## 2. Contracts: JSON Schema and ajv

### What it is

**JSON Schema** is a standard for describing, in JSON, what a JSON document should look like. Each JSON-producing stage of Bauify has a schema for its output: `schemas/raw-facts.schema.json`, `schemas/module-graph.schema.json`, `schemas/findings.schema.json`.

**ajv** is the most widely used JSON Schema validator for Node. The code is in `schemas/validate.mjs`:

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

TypeScript is a language, but the `typescript` package also exposes the compiler as an API that parses source into an **AST** (abstract syntax tree) and performs type analysis. It parses plain JavaScript too (`allowJs: true`), so Archify uses it for both JS and TS.

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

At first Archify parsed one file at a time with `ts.createSourceFile`. The upstream reviewer changed it to `ts.createProgram(files, { noResolve: true, noLib: true })` plus `program.getTypeChecker()` because of a real bug:

```js
function local() { require('./dep'); var require = (s) => s; }
```

Here `require` is a local variable, not the CommonJS loader. Syntax alone cannot tell; the type checker's `getSymbolAtLocation(identifier)` says which declaration an identifier is bound to — no declaration means the global `require`, a declaration means a local. `noResolve` and `noLib` make the Program do lexical binding only, without resolving modules or the standard library, so the cost stays acceptable.

### Project SDK and configuration

The default `typescript.sdk: "bundled"` uses Archify's TypeScript 5.9.3. It follows project configs and references without executing code from the analyzed checkout. Pinned-tree analysis always uses the bundled SDK and captured resolution inputs, even when a live capture is configured to use an installed SDK.

For trusted projects, `typescript.sdk: "auto"` discovers TypeScript packages in the selected source's `node_modules` or in ancestor `node_modules` directories, including ancestors above a narrower analysis root such as `src/`. An explicit `typescript.sdk` names a TypeScript package directory relative to the analysis root or by absolute path. Both opt-ins execute code from the selected TypeScript package in the Archify process. They use installed packages without downloading an SDK or running project application and build scripts.

Auto mode falls back to the bundled SDK when no installed SDK is found and records a declared but missing SDK in `languageScope.limitations`. In live analysis, `typescript.requireProjectSdk: true` rejects bundled mode and auto fallback for any selected project. Invalid or unvalidated installed SDKs fail. The validated range is 5.6–6.0, with discrete probes on 5.6.3, 5.9.3 and 6.0.3.

Auto selection can use different SDKs in one capture. A solution can reference projects under different SDKs. A config serves the groups whose sources it selects as roots, including sources in a nested package with its own SDK. Each compiler validates settings for its participating group and can follow references through solution configs without applying unrelated compiler options. Each file belongs to one project and SDK; `repository.adapter` becomes `typescript@multi`, and `languageScope.sdks` plus each project's `sdkIndex/sdkVersion` record the assignment. SDK paths are canonical physical paths, relative to the physical analysis root when inside it. Replacing a version or relinking an SDK is detected on the next capture, including repeated library calls in one process. SDKs for config-excluded selected sources still produce inferred-project facts and must meet the version policy. Explicit Archify exclusions remove those sources before SDK selection.

Each selected source searches in-root `tsconfig.json` and `jsconfig.json`, with `tsconfig` taking precedence in the same directory. The analysis root is the workspace boundary for config discovery. TypeScript parses `extends`, `files`, `include`, `exclude` and effective compiler options against the frozen inventory; referenced configurations, including explicitly named configs, are discovered recursively. These patterns select initial roots. The SDK's `createProgram` follows imports and references to find complete membership, so a file named by `exclude` can still be imported into a Program, following [TypeScript's semantics](https://www.typescriptlang.org/tsconfig/#exclude). Explicit `noResolve` is honored.

Revision 27 analyzes **every Archify-selected source**. A source outside configured Programs enters an inferred project, like an opened file in VS Code. Configured projects use TypeScript's parsed options unchanged: a `tsconfig` without `allowJs` does not acquire it from inferred defaults. Inferred projects use VS Code's defaults for the supported SDKs: `allowJs`, module `Preserve`, resolution `Bundler`, target `ES2022`, JSX `react-jsx`, and `allowImportingTsExtensions`. See the pinned [VS Code option builder](https://github.com/microsoft/vscode/blob/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/extensions/typescript-language-features/src/tsconfig.ts) and [workspace boundary](https://github.com/microsoft/vscode/blob/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/extensions/typescript-language-features/src/tsServer/bufferSyncSupport.ts). Workspace settings, unsaved buffers and editor sessions are not loaded. `languageScope.excludedByProject` remains an empty compatibility field; Archify's own include/exclude and root still bound capture.

Ownership prefers the nearest configuration that contains the file, then a discovered importing project, then an inferred project. Native Programs can overlap; Archify records a source once under its owner. Revision 28 separates `projects[].files` (exclusive fact ownership) from `projects[].members` (captured sources available to that caller Program under the same SDK). A test can call a function in an imported source member even when that source has another default owner. Files, functions, imports and callsites are emitted only by their owner, so shared analysis does not duplicate facts. History compares SDK identities, effective options, ownership and Program membership independently of array order. Revision 30 also records `selectionDigest` for configured projects, covering effective `files`, `include`, `exclude` and references. Changes to that selection affect comparability. With the same selection, a source added to or removed from the Program can change which shared dependencies it pulls in without making the runs incomparable.

Membership discovery and lexical call extraction use the same snapshot-backed compiler host. Configured and inferred membership Programs follow project resolution settings; the subsequent call Program retains `noResolve: true` over the complete captured members, including shared dependencies. Both omit standard libraries and automatic type packages, and neither reads external source text into the facts. When every captured candidate is already a root, no expansion can add a member and the membership Program is skipped. This preserves the bounded call model while correcting missing shared source context.

Calls across selected SDK groups remain unresolved. For a shared target, its caller-context implementation range and hash must match the owner's captured function. Forwarding statement selections must also match the owner's recorded imports at the same statement position. If two configurations select different targets for a shared barrel, the call stays unknown because the saved file graph cannot represent that contextual route. Revision 28 records and validates these Program boundaries; earlier captures without `members` remain readable under their recorded revision.

The snapshot host uses the selected TypeScript package's `matchFiles` helper to apply TypeScript config globs to captured paths. `matchFiles` is exported by the validated versions but is not part of their public declaration API, so version upgrades must retain the project tests. JS implementation lookup uses the public `resolveModuleName` API with a captured host limited to JS candidates.

Architecture drift and pull request analysis use the bundled SDK for materialized Git trees. They resolve projects using only inputs in each pinned tree, so local SDK settings and installed dependencies do not affect the result.

### Module resolution

`program.getModeForUsageLocation` determines the resolution mode of each literal import from its syntax, file/package format and compiler options, including explicit type-only `resolution-mode` attributes. That mode is passed to `ts.resolveModuleName` with the captured snapshot host, so supported package `imports` and `exports` maps select the appropriate `import` or `require` condition. In NodeNext mode, dynamic `import()` uses the import condition even inside a CommonJS file; a TypeScript static import emitted as `require` uses the require condition.

The result must be inside the analyzed root and in the selected file set to become a resolved edge. For non-type-only references from `.js`, `.mjs` and `.cjs` files, a declaration selected for a package import or an ESM-mode relative import triggers an implementation lookup. This second public `resolveModuleName` call uses a snapshot-backed host that exposes only JavaScript implementations; only a captured JavaScript file can supply that edge. Removing the internal `noDtsResolution` flag preserved the declaration/implementation regressions and sampled real-source facts. Missing or excluded implementations stay unresolved, even when declarations are selected for analysis. TypeScript callers retain their source/type resolution, and relative CommonJS entries retain their existing behavior.

For runtime `.js/.mjs/.cjs` references in Node16/NodeNext resolution, affected in-root exact `#imports` and own-package export keys containing null or empty arrays use a small snapshot-backed target selector before TypeScript. A matched condition's null blocks its default sibling; an empty object has no match, while an empty array blocks. Arrays can continue after null, no-match or known invalid targets, but never because the selected file is missing/excluded or a valid target form is unsupported. Conditions remain per reference (including dynamic import and createRequire), with configured custom conditions; disabled imports/exports options are respected. Ordinary TypeScript/type-only/JSX routes and unrelated exact keys retain their existing policy.

The selector supports nested conditions/arrays and literal relative JavaScript endpoints. Affected pattern routes, internal package redirects, URL/escaped/legacy path forms, non-JS endpoints, numeric condition keys and relevant node-addons/module-sync policies remain unknown rather than selecting a guessed fallback. It adds no external package search, runtime resolver process or cross-extraction cache. Version upgrades must retain the declaration/implementation regressions. This is not a complete Node runtime loader; custom loaders and execution success remain separate concerns. A resolved edge alone does not prove that Node will load that file successfully.

### Bounded ESM and CommonJS call targets

`js-ts-lexical-v5` follows captured, module-acyclic explicit value import/export paths to a unique measured function implementation body. Local exports of imported bindings and explicit reexports retain each forwarding statement in `calls[].via`. Overload signatures without bodies are not implementation targets. Observed binding writes and direct eval, including parentheses and erased TypeScript wrappers, block imported implementation attribution. Forwarding source freshness is required before navigating a saved question.

`js-ts-lexical-v6` also follows a top-level `const { name } = require('./file')` binding to a unique top-level function declaration exported through static `module.exports.name`, `exports.name`, or `module.exports = { name }`. The require must resolve to a captured member of the caller Program; a static self-require is valid. Repeated/dynamic exports, escaped module objects, writes to the callable binding and direct eval leave calls unresolved. A namespace require of the target also blocks attribution. A visible loader alias, dynamic require, cache access or module-loader escape blocks CommonJS attribution throughout the captured caller Program because it can bypass recorded static edges. This conservative rule also rejects read-only cache use; no interprocedural proof of cache effects is attempted. The target's recorded require edge and source freshness are checked before use. Revision 28 fixes shared-member coverage within this existing model; it does not add member dispatch or reinterpret old captures.

Revision 23 stores each measured JS/TS function's exact UTF-16 source range and hash. Project SDK captures also record the syntax kind. Fresh source questions use these captured spans, and paired change questions can use the recorded syntax kind to avoid reparsing with a different SDK. Historical captures without syntax kinds keep the conservative reparse path for paired change questions.

Revision 27 decodes UTF-16LE/BE BOM sources and configs consistently with TypeScript. UTF-8 source BOMs retain the historical capture representation; source questions use the same decoding and UTF-16 positions. Adapter AST walks use explicit stacks so valid long binary expressions supported by TypeScript do not overflow an adapter recursion. See the executable [alignment ledger](TS-UPSTREAM-LEDGER.md) for tested boundaries.

Star/type-only exports, CommonJS reexports and dynamic forwarding, arbitrary function-value aliases, factory results and cyclic routes remain unsupported. This is bounded source evidence; it does not prove initialization order, runtime identity, execution or complete impact. Historical call models retain their captured coverage.

### Why not dependency-cruiser or Babel

The adapter reuses its TypeScript Program and traversal for import edges, function measurements and conservative lexical call facts. It does not add another parser or resolver for this evidence. The explicit `js-ts-lexical-v2` call model and its unsupported cases are described in [Architecture](../ARCHITECTURE.md#jsts-call-facts); complete symbol and call graphs remain unimplemented.

### Where it bites

- `node.getStart(source)` needs the sourceFile argument; without it, positions are wrong in Program mode.
- Sorting with `localeCompare` depends on the operating system locale and differs between machines — see section 9.

---

## 4. extract/py: a transplanted Pyright parser in Node

### What it is

The Python adapter now runs entirely in Node. `extract/py/upstream` contains the
required MIT-licensed tokenizer, parser, source positions and parser diagnostics
from Pyright 1.1.414. Its exact commit, original file hashes and modifications
are recorded in `UPSTREAM.json`. `syntax.ts` selects Python 3.8–3.14 syntax
independently of the host Python installation; the default is 3.14.

### Syntax, binding and source declarations

`bindings.ts` collects lexical binding events before lookup. `collect.ts` and
`facts.ts` retain import timing/type-only guards, module symbols, function ranges,
call inventory, McCabe complexity and nesting. `source.ts` follows bounded
receiver/signature types to captured declarations, with explicit unknowns for
unsupported or ambiguous forms. The existing captured-tree package/namespace
import resolver remains in `index.mjs`.

`npm run build:python` bundles this slice to the checked-in `analyze.mjs` using
esbuild. `npm run check:python` checks that bundle and type-checks the sources;
the module test command runs it automatically. Production requires neither
Python, esbuild nor the complete Pyright npm package. See [Python scope and
provenance](PYTHON.md) for the feature contract, reference comparison and update
procedure.

### Python import semantics (the part newcomers find hardest)

- **Package**: a directory with `__init__.py`. Within one search directory, Python prefers `pkg/__init__.py` to a sibling `pkg.py`. The adapter follows this order among captured sources.
- **Relative import**: the dots in `from .a import x` mean "relative to the package this file is in". `level=1` is the same directory, `level=2` the parent. Leaving the analyzed root is recorded as `outside`.
- **`from pkg import name`** has two readings: `name` is `pkg/name.py` (a submodule) or a variable defined in `pkg/__init__.py` (an attribute). The code tries the submodule first and falls back to the attribute, pointing at `__init__.py`.
- **PEP 420 namespace packages**: since Python 3.3 a directory **without** `__init__.py` can be a package. ai-voice's `utils/` and `asr/` are of this kind. It has no file of its own, so only `from ns import submodule` yields an edge; `from ns import attribute` is `unknown`. This was discovered on a real repository: the first version had 56 resolution failures.
- **Search path for absolute imports**: real Python searches `sys.path`; Bauify cannot know the user's runtime, so it follows the common convention: the repository root first, then `src/`.
- **Parent packages**: each dotted component is resolved before its children. A captured module such as `pkg.py` blocks `pkg.child`; a regular package confines child lookup to that package. Namespace portions across the two absolute search roots combine only when no regular package or module takes precedence. Directories are derived from captured `.py` paths, so excluded files and empty directories do not become extra resolution inputs. Relative imports also search the inferred namespace portions in root/src order when the caller belongs to that package. Regular packages remain confined to their own directory. An analyzed root that is itself a package, or a source directory outside the inferred package, keeps lexical relative lookup because its external import context is unknown. Import hooks, arbitrary runtime search paths and changes to `__path__` are not modeled.
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

Java keeps the same meanings: an import of a package no analyzed file declares (JDK, third party) is `external`; an import in an analyzed package, or a type reference that matches an analyzed type, that cannot be resolved is `unknown`. The Java adapter does not model reflective loading such as `Class.forName` or `ServiceLoader`, so its `opaque` stays 0; that does not mean the code has none. See [Java source analysis](JAVA.md#dependencies).

A single Java static import of a field or method does not hide an unrelated type with the same name. Type lookup proceeds past that import only when its owner is uniquely analyzed, declares the static member, and has a complete known member-type scope with no matching declared or inherited type. Genuine member-type imports and uncertain owners or supertype chains retain the conservative guard; this does not add classpath or general hierarchy resolution.

`opaque` is the important one. Archify's `bin/archify.mjs` starts renderers with `spawnSync(process.execPath, [rendererPath])` and loads the delta module with `import(pathToFileURL(path.join(...)))` — both are calls whose target is only known at run time. The diagram has **no edge** from `bin` to the renderers, and that is a fact; but if the edge were merely missing, a reader would assume `bin` does not depend on the renderers. The count says "there are 3 dynamic loads here that cannot be seen", which is what ARCHITECTURE.md means by "omissions stay visible".

---

## 6. Small utilities: glob matching, file roles, Git

### glob → regular expression

`**/test/**` and `**/*.{js,mjs}` in `config/defaults.json` are **glob** patterns, a shorthand for paths. Node 18 has no stable built-in glob, so `core/glob.mjs` hand-writes a translator from glob to regular expression: `**` → any number of directory levels, `*` → any characters within one segment, `{a,b}` → either. A reviewer added one edge case: an unclosed `{` used to loop forever and now reports `cli/config-invalid`.

### File roles

Every file is tagged `source` / `test` / `generated`. The rules are globs, with precedence **test > generated > source**: `test/generated-artifact-xml.test.mjs` matches two of them and is a test. The precedence was decided after a test caught the ambiguity.

### Git

`extract/shared/git.mjs` runs three **read-only** commands through `spawnSync('git', [...])`: `rev-parse --show-toplevel` (repository root), `rev-parse HEAD` (contextual `baseRevision`), and `remote get-url origin` (the remote URL). Extraction reads the working tree, so `sourceKind` is `working-tree` and `revision` is null, even in a clean checkout. Without Git, the base revision and URL are null and analysis still proceeds. Each file retains the text parsed by its adapter; `extractFacts` hashes the captured facts into `snapshotId`, propagated to graphs and findings. Source panels use the captured text instead of rereading changed files, and working-tree results do not produce commit-based source links.

---

## 7. graphs/module: graph basics and metrics

### From a file graph to a module graph

Edges in raw-facts go from file to file. `graphs/module.mjs` maps every file to a module (by configured groups, package boundary, or directory depth; root-level files become modules of their own). Package boundaries come from marker files — `package.json`, `pyproject.toml`, `__init__.py` — which the extractors record in `packageMarkers` because they are not parsed sources and so never appear in `files`. Java records `pom.xml` and `build.gradle(.kts)` as well, and groups by build module or, in a single-module build, by package unless `modules.depth` or `modules.packageBoundaries: false` is set (see [Java source analysis](JAVA.md)). The graph then **merges** file edges into module edges: several file edges between the same pair of modules become one, `weight` is the count, `kinds` counts static versus dynamic, and `evidence` keeps up to five file:line entries.

For JS/TS, the default also recognizes nested source roots: `web/src/pages/x.ts`
belongs to `web/src/pages`, while a file directly in `web/src` stays in that root.
This uses the innermost `src` at any package nesting depth, with or without a
package marker, including `src/apps/web/src`. A single root-level `src/*` keeps
the established depth-two policy. Explicit
`modules.groups` wins; an explicit `modules.depth` or
`modules.packageBoundaries: false` restores the original directory policy.
Unchanged grouping paths retain their module/finding anchors. Newly split paths
get their own anchors; `grouping.typescript: nested-source-roots-v2` enters the
analysis configuration digest so history comparison reports regrouping as
non-comparable rather than calling disappeared findings fixed. Historical v1
graphs used the first `src`; they remain readable and compare as a grouping
change against the innermost-root v2 strategy. Historical graph
and finding documents remain accepted. Default roles mark Vitest, Jest,
Playwright and Cypress configuration, Vitest workspace and Karma configuration
as `test`; configured role arrays replace these defaults.

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

`evaluate/index.mjs` loads each rule module, runs it with the module graph, the raw facts, and the configuration, and gives every finding a stable id such as `COUP-3f9a2c1b07de`: the dimension prefix plus a hash of the rule code and the finding's subject (sorted file paths, or module grouping paths rather than generated module ids). The id does not depend on output order, so adding or fixing one finding leaves the other ids unchanged and findings can be matched across runs. Changing the module grouping configuration changes module-level ids, because it changes what the module is. When raw facts are available, each finding also carries `evidenceDigest`: the files it is about (the subject's files, or every file of the subject's modules) and a SHA-256 over their source text. Editing an unrelated file leaves the digest unchanged, unlike `repository.snapshotId`, which changes on any edit; a changed digest with an unchanged id means the same problem whose evidence needs re-checking. Rules do not read each other's output. A suppressed rule is counted in `summary.suppressed` rather than silently skipped.

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
and include the package initializers a submodule import loads. A `match` subject
inherits its enclosing context; case guards and bodies are conditional.
TypeScript marks explicit type-only edges, deferred import()/require() calls
and guarded CommonJS loads. For example, `if (require("./a")) require("./b")`
evaluates the first load before deciding whether to run the second.
Optional-chain arguments and computed keys also guard CommonJS loads:
`sink?.use(require("./b"))` and `sink?.[require("./b")]` are conditional.
The base in `require("./b")?.use` stays eager, as does the argument in
`(sink?.use)(require("./b"))`, where grouping breaks the chain. These syntax
flags do not prove whether a load runs or whether initialization is safe.
The adapter uses tsconfig options when resolving aliases and inline type specifiers.
If TypeScript resolves a relative CommonJS require to a declaration, the adapter
checks the captured inventory for the requested file, including Node's implicit
`.js` extension. For a directory it checks an explicit JavaScript main or the
default `index.js`. A confirmed runtime file takes precedence for the require,
while a type-only import keeps its declaration target.
Source text, in-root JSON configuration/package metadata, and the resolution file
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

### Function complexity

The Python extractor records one entry per function in `facts.functions`: `file`, `name`, `qualname` (`Class.method`, `outer.<locals>.inner`), `line`, `endLine`, `complexity`, `nesting`, and `deepestLine`. Complexity follows the McCabe/radon reading: 1 for the function, plus 1 for each `if`/`elif`, `for`/`while`, `except` handler, conditional expression, `match` case other than an irrefutable `case _`, each comprehension `for` and its `if`s, and each extra operand of an `and`/`or`. Nesting counts stacked `if`/loop/`with`/`try`/`match` blocks; an `elif` is an `If` alone in its parent's `orelse` and keeps the parent's depth. Nested functions and classes are measured separately and are not added to their parent; a lambda is part of the enclosing function. `ast.Match` and `TryStar` are looked up with `getattr`, so older interpreters still run.

The JS/TS extractor records the same fields from the TypeScript syntax tree (`extract/ts/functions.mjs`).
- **Complexity:** each `if` (including `else if`), conditional expression, `for`/`for…in`/`for…of`/`while`/`do`, `catch`, non-default `case`, and each `&&`, `||`, `??` and their assignment forms adds 1. Optional chaining is not counted.
- **Nesting:** counts `if`/loop/`switch`/`try`/`with` blocks. An `else if` keeps its `if`'s depth and a `catch` stays at its `try`'s depth, so the same logic gets the same numbers in both languages; a parity test checks this.
- **Records:** declarations, methods, constructors, accessors, and function or arrow expressions bound to a name (variable, object property, class field, assignment target, `export default`) get their own record. Names are qualified as `Class.method`, `object.method`, or `outer.<locals>.inner`.
- **Callbacks:** an anonymous callback is folded into the function that contains it. At module scope it has none, so it is recorded as `<callback of callee>` (for example `<callback of runCheck(…).then>`), with the call's first literal argument when there is one (`<callback of server.on("request")>`), so registering or removing another handler does not rename it. Only callbacks with the same call and literal in one file get `#2`, `#3` in source order.
- **Skipped:** functions without a body (overload signatures, abstract methods) and declaration files.

On archify itself (1,245 source functions), the defaults flag 12% overall. Most directories sit at 5–9%, close to the Python rate; `bin/archify.mjs`, with ten functions over 200 lines, reaches 20%.

`complexity/function` runs only when `facts.functions` is present (its `enabled(config, facts)` checks the facts), so a JS/TS run reports complexity as not checked rather than clean. It reports info from complexity 15 or nesting 5 and a warning from 25 or 6, configurable per level under `rules.complexity.function`. The subject is `{ file, function, line, endLine }`; the id hashes only file and qualified name, so edits above a function keep its id, and `evidenceDigest` hashes only the function's own lines (`evidenceDigest.lines`), so edits elsewhere in the file keep the evidence current. Defaults were checked against a 180-file Python project, where they flag about 6% of functions.

The overview ranks a complexity finding by its size within the same severity and reach, and picks the best finding of each rule at the top severity before filling the remaining priorities, so one rule with many instances does not take all three slots.

### Entry points

`coupling/internal-leak` (version 1) walks `facts.imports` like the boundary rule, but groups by the imported module: every resolved import whose two ends lie in different modules of the module graph either lands on one of the target module's entry files (counted as `viaEntry`) or is cited as reaching inside. Entry files come from `rules.coupling.internalLeak.entries` globs when set (`entrySource: "config"`), else from an `index.*` or `__init__.py` directly in the module's folder (`"detected"`), else there are none (`"none"`). A module with cited imports gives one finding with `subject: { module }`, so its id is stable while imports come and go, and `evidenceDigest` is computed over both ends of every cited import. Severity is per finding: warning only for a configured convention; info for a detected entry, or for no entry once at least `minFiles` internal files are reached. Modules under `vendor/` or `third_party/` are skipped, and the rule is not enabled for Java or without raw facts, so it is listed as not run there.

The Atlas maps the finding to `kind: "edges"` with `module` and `entries` (file indices), and separately computes each module's surface (files imported from other modules, with their importing modules) in the browser from the dependency list, so a focused module shows it without any rule.

### Architecture boundaries

`architecture/boundary` checks layer rules the reader declares under `boundaries` in the `--config` file: `layers` maps names to path globs, and each rule names a `from` layer with either `disallow` (forbidden layers) or `allow` (the only other layers permitted). It is opt-in: a rule may export `enabled(config)`, and the engine skips a rule that is not enabled and leaves it out of `findings.rules`, so the overview says boundaries were not checked instead of reporting them clean.

The rule walks `facts.imports`, not module edges, because module edges keep at most five evidence imports. Each resolved import is assigned the first layer whose globs match each end; imports with an end in no layer, within one layer, or touching an excluded role (test, generated) are not checked. Type-only imports count and are marked. All crossing imports for one `from → to` pair form one finding (`subject: { boundary: { from, to } }`, severity warning, confidence 1), so its id stays the same as crossing imports are added or removed while `evidenceDigest`, computed over both ends of every cited import, changes. An invalid `boundaries` block stops analysis with `config/boundaries-invalid` rather than checking less than was declared. The architecture diagram is never used as a constraint source: a missing connection on the diagram does not forbid a dependency.

The overview's coverage lists each declared layer with the number of analyzed files it matched; a layer matching nothing usually means a mistyped glob. On the page a component gets an "Architecture boundary" indicator only when a configured boundary is crossed by one of its files; there is no green boundary claim when nothing was configured.

---

## 9. overlay/inject: layering onto Archify's HTML

### What it does

`buildOverlay` takes the delivered HTML as a string, computes one record per component (modules, files, edges, indicators, findings), and inserts three blocks before `</body>`: a `<script type="application/json">` with the data, a `<style>`, and a `<script>` with the page logic. Nothing in the original markup is edited, and the result is written to a new file. Everything the page needs is embedded — it works from a file:// URL with no network.

### The Atlas view

`overlay/atlas.mjs` builds a second payload from the same run, `buildAtlas({ graph, facts, findings, review })`, embedded as `#bauify-atlas-data` before the Classic script (which offers the **Atlas** button only when it exists) with its own style and script after it. It is a projection, not an analysis: files owned by the module graph, grouped by module in path order; one entry per resolved file-to-file dependency between them; every measured function as `[file, name, line, complexity, nesting, length, finding]`; and each finding with the indices it selects (`function`, `cycle` path and files, `modules`, `module` for a hub, `edges` for boundary imports, and `edges` plus `module` and `entries` for imports reaching inside a module). Module labels are the shortest path tails that stay unique. Without raw facts there is no Atlas.

The page draws it on a `<canvas>`: files on a circle with a gap between modules, dependencies as cubic curves whose control points sit at the two modules' mid-angles near the centre (intra-module curves stay near the rim), functions as radial spikes scaled to complexity, capped at 26. Hit testing is polar: radius picks the ring (arc, spike, tick), angle picks the module, file or function. Colours come from the page's theme variables and are redrawn when `data-theme` changes. The picture is painted into an off-screen frame; the visible canvas composites it with time-based motion (a circular reveal on opening, a cross-fade from the previous frame on selection, a light moving along the selected import cycle's curves) and the hover mark, so hovering never repaints the whole graph. Frames come from `requestAnimationFrame`, backed by a timer where frames are throttled; `prefers-reduced-motion: reduce` turns all three off. `data-bauify-atlas-animating` and `data-bauify-atlas-flow` on `<html>` expose the motion state. Selecting a finding sets `data-bauify-atlas-finding` on `<html>` and a focused module sets `data-bauify-atlas-focus`, which the browser tests read; `window.__archifyShowFinding(id)` (from the Classic script) opens a finding there with its evidence.

### Mapping components to modules

A component's `sources` in the IR name files; the deepest module whose path contains that file claims the component, and descendants follow their parent unless another component claims them. `--map` replaces this with an explicit `{ componentId: [moduleId] }` table. A module no component claims is listed, not dropped.

Per-component `findings` repeat a finding on every component it touches, and a finding whose modules no component claims appears on none of them. The payload therefore also carries a top-level `findings` list: each finding exactly once, with `moduleIds` (named in its subject, or owning one of its files) and `componentIds` (the components that show it, possibly empty). A project-level view counts and ranks from this list rather than from the components.

### The overview

`overlay/overview.mjs` turns that list into the payload's `overview`, also written to `overview.json`. It produces no wording and no quality score: `verdict` is `attention` (a warning or error fired), `signals-only` (only info) or `none-found` (nothing fired within the checks that ran). `groups` counts findings per rule. Findings that are the same structure at another level are related: a file cycle nested in a wider file cycle, or a file cycle spanning two or more modules that all lie inside a module-level cycle. `priorities` takes at most three findings by severity, then by reach (modules, summed fan-in, files), then id, and skips any finding related to one already picked. `coverage` states the language and adapter, analyzed and role-excluded file counts, the configured exclude patterns (excluded paths are never enumerated, so they are named rather than counted), parse failures, sources of another language left out when `--language` was given, unresolved imports, the rules that ran and the ones suppressed, the modules no component claims, and, when duplicate detection ran, how many of its selected files it analyzed and whether that coverage is complete.

On the page the overview is the left column's default: turning the layer on shows it (it replaces the former hint, and the colour key moves into it). Each priority and each finding under "All findings" opens in the detail panel with its diagram, evidence and related findings; the components it involves stay lit and the rest are dimmed (`data-bauify-focus`). A finding on no component opens the same way, using a stand-in component built from its modules. Clicking a component replaces the overview with that component's panel, whose "← Overview" link and close button return to it. The overview collapses to its verdict line. Below 1180 px the detail panel covers the left column, and below 860 px the source panel covers both, instead of overlapping them. The wording is template text in English, like the rest of the overlay.

### Indicators and the halo

For each component the indicators are computed on the Node side from the findings that touch it: the cycle indicator looks at `import-cycle` findings on its files and `cycle` findings on its modules and takes the worst tier; the hub indicator looks for `hub` findings on its modules; instability is fan-out over fan-in plus fan-out summed over its modules. The component's colour is the worst indicator. On the page, `drawLayer` draws one rounded `rect` per component in an SVG group appended to Archify's SVG, sized from `getBBox()` of the component's `g[data-node-id]`, pushed 10 px outside the box and blurred with a CSS filter so it reads as a halo rather than a second border; red animates.

### Diagrams and source excerpts

The second panel's diagrams are plain SVG strings built in the page: the cycle ring places the files of the shortest cycle on an ellipse and draws clipped arrows between them (dashed when the closing import is lazy); the hub star puts dependents on the left and dependencies on the right; instability is two bars and a marker on a 0–1 scale. `collectSnippets` embeds the full text of every file a finding cites, taken from the extraction snapshot (`facts.files[].sourceText`) rather than re-read from the working tree, so the third panel shows the cited line inside exactly the bytes that were analyzed.

### Where it bites

- The browser scripts and styles are ordinary files in `overlay/client/` (`overlay.js`, `overlay.css`, `atlas.js`, `atlas.css`), inlined into the page by `overlay/client-assets.mjs`. They used to be JavaScript template literals, where every backslash had to be doubled; write them as normal code now. Each script is a classic IIFE: no `import`/`export`, and never the text `</script`.
- Archify's viewer defines the CSS variables the panels use (`--panel`, `--bg`, `--text`, …). A variable that does not exist (`--panel-bg` was one such guess) silently falls back to nothing and makes text invisible in one theme.

---

## 10. bin/serve: deliver first, analyze on click

### What it does

`serve` is the module's only entry point. It runs `archify deliver architecture` on the authored IR through Archify's own CLI (a child process, so Archify's checks and receipt are exactly what a person would get), reads the delivered HTML, appends one small `<script>` that adds a **Code Analysis** button to the toolbar, and serves that page on a loopback port. Nothing else happens until the button is clicked.

### The click

The button POSTs to `/analyze`. The request must come from the served page (the `Origin` header) and carry a token minted for this process; anything else is refused, so a page in another tab cannot start an analysis or pick paths. On the first accepted request the server starts `bin/analyze-run.mjs` as a child process. It passes the `analyzeRepository` options as JSON on stdin and reads back one JSON line: the receipt, or the structured diagnostics. Extract → graphs → evaluate → overlay run there, so a large repository does not block the server's event loop.

Each run writes to `<out>/analysis.next-<random>`. Only on success is it swapped in: the current `<out>/analysis` moves to `<out>/analysis.previous`, and the new directory becomes `<out>/analysis`. A failed run's directory is removed. The current `findings.json` is passed as `previous`, so the report overview compares with the preceding run. Local runs also stage a bounded findings history for task verification. A receipt compares the capture named by the task with the current capture. Duplicate captures occupy one history slot. The response is the analysis page. Concurrent clicks share the one run; later clicks get the latest result back without running again.

### Re-analysis

A request with `X-Analysis-Refresh: 1` discards the cached result (unless a run is already in progress, which it joins) and starts a new run. The client exposes `window.__archifyReanalyze`; when it exists, the overview shows **Re-analyze**. On success the page reloads with `?analysis=open`, and the client clicks its start button, which fetches the new cached result. This re-mounts the layer from scratch instead of patching a running one; the query string is then removed. On failure the button re-enables and the error is shown under it, while the last good result stays on screen and on disk. A changed architecture IR is still refused with 409, as on the first click.

### Review: baseline and comparison

`lib/review.mjs` compares this run's findings with two things, both keyed by the stable finding id:

- **Baseline** (`--baseline`, `schemas/baseline.schema.json`, ids unique). Each finding is `open`, `accepted`, or `accepted-changed`. An entry that recorded a `sha256` whose value no longer matches the finding's `evidenceDigest` is `accepted-changed`. Entries whose finding is gone are `stale`.
- **Previous run** (`previous`). Findings are `new`, `evidence-changed`, or `unchanged`; previous findings that are gone are `notDetected` (`fixed` is kept as a deprecated alias with the same entries). `comparability(previous.analysis, current.analysis)` sets `comparable` (`true`, `false`, or `null` when a side has no `analysis` block) and `reasons[]` with codes `language-changed`, `analyzer-changed`, `adapter-changed`, `config-changed`, `rules-removed`, `rules-added`, `rules-changed`, `scope-changed`, `parse-errors`, `context-missing`. Each `notDetected` entry may carry `likelyCause`: `rule-not-run`, `parse-error`, `files-missing` (needs the current file list), or `possibly-renamed` with `candidates` (new findings of the same rule over the same files).

`findings.json` carries that `analysis` block (`evaluate/index.mjs`, `analysisContext`): analyzer name and version from `package.json`, `adapter` and `adapterRevision` (see [Extractor revisions](#extractor-revisions)), `configDigest` (sha256 of the canonicalized merged config without `schema_version`), `ruleVersions` (rules that ran, suppressed ones left out; a rule exports `version` when its logic changes, default 1), and `coverage` (analyzed file count, excluded roles, files with parse errors). The block is optional in the schema so older findings stay valid.

`review.json` holds both. The overlay copies each finding's status onto the top-level findings list. The overview keeps accepted findings in its lists and counts them as `counts.accepted`, but excludes them from the severity counts, the verdict, and the priorities. Component indicators and diagram rings are computed from open findings only. An unreadable previous `findings.json` means no comparison, not a failure; an invalid baseline stops the run with `baseline/invalid`.

### Extractor revisions

Raw facts record two things about the extractor in `repository`: `adapter`, the parser or runtime it used (`typescript@<version>`, `python@<version>`, `java-parser@<version>`), and `adapterRevision`, the revision of the adapter's own logic. Each adapter exports it as `REVISION` (`extract/ts/index.mjs`, `extract/py/index.mjs`, `extract/java/index.mjs`). A change to either one is reported as `adapter-changed`, so a dependency that appears or disappears because extraction changed is not read as a code change. A run that recorded no revision is reported as changed against one that did; this happens once, on the first comparison after upgrading.

Bump an adapter's `REVISION` when the same sources can produce different raw facts: files, roles, parse errors, imports and their resolution, unresolved counts, symbols or function measurements. A change in `extract/shared/` that alters an adapter's output bumps that adapter. Refactors, messages and performance changes that leave the output identical do not. Revisions are per language: changing the Java resolver bumps only Java, so TypeScript and Python results stay comparable.

`test/extractor-revisions.test.mjs` makes this a decision rather than a memory: it extracts one fixed fixture per language (`ts-basic`, `py-basic`, `java-basic`) and checks a digest of the output, together with the adapter's `REVISION`, against `test/fixtures/extractor-revisions.json`. When the output changes, the test fails and asks which case applies. If the adapter's logic changed, bump `REVISION`; if only the fixture changed, keep it. Either way, record the new digest and revision in that file. The digest leaves out `repository` and captured source text, which depend on the checkout rather than on extraction.

`bin/check.mjs` runs the same review without a diagram. The gate counts open findings at or above `--fail-on`; `accepted-changed` counts as open. With `--new-only`, only findings new since the comparison count; with no comparison available, every open finding counts as new. Exit codes are 0 (passed), 1 (gate failed), and 2 (diagnostic). `--update-baseline` writes `baselineFrom(findings)`: existing reasons are kept, new findings get `--reason`, and gone entries are dropped.

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

Bauify never prints a Node stack trace to the user. Every failure is an object of a fixed shape (`core/diagnostics.mjs`):

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

### AI tasks and evidence checks

`lib/task.mjs` builds a task (`schemas/ai-task.schema.json`) from `findings.json` and `raw-facts.json` of one run; mixing runs is refused (`task/snapshot-mismatch`). `locationsOf` turns each finding into line ranges: a complexity finding into the function's lines (with `focusLine` at the deepest block), an import cycle into the imports along its path, a boundary or module cycle into its evidence imports (one location per line, all targets listed), a hub into its files without lines. Each range gets `sha256` over its exact lines joined with `\n`; the excerpt is bounded (`EXCERPT`: full functions up to 60 lines, otherwise head, ±10 lines around the focus, and the last lines, with `omitted` ranges and `complete: false`). `scope.modify` is the files with cited lines, `scope.read` the rest of the files the finding was computed from. Facts are the finding messages, suggestions are the rule's `supportedFixes`, and preserve/acceptance come from per-rule templates; verification commands appear only when supplied. `taskId` hashes the sorted finding ids with their evidence digests. `renderTaskMarkdown` renders the same object; source sits in a fence longer than any backtick run it contains. `buildTaskPayloads` returns `{ [findingId]: { task, markdown } }` for a page without a server.

`lib/evidence.mjs` `verifyTask(task, root)` reads cited files only inside `root` (no absolute paths, `..`, or symlink escapes). A location is `valid` when its hash matches at the same lines or at another position in the file (`currentStartLine`), `changed` otherwise, `missing` when the file is gone, `unverifiable` without a captured hash. Per finding, the evidence digest is recomputed as `evaluate` computes it (function spans at their current position); a valid location with a changed digest makes the finding `changed`. The task roll-up is the worst of `missing > changed > unverifiable > valid`. A UTF-8 BOM is accepted with or without, since Python's decoder drops it.

### Python call capture

Python adapter revision 13 emits the Node-only `python-source-v3` declaration
model. See [Python support](PYTHON.md). Historical revision 7 adds `python-lexical-v1`, source-contained Call records
and optional exact `functions[].sourceRange` proof. UTF-8 byte offsets from the
AST are converted to UTF-16 columns against decoded source. Ranges exclude
preceding decorators; their hashes retain actual interior line endings. Old
captures without the model remain unavailable rather than known-zero. See
[the architecture contract](../ARCHITECTURE.md#python-call-facts) for binding
limits and freshness; the fresh paired change workflow remains JS/TS only.


### Java captured superclass qualifier evidence

Java call model v4 admits explicit class-qualified static source candidates from callers extending closed captured chains of ordinary top-level classes. It reuses the type/member inheritance graph and collects inherited instance and static field names in the same traversal. Incomplete, external, cyclic or ambiguous ancestry cannot prove value absence; the type-only JDK allowlist does not supply a field inventory. Member-type shadowing keeps the existing type namespace guard. Bare inherited calls, interface/virtual dispatch, inherited target owners and argument applicability remain unproved.

Each new inherited-context target records qualifierAncestry source points. Saved-question navigation requires these files to remain fresh; changing a parent can change the qualifier binding even when caller/target text is unchanged. Historical Java v1–v3 captures remain readable with their original scope, without rebinding under v4.

New inherited-context candidates and ancestor evidence also stay within one captured Maven/Gradle marker root. A sibling module can contain a compatibility class with the same FQCN as an external dependency; without classpath evidence it must not become the target. Cross-root inherited-context calls report java-inherited-build-scope, including legitimate known calls that remain misses. This does not implement Maven/Gradle dependency resolution or change the older non-inherited source-global contract.
