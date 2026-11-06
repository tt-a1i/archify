# Explain a function or feature

Use this workflow when the user asks what a JS/TS feature does, how its
inputs reach outputs, what its changes mean, or whether it needs improvement.
It accepts a question and an entry file, with an optional function name; a
finding is not required. `task --help` describes question mode and its options.

1. **Scope.** Before reading the path in depth, record the question, entry,
   acceptance questions and excluded areas. For a code change, pin full base/head
   revisions and keep each side in its own checkout; record author intent
   separately from the behavior inferred from source. Prepare orientation with
   `task --question … --entry … --root …`, passing an existing analysis directory
   when available. Read `scope`: distinguish the Git root, analysis root and
   captured facts files; root-external regions are indexed paths, not inferred
   responsibilities. Matching roots still leave language/filter/parse limits.
   Git scope may be unknown without preventing source reading.
   Completion: the scope is recorded and the orientation status
   is understood. Orientation is an intermediate result, not the final analysis.
2. **Locate.** Read the entry from the current root. Use a captured function
   range only when its file facts are valid and parseErrors is empty. Missing/changed facts require
   current-source discovery; refresh extraction before using old ranges or
   import edges as current facts. An invalid entry must be corrected. Completion:
   the actual entry is identified in current source and its identity recorded.
3. **Trace.** Follow the finite path needed for the question: callers/dispatch,
   inputs, branches, helpers, configuration and outputs. Inspect computed imports
   and subprocess commands in source; check target source when following them.
   Read `calls.coverage` and `calls.bindingCoverage` before using call locations.
   The explicit `js-ts-lexical-v1` call model covers declarations, direct const
   arrow/function-expression initializers and relative static named imports to
   direct captured exports. The v2 model additionally binds relative default
   imports to direct default function declarations with one implementation body;
   default export expressions and re-exports remain unresolved. This consumer
   supports both versions without reinterpreting older facts.
   `adapterRevision` identifies extraction changes;
   it does not establish call capability, because different experimental branches
   have reused revision numbers for import-only extraction. Only `available` supplies
   usable records; absent/unknown call models, absent calls, changed entry
   text and parse errors leave totals unknown and records empty. An available
   zero means no collected CallExpressions in this source range, not no runtime
   calls (constructors and tagged templates are excluded).
   Older experimental facts without the marker remain readable, but require
   fresh extraction for call orientation even if their calls array is nonempty.
   New marked facts require the updated raw-facts schema; older strict readers
   reject the additional field.
   Each `calls.records` item keeps its original `fact` and `factIndex` in the
   analysis directory's `raw-facts.json` calls array, tied to the snapshot in
   `calls.provenance`. Use full start/end ranges; chained calls can share starts.
   Original `fact.target` is captured evidence, not a current navigation promise.
   Use only `targetNavigation.location` when its status is `valid`. Same-file
   targets share entry freshness; imported targets are checked separately.
   Changed, missing, unverifiable or parse-error targets have `location: null`;
   read current source and refresh extraction before using those target ranges.
   Valid navigation checks captured target text and coordinates, not fresh
   resolution after other source/configuration changes. Refresh extraction before
   asserting current binding relationships. Uncaptured targets are not read or resolved. `imported-function` covers only
   relative non-type-only named imports to direct exports; default/namespace,
   package, CommonJS/dynamic and re-export paths remain unsupported.
   Follow valid `same-file-function` navigation as lexical declaration hints, including
   under reassignment. `same-file-function-initializer` points to the direct const
   initializer; a named function expression uses its measured inner name, which
   can differ from the variable name. This does not prove TDZ safety or execution.
   Wrapped initializers, let/var, aliases and parameter propagation remain unknown;
   unresolved reasons require reading the current callee,
   parameters, imports or assignments. Selected ranges include nested function
   and closure bodies, not just direct calls of the selected function.
   Output includes the first 40 records in source order. Check total/included/
   omitted before drawing conclusions; use current source or raw facts to read
   the remainder. Entry freshness covers same-file targets only.
   Treat unresolved imports as coverage limits. Completion: every
   acceptance question has a source-backed answer or a named unresolved boundary.
4. **Check.** Select a few consequential claims and record expected outcomes
   before running bounded probes. Use project test-selection guidance. Record
   actual commands, results and untested branches. Recheck the files used before
   delivery; if they changed, update the analysis or mark affected claims stale.
   Entry freshness alone does not validate the rest of the report. For a change,
   locate and check source on each side, then run the same bounded inputs with
   expected base/head outcomes. Record dependency/environment reuse and its limits;
   a check against the current experimental tree cannot validate historical sides.
