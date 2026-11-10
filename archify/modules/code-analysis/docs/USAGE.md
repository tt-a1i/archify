# Code Analysis Quick Start

From the `archify/` package directory inside the Archify repository:

```sh
npm ci
npm start -- "/path/to/project" --ir architecture.json
```

Use the project's architecture JSON prepared with Archify as `architecture.json`. Your project can stay in its own directory.

1. Open the **Archify** URL printed in the terminal to view the architecture diagram.
2. Click **Code Analysis** in the upper-right corner to start analysis.
3. Read the project overview, then choose a finding or a component. The same reading column shows the selected page; Back returns to the previous page. View diagram folds the column, and Show analysis restores it.
4. Click a source link for a short captured excerpt. Show full file expands it, and Show excerpt returns to the short view. References without a line show a file preview, not a finding location.
5. Click **Atlas** at the top of the reading column for the whole-repository view, then **Classic view** to come back (see [Atlas view](#atlas-view)).
6. Click **Code Analysis** again to return to the architecture view.

Keep the terminal running. After changing source code or the `--config` file, click **Re-analyze** on the overview: the repository and the config are read again without restarting, the page reloads with the new result, and the overview shows what changed since the previous analysis (new, no longer detected, and findings whose code changed). A finding that is no longer detected is not necessarily fixed: if the config, the rules that ran, or the files that parsed changed between the two runs, the comparison is marked as not directly comparable and says why (see [Comparing runs](#comparing-runs)). If a re-analysis fails, the last good result stays in place and the reason is shown next to the button. Only a changed architecture JSON needs a restart.

Analysis reads the working tree, including uncommitted and untracked source files. Results are labeled **Working tree**; any base commit is context only. Source panels use the text captured during extraction, and working-tree results do not provide commit-based source links. The raw facts retain that source text and a snapshot digest so findings, graphs, and source panels refer to the same extraction. Non-Git directories are supported.

The source panel marks captured changes against the base commit: green gutters for added lines, amber for modified lines, and red deletion markers between lines. This includes staged and unstaged changes; files absent from the base are labeled **New file**. Markers stay tied to the captured source, so re-analyze to see later edits. Without a readable Git base, the panel reports that markers are unavailable rather than treating every line as new.

If the architecture JSON changes or becomes unavailable after startup, the analysis request is rejected and the page asks you to regenerate the diagram. Restart with the updated JSON and open the new URL. The server never rewrites your input JSON or silently combines a new architecture with the previous diagram.

JavaScript, TypeScript, Python, Java, Go and Rust use five adapters. Select one
with `--language ts|py|java|go|rust`; `ts` covers both JavaScript and TypeScript.
Each run uses one adapter. A JS/TS or Python tree that also holds `.java` files
keeps its language unless its root has a Maven/Gradle build file (see the
[upgrade note](JAVA.md)). Choose explicitly for a mixed-language root. Add
`--map overlay-map.json` when you need an explicit mapping between diagram
components and code modules.

Language extraction has its own prerequisites:

| Adapter | Required tools and source scope |
| --- | --- |
| `ts` | Node.js and the module's installed TypeScript parser dependencies. |
| `py` | Python 3; `BAUIFY_PYTHON` can select the interpreter. |
| `java` | Node.js and the installed `java-parser` dependency; no JDK or project build. |
| `go` | Go 1.18+ and a root `go.mod`; see [Go scope and tooling](GO.md). |
| `rust` | Cargo/rustc 1.71+, a root `Cargo.toml` and the locked helper dependencies; see [Rust scope and tooling](RUST.md). |

The Go and Rust adapters compile Archify's source helper, not the target
project. Rust's first use may fetch the helper's locked dependencies; cached
dependencies are required for `rust.offline`. These tools remain necessary
when optional duplicate detection is enabled.

For a Java analysis without a diagram, run `node bin/archify.mjs code-analysis check /path/to/java-repo --language java --out out/java`. No JDK or project build is required. See [Java support and limitations](JAVA.md) for conservative dependency resolution, complexity measurements and syntax coverage.

Output defaults to a system temporary directory. Add `--out out/my-project` to choose a persistent output directory. Use the printed URL: double-clicking a static HTML file cannot start local code analysis.

You can also run `node bin/archify.mjs start "/path/to/project" --ir architecture.json` directly. The legacy `code-analysis serve` command remains supported.

## Architecture boundaries

To check that layers only depend on what they should, pass a config file with `--config analysis.config.json`:

```json
{
  "boundaries": {
    "layers": {
      "domain": ["src/domain/**"],
      "ui": ["src/ui/**", "src/components/**"],
      "shared": ["src/shared/**"]
    },
    "rules": [
      { "from": "domain", "disallow": ["ui"], "reason": "domain logic stays UI-free" },
      { "from": "shared", "allow": [] }
    ]
  }
}
```

Each rule names a `from` layer and either `disallow` (layers it must not import) or `allow` (the only other layers it may import; `[]` means none). A file matching several layers belongs to the first one listed. Imports involving files outside every layer, and test or generated files, are not checked. Every import that breaks a rule is listed as evidence, grouped into one finding per layer pair.

Boundaries come only from this config. The architecture diagram is not used as a rule: a missing arrow on the diagram does not forbid a dependency. Without `boundaries`, the overview lists architecture boundaries as not checked. Coverage shows how many files each layer matched; a layer matching no files usually means a mistyped glob. An invalid `boundaries` block stops analysis with `config/boundaries-invalid`.

## Entry points

`coupling/internal-leak` reports when other modules import a module's internal files instead of going through one entry point. Each such module is one finding listing every import that reaches inside it, the files reached, and the modules that import them.

A module's entry files are, in order:

1. files matching `rules.coupling.internalLeak.entries` in the config, when you declare your convention;
2. otherwise an `index.*` (JS/TS) or `__init__.py` (Python) directly in the module's folder.

```json
{ "rules": { "coupling": { "internalLeak": { "entries": ["src/*/index.ts", "src/*/api.ts"], "minFiles": 3 } } } }
```

Severity follows what is known about your convention:

- **warning**: you declared entry files and imports bypass them;
- **info**: an `index.*` or `__init__.py` exists and imports bypass it, or the module has no entry file and other modules reach `minFiles` (default 3) or more of its files. Deep imports are a common, deliberate style in ES modules and Python packages, so without a declared convention this is a signal, not a defect.

Imports within one module, test and generated files, and modules under a `vendor/` or `third_party/` folder are not checked. Java is not checked: a package's public classes are its interface. If deep imports are your convention, add `"coupling/internal-leak"` to `ignore`. An invalid option stops analysis with `config/internal-leak-invalid`.

In the Atlas, focusing any module marks the files other modules import, whether or not the rule fired; see [Atlas view](#atlas-view).

## Function complexity

Every Python and JS/TS function is measured the same way. **Cyclomatic complexity** is 1 plus one for each decision point:

Java methods and constructors use the same thresholds, with the Java-specific decision points and naming described in [Java complexity](JAVA.md#complexity).

| | Python | JS/TS |
| --- | --- | --- |
| Conditions | `if`/`elif` | `if`/`else if` |
| Loops | `for`/`while` | `for`/`for…in`/`for…of`/`while`/`do` |
| Error handling | `except` | `catch` |
| Conditional expressions | `x if c else y` | `c ? x : y` |
| Cases | non-default `case` | non-default `case` |
| Boolean operators | each extra `and`/`or` operand | each `&&`, `||`, `??` (and `&&=`, `||=`, `??=`) |
| Comprehensions | each `for`/`if` clause | — |

Optional chaining (`?.`) is not counted. **Nesting depth** is the deepest stack of blocks; `elif`/`else if` stays at its `if`'s depth.

Nested named functions are measured on their own:
- in Python: methods and nested `def`s;
- in JS/TS: methods, constructors, accessors, and arrow or function expressions assigned to a name.

Lambdas and anonymous callbacks count toward the function that contains them. A callback at module level has no such function, so it is measured on its own, named after the call it is passed to, and its first literal argument, such as `<callback of server.on("request")>`. Test and generated files are skipped.

A function is reported as info from complexity 15 or nesting 5, and as a warning from complexity 25 or nesting 6. Function length is shown as context but never reported on its own. A high count is a maintenance signal, not a defect. The problem page links to the function's first line and its deepest nested block.

To change the thresholds, set any of them in the `--config` file; unset values keep their defaults:

```json
{ "rules": { "complexity": { "function": { "info": { "complexity": 12 }, "warning": { "complexity": 30, "nesting": 7 } } } } }
```


## Severity levels

The colour says what kind of problem a finding is, not which rule reported it.

| Colour | Level | Meaning | What to do |
| --- | --- | --- | --- |
| Red | `error` | A structural problem: a circular dependency. The parts involved cannot be understood, tested or changed on their own, and cycles tend to grow. | Fix it. It can be accepted in the baseline so CI is not blocked, but it stays red on the page. |
| Yellow | `warning` | The code runs, but people will find it hard to maintain: duplicated code (when C6 is enabled), a hub or concentrated module, a very large file, a very complex function, a crossed boundary. | Review it. Fix it, or accept it with a reason. |
| Blue | `info` | A signal to read. | Nothing is required; it does not affect the verdict or CI. |

Red means "structure that should be fixed", not "proven to fail at runtime". An import cycle shows static structure and a possible load-order risk; the messages keep that wording.

How cycles are graded:

| Finding | Level |
| --- | --- |
| `coupling/import-cycle`: files that import each other at module scope | error |
| `coupling/import-cycle`: a cycle that only closes through deferred or conditional imports | warning |
| `coupling/import-cycle` and `coupling/cycle` in Java | error |
| `coupling/cycle`: modules that depend on each other through module-scope imports | error |
| `coupling/cycle`: a component that only closes through deferred, conditional or type-only edges | warning |
| Rust file and module cycles | info: files of one crate compile together, and mutual `use` is ordinary there |

**Upgrading.** Before rule version 2, file cycles were warnings and module and Java cycles were info. `check` fails on warnings by default, so a project whose only cycles were module-level or Java cycles passed and will now fail. To adopt the new levels without blocking CI on existing cycles, record them once and commit the file:

```sh
node bin/archify.mjs code-analysis check "/path/to/project" --baseline analysis-baseline.json --update-baseline --reason "existing cycle, tracked in <issue>"
```

A comparison with a run made before the change is marked not comparable (the rule versions differ), so a changed level is not misread as a new or fixed problem.

## Concentration

`coupling/concentration` reports where too much of the project sits in, or depends on, one place. It reports numbers, not a verdict that something must be split.

| Reason | Reported when | Default |
| --- | --- | --- |
| reach | a share of the other modules depend on a module, directly or through other modules | `reachShare: 0.5` |
| size | a module holds a share of the analyzed source lines | `sizeShare: 0.4` |
| file | a source file reaches a number of lines | `fileLines: 1500` |

Reach and size compare one module with the rest, so they are only checked when the project has at least `minModules` modules (default 6). Reach counts static dependencies of every kind, including deferred and type-only imports; it is not runtime impact. Test and generated files are not measured.

Findings are warnings, with one exception: high reach alone in a module that depends on no other module is info. That is a shared kernel, which is what the cycle rules recommend moving shared code into. A high-reach module with dependencies of its own passes their changes on to most of the project, so it stays a warning.

```json
{ "rules": { "coupling": { "concentration": { "reachShare": 0.6, "fileLines": 2000 } } } }
```

If the concentration is intended, accept the finding with that reason. An accepted finding is shown again when the module's or file's source changes.

## Duplicate code (C6, optional)

All six source languages can use **jscpd 5.4.3** to report token duplicates as
`redundancy/duplicate-block` warnings. Install the native executable separately
using [jscpd's distribution instructions](https://github.com/kucherenko/jscpd/blob/b82d84186389590fed0813d005391f3b8147dcfa/README.md#quick-start),
then enable it in the existing analysis config:

```json
{
  "duplicates": {
    "enabled": true,
    "executable": "/absolute/path/to/jscpd",
    "minTokens": 50,
    "minLines": 5,
    "identifiers": "exact",
    "timeoutMs": 30000,
    "maxFileBytes": 1000000
  }
}
```

Run from the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis check /path/to/project --language ts --config analysis.config.json --out out/analysis --json
```

Use the same `duplicates` configuration with `--language py`, `java`, `go` or
`rust`. Each invocation checks the selected adapter's captured source scope;
it does not combine all languages in a mixed repository or expand Go/Rust
build/profile coverage.

C6 compares the raw text of those selected files. In Rust, text inside an
inactive `cfg` region or an opaque macro can still match. Duplicate coverage
describes scanned files; it does not establish runtime reachability or coverage
of every build profile.

These are the defaults when `enabled` is true. `executable` defaults to `jscpd`
on PATH; a relative path containing a directory separator is resolved from the
caller's working directory. On Windows select the native `.exe`, not an npm
`.cmd` launcher. No detector is downloaded or installed by an analysis run.
When the block is absent, `enabled` is false, or `ignore` includes
`redundancy/duplicate-block`, the optional executable is not probed or run.
The selected language's extraction prerequisites above still apply. C6 adds
the jscpd executable to that setup; it does not replace the language adapter.

The mode is `weak`: whitespace and comments are ignored, while identifiers and
literals remain significant. Set `identifiers` to `consistent` to also consider
consistent renaming; this is a different matching policy, not a more accurate
default. Python docstrings and TypeScript declarations can still be repeated
tokens. Review their purpose before deciding to change code. These thresholds
have been sampled on real source but are not a universal maintenance threshold.

The detector scans a temporary UTF-8 copy of the already captured source,
following the selected language and module file roles. Test/generated roles
follow `modules.excludeRoles`; conventional `vendor`, `vendored`, `third_party`
and `third-party` directories are omitted. Parse failures, unsupported formats
and files above `maxFileBytes` are also recorded as omissions. The temporary
tree is removed after the invocation; the target project's code is not executed.

`findings.json` records engine/version, effective settings and selected/analyzed/
omitted paths under `analysis.duplicates`; `check --json` includes the same data
under `duplicates`. Native reports also omit files below their token/line limits;
when the report does not state an individual reason, it stays
`not-reported-by-engine`. An incomplete or empty scan is visible even with zero
findings: the CLI summary warns, `overview.json` records `coverage.duplicates`
(analyzed/selected/omitted counts and `complete`), and the page marks Coverage as
incomplete with `Duplicate code: x/y files analyzed · incomplete`. Comparisons involving incomplete coverage, a changed scan scope,
settings or engine are marked not directly comparable. Missing tools, wrong
versions, timeouts and invalid reports fail the analysis with exit 2; they do not
become clean results, even with `--fail-on never`.

Each finding retains one **native pair** and both locations, including duplicates
within one file. It does not infer every pair in a larger group. Coordinates are
converted from jscpd's UTF-8 byte offsets to UTF-16 source offsets and one-based
columns. IDs distinguish content, file, enclosing symbol and repeated occurrence;
leading lines and unrelated findings do not change them, but changing clone
content or the number of identical occurrences can produce new IDs.

The existing `task` command exports both sides and their allowed files. Evidence
hashes cover the complete cited lines, including context beside a partial-line
match. Both sides are checked independently; unique unchanged ranges can move,
while ambiguous moves or a changed number of identical copies invalidate the
old evidence. The original line-level evidence formats remain supported.
In the page, **Duplicate code** shows both file paths and complete short matched
ranges. Theme-coloured highlighting and an underline follow the recorded columns; text
beside a partial-line match stays unmarked. The mark denotes the detector's token
range, whose whitespace or comments may differ under `weak` mode. Long ranges
show bounded beginning/end excerpts with an explicit omission count. Open either
file to inspect its complete source; the exact marks survive full-file expansion
and returning to the finding. Older results without columns show a notice and
leave the source unmarked. The two locations are stacked in the existing reader.

## Accepting known findings (baseline)

Real projects have findings the team knows about and has decided to leave for now. A baseline file records them, so the overview and CI focus on what is new:

```sh
node bin/archify.mjs code-analysis check "/path/to/project" --baseline analysis-baseline.json --update-baseline --reason "existing debt when analysis was adopted"
```

This writes every current finding to `analysis-baseline.json` with that reason. Edit the reasons per entry if you like, and commit the file. Pass it to the page with `--baseline analysis-baseline.json` (`npm start -- … --baseline …`) or to `check`.

- Accepted findings stay listed, marked **accepted** with their reason, but no longer count toward the verdict, the priorities, the diagram colours, or a CI failure.
- An accepted **error** is the exception for colour: it no longer fails CI or counts toward the priorities, but its component stays red and it is marked **accepted · still to fix**. The baseline records a decision to wait, not a repair.
- Each entry remembers a fingerprint of the code it was about. If that code changes, the finding is shown again as **accepted · evidence changed** so someone looks at it once more.
- Entries whose finding no longer occurs are listed as no longer found: the problem was fixed or moved, and the entry can be removed. Running `--update-baseline` again keeps existing reasons, adds new findings, and drops those entries.

## Terminal and CI: `code-analysis check`

`check` runs the same analysis without a diagram and exits with a status a pipeline can use:

```sh
node bin/archify.mjs code-analysis check "/path/to/project" --baseline analysis-baseline.json --fail-on warning --out .analysis
```

| Option | Meaning |
| --- | --- |
| `--fail-on error\|warning\|info\|never` | Fail when an open finding reaches this level (default `warning`). |
| `--baseline file` | Accepted findings do not fail the run unless their code changed. |
| `--out dir` | Write `raw-facts`, `module-graph`, `findings`, `review` and `overview` JSON. The previous `findings.json` in that directory is compared with automatically. |
| `--compare findings.json` | Compare with a specific earlier run instead. |
| `--new-only` | Fail only on findings that are new since the comparison, for gating pull requests. Without a previous run to compare with, every open finding counts as new, so a missing comparison artifact cannot pass the gate. |
| `--update-baseline [--reason text]` | Write the baseline instead of checking. |
| `--json` | Print a machine-readable receipt instead of the summary. |

Exit codes: `0` passed, `1` the gate failed, `2` the analysis could not run (the diagnostic says why). The printed summary lists failing findings as `path:line` with their ids, the comparison counts, and stale baseline entries.


## Config files

`--config file.json` is merged into the defaults (`config/defaults.json`):

- objects merge key by key at every depth, so a file that sets one threshold or one file role keeps every other default;
- arrays replace the default list as a whole — `include`, `exclude`, `ignore` and each role's globs. To add an exclusion, copy the default `exclude` list and append to it;
- other values replace the default.

Use `"ignore": ["rule/code"]` to suppress rules. Optional duplicate detection must
first be enabled through `duplicates.enabled`; absent input or configuration
also leaves rules such as architecture boundaries unchecked. A config that is
not a JSON object stops analysis with `cli/config-invalid`.

## Atlas view

The Classic view reads the result against your architecture diagram and opens source evidence. The Atlas draws the analyzed tree itself, so the shape of the problems is visible at once:

- each **module** is an arc around the circle; a thicker arc is a reported hub;
- each **file** is a tick inside its module's arc;
- each **dependency** between two analyzed files is a curve, coloured by the importing module and bundled through both modules, so heavy coupling shows as a thick strand;
- each measured **function** is a spike outside its file, longer for higher cyclomatic complexity; a reported function carries a dot in its severity colour.

Hover for names and numbers. Click a module arc (or a module in the side panel) to focus it: its own dependencies stay coloured, other modules' dependencies on it are drawn in a neutral colour, and the rest fades. A mark inside the rim shows each of its files that other modules import (longer for more importing modules), and the side panel says how many of its files are imported from outside and by how many modules: the module's public surface as the code actually uses it. Click a dotted spike or a finding in the side panel to draw that finding over everything else: a cycle's path, a module cycle's modules, a boundary's crossing imports, the imports reaching inside a module (its arc thickens and its entry files, if any, are ringed), or a function and its file's dependencies. **Open evidence in Classic view** shows the same finding with its source excerpt and AI task.

Motion is used only to show change: the picture grows out from the centre when the Atlas opens, a new focus or finding cross-fades in, and a light travels around a selected import cycle in the direction of its imports. With your system's reduced-motion setting on, everything is drawn at once and stays still.

The Atlas adds no analysis: it draws the raw facts, module graph and findings of the same run. Dependency records that could not be resolved draw no curve; the side panel states how many there are, so a missing curve is not proof that there is no dependency. Test and generated files are left out, as in the module graph. The Atlas needs the raw facts of the run and is not offered without them.

## Comparing runs

Every `findings.json` records what the result depends on besides the code: the analyzer version, the extractor (its parser or runtime version and the revision of its own logic), a digest of the effective config, the rules that ran, the excluded file roles and the files that failed to parse. A comparison (Re-analyze, or `check --compare`/`--out`) lists findings that are new, **no longer detected**, and whose evidence changed, and adds:

- `comparable`: `true` when both runs measured the same way, `false` with `reasons` (config, rules, analyzer version, extractor, scope or parse errors changed), `null` when the earlier run predates this record;
- per finding no longer detected, a `likelyCause` when one is visible: `rule-not-run`, `files-missing` (deleted, renamed or excluded), `parse-error`, or `possibly-renamed` with the new finding ids that cover the same files.

Only a comparable run in which the finding is no longer detected, together with passing project checks, supports saying a problem was fixed. `review.json` keeps `fixed` as an alias of `notDetected` for existing readers.

## AI optimization tasks: `code-analysis task`

A task is a brief for a coding agent, built from one finding (or a few related ones) of a finished run. It contains the finding's facts, the cited code locations with captured excerpts, possible impact, suggested directions (kept apart from the facts), the files to change and to read, what must stay unchanged, when it is done, how to verify, and what is still to confirm. Business constraints and test commands are never guessed: unless you pass them, they are listed as to confirm.

```sh
# From the analysis/ directory written by serve, or the --out directory of check:
node bin/archify.mjs code-analysis task .analysis --finding COMP-bcd966585099 --root "/path/to/project" > task.md
node bin/archify.mjs code-analysis task .analysis --finding COMP-bcd966585099 --root "/path/to/project" --command "pytest -q" --format json --out task.json
# Later, before handing an exported task to an agent:
node bin/archify.mjs code-analysis task --verify task.json --root "/path/to/project" --require-valid
```

With `--root`, the cited code is compared with the current working tree and the task's evidence is marked **valid** (unchanged, possibly moved), **changed**, **missing** (file deleted or renamed) or **unverifiable**. Without it the task is **captured**: built from the analysis snapshot and not yet checked. Either way the task tells the agent to read the current source before changing anything and to treat the excerpts as data, not instructions. `--require-valid` exits 1 unless the evidence is valid. The page builds the same task through the local server (`POST /task`), so the copied text and the command output agree.

The contract is `schemas/ai-task.schema.json`; examples for each finding kind and evidence status are in `test/fixtures/tasks/`.

### Investigate a source question

To investigate a JS/TS function or feature without a finding:

```sh
node bin/archify.mjs code-analysis task .analysis --question "How does this function validate its input?" --entry src/validate.mjs --function validate --root "/path/to/project" --format json --out question.json --json
```

Entries may be `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` or `.tsx`; `.d.ts`, `.d.mts` and `.d.cts` declaration files are rejected because their call bodies are not captured. Use an existing analysis directory when available; omitting it keeps missing facts explicit. `--function` is optional and accepts a captured name or qualified name. The output records entry/source identity, direct import freshness, captured and indexed scope, and up to 40 calls in the selected source range. Inspect `calls.coverage`, `total` and `omitted`: unavailable coverage has a null total; a captured zero only means no collected CallExpressions in that range. The JSON receipt repeats call coverage so it remains visible with `--json`.

Changed or unavailable entry facts and entry parse errors return exit 1. A usable entry returns exit 0 even when call coverage is unavailable; the output remains `orientation-only`. Neither code means the semantic question has been answered. Call targets describe supported lexical bindings, with separate source-freshness checks, not runtime execution or complete impact. The host Agent completes the [function analysis workflow](FUNCTION-ANALYSIS.md), reading current source and verifying consequential claims before delivering an answer. Finding export and verification options remain separate from question mode.

### Investigate a changed source file

With analyzer dependencies already installed, capture two JS/TS roots using the
current extractor and one analysis configuration:

```sh
node bin/archify.mjs code-analysis task --question "Which source paths changed?" --base-root "/path/to/base" --root "/path/to/head" --entry src/validate.mjs --format json --out "/path/to/review/change.json" --json
```

`--entry` is required. The output must be outside both roots. This mode accepts
uncommitted sources; it reads files without executing the target application. It
compares text/function locations, records lexical call references and keeps module
import references separate. It does not use an existing analysis directory or
accept `--function`. Optional `--config` applies one analysis configuration to both
sides; observed compiler/package differences limit binding attribution.

The receipt reports per-side `definitionCoverage` and any incomplete-coverage
reasons. Parse/freshness failures, unsupported declaration entries or different
resolution settings produce partial/exit 1. Lists expose their own omissions;
ready/exit 0 means usable orientation, not complete impact or zero omissions. No
saved raw-facts directory is produced. Follow the [change-question workflow](FUNCTION-ANALYSIS.md#change-questions)
to explain behavior from source and project checks. Automatic entry selection,
JSON inventory and a semantic diff are not provided by this mode.


### From the analysis page

Open a priority finding or a component's finding, read the captured code excerpt, then click **Copy task for AI**. One click prepares the complete brief and copies it, without requiring you to open its preview. Paste it into the coding AI working on this project. **Task preview and download** provides the full preview, **Copy AI task**, **Download .md** and **Check again**. Copy and download refresh the task first when the local service is available. If clipboard access is unavailable, the preview opens and selects the text for manual copying.

The first `serve`, `check` or `task` run initializes the analysis module's missing dependencies using its package lock. Running a task does not itself connect to an AI recipient: the current UI reports copying or downloading, not sending or starting a refactor.

An offline report exports the captured snapshot and labels it as not checked against current source. Changed, missing, and unverifiable evidence is called out in both the preview and exported brief; ask your coding AI to read the current files before editing. An expired page or a rejected server request requires retry or re-analysis. Export does not apply a patch or execute project checks.

Relationships and metrics are folded below the code evidence. A source link opens the nine-line context; **Show full file** expands the file while preserving function-range highlighting. On narrow screens, **View diagram** / **Show analysis** switches between the canvas and reading column. Unchecked categories remain visible in the overview; a clean result only covers the rules that ran.

### Go source investigation

Use `--language go` at a root containing `go.mod`. An installed Go 1.18+ compiler is required. Saved and paired questions can follow captured direct function declarations and known callers; build scope, test inclusion, excluded files and incomplete typing remain explicit. See [Go support](GO.md) for commands, toolchain cost and limitations.

### Rust source investigation

Use `--language rust` at a Cargo workspace/package root. Cargo/rustc 1.71+ and
the locked helper dependencies are required. Saved and paired questions retain
the captured source profile, cfg/features, omitted regions and bounded call
model; a source binding does not establish compilation or runtime dispatch.
See [Rust support](RUST.md) for setup, profile settings and limitations.
