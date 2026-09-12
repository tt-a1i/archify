# Locate reference

Read this reference only when the user asks where a Git change lands on a checked-in map, or
asks to author or lint a component ownership sidecar. Ordinary diagram generation does not use
`locate`.

`archify locate` is pure computation. It reads Git output, one validated diagram JSON, and one
validated ownership sidecar, and writes a deterministic receipt plus an annotated HTML view. It
never calls a model, never edits the map, and never infers runtime impact. Its own receipt says
so:

```
Path ownership only; no runtime impact, causality, risk, or mergeability is inferred.
Import facts are reported as-is and never reconciled against authored connections.
```

## When to use it

Use it when a stable map already exists and the question is *which components does this range
touch, and what is the evidence*. Use `compare` instead when the question is *how did the map
itself change*. Use `--lint` while authoring a sidecar, before the map is used in review.

## Commands

```
archify locate <base>..<head> --map <map.json> --out <dir> [--ownership <file>] [--repo-root <dir>]
                              [--facts <before.json> <after.json>] [--bundle <dir>] [--json]
archify locate --lint [<rev>] --map <map.json> --out <dir> [--ownership <file>] [--repo-root <dir>] [--json]
```

- `<base>..<head>` is a two-dot range, i.e. the direct diff between two commits. For a pull
  request, pass the merge base as `<base>`. Both endpoints must exist locally. A three-dot
  `A...B` is rejected as `locate/range-invalid`; it is not parsed as `A` + `.B`.
- `--map` accepts any of the five diagram types. Only architecture maps produce an annotated
  canvas; the other four produce a receipt-only HTML shell.
- `--out <dir>` is required. It receives `locate.receipt.json` and `locate.html`, both committed
  by atomic rename.
- `--ownership` defaults to the map path with `.json` replaced by `.ownership.json`.
- `--repo-root` defaults to the Git top-level containing the map, and must itself be a top-level.
- `--facts` takes two raw-facts JSON files and contributes import-edge observations only.
- `--bundle <dir>` additionally writes `<map-stem>.locate.html`, a copy of the bundle entry with
  the change projection embedded.
- `--lint` cannot be combined with a range.

## Inputs

The sidecar is a separate file; no diagram schema field changes. Minimal shape:

```json
{
  "schema_version": 1,
  "kind": "ownership",
  "map": "archify-self.json",
  "excluded": ["archify.zip", "**/package-lock.json"],
  "components": [
    { "id": "cli", "globs": ["archify/bin/**"] },
    { "id": "renderers-shared", "globs": ["archify/renderers/shared/**"], "child_map": "render-pipeline.json" }
  ]
}
```

`map` is relative to the sidecar's own directory, so the pair moves as a unit. Every component id
in the map must appear exactly once in `components[]`; an empty `globs` array is a valid, explicit
statement that a component owns no repository path, which is the normal case for `external`
components. `child_map` marks a drilldown parent and requires the child sidecar to declare the
matching `parent` back-link.

### Glob language

Paths are POSIX and relative to the Git top-level. A glob is `/`-separated segments; each segment
is either `**` or a pattern segment.

| Token | Meaning |
|---|---|
| `*` | any run of characters within one segment, possibly empty |
| `?` | exactly one character within one segment |
| `{a,b}` | literal alternation; no nesting, no wildcards inside, at most 64 expansions |
| `**` as a non-final segment | zero or more whole segments |
| `**` as the final segment | one or more whole segments |

Matching is anchored at both ends and case-sensitive. `**` must occupy a whole segment, so
`a/b**/c` is rejected. There is no implicit directory expansion: `archify/schemas` matches only a
file with that exact path; to cover a directory write `archify/schemas/**`. There are no negative
globs and no precedence rules.

## Classification

Each path is classified once, in this order:

1. matches an `excluded` glob → `excluded`; component globs are not consulted.
2. otherwise, count matching components: zero → `uncovered`; exactly one → `touched`; two or more
   → `ambiguous`, with every candidate id listed.

Ambiguity is reported, never resolved. There is no last-match-wins and no specificity ranking; the
repair is to narrow a glob. A `touched` or `excluded` entry records the exact `matchedGlob`, so
every attribution is auditable without rerunning the matcher.

