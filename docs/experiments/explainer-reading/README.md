# Explainer reading laboratory

Open [the local review page](index.html) to switch between eleven reading questions across ten projects, retained alternatives, and 390/1440 px previews. It identifies adopted branch changes separately from rejected experiments. Download/check out this directory to use the HTML; a GitHub source view is not the rendered preview.

Experimental branch, authorized by the maintainer's 2026-10-29 request to explore clearer, more attractive explainers from latest `dev` and push the results to a remote branch. This is not a request for final review or merge.

Base: `5ecbd1bfdbf83ea747072112493c940e707569cb`.

## Questions and bounded plan

1. Can a Chinese SQLite WAL explanation distinguish concurrent reads/writes from checkpoint progress without hiding the exception?
2. Can an English Go singleflight explanation distinguish duplicate suppression, caching and forgetting an in-flight key?
3. Does the current writing rule reject useful local qualifications and encourage moving necessary context away from its claim?

Two independent discovery authors use gpt-6.1-terra, medium reasoning, with a 15-minute budget per case. They use the unchanged base runtime, preserve their first draft and actual failures, and cite primary sources. Parent review checks source claims and desktop/mobile screenshots before selecting changes. These are parallel discovery practices, not controlled base/candidate generation runs or speed measurements.

The writing-rule experiment uses the same authored input on base and candidate. Scope is removal of a demonstrated false-positive phrase rule; keep sentence/paragraph length, vague quantities, source resolution and all diagram contracts. No new scoring heuristic. The existing real-repository generation pilot concerns architecture/workflow authoring: this exploratory branch does not claim that benchmark or general generation gains. A broader benchmark and human acceptance remain unperformed.

Existing open work checked before implementation: #1015 (visual hierarchy, metrics, steps and source cards), #1076 (mobile menus), #1142 (claim attribution), #1144 (dependency preview), #1108 (placement indexing), #1152 (locale). This experiment does not implement those features or change their branches.

## Evidence

Case directories retain authored Markdown, delivered HTML, receipts and source/repair notes. Machine delivery does not establish factual correctness or visual acceptance. Screenshots and inspection results are recorded after the drafts exist. Unsupported claims are corrected in the candidate, never retroactively in its first draft.

## Results — 2026-10-29

| Practice | Inspectable result | What changed |
| --- | --- | --- |
| SQLite WAL, Chinese/editorial | [Page](sqlite/candidate.html), [draft](sqlite/candidate.archify.md), [source audit](sqlite/notes.md) | Shorter conclusion; only two complementary reasons; reading steps beside the architecture; checkpoint modes in a table. Removed redundant architecture edge labels after the browser measured them below 10 px; the adjacent steps preserve their meaning. |
| Go singleflight, English/clean | [Page](singleflight/candidate.html), [draft](singleflight/candidate.archify.md), [source audit](singleflight/notes.md) | Ordinary duplicate suppression comes first; `Forget` has its own table instead of being mixed into a six-participant sequence. The first draft's blocked-caller storytelling mistake is preserved and corrected. |
| Local qualifications | [Base strict failure](singleflight/base-strict.json), [candidate strict delivery](singleflight/candidate-strict.json) | The identical final singleflight draft is rejected by base for “illustrative” and “not measured”. Removing the blanket phrase rule permits this truthful local caption without switching writing checks off. |

Runtime fix: `553bf9411`. Canonical archive refresh: `713697902`. Neither renderer nor reader CSS/JavaScript changed. The authoring guide now distinguishes page-wide scope from local assumptions and uncertainty. No schema, theme, layout or source-attribution feature was added.

### Visual comparisons

These compare authored versions, not a renderer A/B test. Both versions use the same renderer; singleflight also changes its authored style from editorial to clean. Parent inspection found the candidate hierarchy clearer, but no human comprehension study was run.

