# Architecture Atlas implementation and acceptance

Post-review update: six confirmed findings have been fixed. See [the fix and revalidation report](architecture-atlas-review-fixes.md) for current artifact hashes and verification. The evidence and hashes below describe the original, pre-review implementation and remain preserved for comparison.

Status: complete. All required AC01–AC14 acceptance is satisfied by the evidence below. The authoritative scope remains [the Goal](nested-architecture-goal.md).

## Delivery

Branch `codex/architecture-atlas-v1` starts from upstream/main `8c3af8a`. The pre-existing untracked Goal and design documents were preserved. No commit, push, merge, deployment, release/version change, or external comment was performed.

```sh
node archify/bin/archify.mjs deliver atlas archify/examples/atlas/project.atlas.json output.html --quality showcase --json
node archify/bin/archify.mjs visual-check output.html --json
```

The checked-in [offline example](../examples/architecture-atlas.html) has four independent architecture members, three levels and two references to the canonical Redis definition. The [authoring reference](../archify/references/architecture-atlas.md) documents the schema, CLI, identity, navigation and export boundaries.

The implementation adds a dependency-free Atlas schema/validator and compiler. It freezes source bytes, applies inheritance, runs the existing member validators, renders whole member documents, unpacks/rechecks their actual embedded bytes and atomically commits the final HTML. A single active srcdoc Viewer uses a gated logical address; the parent owns visits, history and global preferences. Detail/reference navigation adds no graph edges.

## Final artifact evidence

[Local evidence](/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/atlas-acceptance/README.md) contains complete receipts, screenshots, decoded exports and test logs. Browser evidence is from macOS, Node 22.23.1 and Chrome 151.0.7922.174. The same four-member HTML was tested over file and local HTTP; the source-evidence member uses an explicitly illustrative, deterministic local repository fixture.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `atlas.html` (four members with verified illustrative source evidence) | 3,466,445 | `891fa4fa21891244a31a0dddc1ec9eb9bb44f53360bc44269dede0b809bfe7ae` |
| `desktop.html` (30/20 nodes) | 1,761,466 | `6bed8952ff577d48def366e141bfa4596758bc2c7e8b1463e84069cd80f72a4f` |

`delivery.json` and `desktop.delivery.json` include original-source, effective-input, member-artifact and final-artifact receipts. `atlas.visual-check.json` and `desktop.visual-check.json` bind automated metrics to those exact HTML bytes. `visual-review.json` separately records image inspection; automated receipts retain their own pending manual-review field rather than misrepresenting that field as an automated judgment.

## Acceptance matrix

| AC | Evidence and result |
| --- | --- |
| AC01 | Manifest/delivery tests: valid singleton/four-member/mutual definitions and invalid tree, references, configuration, URI and CLI cases. Pass. |
| AC02 | Actual unpack/recheck, Unicode and literal `</script>`, corrupted hidden bytes/inventories/receipts/context. Real worker page displays escaped title safely. Pass. |
| AC03 | Existing output/input preservation, source/manifest aliases, hardlinks/symlinks and commit-time symlink redirection; staging cleanup. Pass. |
| AC04 | Source rewrite after freeze still delivers frozen bytes. Effective configuration receipts differ appropriately. Two verified member revisions share one repository root correctly. Pass. |
| AC05 | Real three-level navigation and Back, both payment/orders → system Redis visits, repeated local controller IDs, valid/invalid deep links, refresh and explicit recovery. Pass. |
| AC06 | Same-viewport camera anchor ≤2 CSS px and relative zoom ≤0.1%; scroll offsets ≤2 px, exact focus/route/reach/lens/chapter restoration, stopped motion. Changed viewport restores finite logical state. Pass. |
| AC07 | Twenty round trips, rapid Back, stale session/entry/transaction ready/state/snapshot/error messages, one active iframe; injected font-ready rejection enters scoped worker failure, Retry succeeds and Back returns to payment. Pass. |
| AC08 | Real directed current-member route and unreachable reverse path, separate HTTP and webhook relationships; parent ID navigation and no-ID text-only summaries; query preferences preserved. Pass. |
| AC09 | Same final HTML: file and HTTP cold start → worker → Back → refresh → exports. Exactly two explicit HTTP document requests, zero autonomous requests, zero source JSON loads. Chinese text reviewed. Pass. |
| AC10 | Sixteen actual exports across both protocols; SVG/PNG/JPEG/WebP/cards/WebM decoded. SVG assertions preserve shared-object mark/type and remove transient focus UI. PNG/full/share/route/reach images inspected. Pass. |
| AC11 | Actual WebM, granted native clipboard write/read compared with standalone, denied clipboard download fallback; navigation defers until export ends, Back stops recording tracks and suppresses late downloads; Presentation Stage retains parent navigation. Pass. |
| AC12 | Actual shell + all members at 1440×900, 1600×1000, 1920×1080 and 2048×1320; endpoint light/dark captures. All browser gates pass. All 24 screenshots inspected; 30/20 sample minimum projected node text is 9 px. Pass. |
| AC13 | Standard `npm test`: 1354 pass, 0 fail, 50 optional/environment skips (browser cases exercised separately). Full Chrome run: 1474 pass with 13 stale static/generated-fixture failures plus one nested Chrome Layout fixture failure (also counted by its parent); all static failures are resolved by the final standard run. The repaired Chrome Layout suite passes all 24 tests (0 skips); all observed failures are resolved. The four optional full-Chrome skips concern the external MCO fixture, non-Node-22 branch and serialized site integration gates, not Atlas acceptance. Generated templates, validators, examples, gallery, README motion proof and ZIP refreshed. Freshly extracted ZIP delivers Atlas without node_modules; doctor passes. |
| AC14 | Three controlled removal experiments below; affected tests and final-byte browser/visual/export evidence pass. |

