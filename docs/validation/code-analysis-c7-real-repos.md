# C7 external diagnostics: real-project validation

Native runs recorded: 2026-11-11. Default-severity follow-up approved: 2026-11-12. Original reviewed base: `labs/code-analysis` commit `10a608a743be58ede8069959cc6e502175677d7c`. This record separates actual native tool runs, authored contract tests, illustrative prototypes and subsequent real-viewer checks. All were run against the evolving C7 working tree; earlier passing results are reused for their unchanged scope, not relabeled as final-commit or later-target-base validation. This independent draft PR is not a complete release gate or a replacement for another open proposal.

The two upstream checkouts remained unchanged and clean. Their configured lint rules were retained. Tool generation ran explicitly during this validation; Archify's import/check/task paths only read the resulting files and did not execute their recorded commands.

## Source and tool identities: historical source policy

| Project and fixed source | Tool and configuration | Actual scan | Imported result |
|---|---|---|---|
| [Understand-Anything `4e6d3299`](https://github.com/Egonex-AI/Understand-Anything/tree/4e6d3299017a7432da15957874992837a315c5b4) | ESLint `9.39.4`; unchanged `eslint.config.mjs`; direct runtime versions match upstream `pnpm-lock.yaml` | 304 checked JS/TS/config source files; 0 findings | 0 findings; source binding verified; complete declared scope; repeated import comparable |
| [Trail of Bits skills `711af095`](https://github.com/trailofbits/skills/tree/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e) | Ruff `0.14.13`, the root `.pre-commit-config.yaml` pin; existing root and nested configurations | 190 selected files (175 Python and 15 TOML); 0 findings | 0 findings; source binding verified; repeated import comparable |
| Same Trail of Bits source, isolated copy | Ruff `0.17.1`; same configuration inputs; this version is also pinned by a nested plugin's development group, but is **not the root CI version** | 191 selected files; 77 findings | All 77 imported as error under the then-effective source policy; source binding verified; repeated import comparable; real-data task/export/refresh sequence completed |

The `0.17.1` row is a compatibility probe with a newer tool version. Its additional diagnostics are source-tool claims, not independently reviewed defects or evidence that canonical upstream lint fails. File discovery also differs between the two Ruff versions; their scope counts must not be presented as the same scan.

These runs predate the warning-cap default. At that time omitted severity selected source mapping; the same mapping now requires explicit `external.severity: "source"`. The original 77-error artifacts are preserved as source-mode evidence rather than relabeled as a new default-mode run.

ESLint ran over unchanged source/config copies with an isolated npm runtime: `@eslint/js@9.39.4`, `eslint@9.39.4`, `typescript-eslint@8.59.4`, `globals@17.6.0`, `typescript@5.9.3`. The isolated package lock pins the transitive runtime used here; this was not a complete installation of the upstream pnpm workspace.

Ruff used an isolated uv cache and `--no-cache`. For the copied `0.17.1` run, its own `--show-files` output was checked against the original scope. Generation-time file byte hashes were captured around the scan, and configuration input hashes plus observed tool versions were recorded in source manifests. These manifests provide the C7 source binding; import-time hashes alone would not prove report freshness.

## Completed real-data sequence

For every row, the native report entered `code-analysis check`, the emitted `findings.json` passed its schema, and a second import of the same source was comparable with no new or disappeared finding. Valid empty reports still recorded the conventions source as checked.

For the positive Ruff `0.17.1` row:

1. Native Ruff emitted 77 diagnostics, and Archify imported 77.
2. A task for `ISC004` in `plugins/c-review/scripts/render_report.py` retained the tool, original rule, positions, captured snippet and generation command. `task --require-valid` reported valid evidence.
3. A comment was appended only to the isolated source copy. The old task's cited line stayed available, but its whole-file/source-scope evidence changed; `task --verify --require-valid` exited 1 with `changed` evidence.
4. Ruff was explicitly rerun using the same configurations and scope, and the generation manifest was updated. Archify reimported 77 results with `comparable: true` and four findings marked evidence-changed.

The raw Ruff JSON bytes happened to remain identical after that comment-only edit. Its report SHA therefore did not change, while the generation-time source hashes and finding evidence did. This is why the report digest is provenance, not a sufficient freshness check.

The edit verifies source invalidation and report regeneration. It does not claim to fix an upstream issue, rerun an AI reviewer, or verify the project's runtime behavior. Both canonical configured scans were clean, so neither produced a nonempty canonical real-data task case; positive native task coverage comes from the explicitly labeled newer-Ruff compatibility run.

## Reproducible local evidence

The local evidence directory is denoted here as `$C7_EVIDENCE_ROOT/real-repos/` and is kept outside this checkout. Its raw source, analysis files and screenshots are not submitted or publicly available through this document. It contains:

- `results.json`: ESLint and Ruff `0.17.1` observations and limitations.
- `canonical-ruff-results.json`: the separate Ruff `0.14.13` result.
- `implementation.json`: candidate base, implementation file hashes and clean original-source status recorded for these runs.
- `commands/*.json`: exact argv, cwd, exit code and captured stdout/stderr for generation, check, task, verification and reimport.
- `*-report.json`, `*-manifest.json`, `*-analysis.config.json`: actual native reports and their source/configuration evidence.
- `*-analysis/`, `*-reimport/`, `ruff-after-refresh/`, `ruff-task.json`, `ruff-task-changed.json`: generated analysis and task outputs.
- `validate-real-repos.py`: the isolated-copy report/check/task sequence. It expects its pinned ESLint runtime and Ruff scope inventory in that evidence directory. The canonical Ruff command and its distinct scope are recorded separately under `commands/ruff-canonical-*.json`.

The public entrypoints used after report generation were:

```sh
node bin/check.mjs REPO --language ts --config SOURCE_CONFIG --fail-on never --out ANALYSIS --json
node bin/check.mjs REPO --language ts --config SOURCE_CONFIG --fail-on never --compare ANALYSIS/findings.json --out REIMPORT --json
node bin/task.mjs ANALYSIS --finding FINDING_ID --root REPO --require-valid --format json --out TASK_JSON --json
node bin/task.mjs --verify TASK_JSON --root REPO --require-valid --format json --out VERIFIED_TASK_JSON --json
```

Use `--language py` for the Python cases. The source configuration limits AST extraction to the actual recorded lint file list and disables unrelated internal finding rules for this import acceptance run. That isolates C7 behavior without substituting a fake linter or changing upstream lint rules.

## Persistent local tryout with real diagnostics

The local evidence workspace contains `real-repos/tryout-ruff-0171/`. It contains a fresh copy of all 1,600 tracked upstream files at `711af095`, with unchanged file bytes, modes, configuration and symlinks. This is separate from the earlier freshness-probe copy, where a comment was intentionally appended. The original repository remains clean. That source copy, raw facts/reports, helper scripts and screenshots are **local-only**; they are not included in this change or made public by the paths below.

`refresh-report.py` explicitly ran the already cached Ruff `0.17.1` executable against this clean copy, without installing packages or modifying source. It produced 77 actual diagnostics over the same 191 selected files as the original `0.17.1` scope (175 Python and 16 TOML). `source-identity.json`, `generation.json`, the native report and its manifest retain that provenance. Running Archify does not rerun Ruff; refresh the native report and manifest explicitly with `python3 "$c7_case/refresh-report.py"` after changing the copied source.

Start the ordinary local entrypoint with:

```sh
c7_case="$C7_EVIDENCE_ROOT/real-repos/tryout-ruff-0171"
c7_checkout="$C7_CHECKOUT"
node "$c7_checkout/archify/bin/archify.mjs" start "$c7_case/source" \
  --ir "$c7_case/architecture.json" --map "$c7_case/overlay-map.json" \
  --language py --config "$c7_case/analysis.config.json" --out "$c7_case/view-live"
```

Set `C7_EVIDENCE_ROOT` to a local validation workspace and `C7_CHECKOUT` to this repository checkout. The command reuses a prepared case; cloning this repository alone does not supply the local evidence files. Reconstruct tool reports from the fixed upstream revisions/configurations above, recording generation-time hashes as described in [External diagnostics](../../archify/modules/code-analysis/docs/EXTERNAL-DIAGNOSTICS.md#bind-a-report-to-its-actual-source). The placeholders do not imply that another machine has the original author's directories or cached executables.

Open the printed localhost URL and click **Code Analysis**. The IR is a directory grouping of the actual source: five directories containing the reported diagnostics and 22 other selected directory groups. It draws no inferred runtime dependency arrows. The explicit map covers all 27 modules; `modules.excludeRoles: []` includes the tests that Ruff actually scanned, so their 19 diagnostics are also mapped. The native report and its original levels are unchanged; mapped severity depends on the case configuration. Set explicit `external.severity: "source"` when reproducing the historical 77-error presentation; omitting it now selects warning. Internal finding rules are disabled only in the Archify case configuration to keep this import-focused tryout separate from structural findings.

`serve-validation.json` records the initial public-entrypoint HTTP/data checks, and `task.json` / `task.md` hold a source-verified real `ISC004` task. Later frontend checks used `view-live/analysis/`; the earlier `view/analysis/` still contains an older script snapshot and must not be presented as current UI evidence. A fresh invocation of the command above builds the current source into its chosen output. The localhost port is allocated at each start; the directory and command are reusable after stopping the current server.

The earlier `ui-v2/architecture.json` describes Archify's C7 processing flow for an interaction prototype. Its component names and sample workflow are demonstration content. The `tryout-ruff-0171` directory map, source report and task use actual Trail of Bits source and Ruff results. The 77 remain the explicitly labeled newer-version compatibility results, while the separate canonical root-CI Ruff `0.14.13` scan remains clean.

The later read-only `tryout-ruff-0171/permissions-validation.json` audit also confirmed every copied tracked file's permission mode and type against upstream, every regular file's executable bit against the Git index, and 745 parent-directory modes. There were no differences. The index contains 1,508 regular non-executable files, 90 executable files and two symlinks; `core.filemode` is true. All 11 files with native `EXE001` diagnostics are index `100644` and filesystem `0644` in both upstream and copy. Their diagnostics were not introduced by losing executable bits during copying. The current C7 source hashes bind bytes rather than Unix permission metadata; a chmod-only change is outside that freshness check.

A second persistent case at `real-repos/tryout-ruff-canonical/` reuses the existing actual Ruff `0.14.13` empty native report and manifest. It shares the verified unchanged source copy, but has its own IR/configuration/output and reusable startup command in `README.md` / `tryout.json`. The complete 190-file generation manifest was checked against the copy before starting. Its public `archify start` and `/analyze` output preserve zero findings, the checked `conventions/ruff` rule, verified binding and complete source coverage. This provides actual empty-report data for main-thread UI acceptance without constructing an artificial clean result.

## Real-viewer evidence after v3 acceptance

The user accepted the illustrative v3 prototype before production controls were connected. Prototype counts, in-memory state changes, theme checks and narrow-viewport comparisons are design evidence only; they do not establish that a real baseline was saved or that a native tool produced the sample messages.

The historical real-page checks used the 77 native Ruff compatibility findings above with source mapping. Local records are under `tryout-ruff-0171/browser-evidence/`:

| Record | Directly established behavior |
|---|---|
| `source-changed-rejected.jpg`, `rejected-review.json` | A source edit after analysis is rejected by live acceptance; no baseline is created and the entered reason remains available. |
| `accepted-persisted.jpg`, `accepted-review.json` | Under source mapping, a Chinese reason is saved to the real baseline and the accepted error retains its configured/original severity. Captured facts and the previous-analysis timestamp are unchanged, confirming review did not start another analysis. This is not warning-default evidence. |
| `revoked-after-evidence-change.json` | An accepted item that needs re-review can still have its old baseline decision revoked. |
| `final-clean-result.json` | After restoring source and regenerating the actual Ruff report: 77 findings, verified content binding, comparable reimport and zero accepted entries. |
| `empty-report.jpg` | The separate canonical zero-diagnostic report is shown with its coverage rather than an invented positive result. |

The recorded `view-live` HTML for both Ruff cases embeds the same `overlay.js`/`atlas.js` bytes inspected in the subsequent read-only review. `view-mixed` also embeds those scripts and has HTTP/data evidence for 184 findings (107 internal, 77 external); its mixed-category filters have **not** been accepted through the browser. The JSON summaries and screenshots are local task evidence, not published CI artifacts. Later identity/task/source-label fixes need their own focused validation; these browser records are not reruns of that later version.

## Automated contract and failure-path evidence

The following are executed authored-fixture checks, separate from the actual tool runs above. The full 578-case run preceded the final UI semantic adjustments, the later identity/component/primary-location/task/source-label fixes and the warning-default switch:

| Selection | Executed result | Behavior covered |
|---|---|---|
| `npm --prefix archify/modules/code-analysis test` (repository root) | 578 tests; 562 passed, 16 skipped, 0 failed | Module-wide pre-follow-up evidence, including new external-map cases, captured view context, ordinary cached reload after review, UTF-8 reasons, stale review targets, artifact-write failure recovery, and existing task/comparison/overlay cases. All 16 skips require the real C6 `ARCHIFY_TEST_JSCPD` tool; no C7 case was skipped. |
| `npm test` (repository root) | 19 passed; 0 skipped | Public CLI/core smoke at that earlier working-tree state. |
| `node --test test/external-map.test.mjs test/overlay.test.mjs test/atlas.test.mjs test/external-workflow.test.mjs test/external-serve-review.test.mjs` (module directory) | 25 passed; 0 skipped | Later focused payload, map, Atlas, CLI and HTTP checks after the first UI semantic fixes. This selection does not execute browser filtering or keyboard interaction. |

The serve case confirms malformed and missing reports return structured errors while the saved successful HTML/findings and its tasks remain available. Restoring a report permits a fresh run, and a retired finding cannot be exported as current. A later test simplification removed redundant response-body cloning; the affected serve case was rerun successfully.

## Selected UI screenshots: warning default

The draft PR includes current screenshots from the 2026-11-12 warning-default replay on the real local service: [diagnostic counts on the directory map](../assets/code-analysis-c7/overview-map.jpg), [finding filters and list](../assets/code-analysis-c7/findings-list.jpg), and [the original rule with captured code evidence](../assets/code-analysis-c7/finding-evidence.jpg). The same pinned Trail of Bits source, Ruff 0.17.1 report and manifest now yield 77 warnings and zero errors, with original error severity and verified source binding preserved; Ruff was not rerun. Conditions are 1280×720, Light, Classic, Still, 100% zoom and a 420px reader. The main-thread Codex agent inspected these images; human approval is not claimed. The map groups real directories and does not assert inferred runtime dependencies.

The previous source-mode versions of these three images remain in Git history at `bdd477bb7f76dedb7975bf9ecb1b86018b3ed44d`; the historical local browser evidence also remains source-mode evidence. The current links above must not be used to illustrate the old 77-error presentation. Raw source snapshots and the rest of the local evidence remain outside this checkout.

## Follow-up and remaining validation

The draft-preparation review identified acceptance transfer between repeated SARIF results, extension results deduplicated together, related locations presented as primary, an old page receiving a changed external task claim, and indistinguishable same-tool source labels. These five defects received focused corrections and regressions. Explicit SARIF `toolComponent.index: -1` was excluded as a defect after checking the specification body; schema acceptance alone was not treated as proof that the producer input was valid.

The SARIF follow-up ran `node --test test/external-contract-regressions.test.mjs test/external-import.test.mjs test/external-task.test.mjs test/task.test.mjs test/external-review.test.mjs` from the module directory: 63 passed, 0 skipped. Its three new regression groups first failed against the old implementation. Separately, the saved pre-fix SARIF review inputs were replayed through the current public extraction/evaluation/task helpers in a disposable repository: removing the accepted first occurrence left the second id stable and open despite unchanged source evidence; two extension components retained two ids; a logical-only primary retained related read context but no primary file, evidence digest or modification scope. An additional same-name/no-GUID component replay remained partial and required re-review after reordering. These are constructed contract probes, not native tool runs.

The task/source-label follow-up reproduced the old page's claim mismatch with real HTTP and Chrome interactions, then passed the existing root browser selection `node --test test/code-analysis-task-browser.test.mjs` with 4 passed, 0 skipped. The live page supplies the displayed claim digest, the service rejects changed claims with HTTP 409, HTTP rejection does not fall back to a captured offline task, and same-tool source options remain distinct by id. The task guard was also ablated: removing it made the stale-claim HTTP regression fail again; restoring it passed the focused check.

A later run of that browser selection passed 7/7, including an authored mixed fixture with one native finding and 41 ESLint findings. It covers source/category intersections and keyboard pagination, alongside the existing task/source and location-role cases. This is fixture browser evidence; the distinct 184-finding real mixed case remains HTTP/data-only.

These follow-up results establish the corrected boundaries at the tested working-tree state. Final candidate checks, package freshness and remote CI belong to the actual submitted revision; none is implied by the earlier green totals. The PR records that final revision's commands and results rather than backdating them into this evidence.

## Native fixed-input Viewer comparison

The 2026-11-12 comparison uses a constructed two-file native fixture, not a fresh real-repository generation benchmark. The route is **fixed-input Viewer presentation/export replay**: base `10a608a743be58ede8069959cc6e502175677d7c` versus the candidate working tree based on `bdd477bb7f76dedb7975bf9ecb1b86018b3ed44d`. The [comparison record](../assets/code-analysis-c7/review-20261112/native-viewer-comparison.json) contains the source, authored IR/map, input/file hashes, finding ids, DOM measurements and agent observations.

Both samples use the same input SHA-256 `a68f2c17e5d693b117c8ce962eca12d7ece7c53971fc7c50744c53f397880eef`, the same two structural errors and one complexity warning, and identical finding ids, severity and component mapping. Conditions are 1280×720, Light, Classic, Still, 100% zoom and a 420px reader. Both nodes' measured DOM geometry matches value for value.

| View | Base | Candidate |
|---|---|---|
| Overview | [Base overview](../assets/code-analysis-c7/review-20261112/native-base-overview.jpg) | [Candidate overview](../assets/code-analysis-c7/review-20261112/native-candidate-overview.jpg) |
| Native finding | [Base evidence](../assets/code-analysis-c7/review-20261112/native-base-finding.jpg) | [Candidate evidence](../assets/code-analysis-c7/review-20261112/native-candidate-finding.jpg) |

The main-thread Codex agent inspected all four images. It observed no unexpected change in diagram content, code evidence, highlighted line or task entry. Expected changes are the Browse findings entry, Problem → Finding navigation wording and the offline Accept control below the evidence. The entry adds about 48px to the overview: the second priority card needs more scrolling at this viewport, while the source evidence remains at the same visible position. These perceptual observations and the stated tradeoff are separate from the matching geometry; they do not claim human approval or acceptance of every mode, viewport or theme.

The target later advanced to `91270ea08d53baf676bd2270d7805233a8798351` (#1320 and #1326). A [same-input replay](../assets/code-analysis-c7/review-20261112/native-viewer-base-refresh.json) found the new base's complete HTML and payload byte-identical to the original base, and the merged candidate byte-identical to the original candidate. The four fixed-condition screenshots above are therefore reused at their recorded capture state, not recaptured or claimed as new human approval. This native TypeScript fixture has no Git history and does not cover the incoming Go build-scope or Git-diff behavior.

## Warning-default follow-up

The user approved the review-requested policy: cap imported lint errors at warning when severity is omitted, preserve info and `originalSeverity`, retain explicit source mode and keep AI review at warning. The default CLI threshold remains warning; an error-only gate can now pass when the only findings are default-capped external claims. Moving an earlier lint source from source mapping to the warning default requires baseline re-review and an incomparable comparison; `--new-only` refuses that policy transition.

The [real Ruff replay receipt](../assets/code-analysis-c7/review-20261112/ruff-warning-replay.json) records the 2026-11-12 import and Viewer replay. The local `analysis.default-warning-20261112.config.json` differs only by removal of `external.severity`; the original report, manifest and source were reused without running Ruff again. The `view-default-warning-20261112` service and current screenshots show 77 warnings, zero errors, amber component indications and the original error level in import details.

All 77 records were checked individually: error became warning; `originalSeverity` remained error and binding remained verified; ids, source-only evidence digests and locations were unchanged; every review digest changed. The report SHA was unchanged while `importSettingsDigest` changed. This is newer-tool compatibility evidence rather than a failing canonical root CI scan, and the 77 tool claims were not independently confirmed as defects. It does not establish browser acceptance of the 184-finding mixed case.

Before synchronization with the newer target branch, the working tree based on `bdd477bb7f76dedb7975bf9ecb1b86018b3ed44d` plus the warning-default change passed the complete module suite (583/583, real jscpd, zero skips), the mixed browser selection (7/7) and `npm run test:generated`. These are pre-merge results, not validation of a later merged revision.

After incorporating target `91270ea0`, local Node `22.23.5` checks passed: core CLI 19/19; the five Code Analysis Chrome suites 17/17 with no skips; generated-output checks; and the extracted-package smoke. The canonical ZIP was rebuilt twice with identical bytes. A constructed cold-package ESLint case confirmed the default warning gate (exit 1), error-only gate (exit 0) and evidence-valid task export (exit 0); this probe did not execute ESLint. Two added cross-contract regressions preserve known external differences when Go scope is unknown, and prevent verified report binding from upgrading an exhausted source-digest search. Isolated incorrect-merge ablations failed those regressions. Full module and final-head CI results are recorded in the PR rather than implied by earlier totals.

Environment for the original native runs: macOS, Node `20.20.2`, Python `3.14.3`. This evidence does not cover native Windows execution, a real nonempty canonical ESLint case, live GitHub review collection, full project behavioral tests, real 184-finding mixed-list browser acceptance, or exhaustive keyboard/accessibility and final-version visual acceptance. Those claims require their own scoped evidence rather than treating the earlier import and viewer checks as a substitute.