| Case | Before parent review | Candidate |
| --- | --- | --- |
| SQLite, 1440 × 900, light | ![SQLite before](screenshots/sqlite-before-review-1440-light.png) | ![SQLite after](screenshots/sqlite-candidate-1440-light.png) |
| singleflight, 1440 × 900, light | ![singleflight before](screenshots/singleflight-before-review-1440-light.png) | ![singleflight after](screenshots/singleflight-candidate-1440-light.png) |

The final singleflight sequence panel is 637 px high versus 810 px before review at the recorded viewport; its local illustration caption adds height compared with the intermediate 596 px version. This describes the case, not a quality score. [Metrics](visual-metrics.json) also record 390 px light and 1440 px dark states. Themes were selected through the actual reader controls; a URL query alone did not change the theme and was not accepted as dark-mode evidence. Final captures replace those incorrect preliminary captures.

Bottom-of-page captures ([SQLite](screenshots/sqlite-candidate-1440-bottom.png), [singleflight](screenshots/singleflight-candidate-1440-bottom.png)) were inspected for the remaining tables and checklists at 1440 × 900. Both checklist inputs could be clicked and checked; [interaction results](interaction-results.json) do not establish keyboard traversal.

### Validation and limits

- The new regression expectations fail on base: **20 pass, 2 fail**, both failures caused by the qualification rule. [Actual output](base-regression.log).
- Writing, validation, layout and CLI focused suites: **40 pass, 0 fail, 0 skipped**. [Actual output](candidate-tests.log). Tests preserve other strict-mode diagnostics; they do not require a particular implementation of the phrase rules.
- Core public CLI suite: **19 pass, 0 fail, 0 skipped**. [Actual output](core-tests.log).
- Generated-output checks pass. [Actual output](generated-tests.log). No Viewer/schema/generated-example inputs changed; no unrelated gallery rebuild was needed.
- `archify.zip` rebuilt with official Node **22.23.3**, bundled zlib **1.3.1-e00f703**. The extracted archive, outside the repository, successfully finalized the qualification case in strict mode. [Package smoke](package-smoke.json). This is a macOS CLI check, not Windows or live-install acceptance. No live installation was modified.
- Both final candidates pass strict finalize's validate/deliver/check stages; browser acceptance is separate. Source claims were checked against the linked primary materials, with Go pinned to a commit and SQLite documentation live as noted in its audit.
- **Full browser gate is not green.** SQLite's first browser run reported 12 readability diagnostics and 28 keyboard-traversal diagnostics. After removing duplicate small edge labels, all readability diagnostics disappeared; 28 keyboard-traversal diagnostics remain across the checked states. [Before](sqlite/browser-before-label-repair.json), [after](sqlite/browser-check.json). The symptoms resemble existing #1124, but this experiment did not establish that PR fixes this case. The reports reference local screenshot sidecars retained under the tuning round; the selected screenshots committed here remain independently viewable.
- At 390 px, the English toolbar produces `scrollWidth=401` for `innerWidth=390`; SQLite's Chinese page stays at 390. Narrow toolbar work already exists in #1076. Singleflight's four-party preview is small on a phone; the interactive Viewer remains available. These remain known limitations, not successful mobile acceptance.
- No fresh five-project benchmark, human acceptance, Windows gate, full regression suite, or final-head remote CI acceptance is claimed. This branch is an experimental candidate, not integration-ready solely because local checks pass.

The test-value check retained existing protections and changed the former test that enforced the misleading qualification ban. No new dependency, state machine or abstraction was introduced, so no broader simplification was warranted. The guidance edit was checked against writing-for-agents: the local/page-wide distinction lives beside the evidence rule, and the removed rule is no longer advertised in delivery guidance.

### Reproduce and continue

From the repository root, run `node archify/bin/archify.mjs finalize explainer docs/experiments/explainer-reading/<case>/candidate.archify.md /tmp/<case>.html --writing strict --json` for `sqlite` or `singleflight`. The package smoke used the same singleflight input. Browser checks use the public `browser-check` command with a discovered Chrome binary; do not suppress its failures.