A rename contributes **two** file entries — the base path and the head path — marked with
`side: "base"` / `side: "head"` and cross-linked by `renamedFrom` / `renamedTo`. If the two sides
belong to different components, one `moved_between_components` fact is added. Facts never change a
state.

Components are `touched`, `untouched`, or `stale`. `stale` means at least one
`components[].sources[].path` is no longer a blob at the range end; it takes precedence over
`touched` because it is the one state that requires editing the map, and `touchedCount` /
`touchedFiles` are still filled in. When the missing path is the old side of a rename in the
range, `staleSources[].renamedTo` names its replacement. Only architecture maps carry `sources`,
so only they can be stale.

## What a touched state does and does not mean

`touched` means: at least one path changed in this range, and exactly one component's globs
matched it. That is the whole claim.

It does not mean the component's behavior changed, that the change is correct, that anything
downstream is affected, or that a reviewer can stop reading. `uncovered` means no glob matched —
which is a fact about the map's coverage, not about the change. `ambiguous` means the map is
imprecise here. `componentId: null` in a fact is an explicit unknown, never a guess. Import facts
are recorded as observed and are never reconciled against the map's authored `connections`,
because most authored relationships are not import edges.

The rendered HTML enforces the same boundary: it refuses to emit *chrome* containing `SAFE`,
`LOW RISK`, `MERGEABLE`, `NO IMPACT`, or `VERIFIED PR`, and it uses amber and red rather than a
success colour. Escaped input text is marked at its insertion site and excluded from the
visible-chrome check, together with embedded JSON, scripts, styles and the authored SVG.
A path such as `tpl/safe/` or a component label cannot trigger a claim or mask identical words
in a generated heading. A match names the substring in `evidence.match` and carries a
`supportedFixes` entry.

## Outputs

`<out>/locate.receipt.json` is validated by `schemas/locate-receipt.schema.json`. Top-level
fields:

| Field | Contents |
|---|---|
| `schemaVersion`, `ok`, `command`, `locatorVersion`, `completeness` | `1`, `true`, `"locate"`, `1`, `"complete"` |
| `mode` | `"range"` or `"lint"` |
| `repository` | `root` is the literal `"."`; `base`+`head` in range mode, `revision` in lint mode; `url` and `linkMode` copied from `meta.repository` |
| `map` | `path`, `diagramType`, `semanticSha256`, and — for a map that pins a revision — `revision` and `mapBehindBy` |
| `ownership` | `path`, `sha256` of the raw sidecar bytes, and the `parent` link when the map is a drilldown child |
| `review` | `required`, `blocking[]`, `advisory[]` |
| `summary` | file counts and component counts |
| `files` | one entry per classified path, sorted by path |
| `components` | one entry per map component, sorted by id, including untouched ones, with `label` inlined |
| `facts` | `moved_between_components` and `import_edge_change` entries |
| `mapDelta` | present only when the map JSON changed inside the range |
| `limitations` | the two sentences quoted above |

`review` is the explicit needs-review contract, so a consumer never derives it from counts.
`blocking` is drawn from `files_ambiguous`, `components_stale`, `map_changed`; `advisory` from
`files_uncovered`, `map_behind`, `map_revision_unavailable`, `import_edges_unmapped`; `required`
is true when `blocking` is non-empty. A pinned `meta.repository.revision` that is absent locally
omits `mapBehindBy` and adds `map_revision_unavailable` instead of aborting.

Because `components[]` lists every component with its label, and `repository.url` plus `head` are
in the receipt, a CI job can render a table with blob links without touching Git again.

### Determinism

Arrays are sorted by code point (`files` by path, `components` by id, `facts` by canonical JSON).
There are no timestamps and no randomness. There are no absolute paths: `repository.root` is the
literal `"."` and every path is relative to the Git top-level. Commit SHAs are 40 lowercase hex
characters. `map.semanticSha256` hashes the canonical map JSON; `ownership.sha256` hashes the
sidecar's raw bytes. Two runs over the same inputs produce byte-identical receipts. Failure
diagnostics may still contain resolved absolute paths in `evidence`; the receipt does not.

