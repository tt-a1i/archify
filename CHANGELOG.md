# Changelog

All notable changes are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Workflow diagram mode.** Archify now includes a renderer-backed workflow diagram type for technical flows, approval chains, tool calls, CI/CD paths, runbooks, and process ownership diagrams. Workflow diagrams use a JSON IR with lanes, nodes, routed edges, and summary cards, then render into the same standalone HTML shell with theme toggle and export menu.
- **Workflow JSON Schema.** Added `archify/schemas/workflow.schema.json` to document and validate the workflow IR shape.
- **Workflow example.** Added a rendered agent tool-call workflow example at `examples/workflow-agent-tool-call-rendered.html`.
- **Sequence diagram mode.** Added a renderer-backed sequence diagram type for API call chains, request lifecycles, cache fallback paths, authentication checks, async trace emission, and service interactions over time.
- **Sequence JSON Schema.** Added `archify/schemas/sequence.schema.json` to document and validate the sequence IR shape.
- **Sequence example.** Added a rendered cache-miss request sequence example at `examples/sequence-cache-miss-request.html`.
- **Sequence README preview.** Added a rendered sequence screenshot to the README preview flow.

### Changed
- **Template responsive polish.** The shared HTML template now handles narrow viewports better: the toolbar no longer overlaps the title, diagrams can scale down to the available width, and cards stack cleanly on mobile.
- **Subtle swimlane styling.** Added `c-lane` for workflow/process swimlanes so workflow boundaries do not visually overpower the main path.

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