First drafts and all substantive failure receipts are preserved. Initial first-draft HTML files were not retained; their source can be replayed, but regenerated output must not be described as the original capture. The notes are author records, not complete exported agent transcripts.

Next worthwhile experiments: compare an equivalent phone-readable explanation using sequential steps versus a wide sequence; evaluate #1076 and #1124 against these exact drafts after their owners' changes are ready; test the local-qualification guidance with fresh independent authors before claiming a general reduction in repairs. Stop adding heuristics when source-backed case edits solve the reading problem.

AI disclosure: Codex performed research, source inspection, writing-rule implementation, tests, artifact authoring and visual inspection. The two independent discovery authors used gpt-6.1-terra with medium reasoning. No human review is claimed.

## Continued exploration — round 2

The user explicitly requested ongoing work on 2026-10-29; the first round is not the end of the goal. See [phone-preview round 2](phone-preview/README.md) for the mobile diagram experiment, export repair, source-backed Redis and TaskGroup pages, actual failures, and verification limits. Runtime change: `b670b5d4d`. No merge or live-install action is implied.

## Continued exploration — round 3

- [SQLite measured mechanism](sqlite-probe/candidate.html): an isolated temporary database demonstrates old-reader A/new-reader B and checkpoint progress, with a reproducible script, two actual runs and pinned raw output links. Frame counts are explicitly case-specific.
- [12px phone-label experiment](phone-labels/README.md): text grew, but the extra scrolling hid more of the exchange. Checks passed; visual comparison led us to reject this additional default and retain round 2's behavior. The patch and candidate remain inspectable.

These are ongoing exploration checkpoints. No overall-goal completion, human acceptance, merge or installation is claimed.

## Continued exploration — round 4

[Git restore paired experiment](restore-pair/README.md): a short-table-label instruction failed to improve the phone table. The preserved independent pair led to a separate two-column content repair, verified against the pinned Git manual and a disposable-repository probe. The candidate instruction remains unadopted; a remaining split command separator is the next bounded reader problem.

## Continued exploration — round 5

[Inline command wrapping](inline-code/README.md): the candidate preserved short flags and passed 33 focused tests, but left Chinese punctuation alone on a line. It was rejected after visual review; the experimental patch and actual results remain available, and the adopted runtime is unchanged.

## Continued exploration — round 6

[Copyable Git restore operations](restore-commands/README.md) use existing code snippets to keep complete commands readable. The variant trades desktop density for clearer actions and direct copy controls; the compact comparison remains available.

## Continued exploration — round 7

[Ripgrep filtering](ripgrep-pair/README.md) adds a new source-backed case and isolated executable fixtures. Both independent authors already chose fenced commands, so the proposed guide clarification remains unadopted. The reviewed variant uses verified shell continuations to fit complete commands on a phone while retaining the distinction between search scope and pattern interpretation.

## Continued exploration — round 8

The [review page](index.html) provides one local entry for the six projects and twelve page variants. It uses the actual retained HTML in a single iframe, displays its CSS viewport width and any visual scaling, and links directly to the full artifact and evidence record. No external assets or new product dependency are used.

[Live interaction check](review-index-check.json): all twelve variant loads completed, each full-page link matched its preview, and all 22 local targets existed. The outer page fits 390 px without horizontal overflow. Parent inspection covered the [desktop shell](review-index-1440.png), [desktop preview mode](review-index-desktop-view.png) and [phone shell](review-index-390.png). This check does not revalidate the embedded pages; their documented limitations remain in the visible case notes. The snippets’ clipboard and reader acceptance scopes remain as described in the respective rounds. No runtime source changed and no package rebuild was needed.

Next bounded direction: a curl explanation of request method versus output formatting (`-I` versus `-i`), verified with a disposable local HTTP fixture and pinned official option documentation. Keep the ongoing goal active and preserve the existing branch rather than starting a duplicate lab.

## Continued exploration — round 9