5. **Deliver.** Write the actual analysis with source links: responsibilities,
   inputs/outputs, main flow, key dependencies/configuration, failure exits,
   change semantics when relevant, and coverage limits. Separate tool observations,
   Agent interpretations and runtime observations. An improvement candidate needs
   an observed problem, smallest justified change and acceptance check; otherwise
   explicitly conclude that no change is justified. Completion requires this
   analysis and verification record, not the CLI's orientation or this checklist.

The tool checks file identities and locates captured facts; the host Agent owns
semantic interpretation. Report the analyzed revision and working-tree state.
A single run is neither independent validation nor an accuracy/cost benchmark.
A semantic explanation does not authorize implementing its proposed changes.

## Change questions

For two existing JS/TS source roots, prepare a fresh pair from the `archify/`
package directory:

```sh
node bin/archify.mjs code-analysis task \
  --question "How did language selection change?" \
  --base-root /path/to/base --root /path/to/head \
  --entry extract/index.mjs --format json --out /path/to/review/change.json
```

The output must be outside both roots. This path uses installed analyzer
dependencies and reads source without running the target application or changing
checkouts. Both sides use the current TS extractor and one effective analysis
configuration (defaults, or one `--config` merged with defaults using the usual
analysis-config rules). It accepts uncommitted files; Git metadata is background,
while each snapshot digest identifies captured text. Existing analysis directories,
finding/verify options and `--function` are separate modes.

Read the orientation before following locations:

- `fileChanges` covers captured JS/TS files across both roots. Added/deleted files
  are normal results. Documents, excluded files and other languages remain outside
  this signal. `changedDefinitions`, `positionOnlyDefinitions` and
  `unpairedDefinitions` focus on the entry file; known references search all
  captured sources. An entry present on one side is supported.
  `definitionCoverage` reports each side explicitly. Captured declaration files
  have `declaration-file-unsupported` coverage and partial/exit 1; an available
  implementation file with zero measured functions is a different result.
- `moduleReading` is separate from function calls: each side lists captured,
  resolved imports/re-exports whose destination is the entry. Read the original
  fact's `kind`, `typeOnly` and `lazy` flags (absent flags mean false). These are
  dependency reading locations, not proof that a function executes or behavior
  is affected. `factIndex` addresses that side/snapshot's imports array. Navigation
  requires valid origin/entry source and unchanged resolution inputs; configuration
  differences retain the same binding-attribution limit. The unresolved-import
  count covers all captured sources, whose destinations cannot be assigned to
  this entry. Zero resolved references does not establish zero consumers.
- A unique file + qualified name + syntax-kind slot is a reading pair, not an
  enduring entity ID. Text differences include formatting and do not prove
  behavior changes. Equal function text with shifted positions is separate.
  Renames/moves are shown as unpaired or deleted/added, never inferred by name or
  similarity. Duplicate slots stay unpaired.
- Each side records source freshness, parse failures, compiler options and a
  digest of actually read configuration/package inputs. Root-relative options
  are normalized for comparison; extended configs and package metadata are
  included. `comparison.resolutionChanges` lists changed options with their values
  and changed configuration/package paths with per-side hashes, separately from
  source-file changes. Differences set `bindingAttribution: limited`: explain them before
  attributing changed bindings to source alone. Even irrelevant config-text edits
  conservatively trigger this limit. Added source candidates can change bindings
  with identical configuration.
- Parse failures or source drift produce `status: partial` and exit 1, retaining
  valid regions; this exit describes capture/configuration limits, not a finding
  gate failure. Affected definitions have no trusted locations. Original call
  `fact` records are captured evidence; use `knownReferences.items[].navigation`
  only when valid. Coordinates and factIndex belong to that item's side and
  snapshot. No saved raw-facts directory is produced by this mode; the selected
  records are embedded. Resolution-input drift suppresses call navigation.
- Lists include total/included/omitted and are capped at 40. Read relevant source
  beyond the cap. `unresolvedWithinSourceRange` includes nested closures;
  supported lexical references do not establish runtime callers, complete impact
  or risk. Freshness checks are bounded observations, not an atomic two-tree
  snapshot or a promise of future re-resolution.

Continue with **Trace**, **Check**, and **Deliver** above. In particular, read the
actual caller and relevant branches on both sides, then distinguish source-backed
interpretation from executed behavior. Completion requires a short analysis with
source references and named unknowns, not merely this orientation JSON.
