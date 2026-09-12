# Identity-map legacy disposition — 2026-09-12

The recovered work now has concrete pull requests, regression tests and replayable evidence. None of these PRs has been merged as part of this recovery. Original recovered snapshots and the user's mixed working tree/index are preserved. The PRs' current checks and descriptions record final acceptance for their exact heads; the observations below name their source versions where relevant.

## Delivered work and remaining acceptance

| Work package | Reuse and current boundary |
|---|---|
| Classifier and keyboard correctness | [#367](https://github.com/tt-a1i/archify/pull/367) contains the empty-segment subset fixes and ordinary-viewer keyboard regression. A real nested-child reproduction found the remaining Backspace forwarding defect; the follow-up fixes the shared Escape ladder and preserves text input and ordinary-viewer behavior. |
| Locate HTML and bundle delivery | #367 reuses canonical bundle validation, binds maps/specs/sidecars to manifest files, copies complete portable bundles, distinguishes user text from generated claims, handles added/renamed maps and restores prior outputs after installation failure. A moved-directory browser check deletes the original source and verifies actual child projection. |
| Current-main renderer/checker defects | [#396](https://github.com/tt-a1i/archify/pull/396) supplies readable, correctly classified renderer diagnostics. [#397](https://github.com/tt-a1i/archify/pull/397) preserves explicitly authored straight routes through final checking. Both exact heads have passing hosted CI. The finite-SVG finding reuses [#373](https://github.com/tt-a1i/archify/pull/373): main integration and a reproducible ZIP were pushed to the contributor's branch as `e59c633`, preserving their commits. Its 26 checker tests, recovered public sequence validation and all hosted CI gates passed. |
| Source integration and browser acceptance | Main `6db72a9` is integrated into the modular Viewer source. Packaged/development examples, Gallery, Checkout comparison, MCO artifacts, README animation and ZIP are regenerated. New real-browser message, stale-child, navigation and portable-output cases are registered for CI. All hosted gates passed on `dc2153b`. Two previous heads failed the stored-motion-preference test; diagnostics were added without removing the persistence assertions. The root cause of those intermittent failures was not established, and a passing later run is not described as a product fix. |
| Presets and receipt presentation | The four historical commits are preserved at `9306382` on `codex/archive-identity-presets-20260909`. Broad presets are not adopted: fixed counterexamples show legitimate product inputs becoming excluded. Smaller output remains a separate design candidate with [specific compatibility requirements](../experiments/legacy-replay/receipt-only-decision.md), not an unfinished promise to merge the old implementation. |
| Communication and maintenance routing | Actual PR descriptions replace the old draft/status claims. The author's Discussions [#368](https://github.com/tt-a1i/archify/discussions/368) and [#369](https://github.com/tt-a1i/archify/discussions/369) were corrected and their complete bodies read back. The bulk 15-comment plan is retired; co-referencing PRs are routed by actual scope. The CLI investigation found the structured argument fix already in #330/#331 and strict-argument work already tracked by #305/#307/#314, so no duplicate bug or policy system is introduced. |
| Evaluation evidence | [The pinned replay](../experiments/legacy-replay/README.md) supplies 75 fixed observations and six real CLI runs with matching independent output hashes. Six original external map/sidecar files are retained verbatim. [First-look recovery](../experiments/legacy-first-look/README.md) preserves 30 original answers, 15 static ground truths and independently checked scoring. [E3 recovery](../experiments/legacy-e3-replay/README.md) reconstructs the 100-step history and explicitly separates two anchor selections. Each package includes runnable code, fixed inputs or Git pins, results and provenance. |

## What the experiments establish

The fixed replay characterizes named boundaries, including known bad behavior. It is not a new model trial, a repeat of the old 93-PR survey or an estimate of human review time.

The recovered first-look answers preserve the old result: on ten main PRs, P@3 is 0.767 without Locate and 0.700 with it; across all 15 PRs it is 0.711 and 0.644. This was one model, one trial per condition and experimenter-authored non-blind ground truth. Complete original prompts and receipt-derived noise labels have not all been reconstructed. No human speedup, runtime-impact inference or recommended review order is established.

The exact `archify/migrations/workflow-v2.mjs` path stays uncovered in the tested docs/generated preset cases. Other illustrative product files under build, fixtures, image and documentation patterns become excluded. Both results matter; an extension or directory name does not establish product importance.

The E3 replay JSON matches the old record byte for byte: nine of 100 first-parent commits trigger ten scheduled human-authored edits. The recovered anchor script chooses 61 anchors from 21 files; the old report chooses 67 from 23. Reusing only the latter's coordinates and independently reading Git reproduces that report's complete observations. Both selections are preserved. Neither edit counts nor line decay measures actual maintenance time.

Two named historical label-overlap fixtures were reconstructed at the original and current-main revisions. All eight render/check commands passed and each fixture's SVG bytes were identical across revisions. Real-browser ink checks did not substantiate the old suspected visible collisions: the architecture tag is initially hidden and has separate ink when revealed; the workflow ZWJ label has no visible ink. The historical suspicion was corrected without changing label policy or claiming the original 2,200-case corpus was rerun.

## Material disposition and completion

The private recovery ledger retains all 84 snapshot IDs, exact source provenance and one destination per snapshot: 64 used and 20 archived with reasons. Material reuse, publication and final CI acceptance are recorded separately. Historical scripts, old timing values and missing screenshots are not relabelled as new results.

Local `npm test` on product commit `66576ed` completed with 1,422 passed, zero failed and 52 skipped; source hashes were unchanged throughout. The six-case hostile-CLI file and six-case real-browser file also passed independently. The final handoff additions passed 44 focused contract checks and all six browser cases, including an ordinary page with zero bundle message registrations and a working child with no embedded manifest/projection payload. These local results do not waive any failing hosted gate. Existing contribution/review policy already covers impact, compatibility and evidence; no additional bot or mandatory questionnaire is needed for this recovery.

## Original handoff requirements

| Requirement | Adopted result or explicit disposition |
|---|---|
| Scoped Backspace | Active/nested context only; five keyboard checks plus real child focus-clear/return and ordinary embedded behavior. |
| Payload-scoped listeners | Click/load listeners require an entry manifest; message handling also permits a nested child without its own payload. Registration waits for document parsing because bundle injection can place its manifest after the runtime. Blanket removal of `postMessage("*")` was rejected for opaque `file:` origins; source/role/payload/ID/digest checks remain. |
| Safe embedded JSON | `<`, `>` and `&` are escaped; actual injection/message regressions cover the boundary. No refactor solely to adopt a proposed helper name. |
| Fail-closed bundle and ownership boundaries | Canonical bundle preparation rejects malformed manifests and missing required child inputs. Missing explicit parent pointers fail; ordinary Locate may omit optional child `inside` details. A real CLI regression protects that distinction. Existing error codes are retained. |
| Missing map fields and repair guidance | `loadMap()` names missing/invalid `diagram_type` and `schema_version`, keeps `locate/map-invalid`, and supplies actionable fixes. Eleven negative cases cover both range/lint modes and preserve previous outputs. |
| Newly added maps | Public CLI returns `mapDelta.status: added`; renamed-map and supplemental compare-failure cases are covered separately. |
| CHANGELOG and README | Compatibility wording does not promise unchanged HTML bytes; all README variants link the two maintained references. SKILL.md was not expanded. |
| Lint, error and API documentation | References distinguish lint ownership from changed paths, document manifest failure codes and synchronous `descend(componentId)` request semantics. A true return does not assert child readiness. |
| Property and byte guards | Fixed empty-segment implication counterexamples are executable. Universal base/head HTML byte equality was rejected because intentional wrapper changes alter bytes; applicable generation and CI checks remain. |
| Stale decision-record references | Six named navigation errors now link to verified symbols at fixed public commit `dc2153b`; remaining numeric citations are explicitly historical, and maintained references are the contract authority. This is not a claim that every old citation was re-audited. |
| Receipt behavior instead of source assertions | Removed the named source-text status assertion; actual receipts cover evidence-only identity, `import_edges_unmapped`, `unsupported-type` and `compare-failed`. |

The old uncovered UI proposal (prefix grouping, a permanent Passport chip and an empty-list state) was not adopted as a separate feature. Current receipts retain every uncovered path and the HTML exposes their count and complete list. The proposed extra widgets and receipt-only output need their own validated user need; they are not unfinished implementation promises in this recovery.

The five states, two-level/12-child scope, authored `sources` contract and separation from runtime-impact inference remain. No first-party PR-comment action, new exclusion policy, inference engine or simulated human study was introduced. The proposed three-person study is unplanned and archived, not secretly replaced with agent trials. Code review evidence comes from recorded agent reviews and root diff inspection, not a claim of human maintainer approval or completion by the original quota-limited Fable agents.

[The acceptance record](identity-map-followup-2026-09-12.md) preserves the earlier source-stage failures and subsequent fixes. Earlier failed or overlapping runs remain historical evidence rather than being renamed into final-head success.