[Curl request/download/output](curl-headers/README.md) adds the seventh project to the review index. Two loopback probe runs show that HEAD and GET-with-discarded-body can print identical headers while downloading different body lengths. A two-column content repair makes all four operations visible in the phone table; source semantics and local fixture limits remain beside the claims. The independent first draft, its relocated-receipt failure and the repaired artifact's passing current-path check are retained.

The index now has fourteen variants. The original twelve-load evidence remains at round 8's revision; round 9 checks the two added curl variants and local links separately. This round changes no runtime or authoring rule and makes no general generation-quality claim.

## Continued exploration — round 10

[Existing mobile-toolbar proposal](mobile-tools/README.md) replays #1076's exact CSS addition on the current runtime and complete TaskGroup/curl pages. Baseline: 12 of 24 light-theme states overflow. Candidate: all 24 keep controls and menus visible, with checked keyboard opening and Escape focus return. The clean desktop screenshot is byte-identical, and the checked print controls remain hidden. This is independent transfer evidence for the existing proposal, not a new implementation PR or product integration.

The review index adds these two experimental variants, for sixteen variants across seven projects. Existing content and runtime remain unchanged; the candidate rule lives in the frozen replay and its generated pages only. Human acceptance and broader integration checks remain separate.

## Continued exploration — round 11

