# Changelog

All notable changes are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Zero-install schema validation.** All five JSON Schemas are compiled at development time into committed standalone ESM validators. Installed skills now enforce the full schema contract without `npm install`, `node_modules`, or a network connection; CI verifies the packaged ZIP rejects invalid input in this dependency-free state.
- **First-run CLI commands.** `archify doctor` checks the installed runtime surface, and `archify demo [output-directory]` generates a ready-to-open example plus the next render command.

### Changed
- **60-second quick start.** README and GitHub Pages now lead with `npx skills add tt-a1i/archify -g`, a temporary `skills use` path, and three copy-ready prompts before the manual ZIP instructions.

### Fixed
- **CJK text width coverage (#14).** `textUnits` now detects supplementary Kana, Tangut, Nushu, Khitan, and vertical CJK punctuation while keeping halfwidth forms single-width.

## [2.10.0] — 2026-07-05

### Added
- **Actionable validator hints (#7).** Architecture layout errors now include concrete `Suggested fix` coordinates (`labelAt`, `labelDy`, nudged `pos`) so agents can patch JSON in one pass.
- **Architecture grid placement (#8).** Optional `layout.mode: "grid"` with `row`/`col` per component; explicit `pos` still overrides a cell. Example: `examples/archify-repo-grid.architecture.json`.
- **Layout inspect (#9).** `archify inspect architecture <file.json>` (alias: `validate --layout-json`) prints computed component rects, boundaries, connection paths, and label boxes as JSON.

## [2.9.0] — 2026-07-05

### Added
- **Unified CLI entrypoint.** Added `bin/archify.mjs` with `render`, `validate`, `check`, and `examples` commands so renderer-backed workflows have a single product-facing command surface.
- **Architecture examples.** Added self-diagram (`examples/archify-repo.*`) and a third-party sample (`examples/maka-architecture.*`) demonstrating clean main-path layout on real repos.

## [2.8.0] — 2026-07-03

### Added
- **Opt-in trace animation.** Renderer-backed diagrams can set `meta.animation: "trace"` to animate marked arrows and nodes inside the generated HTML/SVG. The default output remains static, and the CSS respects `prefers-reduced-motion`.
- **Workflow route guard.** Workflow rendering now rejects edges that cross through non-endpoint nodes, so crowded or long return routes fail with an actionable routing hint instead of producing confusing line artifacts.

## [2.7.0] — 2026-07-03

### Added
- **Post-render artifact checker.** Added `scripts/check-render-output.mjs`, a zero-dependency final HTML/SVG gate that checks for a single SVG block, non-finite SVG values, accidental two-point diagonal arrows, and arrows crossing the legend.
- **Workflow phase headers, groups, and exception lanes.** Workflow JSON now supports `phases`, `groups`, and `lane.variant: "exception"` so diagrams can make story beats, branch areas, and human/policy stop paths explicit.
- **Workflow `mainPath` lint.** The workflow renderer can validate that happy-path node ids are linked in order and do not accidentally move backward.
- **Artifact-check tests.** `test/render-output-checks.test.mjs` covers the new checker, including the legend-collision case that visual review exposed.

### Changed
- The renderer loop in `SKILL.md` and the workflow README now includes the post-render artifact checker as a standard delivery step.
- The workflow example was regenerated to demonstrate phases, groups, an exception lane, and clearer return/trace paths.

### Fixed
- **Same-lane offset routing.** Default same-lane workflow edges with different `yOffset` values now route orthogonally instead of drawing a two-point diagonal.
- **Legend collision in generated workflow previews.** The generated Archify renderer-pipeline preview now routes the compare path through a lane gap instead of crossing the legend.

## [2.6.0] — 2026-06-12

### Added
- **Architecture renderer.** The default, highest-traffic mode now has a constrained renderer (`renderers/architecture/render-architecture.mjs`) and JSON Schema (`schemas/architecture.schema.json`), bringing it to validation parity with the four typed modes — without auto-layout. Claude still picks all coordinates (`pos`/`size`); the renderer handles the mechanical work: the two-rect `c-mask` pattern, arrows-before-boxes z-order, an auto-built legend, and an auto-fitted `viewBox`.
- **Boundaries from `wraps`.** A `region` or `security-group` boundary lists the component ids it encloses; the renderer computes the box with correct 30/50 padding automatically, eliminating the hand-arithmetic that caused the v2.2.1 padding bug.
- **Architecture example.** Added `archify/examples/web-app.architecture.json` rendered to `examples/web-app-rendered.html`, wired into the golden suite (5th entry).
- **Geometry unit tests.** `archify/test/geometry.test.mjs` directly tests the pure helpers every renderer depends on (`rectsOverlap`, `anchor`, `roundedPath`, `labelPoint`, `chosenSide`, `textUnits`, …) — previously covered only transitively by golden byte-compares.
- **Layout-rule coverage matrix.** `archify/test/layout-rules.test.mjs` drives one minimal-violation case per high-value layout rule across all five modes and asserts the error message carries its numeric threshold and remediation hint (the LLM-facing DX contract).
- **Degraded-mode fuzz net.** `archify/test/degraded.test.mjs` asserts that type-wrong-but-JSON-legal input always fails friendly (non-zero exit, no `TypeError`, no `NaN`/`undefined` written) and that valid order-shuffles always render.

### Changed
- `npm test` now runs the golden suite plus `node --test test/*.test.mjs` (geometry, layout-rules, degraded). The `architecture` schema is registered in `validator.mjs` and covered by `render:examples`.
- `textUnits` now counts supplementary-plane CJK and emoji as double-width (added the `u` flag and astral ranges).

### Fixed
- **Degraded-mode robustness (no ajv).** A type-wrong top-level field (e.g. `nodes: "oops"`) or a missing coordinate field (e.g. a node with no `col`) previously threw a raw `TypeError` before the friendly checks ran, or exited 0 while writing `<rect x="NaN">` into the HTML. Renderers now coerce non-array fields via `asArray`, guard non-finite coordinates with `isFinitePoint`, and validate `cards`/`messages`/`segments`/`activations` are arrays — so malformed input always produces an actionable message instead of a crash or silent corruption.

## [2.5.0] — 2026-06-11

### Added
- **Workflow diagram mode.** Archify now includes a renderer-backed workflow diagram type for technical flows, approval chains, tool calls, CI/CD paths, runbooks, and process ownership diagrams. Workflow diagrams use a JSON IR with lanes, nodes, routed edges, and summary cards, then render into the same standalone HTML shell with theme toggle and export menu.
- **Workflow JSON Schema.** Added `archify/schemas/workflow.schema.json` to document and validate the workflow IR shape.
- **Workflow example.** Added a rendered agent tool-call workflow example at `examples/workflow-agent-tool-call-rendered.html`.
- **Sequence diagram mode.** Added a renderer-backed sequence diagram type for API call chains, request lifecycles, cache fallback paths, authentication checks, async trace emission, and service interactions over time.
- **Sequence JSON Schema.** Added `archify/schemas/sequence.schema.json` to document and validate the sequence IR shape.
- **Sequence example.** Added a rendered cache-miss request sequence example at `examples/sequence-cache-miss-request.html`.
- **Sequence README preview.** Added a rendered sequence screenshot to the README preview flow.
- **Data-flow diagram mode.** Added a renderer-backed data-flow diagram type for analytics pipelines, ETL/ELT, PII isolation, governance boundaries, data lineage, warehouse sync, and downstream consumers.
- **Data-flow JSON Schema.** Added `archify/schemas/dataflow.schema.json` to document and validate the data-flow IR shape.
- **Data-flow example.** Added a rendered product analytics data-flow example at `examples/dataflow-product-analytics.html`, plus a README preview screenshot.
- **Lifecycle diagram mode.** Added a renderer-backed lifecycle/state-machine diagram type for object lifecycles, wait states, retries, cancellation, timeout, terminal states, and recovery paths.
- **Lifecycle JSON Schema.** Added `archify/schemas/lifecycle.schema.json` to document and validate the lifecycle IR shape.
- **Lifecycle example.** Added a rendered agent-run lifecycle example at `examples/lifecycle-agent-run.html`, plus a README preview screenshot.
- **Runtime JSON Schema validation.** All four typed renderers validate their JSON IR against the published schemas via ajv (draft 2020-12); violations exit non-zero with path-prefixed error messages, and error paths carry element ids (e.g. `/nodes/3 (id/label: "router")`). When dependencies aren't installed, the renderer warns and skips schema validation gracefully — layout checks still run.
- **GitHub Pages landing page.** Added a product landing site under `docs/` plus a repository social preview image.
- **Mermaid as an input dialect.** New `SKILL.md` section maps `flowchart` → workflow, `sequenceDiagram` → sequence, and `stateDiagram` → lifecycle so Claude can accept pasted Mermaid and lay out from scratch (prompt engineering, no parser) — closing roadmap item P2.
- **Label collision detection.** New validation checks flag label-vs-node and label-vs-label collisions, plus node labels overflowing their boxes.
- **CJK-aware text width estimation.** Full-width characters count as 2 units, and the template plus exported-SVG font stacks gained PingFang SC / Microsoft YaHei / Noto Sans CJK SC fallbacks.
- **Golden test suite.** `archify/test/golden.mjs` byte-compares the four rendered examples, runs 6 negative validation cases (schema + layout), and checks `web-app.html` template freshness and version sync — wired to `npm test`.
- **Example re-render script.** `archify/test/render-examples.mjs` re-renders every example in one shot via `npm run render:examples`.
- **CI workflow.** `.github/workflows/ci.yml` runs the test suite on a Node 20/22 matrix and verifies `archify.zip` freshness by rebuilding and diffing.
- **Release workflow.** `.github/workflows/release.yml` builds the zip on `v*` tags, verifies the tag matches `package.json`, and attaches the artifact to the GitHub Release.
- **Zip build script.** `scripts/build-zip.sh` builds `archify.zip` from `archify/` (including `package.json`, the lockfile, and the newly bundled `archify/LICENSE`; excluding `node_modules`). `package.json` declares `engines.node >= 18`.
- **Workflow preview image.** Added `docs/assets/archify-workflow.png` (4× dark export) — workflow was the only diagram type without a preview screenshot.
- **Generator metadata & accessibility.** Generated HTML carries `<meta name="generator" content="archify 2.5.0">`; the SVG root gets `role="img"` + `aria-label`, toasts get `role="status"`, and the export menu fixes focus return to the trigger, ArrowDown-to-open, and separator ARIA.
- **Async Google Fonts loading.** The `media="print"` onload trick plus preconnect and a noscript fallback mean an offline or slow network no longer blocks first paint.
- **Theme FOUC guard.** An early script in `<head>` applies the stored theme before first paint, and pages without an explicit preference now follow live system theme changes.
- **`--text-faint` UI variable.** Menu hints and the footer now meet contrast standards; the SVG `t-dim` color is unchanged.

### Changed
- **Template responsive polish.** The shared HTML template now handles narrow viewports better: the toolbar no longer overlaps the title, diagrams can scale down to the available width, and cards stack cleanly on mobile.
- **Subtle swimlane styling.** Added `c-lane` for workflow/process swimlanes so workflow boundaries do not visually overpower the main path.
- **Lifecycle diagram reworked as a phase map.** The lifecycle visual model was redesigned across several composition passes: phase bands, decluttered middle lanes, and refined transition labels.
- **Shared renderer code.** The typed renderers share `utils.mjs` (with hardened template slot replacement), and this release extracts `renderers/shared/geometry.mjs` (geometry/class maps), `cli.mjs` (CLI head/tail), and `schemas/common.schema.json` (`$ref`-shared id/point/componentType/variant/cards definitions). ajv now runs in strict mode.
- **Validation error messages rewritten.** Every check now reports numeric thresholds, the valid range, and which field to change.
- **`SKILL.md` restructured (433 → ~205 lines).** New Setup section (npm install, graceful degradation, architecture-mode fallback when no shell is available), per-mode JSON examples upgraded from empty skeletons to renderable snippets (all verified to pass first try), per-mode layout budgets (columns/rows/coordinate ranges/spacing), documented lifecycle reserved-lane (`main`/`terminal`) semantics, a 6-item machine-checkable architecture-mode checklist, a pointer to the renderer README for depth, and corrected viewBox guidance. Frontmatter version is 2.5 and the description gained Mermaid/flowchart trigger words.
- **Lifecycle band titles.** Band titles now render from lane labels (the schema-required field is finally used), the main track length derives from actually occupied columns, and a missing `main` lane is a validation error.
- **Sequence timeline scaling.** The timeline scales with viewBox height (taller viewBox = more timeline room), and segments are validated (`to > from`, within the canvas).
- **Workflow sizing defaults.** Omitting the viewBox now auto-computes height from the lane count, and the default width dropped 1000 → 720, eliminating 320px of dead space.
- **Schema limits tightened.** Column caps added (workflow `col ≤ 5`, lifecycle `col ≤ 4`), sequence messages require `y ≥ 160`, and viewBox minimums are stricter.
- **Exported SVG embeds only SVG-relevant CSS.** ~9 KB of toolbar/cards/print rules are stripped from `.svg` downloads.
- **Download filename cleanup.** The redundant `-diagram` suffix is stripped from export filenames.
- **Docs images consolidated under `docs/assets/`.** `examples/images/` is removed, the orphaned `archify-print.png` deleted, and `archify-lifecycle.png` regenerated with the new band titles.
- **Docs accuracy.** README's "~3 KB embedded JS" corrected to ~19 KB; "4× export" is now documented as *up to* 4× (oversized diagrams automatically step down to 3×/2× via `pickSafeScale`); and "zero dependencies" is scoped to the generated HTML only — the renderers need `npm install` for ajv.

### Fixed
- **`applyTemplate` slot corruption.** Slot replacement now uses a function replacer, so `$&`, `$'`, `` $` ``, and `$$` in titles or labels no longer corrupt the output.
- **Lifecycle overlap detection across lanes.** Overlap checks now compare all state pairs across lanes — previously, identical coordinates in different lanes produced zero errors.
- **Sequence vertical-spacing false positives.** The spacing check now only fires for messages whose horizontal spans actually overlap, eliminating false reports on parallel messages.
- **Zero values swallowed.** `bias: 0` / `channelX: 0` / `channelY: 0` now use `??` instead of `||`, so schema-legal zero values are respected.
- **Workflow `fromSide`/`toSide: "auto"`.** Removed from the schema and normalized in code — an explicit `"auto"` used to anchor edges to the wrong side.
- **Route enums converged.** Workflow drops `drop-right`/`drop-left`/`same-lane` (byte-identical output to `drop`/`straight`); lifecycle drops `raise`, removes the dead `bias` field, and adds `cornerRadius` (the renderer read it but the schema rejected it).
- **Light-theme exports kept dark swimlanes.** The export pipeline now scans the stylesheet for CSS variables at runtime instead of using a hardcoded list — `--lane-fill`/`--lane-stroke` were slipping through, and newly added variables can no longer be missed.
- **Safari Copy PNG.** `ClipboardItem` is now constructed synchronously inside the user gesture (with a `Promise<Blob>` value), with a fallback path.
- **`localStorage` guarded.** All access is wrapped in try/catch, so disabled storage no longer takes down theme, export, and keyboard shortcuts together.
- **Print palette completed.** Print styles now carry a full light palette (no more neon strokes when printing from the dark theme), and the footer keyboard-shortcut hints are hidden in print.
- **Stale `archify.zip`.** Rebuilt — it had fallen 3 commits behind and was missing `renderers/shared/` and `package.json`; CI now enforces zip freshness.

## [2.4.0] — 2026-04-18

### Changed
- **Download SVG is now dual-theme self-contained.** The exported `.svg` ships with BOTH dark and light CSS variable sets plus a `@media (prefers-color-scheme: light)` rule. Embedding the file via `<img src="x.svg">` in a GitHub README (or any host that exposes a color scheme) makes it follow the reader's dark/light preference automatically — no more shipping two PNGs wrapped in `<picture>`. The root `<svg>` no longer carries a `data-theme` attribute, so the media query can actually take effect; downstream consumers can still force a theme via `svg[data-theme="light"]` / `svg[data-theme="dark"]`.
- **`serializeSvg(scale, opts)`** grew a second argument: `opts.autoTheme: true` switches on the new dual-theme path. The raster pipeline (PNG / JPEG / WebP / Copy to clipboard) explicitly does NOT set it, so those paths keep locking colors to the viewer's current theme — canvas rasterization needs deterministic output and a raster can't react to `prefers-color-scheme` after encoding.
- **Background rect in auto-theme mode** now carries `class="c-bg-rect"` + `rect.c-bg-rect { fill: var(--bg); }` instead of a baked-in color, so the backdrop swaps along with the variables.

### Why
The v2.0 SVG export was good, but single-theme — users who wanted README embedding still had to export one PNG per theme and wrap them in `<picture><source media="(prefers-color-scheme: dark)">`. A single SVG that already knows both themes cuts that down to `![](archify.svg)`.

## [2.3.1] — 2026-04-15

### Fixed
- **Stale docs referencing the removed scale selector.** `SKILL.md` frontmatter version bumped `2.0` → `2.3`; the two "2x retina" bullets (lines 18, 233) rewritten to describe the current 4× native pipeline + clipboard copy. `README.md` cleaned up in four places: intro paragraph, "What's new" table (now includes v2.2 column), "Export menu" description (no more "scale selector"), and technical-details section (accurate 4× native-rasterization description, not `Image + 2x canvas`).
- **Canvas-size clamp for large diagrams.** `rasterize()` now picks the largest integer scale in `{4,3,2,1}` whose `viewBox × scale × scale` fits under a 16 Mpx cap — enough to cover older iOS Safari's silent "blank canvas" ceiling. Default diagrams (viewBox ≈ 1000×680) stay at 4×; only unusually large viewBoxes (say, 1600×1200) step down to 3× automatically.
- **`?openExport=1` race with font loading.** Replaced the 60 ms `setTimeout(open)` with `document.fonts.ready.then(open)` (+ double `requestAnimationFrame` to let layout settle). Slow connections no longer get a flashed / mispositioned menu on first paint.

### Added
- **Export menu visual grouping.** Two `<hr role="separator">` dividers split the menu into three sections: *Copy to clipboard*, *Download raster (PNG / JPEG / WebP)*, *Download vector (SVG)*. Makes scanning faster and disambiguates "Copy PNG" vs "Download PNG" at a glance.
- **Renamed "Copy PNG" → "Copy to clipboard"** with `PNG` moved to the hint badge on the right. The destination ("clipboard") is now in the primary label instead of inferred from context.
- **Print stylesheet polish.** Added `@page { size: landscape; margin: 1.5cm; }`, expanded container width in print, switched the summary-card grid to two columns in print so the third card doesn't orphan onto a second page, and added `page-break-inside: avoid` for older browsers that don't understand `break-inside`.

## [2.3.0] — 2026-04-15

### Fixed
- **Raster exports are now genuinely sharp.** Previously the browser rasterized the serialized SVG at its natural `viewBox` dimensions (e.g., 1000×680), and then `ctx.drawImage(img, 0, 0, width*scale, height*scale)` bitmap-upsampled that raster onto the canvas — which just blew up the pixels and produced a soft image. The new flow sets the serialized SVG's `width`/`height` to `4 × viewBox` so the browser rasterizes the vectors at target resolution natively; the canvas then draws at the image's natural size with no scaling. Result: text edges, arrow heads, and stroke details that are actually crisp at 4×.

### Removed
- **Scale selector (1× / 2× / 4×).** The selector introduced in 2.1 encouraged picking a low scale to "save file size", which (combined with the upsampling bug above) always produced the softest output. Replaced with a single hardcoded 4× render on every raster export. PNG file sizes grow ~3–4× but the output is visibly sharper. A typical diagram exports to 4000×2720 (~300–700 KB PNG).
- `Left` / `Right` arrow key binding (used by the selector) removed from the menu keyboard nav. Up/Down/Home/End/Esc/Tab all preserved.
- `archify-export-scale` localStorage key is no longer read or written (old values are harmless leftovers).

### Changed
- Toast no longer includes the scale suffix — now just "Copied PNG to clipboard" since the scale is always 4×.
- JPEG/WebP quality bumped from 0.92 to 0.95 (file-size delta is tiny at 4× but the encoded edges look cleaner).

## [2.2.1] — 2026-04-15

### Fixed
- **Security group label crowding.** The `sg-name :port` label on the dashed rose boundary sat only ~1px above the Load Balancer box inside it (boundary `y=265 h=80`, inner box `y=280`, label baseline `y=279`). Bumped the boundary to `y=250 h=100` and moved the label to `y=268`, giving ~12px clear gap between the label baseline and the inner component. Same pattern documented in `SKILL.md` so Claude stops generating crowded boundaries.

### Changed
- `SKILL.md`: new **Security Group & Region Boundary Padding** section with the 30/50 offset rule (boundary `y = inner.y - 30`, `h = inner.h + 50`, label baseline 18px below boundary top) and a concrete code example.

## [2.2.0] — 2026-04-15

### Added
- **Print stylesheet.** <kbd>Cmd</kbd>+<kbd>P</kbd> (or browser print) now produces a clean, print-ready page: toolbar and toasts hidden, dark background replaced with white, grid removed, card/container borders switched to light gray, `break-inside: avoid` on diagram + cards so nothing splits mid-element. Works regardless of current theme.
- **Font fallback improvement for exported images.** The serialized SVG now includes a `local()`-only `@font-face` block for JetBrains Mono at weights 400/500/600/700 so that raster exports can pick up a locally-installed JetBrains Mono (common on developer machines) and fall through cleanly to `ui-monospace` / Menlo otherwise. Previously the sandboxed image-rendering context couldn't reach the Google Fonts URL in the `<link>`, resulting in plain monospace even when users had the font installed.
- `archify-print.png` screenshot wired into the README preview section.

## [2.1.0] — 2026-04-15

### Added
- **Copy PNG to clipboard.** New menu action writes the diagram straight to the system clipboard via `ClipboardItem` / `navigator.clipboard.write` so it can be pasted into Slack, Notion, GitHub, Figma, Keynote, etc. Item is dimmed on browsers that don't support clipboard image writes.
- **Export scale selector (1× / 2× / 4×)** at the top of the Export menu. Raster downloads and Copy use the selected scale. Selection persists in `localStorage`. Keyboard: <kbd>←</kbd> / <kbd>→</kbd> switch scale.
- **Toast feedback** — brief "Copied PNG to clipboard (2×)" confirmation after successful copy.
- **URL parameter `?openExport=1`** — auto-opens the Export menu on load. Primarily for deterministic screenshots and live demos.
- Screenshot showing the Export menu open (`examples/images/archify-menu.png`) wired into the README preview section.

### Changed
- Export menu items renamed from `PNG / JPEG / WebP / SVG` to `Download PNG / JPEG / WebP / SVG` to disambiguate from the new `Copy PNG` action above.
- `SCALE` constant replaced by `getScale()` reading from the radiogroup; scale flows through `rasterize()` and clipboard copy alike.

## [2.0.0] — 2026-04-15

First Archify release. Fork / rewrite of
[`Cocoon-AI/architecture-diagram-generator`](https://github.com/Cocoon-AI/architecture-diagram-generator)
v1.0 (MIT).

### Added
- **Dark / Light theme toggle** on every generated diagram. Persists in `localStorage`, respects `prefers-color-scheme` on first visit, overridable per-page via `?theme=dark|light` URL parameter.
- **Client-side export menu**: PNG, JPEG, WebP (all 2× retina) and SVG (vector, styles inlined).
- **Keyboard shortcuts**: <kbd>T</kbd> toggles theme, <kbd>E</kbd> opens the Export menu. Menu supports <kbd>Arrow</kbd> / <kbd>Home</kbd> / <kbd>End</kbd> / <kbd>Esc</kbd> / <kbd>Tab</kbd>.
- **WebP support detection** — menu item is disabled on browsers that can't encode WebP (older Safari) instead of silently saving a mislabeled PNG.
- **CSS-variable theme system**: every color lives in a `:root` / `[data-theme="light"]` pair, so both themes render from one SVG markup.
- **Semantic SVG classes** in the template: `.c-frontend` / `.c-backend` / `.c-database` / `.c-cloud` / `.c-security` / `.c-messagebus` / `.c-external` plus matching `t-*` text color helpers, `a-*` arrow variants, and `c-mask` / `c-security-group` / `c-region` boundary classes.
- **Accessibility**: ARIA roles on the toolbar (`role="toolbar"`, `role="menu"`, `role="menuitem"`), `aria-expanded` / `aria-haspopup` / `aria-pressed` wired up, `:focus-visible` outline, full keyboard navigation.
- `v2.0.0` zip package renamed to `archify.zip`; skill identifier is now `archify` so it doesn't collide with users who still have the v1 skill installed.
- `CHANGELOG.md` (this file).

### Changed
- `SKILL.md` rewritten to steer Claude toward the class-based, themeable system. Contains an explicit "Cardinal Rule: Use CSS Classes, Not Inline Colors" section and a full class reference.
- `README.md` rewritten around the new feature set; adds an Attribution section linking the original project.
- Example page (`examples/web-app.html`) regenerated using the v2 template so the live demo actually exhibits the theme toggle and export menu.

### Removed
- Hardcoded `fill` / `stroke` attributes on SVG components — they broke theme switching and are banned by the new `SKILL.md`.
- v1.0 example HTMLs (dark-only, no toolbar) to avoid showing stale output.

### Fixed
- **Light-mode exports rendered in dark mode.** The serialized SVG injected the resolved theme variables *before* the host stylesheet, which placed the `:root, [data-theme="dark"] { ... }` rule later in the cascade and overrode the chosen theme. The export pipeline now appends the resolved `:root, svg { ... }` variable block *after* the host CSS so it wins cascade order.
- Filename sanitizer now strips leading and trailing hyphens (previously left artifacts like `-project-name-.png` when the title still contained placeholder brackets).

### Known limitations
- Exported raster images render text in the system monospace fallback (`ui-monospace` / Menlo / Consolas), not JetBrains Mono. The browser's sandboxed image-rendering context can't fetch Google Fonts. Install JetBrains Mono locally for pixel-perfect exports.

---

Original v1.0 design (dark theme, palette, grid background, summary-card layout, JetBrains Mono typography) belongs to Cocoon AI and is preserved.
