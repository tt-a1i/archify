# Rust defaults: distinguish the result from the work that ran

[Preferred explanation](candidate.html) · [independent author's page](author/answer.html) · [review index](../index.html#rust)

Round 25 asks why `Some(7).unwrap_or(fallback())` can return 7 while still calling `fallback`. The preferred Chinese page pairs the return value with the call count, provides a complete runnable program, and retains the counterexample where a default is computed before a closure is created. It also keeps `Some(0)` distinct from `None` and does not prescribe closures for already-available constant defaults.

This is open-source discovery and content practice, not a controlled writing-instruction comparison, a performance benchmark or a human-comprehension study. Product runtime and package are unchanged.

## Source and executable observations

The [pinned Rust source](https://github.com/rust-lang/rust/blob/29483883eed69d5fb4db01964cdf2af4d86e9cb2/library/core/src/option.rs#L1009-L1052) is commit `29483883eed69d5fb4db01964cdf2af4d86e9cb2`, Rust **1.89.0**. The installed compiler reports that same commit on `aarch64-apple-darwin`; this is not a claim about the latest Rust release. The GitHub connector fetched the exact blob. The numbered [source excerpt](evidence/option-excerpt.txt), [compiler identity](evidence/rustc-version.txt), [round identity](evidence/identity.json) and [commands](evidence/commands.md) are retained.

The source documents eager argument evaluation for `unwrap_or`, which receives a ready `default: T`. `unwrap_or_else` receives a function and calls it only in its `None` branch. The parent compiled a [small std-only probe](evidence/probe.rs), without installing a toolchain or crates, then ran it twice. [Run 1](evidence/probe-1.jsonl) and [run 2](evidence/probe-2.jsonl) are byte-identical; [nine result/event expectations](evidence/probe-check.json) pass.

| Input | `unwrap_or` | `unwrap_or_else` | Compute first, then close over the value |
| --- | --- | --- | --- |
| `Some(7)` | 7; fallback called | 7; fallback not called | 7; fallback already called |
| `None` | 99; fallback called | 99; fallback called | 99; fallback already called |
| `Some(0)` | 0; fallback called | 0; fallback not called | 0; fallback already called |

The recorded events are `before`, optional `fallback`, and `after`, not durations. The illustrative function returns 99 and records a local event; there is no measured cache, disk or network workload. Deferring a closure body does not undo preceding work. Ownership, capture and drop behavior are outside this small example's scope; no universal speed claim is made.

## Independent author and retained failures

A separate gpt-6.1-terra author with medium reasoning read the frozen source/probe and Archify authoring reference. Runtime revision: `fc79568e08b8128cb569deab2429cbc8cb8e9407`; branch base for this content round: `9f0c1d2f06234bb3c6f345bcc74ec53ae95ca9db`. The last observed `origin/dev` remains `5ecbd1bfdbf83ea747072112493c940e707569cb` and is an ancestor.

- [First draft](author/first-draft.archify.md): strict finalize [failed](author/finalize-1.stdout.json) because repeated first-column labels generated duplicate row IDs. The error required explicit distinct IDs.
- The ID edit accidentally removed closing code backticks. [Attempt 2 diagnostics](author/finalize-2.stdout.json) show parse failures; [attempt-2 source](author/attempt-2.archify.md) was reconstructed by the author after the failure, not saved at that exact moment.
- [Submitted source](author/answer.archify.md): [attempt 3](author/finalize-3.stdout.json) passed validate/deliver/check. Its two-line boundary snippet is explicitly illustrative, not a standalone runnable program.

The [author report](author/report.md) also records initially failed relative-path reads that were retried with absolute paths. The [trace](author/author-trace.json) lacks individual attempt timestamps and is not a complete agent transcript or authoring-speed result. Copied author/attempt receipts describe their original paths and times; they do not claim current provenance at their archive paths.

The duplicate generated IDs are a concrete candidate for a later parser investigation. This round preserves the failure and makes no change to ID generation, explicit-ID validation or references.

## Content and visual decisions

The original four-column tables are 432 px wide inside a 358 px phone container. [The original table capture](screenshots/author-390-light-table.png) shows the key “fallback executed” column beyond the initial visible area, while method names break across lines. Horizontal document width alone was 390 px, so that measurement would not reveal this reading problem.

The parent replaces both four-column tables with one two-column observation table and a short mechanism explanation. A complete program makes the eager/lazy distinction observable, while the separate precomputed example remains explicitly dependent on its surrounding context. The opening uses ordinary Chinese and leaves exact calls in code blocks.

The [first parent edit](attempts/intermediate-1.archify.md) passes strict validation but leaves 3 px of code overflow. The final version places the eager method call on its own line and shortens the observation heading; no meaning or executable behavior changes. Both parent attempts' finalize logs are retained in [attempts](attempts/).

| State | Author | Final candidate |
| --- | --- | --- |
| Phone, light | [Top](screenshots/author-390-light-top.png), [table](screenshots/author-390-light-table.png), [bottom](screenshots/author-390-light-bottom.png) | [Top](screenshots/final-390-light-top.png), [program](screenshots/final-390-light-middle.png), [bottom](screenshots/final-390-light-bottom.png) |
| Phone, dark | [Top](screenshots/author-390-dark-top.png), [bottom](screenshots/author-390-dark-bottom.png) | [Top](screenshots/final-390-dark-top.png), [program](screenshots/final-390-dark-middle.png), [bottom](screenshots/final-390-dark-bottom.png) |
| Desktop, light | [Top](screenshots/author-1440-light-top.png), [bottom](screenshots/author-1440-light-bottom.png) | [Top](screenshots/final-1440-light-top.png), [bottom](screenshots/final-1440-light-bottom.png) |
| Desktop, dark | [Top](screenshots/author-1440-dark-top.png), [bottom](screenshots/author-1440-dark-bottom.png) | [Top](screenshots/final-1440-dark-top.png), [bottom](screenshots/final-1440-dark-bottom.png) |

[Original/intermediate measurements](evidence/visual-metrics.json) and [final measurements](evidence/final-visual-metrics.json) use matched 390/1440 × 900 editorial light/dark states. The final table and all three code blocks fit their checked containers. Document height grows from **2404 to 2609 px on the phone** because the page now includes a complete program; desktop height falls from **1486 to 1190 px**. Neither direction is a comprehension score.

## Copy, export and validation

All three copy buttons were clicked on the final page, and their `Clipboard.writeText` payloads match rendered text. The [copied complete program](evidence/final-copied-example.rs) compiled with Rust 1.89.0 and its [stdout](evidence/final-copied-example.stdout.log) matches the displayed output exactly. [Result](evidence/final-copy-result.json), [payloads](evidence/final-copy-check.json), and compiler logs are retained. This intercepts the Clipboard API boundary; it does **not** test operating-system clipboard permissions. The output and illustrative counterexample blocks were checked for literal copying, not treated as standalone programs.

The [actual phone PNG](candidate-390-light.png) was downloaded through the reader UI, then inspected as image pixels. [Image dimensions](evidence/export-image.json) and top/middle/bottom captures are retained. The [strict finalization](evidence/candidate-finalize.stdout.log) and [current-path artifact check](evidence/candidate-check.json) pass. The final repository HTML matches the inspected final tuning HTML byte-for-byte. The [index interaction check](evidence/index-check.json) covers the two new variants, matching open links and width controls; [local link checks](evidence/link-check.json) cover the review documents.

The broad automated browser gate was not run. No Windows, human acceptance, general generation gain or final integration CI claim is made. Following CONTRIBUTING's impact policy, this authored-content/index update needs content, links, artifact and relevant browser checks, not an unrelated runtime suite or ZIP refresh. The behavior-changing PR skill review is skipped for this content-only round. Nothing was merged, released or installed.

## Reproduce

From the repository root:

```sh
node archify/bin/archify.mjs finalize explainer \
  docs/experiments/explainer-reading/rust-default/candidate.archify.md \
  /tmp/rust-default.html --writing strict --json
rustc --edition=2021 \
  docs/experiments/explainer-reading/rust-default/evidence/probe.rs \
  -o /tmp/rust-option-probe
/tmp/rust-option-probe
```

Use the recorded Rust 1.89.0 compiler when reproducing the exact environment; other installed versions are different evidence. Browser scripts retain their original absolute paths and TaskSpace 14 and are execution records, not a portable runner. AI disclosure: an independent author wrote the first page; Codex performed source probing, content repair, visual/copy verification and repository preparation. Human reading remains unevaluated.
