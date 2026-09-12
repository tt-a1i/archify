# Identity map: recovery acceptance queue

This is a local follow-up to draft PR #367, not a new product specification or a merge approval. The recovered research baseline is c881670. Research reports describe that historical version; current delivery state is tracked in the dated entries below and the disposition record.

## Scope and order

1. Fix confirmed classifier and ordinary-viewer regressions, retaining executable counterexamples.
2. Review the existing batch-1 patch rather than rewriting it. Separate raw evidence from reported claims.
3. Recover and review the presets commits; do not integrate them until exclusion semantics are defensible.
4. Integrate with fresh main in an isolated checkout, then run relevant full/browser checks and rebuild affected artifacts.
5. Reconcile public drafts with verified behavior and current issue state. Keep #367 draft until acceptance.

## Acceptance items

| Item | Evidence now | Acceptance / next action |
| --- | --- | --- |
| Recursive glob prefix consumes empty segment | Reproduced `subsumes('**/b', '{a,}/b')` true while `/b` matches only child | Fixed recursive consumption guard; deterministic sampled implication and real bundle CLI subset rejection cover it. Existing trailing-** patch retained. |
| Global Backspace alias | Current template handled Backspace as Escape in every diagram | Scope alias to active drilldown; execute actual keyboard listener for ordinary focus preservation, Escape clearing, input exclusion, and parent return. Browser acceptance still separate. |
| Forbid-list scope | Batch 1 removes user strings by global text substitution | Reproduce header basename/ref false positives and authored-chrome false negatives when labels duplicate forbidden text. Do not consider current subtraction sufficient evidence. |
| Other fuzz fixes | Existing patches for NUL tree parsing, receipt paths, ranges and missing children | Run focused tests and verify public failure receipts, not just helper assertions. |
| Presets | Four commits survive locally; audit never finished | Explicit exclusions / ownership / preset precedence must be documented and tested. Test build packages, input PNGs, fixture libraries, product references and migrations. Audit replay versioning and parent-child exclusions. No blanket “uncovered means product only” claim. |
| New map in range / bundle failure handling | Historical reports identify failures | Reproduce on candidate; verify added-map behavior, child completeness, safe embedded JSON and structured write errors. |
| Visual compatibility | Local template and generated artifacts differ; historical review incomplete | Fixed inputs and comparable browser conditions; ordinary diagrams plus parent/child views. Updating goldens is not approval. |
| Public drafts | Recovered text, final factcheck interrupted | Correct sample: 15 total, 10 main + 5 controls; 0.767 vs 0.700 is main cohort, not all 15. Single-model evaluation, not human study. No impact/mergeability claims. |

## Reuse existing maintenance policy

CONTRIBUTING.md already requires impact-based evidence, shared-caller checks, base/candidate comparisons and preserved behavior. REVIEWING.md already separates reproduced defects, evidence gaps and suggestions. Do not duplicate these requirements in another checklist or increase every author's workload.

For this change, apply those rules to the optional-feature-off case and classification counterexamples. Add only confirmed regression fixtures to CI; research scripts and reconstructed evidence stay outside the shipped Skill. Missing historical raw JSON must not be replaced with invented benchmark results.

## Verification and delivery boundary

Focused glob/bundle tests: 20 passed after reproducing a failing property check before the fix. Keyboard tests execute the actual final template listener in a VM; they are behavioral checks, not real-browser acceptance. Full combined-tree test output is saved outside the repo in `archify-recovery-2026-09-12/followup-npm-test.log`; record its final outcome before requesting final review.

No issue, comment, PR update, push, or merge has been performed by this follow-up. The current index and unrelated user changes are preserved. Hand-off document and this queue are local coordination records.


### Observed check outcome (2026-09-12)