## Ablation

| Candidate removed, one at a time | Result | Validation |
| --- | --- | --- |
| Unused returned `detailByNode`/`referenceByNode` indexes | Kept removed; local validation maps remain private. | 31 manifest/delivery assertions pass (`ablation-indexes.log`). |
| Unused inbound asynchronous revoke message branch | Kept removed; parent synchronously disposes recording before removing iframe. | Atlas navigation/lifecycle and Focus/Guided checks pass. Old Reader extraction fixture was independently repaired; all eight Reader checks pass. |
| Explicit iframe clipboard permission declaration | Kept removed; native same-origin capability works without the added policy. | Actual clipboard grant/write/read, denied fallback, export navigation and Back recording disposal all pass (`ablation-policy.log`). |

No candidate required restoration. Final browser/visual/export evidence was regenerated after these removals. The persistent parent summary was also changed to a disclosure after real viewport overflow, but that correction is not counted as an ablation experiment.

## Validation commands and boundaries

```sh
cd archify
npm test
ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test
ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test --test-timeout=180000 test/atlas-browser.test.mjs test/atlas-export-browser.test.mjs test/atlas-lifecycle-browser.test.mjs
cd ..
bash scripts/build-zip.sh
```

Initial standard baseline had 1265 passes, 25 sandbox-listen failures and 47 skips; the affected suites rerun outside the sandbox had 102 passes, no failures and one skip. Browser/localhost validation here uses the required sandbox-external launch path. Original generated-output and static test fixtures were updated to understand the gated address and inert member bundle, retaining negative checks rather than bypassing them.

Atlas v1 intentionally supports architecture members, a single-parent detail tree, explicit canonical references and current-member exports. It does not compute cross-layer paths or synchronize object properties. Clipboard behavior remains browser/permission dependent, with an explicit downloadable fallback when rejected. The measured sample sizes and observed successful switches are evidence, not a product size/depth/performance promise.

## Workspace centering follow-up — 2026-09-12

Wide desktop Atlas members now reserve the left rail before choosing the reader width. Root and child readers fit and center inside the same remaining workspace, with the page's right padding preserved. Rail eligibility depends on viewport capacity, not chapter or card content. Overview cards remain in the rail during measurement; selection, details, relationships and source inspection keep their existing state and content. Standalone, non-wide and compact/presentation/embed/print behavior is unchanged.

The new controlled-DOM regression suite passed 8/8 after a 6-failure baseline. Adaptive-reader, address-state and generated-template checks passed alongside it (291 tests); Atlas manifest/delivery checks passed 36/36. The affected runtime tests and template freshness check were repeated after the final simplification. These are deterministic/Node tests, not browser containment or perceptual evidence.

Ablation: replacing the dynamic 280–304px rail width with a fixed 280px rail retained all eight layout acceptance checks, so the dynamic calculation stays removed. The temporary extension of adaptive layout to square/portrait members was withdrawn: the existing 960px readability floor cannot height-fit tall members. Their original behavior and tests were restored. The old move-cards-home/measure/move-cards-back height calculation is no longer needed because the workspace is selected first.

OpenPI was authored anew from main@5fe045077a7e4c86c79295beaac84ce556301093 into `openpi-workspace-centered`, with five 1380×840 members, symmetric 80-unit node margins and four detail links. Every member passed all nine showcase checks with zero errors/warnings. The delivered artifact SHA-256 is `67a26d7755b0866bffffbb784f83b5a9ff4f9ad19f44cf64b0899c96a934bcb8`; its generation-verification record binds the actual output path, source specifications and current working-tree reader/template bytes. Browser access to the local HTML was rejected by browser security policy, so no fresh browser/visual acceptance or screenshots are claimed for this follow-up. Earlier browser evidence above does not validate these new bytes.