### `mapDelta`

When the map JSON is itself one of the changed paths, `mapDelta` carries `path` and the two
`<sha>:<path>` blob names. In range mode with an architecture map, locate then runs
`archify compare` as a child process and attaches the artifacts under `<out>/compare/`:

| `status` | Meaning |
|---|---|
| `added` | the map was added in this range; no baseline map exists, so comparison is not run |
| `compared` | comparison succeeded; `receiptPath`, `htmlPath`, and `exitCode: 0` are set |
| `compare-failed` | the child process failed; `exitCode` records its status |
| `unsupported-type` | the map is not an architecture diagram; nothing is run |

The comparison never changes locate's own result: the receipt is still written, `ok` stays
`true`, and locate still exits 0. Only `review.blocking` reflects the situation, by including
`map_changed`. For `added`, `baseBlob` is a lookup reference, not a claim that a baseline blob exists.
`--lint` never attaches a comparison.

### HTML

`<out>/locate.html` embeds the receipt as
`<script id="archify-locate-receipt" type="application/json">`. For an architecture map it also
renders the map's SVG with `data-locate-state` on each node group, dimming everything except
`touched` and `stale`, alongside per-component blocks and the uncovered / ambiguous / excluded
lists. When a comparison was attached, it links to it. For the other four diagram types the file
is a minimal receipt carrier.

`--bundle <dir>` additionally embeds
`<script id="archify-locate-projection" type="application/json">` into a copy of the bundle's
entry HTML. See `drilldown-bundles.md` for how the viewer consumes it.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success, including a lint run with no ambiguous paths |
| 1 | any diagnosed failure, and a lint run that found ambiguous paths |
| 2 | usage errors (missing `--map`, missing `--out`, unknown option, a flag without a value, `--lint` combined with a range) and `locate/range-invalid` |

Every failure emits a diagnostic with a stable `code`, `severity`, `message`, `subject`,
`evidence`, and `supportedFixes`. With `--json` the failure payload is
`{ schemaVersion, ok: false, command: "locate", error, diagnostics }`; without it, the first
diagnostic is printed to stderr as `[code] message`.

Codes are grouped by cause: `locate/git-*` and `locate/root-*` for the repository;
`locate/range-invalid` and `locate/revision-unavailable` for revisions; `locate/map-*` for the
diagram; `locate/ownership-*` for the sidecar (missing, invalid, map mismatch, duplicate or
unknown or unmapped component, invalid glob, parent mismatch, parent missing, not a subset);
`locate/facts-invalid` for `--facts` (including a non-string import endpoint); an import
endpoint whose path fails the repo-path check is kept with `componentId: null` and the raw
path string; `locate/out-directory` for the output directory;
`locate/artifact-invalid` when the generated HTML fails its own checks;
`locate/ambiguous-ownership` for lint.

## Authoring a sidecar

1. Write one entry per map component. Start from directory-level globs — one component per
   directory is the shape that holds up best.
2. Put generated output, packaged artifacts, lockfiles, and other non-product prefixes in
   `excluded`. On a repository that checks in rendered artifacts this is not optional: without
   it the projection drowns in generated files. The self-map excludes gallery and case HTML,
   README/changelog/roadmap prose, `.github/**`, `archify/examples/**`, `experiments/**`,
   `benchmarks/**`, `integrations/**`, root `scripts/**`, and `archify.zip`. Do not chase
   `uncovered` to zero by adding components for those trees.
3. Run `archify locate --lint HEAD --map <map.json> --out /tmp/lint --json`.
4. Fix every `ambiguous` path. The glob language has no negation, so the repair is usually to
   replace a broad glob with a brace enumeration. For example, when
   `archify/scripts/generate-validators.mjs` belongs to `schemas`, the sibling component cannot
   use `archify/scripts/**`; it enumerates its own files instead:
   `archify/scripts/{check-render-output,check-update,generate-brand-marks,render-examples,update-contract}.mjs`.
5. Read the `uncovered` count but do not chase it to zero. Lint reports it and does not fail.
   Requiring full coverage turns a ten-component map into a file-tree mirror.