[TaskGroup's direct opening](taskgroup-language/README.md) replaces abstract introductory phrases with the cancellation/wait/report sequence and keeps the cancellation exception adjacent. The phone answer card is about 58 px shorter; the desktop summary takes an extra line while the card is slightly shorter. Source declarations and the remaining explanation are byte-identical. This is a content variant, not a new writing heuristic or demonstrated human-comprehension gain. The index now offers seventeen variants.

## Continued exploration — round 12

[Thread cancellation boundaries](thread-cancel/README.md) adds an eighth reading question across the same seven projects. Two local runs distinguish a cancelled async Task from its already-running thread function, both directly and through TaskGroup failure. The preferred page makes the object states visible and uses existing two-column authoring hints; original, intermediate and preferred layouts remain inspectable. Source Python 3.13.9 and local Python 3.15.0 evidence are explicitly separated. The index now offers nineteen variants.

## Continued exploration — round 13

[Chinese modifier diagnostic](chinese-modifiers/README.md) removes a count-only rule that mistook three independent “的” occurrences for a nested modifier chain. Three unchanged original drafts fail only that check on base strict mode and pass candidate strict mode. The writing guide retains meaning-based editing advice; other checks stay active. Focused 41 tests, core 19 tests, generated checks and the rebuilt package smoke pass. This is a fixed-input diagnostic correction, not a fresh-generation or human-comprehension result.

## Continued exploration — round 14

[Gzip size](gzip-size/README.md) separates compressed payload bytes from format overhead using four reproducible local inputs. A five-column author table hid the final gzip result on a 390 px phone. The parent combines input/output/difference into one column, keeping every measured value visible at that width. The panel grows by about 68 px; the original and the three-column variant remain available. No runtime or guide change. The index now offers twenty-one variants across nine questions and eight projects.

## Continued exploration — round 15

[Gzip's concrete opening](gzip-opening/README.md) introduces the space occupied by compressed data and header/trailer information through one local byte example. The rest of the explanation is byte-identical. An intermediate version was shorter; the final wording has the same checked geometry as the original and is retained as a language alternative, not a measured density or comprehension gain. First attempt, source checks, light/dark screenshots and receipts remain inspectable. The index now offers twenty-two variants.

## Continued exploration — round 16

[Gzip composition charts](gzip-charts/README.md) compare existing pie and bar support on the same measured 21-byte output. Both pass artifact checks, but phone text shrinks to about 8.8 px for the pie legend and 6.9 px for bar values; the explanation also grows by 245–270 px. Neither replaces the preferred text-first page. The experiment confirms a chart-readability gap, records relevant existing PR scope, and provides fixed inputs for a separate rendering experiment. The main index still offers twenty-two variants.

## Continued exploration — round 17

[Native-width phone chart scrolling](chart-scroll/README.md) restores 10–11 px labels, but hides the most important latency bar on first view and adds 78–127 px of panel height. Keyboard scrolling reaches the data; the comparison still becomes harder to see at once. The default is rejected. All three desktop screenshot pairs are byte-identical. Product source stays unchanged; the patch, failed first attempt, browser timeout and bounded successful observations are retained.

## Continued exploration — round 18

[Chart-native narrow layouts](chart-narrow/README.md) make the three-category comparisons readable at 390 px without scrolling, but remove half the category labels in a six-batch counterexample; at the narrower cap, all bar-value labels disappear. Universal compact defaults are rejected. The pie's bottom legend preserves its values but costs vertical space. A separate configured-pie legend defect is now reproduced for a focused follow-up. Product source remains unchanged.

## Continued exploration — round 19

[Configured pie legends](pie-legends/README.md) now retain values and percentages after comments, frontmatter and init directives. Parsing before decoration also prevents repeated category names from turning into extra slices. The first attempt failed existing multiline compatibility coverage; the retained normalizer fixes that regression. Two new tests fail base, 54 focused and 19 core tests pass, generated checks pass, and the rebuilt package passes an extracted smoke. Matching phone/desktop and light/dark pages preserve panel height. No universal narrow-layout default is adopted.

## Continued exploration — round 20

[jq defaults](jq-default/README.md) adds a source-pinned explanation of why `// true` replaces an explicit `false`. The 24-case local probe separates false/null, absent keys, empty values and empty result streams. A shorter four-column header still overflows; the retained two-column explanation fits at 390 px, and all five commands copied through the reader produce their displayed outputs. Multiline commands cost vertical space. Original author work and the failed intermediate layout are retained. The review index now has ten questions across nine projects and 24 main variants; product runtime and package are unchanged.

## Continued exploration — round 21

[Wide-table export](export-overflow/README.md) confirms that keyboard scrolling works in the observed browser, while phone-width PNGs lose later table columns and long code. Two frozen export-only prototypes recover content but split a technical term or a numeric value; neither table strategy is adopted. Code wrapping remains a separate candidate. Four unchanged controls per prototype—three desktop cases and the fitting phone case—produce byte-identical PNGs. Product runtime and archive remain unchanged; the next trial will preserve table tokens with a wider export canvas.

## Continued exploration — round 22

[Complete image exports](export-complete/README.md) preserve every comparison-table column and wrap overflowing commands in the exported image. A responsive counterexample exposed footer clipping, and actual-pixel tests caught broken CSS serialization; both failures are retained. Three new regressions fail on base and pass on the product change. Four no-overflow PNG controls remain byte-identical. The official-toolchain ZIP builds reproducibly and passes extracted CLI/browser smoke. Wider images may require zooming; this does not replace the clearer two-column content variants or establish human reading gains.

## Continued exploration — round 23

[Diff and desktop-code exports](diff-export/README.md) retain long removed/added lines and release stale measured panel heights when code wraps. The first prototype passed width/footer checks but clipped the bottom of a real patch; the retained image exposed that failure. An extended snippet test and new diff test fail on base; 13 browser, 25 parser/renderer and 19 core tests pass on candidate. Short diff PNGs remain byte-identical, and the canonical package passes extracted CLI/five browser checks. The complete phone patch is substantially longer, so content selection remains the next readability question.

## Continued exploration — round 24

[Explain the pie fix](pie-reading/README.md) separates a concrete reading question from the complete patch. The preferred Chinese page starts with the disappearing legend values, compares the actual before/after labels, and groups the processing order into three stages while retaining multiline compatibility. An independent first draft and a rejected manual-width layout remain inspectable. Eight source probes run twice produce identical recorded results; the final page passes strict delivery and current-path checks, with 390/1440 px light/dark review and an actual phone PNG. This is content exploration, not a controlled generation or human-comprehension improvement. The index now offers eleven questions across ten projects and 26 main variants; product source and ZIP are unchanged.
