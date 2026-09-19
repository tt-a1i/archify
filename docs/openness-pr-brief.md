# Openness PR — a review brief

What this branch does, what it does not do, and how to check both in a few minutes.
(The design reasoning lives in [openness-design.md](openness-design.md); this file is the short version for a PR conversation.)

## The claim

The compiler gains **positions a document may fill**, not a vocabulary it must speak. A document that fills none of them renders **byte for byte** as it did before, and the checked-in golden test is what proves it — not our word.

## What is added: fields only

Every addition is optional. `—` means "the artefact is exactly what it was".

| Seam | Fields | Effect when declared | Effect when not |
| --- | --- | --- | --- |
| Carriers | `nodes[].facts`, `edges[].facts` | numbers a rule may read | — |
| Actions | `nodes[].links`, `edges[].links`, `$defs/link`, `$defs/links` | a spot or a leg opens a URL (hover chips) | — |
| Photos | `nodes[].media.href/alt`, `$defs/href` | a photo revealed on focus | — |
| Vocabulary | `meta.types[]`, `meta.labels`, `$defs/labels` | the document names its kinds and restates viewer copy | built-in seven kinds, built-in copy |
| Derivation | `meta.rules[]` (`kind: window \| sum \| compare \| require \| accumulate`, `add`, `seeds`, `render`, `wrap`, `limit`, `missing`, `scope`, `tolerance`, `expect`, `field`, `left/right/op`, `min/max`, `on`) | values are derived and checked, with diagnostics of the same shape as geometry ones | no rule runs |
| Line states | `meta.edgeStates[]`, `edges[].state` | a line carries a declared state; the paint names the *authored* arrow class, never a viewer clone of it | lines keep their variant |
| Reader | `meta.reader` (`store`, `slots[]`, `view.dim/stow/solo`, `clock`, `suppress`), `$defs/readerViewTarget.slot/reach` | the reader writes values, the view responds, the clock replays the declared rule in the browser | no reader UI, no reader runtime in the artefact |
| Clock bands | `meta.bands[]`, `phases[].from/to`, `groups[].from/to`, `rules[].render.caption` | a band names or places values by clock range; `{band}` writes the word into a render template | phases keep their column extent |

The delivery receipt gains one optional field: `suppressed: [...]` — read back from the artifact itself, so the receipt describes the file that exists.

## What is *not* added

- **No domain noun in the core.** The core learns verbs (`accumulate`, `compare`, `require`, "place by value", "name by value"), never "hotel", "morning" or "deadline". Every word an artifact shows comes from the document (`meta.types`, `meta.labels`, `meta.bands`, node/edge copy) or from the renderer's own `en`/`zh-CN` catalog, which already existed. This branch even moved two hardcoded cost strings out of the compiler and into that catalog (`workflow.leg.cost`, `workflow.leg.spoken`), where `meta.labels` can restate them.
- **No new rendering path** for documents that declare nothing: every added branch is guarded by a declaration, so the rendered output is unchanged — the byte comparisons below are what establish that, and the guard table only shows where those branches return.

## Does anything that existed change?

Measured, not asserted:

1. **Golden**: `node test/golden.mjs` renders every checked-in example (plain and packaged) and compares bytes. All pass unchanged. This is the load-bearing evidence: unstated means inert.
2. **The whole suite**: on this machine `npm test` reports 31 failures — and a pristine checkout of the base commit, with the same dependencies, reports **the same 31, one for one** (Windows symlink privileges, missing `bash`/`unzip`, `core.autocrlf` checkout expectations, git replacement refs, network-lease timing). Zero added, zero removed. 1363 tests pass.
3. **Three `required` lists were relaxed** — `nodes[].col`, `phases[].fromCol/toCol`, `groups[].fromCol/toCol` — because a value can now own the column. Each relaxation is paired with a compiler diagnostic that names the same defect in the same structured shape, so a document that was rejected before is still rejected, with a better message: `workflow/node-col-missing`, `workflow/phase-extent-missing`, `workflow/group-extent-missing`. No silent skip was introduced; that was the point of writing them.
4. **Viewer**: the chrome now asks the document (via `data-suppressed`) before building an effect. A document that declares nothing gets exactly the chrome it had; the receipt records what a document chose to leave out.

## Tests added (8 files, 63 cases)