Maintenance is discrete rather than continuous: a replay of 100 commits on this repository needed
a sidecar edit in 9 of them, ten one-line edits in total, and six of those ten were "the
repository grew a new top-level directory".

### Drilldown children

A child diagram's sidecar declares `parent: { map, component }`, and the parent component
declares `child_map`. Both must point at each other. Every glob in the child sidecar, including
`excluded`, must be a syntactic subset of one glob of the parent component that declares the
drilldown. The check is one function, `validateChildOwnershipSubset`
(`archify/locate/ownership.mjs:222-248`), shared with `archify bundle`. It is conservative:
everything it accepts is a true subset, and it may reject a glob that is in fact narrower. So
`archify/renderers/**` covers `archify/renderers/shared/**`, but `archify/scripts/*.mjs` does
not cover `archify/scripts/**`. Repair a rejected glob by rewriting it as a literal extension
of a parent glob, or by widening the parent.

Parent `excluded` is inherited at projection time (`inheritParentExcluded`,
`archify/locate/ownership.mjs:251-257`): `locate --bundle` and the parent receipt's `inside`
counts treat a parent-excluded path as `excluded` even when a child glob would match it
(`archify/locate/locate.mjs:141`, `archify/locate/cli.mjs:304`). The child sidecar does not
repeat parent exclusions.

A parent component with a child gets `childMap` and `inside: { touched, uncovered, ambiguous,
excluded }` in the receipt — the child classifier run only over range paths that match the
parent component's globs, through the child's sidecar plus inherited parent exclusions
(`archify/locate/locate.mjs:136-146`). The parent's own `touchedCount` counts only what its
own globs matched; the two numbers are never merged. `inside.touched + uncovered + ambiguous
+ excluded` equals the number of range paths inside the parent component.

## Worked example: the Archify self-map

`docs/cases/archify-self/` holds a ten-component architecture map of this repository, its
sidecar, and two children. Regenerate from the repository root:

```bash
node archify/bin/archify.mjs bundle docs/cases/archify-self

node archify/bin/archify.mjs locate \
  b86b60789e18829885dd23c844e36549f0b40303..e9ea3a1330733ea6049429ca9e3b731d7f59d8c4 \
  --map docs/cases/archify-self/archify-self.json \
  --out docs/cases/archify-self/locate-pr-256

node archify/bin/archify.mjs locate \
  10722002bb8777ecb639d93c49586fae4adf3ae4..3b875f79bb3432ad8210b8abc36ade9802466bfa \
  --map docs/cases/archify-self/archify-self.json \
  --out docs/cases/archify-self/locate-pr-352

node archify/bin/archify.mjs locate --lint HEAD \
  --map docs/cases/archify-self/archify-self.json \
  --out /tmp/archify-self-lint
```

Only `locate.receipt.json` is kept under each PR folder; the HTML and any `compare/` directory
are deleted after regeneration.

The first range covers 50 paths: 7 touched, 2 uncovered, 41 excluded, 0 ambiguous; 2 of 10
components touched, 0 stale. `review.required` is `false` with advisories `files_uncovered` and
`map_behind` — the map pins revision `1072200`, eight commits behind that range's head. Both
drilldown parents report `inside: { touched: 0, uncovered: 0, ambiguous: 0, excluded: 0 }`
because no range path matches `archify/renderers/**`. The second range covers 25 paths with
nothing touched and 24 uncovered, which is a real and useful answer: 22 of those paths are a
new top-level `analyzers/` directory that the map does not yet claim, so the honest report is
"this change lands outside the map", not a touched component. Its drilldown parents are also
`inside` all zeros.


### Bundle projection failure

With `--bundle`, the projection is prepared before replacing the main HTML/receipt pair.
A missing child specification, ownership sidecar or matching parent binding fails as
`locate/bundle-incomplete`; invalid manifest or projection preparation errors produce
`locate/bundle-invalid`. No successful main pair is published for an incomplete projection.
All three output files are preflighted and committed together with rollback on write failure.
If the filesystem also prevents rollback, the diagnostic identifies the retained staging
backups for recovery. Projection JSON escapes HTML-significant characters before embedding.
