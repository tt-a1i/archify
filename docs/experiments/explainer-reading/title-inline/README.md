# Render the page title's validated inline content

Round 30, 2026-10-30. Disposition: verified local rendering repair. [Open the unchanged Make first draft with the repair](candidate.html); the [preferred Make explanation](../make-phony/candidate.html) remains the separately edited round 29 candidate.

Independent curl, Git and Make drafts put command names in backticks in the main heading. Validation accepted that inline syntax, but the reader printed the backticks. Panel titles already rendered the same syntax. [Before](screenshots/base-gitdiff-1-390-light.png) and [after](screenshots/candidate-gitdiff-1-390-light.png) use the identical frozen Git draft.

Base: `56027318779fb1b5a665dce16a8eba7a631821d6`. Latest fetched `dev`: `5ecbd1bfdbf83ea747072112493c940e707569cb`, an ancestor. [Source and regression commit](https://github.com/tt-a1i/archify/commit/3e356695afca522e8bcc72a0899869d7325a4e12).

## Behavior

The main heading now uses the existing inline renderer for code, emphasis and references. Rendering it before the answer preserves citation and typical-note numbering in reading order. The browser tab title uses plain text derived from the parsed tokens, retaining code contents and link labels. Authored source, canonical metadata and provenance payloads are unchanged; no regex Markdown stripping, new grammar, dependency or style rule is added.

Native references in the title now participate in preparation's existing target checks. A title link to an absent node in an external diagram fails with the existing located diagnostic, instead of silently bypassing that check. Real native targets continue to prepare successfully.

Two old renderer fixtures supplied raw HTML in a title directly to a renderer documented to take validated input. [Frozen-base contract checks](evidence/title-contract.json) confirm that those strings already failed public validation. The fixtures now put the same script-breaking content inside valid inline code. Their literal text, intact source/payload and no-extra-script assertions remain; they were not removed to make the repair pass.

## Evidence

- The final two regressions [fail on frozen base](evidence/final-base-regression.log), 0 pass / 2 fail / 0 skipped, and [pass on candidate](evidence/candidate-regression.log). They cover visible code/emphasis, plain tab text, citation/footnote order, source/block/native destinations, preserved canonical input, and public preparation of an external native target. The first red capture's missing-code assertion produced a TypeError; the final red run uses an explicit assertion and is the authoritative discriminator.
- [Renderer, inline, validation, CLI and patch tests](evidence/focused.log): 61 pass / 0 fail / 0 skipped. [Explainer browser file](evidence/browser-suite.log): 14 pass / 0 fail / 0 skipped. [Core](evidence/core.log): 19 pass / 0 fail / 0 skipped. [Generated checks](evidence/generated.log) pass.
- [All 32 index variants replayed](evidence/replay.json) with frozen authored documents and resources. Twenty-nine outputs are byte-identical. Only the curl, Git and Make original headings change; after removing `h1` and `title` content, every changed pair is also byte-identical. This is renderer compatibility evidence, not new generation or renewed artifact provenance acceptance. [Replay script](evidence/replay.mjs).
- [Browser comparison](evidence/browser-comparison.json) covers those three changed pages, both runtimes, 390/1440 px and light/dark: 24 states. Page heights remain equal for every pair; no panel clipping occurs. Parent inspection includes [Git phone](screenshots/candidate-gitdiff-1-390-light.png), [curl dark desktop](screenshots/candidate-curl-1-1440-dark.png) and [Make phone](screenshots/candidate-make-1-390-light.png).
- A [derived native interaction control](title-control.html) uses frozen singleflight resources with a constructed title. [Keyboard checks](evidence/title-interactions.json) open the Viewer from the title, focus node `a`, restore focus on close, and navigate to source and panel anchors. This is a constructed interaction control, not an independent author or provenance acceptance result.

The unchanged Make first draft passes canonical [strict finalize](evidence/candidate-finalize.json) and [current-path provenance checking](evidence/candidate-check.json). HTML SHA-256: `39b65a4f1f55c076af60bde5e7f1dd63dec653d74984b50a0e7e955bed99f430`. Its old wording and layout are intentionally retained to isolate the title repair.

The actual reader export is a [780 × 5,200 PNG](candidate-390-light.png). The parent inspected its pixels at [top](screenshots/export-top.png) and [bottom](screenshots/export-bottom.png), confirming the rendered code title and retained final checklist/sources. [Export result](evidence/export-check.json). Reading quality and factual content still belong to the original draft's audit; a heading fix does not supersede round 29's content improvements.

## Package and scoped review

Two Node 22.23.3 / zlib 1.3.1-e00f703 builds are byte-identical: 6,996,556 bytes, SHA-256 `129a63a8e7e0bc756d5614e2d1ad40a7625fceb49d418bd5aa2ba8f92a5f082b`. Extracted render, preparation, inline, reader JS and CSS match source. The extracted CLI passes [strict finalize](evidence/package-finalize.json), [provenance checking](evidence/package-check.json) and [both regressions](evidence/package-regression.log), with zero failures/skips. [Package identity](evidence/package-identity.json) records runtime version and repository test-harness dependencies outside the extracted Skill. No live installation occurred.

The [bounded ownership check](evidence/ownership.json) inspected current heads of #1015, #1142 and #1144; all retained the old escaped heading and browser-title expressions. No patch was reused or external message sent. The search is not exhaustive.

Scoped test-value review uses two observable regressions at the renderer and preparation boundaries. Existing escaping/payload protections remain effective. Direct consumers are delivery rendering and panel replacement's preparation check; both affected integration files pass. Plain browser text includes code, unlike validation's prose-only writing text, so merging those different transformations would obscure their purposes. No shared abstraction or broader refactor was warranted.

Under the [benchmark convention](../../../../benchmarks/real-repo-generation/README.md), the experiment is a fixed-input repair of observed author outputs. No fresh-author speed, broad generation improvement or human comprehension claim is made. Full repository/browser runner, Windows, final-head CI and human acceptance remain unperformed. Archived scripts keep original absolute paths; copied text and the archived derived control trim trailing whitespace. Interaction evidence was recorded before this nonfunctional archive cleanup. Index questions and variants remain 14 and 32 across 12 projects.

AI disclosure: Codex investigated, implemented, tested and visually inspected the repair. Triggering authors are recorded in their original rounds. No merge, release or live-install action is implied. The overall exploration goal remains active.