- Initial combined-tree `npm test`: 1,135 passed / 7 failed / 37 skipped, 1,179 total. This run overlapped the keyboard edits and is diagnostic evidence, not a final-head acceptance run.
- Five failures were old source-pattern assertions for Escape routing. Updated them to the shared `isEscape` predicate and reran the affected files with the new executable keyboard regressions: 25 passed / 0 failed / 5 skipped (browser cases). Log: `followup-keyboard-final.log` in the recovery directory.
- Two remaining full-run failures concern generated Gallery and pinned MCO artifact reproducibility. Viewer changes require authoritative regeneration after the source scope is settled; they are not waived or claimed as unrelated. No final full-suite pass, real-browser pass, or archive freshness is claimed.
- `git diff --check` passed. The original staged binary diff was compared byte-for-byte against the before-follow-up snapshot and remains unchanged.

Do not push this mixed working tree wholesale. The fixes in this follow-up are glob recursive-prefix containment, the actual keyboard listener and its tests; prior batch changes remain owned by the original work. Capture final source selection in a narrow integration commit only after review of the remaining blockers.


### Legacy inventory completed

See [the disposition receipt](identity-map-legacy-disposition-2026-09-12.md) for all recovered assets, fresh current-main reproductions, presets red-team findings, corrected public drafts and seven bounded work packages. Inventory completion does not waive this document's implementation gates.


### HTML, added-map and bundle output repair (2026-09-12)

- Replaced global subtraction of input strings with escaped input markers at render insertion sites. Authored SVG and non-visible script/style payloads are excluded; generated visible/accessibility text remains checked. Tests retain both the safe.json false-positive and same-label masking counterexamples.
- Added `mapDelta.status: added` to the draft receipt schema and regenerated the standalone validators. An architecture map newly added in the range no longer tries to compare a nonexistent baseline; `map_changed` remains in review.blocking. Existing edited-map comparison still passes.
- Bundle projection preparation now validates manifest shape and refuses missing children/specs/sidecars or mismatched entry bindings. Preparation finishes before publishing the main pair. Projection JSON escapes `<`, `>` and `&` without changing decoded data.
- Bundle HTML, main HTML and receipt destinations are preflighted together. Rename failures roll back existing outputs; if rollback also fails, staging backups are retained and named in the diagnostic. This is error recovery, not a guarantee of simultaneous multi-file visibility or crash durability.
- Added actual CLI regressions for a new map, incomplete/malformed bundle, output destination conflicts and injected rename failure. The targeted locate CLI run passed 17 tests; the final HTML/projection tests passed 10 tests. No source code or tests were skipped to make these pass.
- Full `npm test` stopped at 11 stale-example/template golden checks. A separate runtime suite was recorded in the recovery audit/html-followup-runtime.log. Generated artifact rebuild and real-browser acceptance remain outstanding; no final integration/CI pass is claimed.

Source files changed in this follow-up: locate/locate-html.mjs, locate/cli.mjs, locate/locate.mjs, locate-receipt schema and its generated validator, relevant tests and locate reference. The original Git index was compared to its saved binary diff and preserved.


Final runtime result for this source snapshot: **1,190 tests; 1,150 passed, 3 failed, 37 skipped**. The three failures are checked-in Checkout compare, Gallery and MCO artifact reproducibility. This is the complete runtime runner, separately invoked after npm test stopped at the 11 stale-example golden checks. It is not a green npm test or a browser/ZIP acceptance result. No source changed during this runtime run; hashes and the unchanged index were verified.

## Main integration — September 12

The recovered source fixes were committed as `1b3a916` in an isolated delivery checkout. Main at `6db72a9` was integrated while preserving the modular Viewer sources and the current sponsor tables. Identity-map additions now live in the Viewer shell and five existing fragments; the generated template is validated by `generate-viewer.mjs --check`. The hand-authored web-app example retains every original SVG byte.

Browser follow-up reproduced Locate projection badges leaking into SVG export (two transient elements/attributes). The shared export cleanup now removes projection state and the count badge from the clone. A real Chrome regression asserts that the live SVG remains untouched and the entire exported SVG matches its pristine counterpart. The regression failed before the fix and passed afterward.

