# Changelog

All notable changes are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