| File | Cases | What it locks |
| --- | --- | --- |
| `workflow-reader.test.mjs` | 11 | slots, view, store, the reader runtime only exists when declared |
| `clock-arithmetic.test.mjs` | 6 | every drawn time is re-derived from the document; stated minutes equal the leg's fact |
| `derivation-conflicts.test.mjs` | 9 | two rules on one render slot report instead of stacking; the ceiling travels with the artifact; a line state paints the authored line, never a copy |
| `phase-bands.test.mjs` | 19 | a band places or names; a value no band covers is reported, never clamped; a stop the rule never reaches takes part in nothing |
| `workflow-rules.test.mjs` | 6 | each rule kind, opt-in strictness (`missing`) |
| `workflow-links.test.mjs` | 4 | chips, href shape, no orphaned link targets |
| `workflow-types.test.mjs` | 4 | declared kinds ride the seven palette slots; unknown kind is a diagnostic |
| `suppression.test.mjs` | 4 | a suppressed effect is never built and is recorded in the receipt |
| `workflow-compiler-hard-contract.test.mjs` (edited) | — | keeps the closed side closed under the new fields |

## Costs and limits, measured

- **An aligned clock axis is honest but wide.** Declaring the six bands of a four-day, five-stop-a-day itinerary as clock ranges makes every stop land in its own band: 9 columns, 1719px viewBox. At the repository's narrowest desktop reader (960px wide → 930px of diagram) that projects 4.3px of text against a 6px floor, so `showcase` refuses it. The same document *naming* bands instead (`meta.bands` + `{band}` on the caption line) stays at 1223px and 6.1px. Both forms are supported; a pack picks one and states its target window. We did not touch the floor to make our own diagram pass.
- **Group frames are still geometry** unless they declare a clock range.
- **The reader replays the rule in the browser and writes nothing back** — the artifact stays a file; state travels inside a copy of it.

## On "not general-purpose"

We read your note as **"the core must not accumulate domain vocabulary or domain rules"**, and this branch agrees with it: the core grows resolvers, checkers and aggregations — computing capability — and refuses nouns. The seams are positions, and a position is not knowledge. If any field here looks like a noun that belongs to a domain, that is exactly the kind of review we want on it.

## The authoring surface

The core can now be declared open, so the branch also publishes what a document may fill, at the same layer the other references live:

- [`archify/references/positions-contract.md`](../archify/references/positions-contract.md) — one page: what may be declared, what each declaration decides, what stays untouched when it is absent, and how to re-run both invariants.
- [`archify/references/creation-guide.md`](../archify/references/creation-guide.md) — the situational half: which position a given situation is worth, and the three questions that decide whether something belongs in a pack or in the core.

Nothing here tells a pack author how much of that page to put in front of an AI. That is the pack's own optimization; the core owes a bounded contract and a router, which is what `SKILL.md` (141 lines) keeps being.

## All diagrams, not just ours

Two runs over the whole repository, not over the one example that motivated the work:

| Run | What it compares | Result |
| --- | --- | --- |
| Compiler against compiler | every `*.workflow.json` in the repository (15 documents: examples, gallery sources, issue fixtures, v1 baselines, one generated) compiled once with the base commit's compiler and once with this branch's, comparing SVG bytes, runtime bytes and diagnostic codes | **15 / 15 byte-identical** |
| Drawing against drawing | every checked-in artifact of the other four renderers that can be re-rendered here (five `archify/examples`, four root `examples`, one generated) re-rendered and its `<svg>` compared byte for byte with the base commit's checked-in artifact | **10 / 10 identical** |

Two `mco-runtime` cases pin source evidence to a repository revision and cannot verify in a shallow clone — the same limitation the repository's own pinned-evidence tests hit in this environment.

The repository's own byte locks cover the rest: `test/golden.mjs` renders all five modes (plain and packaged), the gallery test regenerates and compares eleven artifacts, and the delta test compares the checkout pair.

## Undeclared means not computed

Every new path returns before it can touch anything. First line of each:

| Where | Guard |
| --- | --- |
| `applyRules` | `if (!rules.length) return [];` |
| `renderEdgeStateStyles` | `if (!states.length) return '';` |
| `placePhases` | `if (!phases.length) return [];` then, for the column form, one extent check and out |
| `placeGroupFrames` | only groups that declare a clock range are read |
| `renderReaderRuntime` | `if (!declaration.active) return '';` |
| `suppressedAttr` | `suppress.length ? … : ''` |
| viewer chrome | `data-suppressed` absent → the split yields a list that matches no effect id |
| delivery receipt | the `suppressed` key is added only when the attribute exists |

Byte equality and inert code are the same claim seen twice: the guards show the paths return early, the comparisons show the bytes do not move.

## How to review in three commands

```sh
cd archify && npm test                      # golden + everything; compare the failure list with your base
node test/golden.mjs                        # the byte lock alone
git diff 72c750b -- archify/schemas         # every added field, in one screen
```