Bundled/development examples, Checkout compare, Gallery, pinned MCO artifacts, README animation and the Node 22 archive have been regenerated. Intermediate test runs overlap this follow-up fix and are diagnostic evidence only; final acceptance requires an immutable candidate run. No push or merge is claimed by this entry.

## Independent acceptance review follow-up

A review of `365fec9` reproduced three additional defects: Locate copied only the projected
entry into a separate destination, filenames containing `Infinity` failed the geometry guard,
and renamed maps attempted to read the new filename at the base revision. The follow-up
uses canonical bundle validation, manifest-bound child specifications and complete bundle
file delivery; rejects mismatched entry maps and target collisions; preserves all previous
files if installation fails; scopes finite checks to SVG numeric attributes; and resolves
rename baselines using the old path while keeping comparison failures supplemental.

Regressions also cover an ID-named decoy beside the manifest-bound child spec and an explicit
non-default ownership file. Real Chrome acceptance moves the destination directory, deletes
the original source, waits for the child's actual projection and verifies the touched node.
The existing Viewer stale card still handles delivered artifacts that subsequently diverge.

On the previous immutable `365fec9`, all four hosted Node matrix jobs, ZIP freshness and
three platform package smoke jobs passed. Hosted browser CI failed Motion Governor stored
preference; the same test passed standalone on both main and candidate with local Chrome152,
while hosted CI uses153. Exact-version diagnosis remains open. The local immutable full run
also hit two update-notifier timing tests; one was reproduced on unchanged main in isolation.
Those failures are retained as evidence, not renamed into a green full-suite result.


## Delivery and remaining acceptance

The recovered fixes and offline counterexample replay were first pushed to #367 through `78df1ec`. Independent main fixes are now actual draft PRs #396 (`bfb7603`, renderer diagnostics) and #397 (`4f8e594`, explicit straight routing); both have passing hosted CI. Existing #373 now contains the main integration and canonical ZIP at `e59c633`, pushed to the contributor's original branch with their commits preserved. Its 26 checker regressions and the recovered public sequence validation pass; hosted CI run `34679027097` is tracked separately.

A recovered real cross-origin/OOPIF probe showed that the ordinary embedded Viewer rejects bundle control messages and permits native Tab to leave the iframe. Further real-browser checks reproduced a nested-child Backspace defect: the child had no local active drilldown, so it neither consumed the key nor forwarded it to the parent. Commit `66576ed` makes Backspace follow the same temporary-state/parent-return ladder as Escape inside a nested child; ordinary viewers and text inputs retain their behavior. The five listener tests and six targeted real-browser cases passed after the change.

Regeneration also exposed two README capture faults with Chrome 153: tab creation passed window-only dimensions, and cleanup could remove the browser profile before Chrome exited, masking the original error. The builder now applies viewport dimensions through its existing emulation call and waits for browser exit. The 54-frame animation and all affected HTML/ZIP artifacts have been regenerated.

The hosted Motion Governor preference test failed again on `78df1ec` while other CI gates passed. It reads no stored key at the earliest document startup, before Viewer initialization. The browser test is identical to main; investigation now distinguishes `file:` URL/query storage behavior from an actual reload of the same URL. Neither a local pass nor the unrelated keyboard fix resolves this gate by itself. Final source and CI acceptance remain open.

The full local `npm test` run on product commit `66576ed65fc894fb523f52a4692a68ef9b4f12c7` completed with **1,474 total, 1,422 passed, zero failed and 52 skipped**. The recorded hashes of tracked product/test/build sources were unchanged between start and finish. Browser environment variables were not enabled for that run; actual-browser evidence is recorded independently, not inferred from its skips.

Commit `506d87e` adds six real public-CLI cases (Unicode, control characters preserving old output, symlink and gitlink changes, divergent trees), including a separate-process byte-identical repeat of delivered HTML and receipt. It also adds the six-case real-browser boundary file and registers the bundle/portable-output/export checks for hosted CI. Both new files passed their final dedicated runs and independent review. The same commit adds the first-look and E3 packages linked from the disposition record; independent offline executions agree with their recorded results and preserve the E3 anchor-selection difference.
