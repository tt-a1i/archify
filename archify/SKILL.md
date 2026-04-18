---
name: archify
description: Create professional architecture diagrams as standalone HTML files with SVG graphics, a built-in dark/light theme toggle, and one-click export to PNG / JPEG / WebP / SVG. Use when the user asks for system architecture diagrams, infrastructure diagrams, cloud architecture visualizations, security diagrams, network topology diagrams, or any technical diagram showing system components and their relationships.
license: MIT
metadata:
  version: "2.4"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify Skill

Create professional technical architecture diagrams as self-contained HTML files with inline SVG, a theme toggle, and a built-in image/SVG export menu. No external runtime dependencies beyond Google Fonts.

Every diagram this skill produces ships with:

- A **Dark / Light theme toggle** (top-right, persists in `localStorage`, respects `prefers-color-scheme` on first visit).
- An **Export menu** with **Copy PNG to clipboard** plus downloads for **PNG / JPEG / WebP** (all rasterized natively at 4× source resolution for maximum sharpness) and **SVG** (vector, styles inlined). The SVG download is **dual-theme self-contained**: it ships with both dark and light variable sets plus a `@media (prefers-color-scheme)` rule, so embedding it in a GitHub README (or any `<img>` host that exposes a color scheme) makes it follow the reader's dark/light preference automatically. All rendering happens in-browser, no server.
- A **CSS-variable-driven color system** so both themes remain visually consistent with the same SVG markup.

## The Cardinal Rule: Use CSS Classes, Not Inline Colors

The theme toggle works by switching CSS custom properties. If you hardcode `fill="rgba(...)"` or `stroke="#22d3ee"` on SVG elements, those values will NOT update when the theme changes. Always prefer the class-based system.

### Do this

```svg
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-mask"/>
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-backend" stroke-width="1.5"/>
<text x="CX" y="CY" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">API Server</text>
<text x="CX" y="CY+16" class="t-muted" font-size="9" text-anchor="middle">FastAPI :8000</text>
```

### Don't do this

```svg
<!-- Hardcoded colors break the theme toggle -->
<rect fill="rgba(6, 78, 59, 0.4)" stroke="#34d399" .../>
<text fill="white" .../>
```

## Design System

### Component color classes

| Component Type   | Fill class       | Text color class | When to use                                |
|------------------|------------------|------------------|--------------------------------------------|
| Frontend         | `c-frontend`     | `t-frontend`     | Client apps, browsers, mobile, UI          |
| Backend          | `c-backend`      | `t-backend`      | Services, APIs, workers, daemons           |
| Database         | `c-database`     | `t-database`     | DBs, caches, log files, data stores        |
| Cloud / AWS      | `c-cloud`        | `t-cloud`        | Managed cloud services, infra              |
| Security         | `c-security`     | `t-security`     | Auth providers, secrets, guards            |
| Message Bus      | `c-messagebus`   | `t-messagebus`   | Kafka/RabbitMQ/SNS/Event buses             |
| External/Generic | `c-external`     | `t-muted`        | Users, 3rd parties, anything uncategorized |

Text on a dark or light background uses three neutral helpers:

| Text class  | Role                          |
|-------------|-------------------------------|
| `t-primary` | Component names / titles      |
| `t-muted`   | Sublabels, annotations        |
| `t-dim`     | Tertiary / footer metadata    |

Per-semantic text accents also exist: `t-frontend`, `t-backend`, `t-database`, `t-cloud`, `t-security`, `t-messagebus`, `t-external` — use when you want a label colored to match its component type (e.g., a small "OAI Protected" caption inside a cloud-type box).

### Arrow classes

| Class         | Marker id                  | Semantic                       |
|---------------|----------------------------|--------------------------------|
| `a-default`   | `#arrowhead`               | Standard data/flow arrow       |
| `a-emphasis`  | `#arrowhead-emphasis`      | Live event stream / hot path   |
| `a-security`  | `#arrowhead-security`      | Auth / security flow (dashed)  |
| `a-dashed`    | `#arrowhead-dashed`        | Async / secondary (dashed)     |

Always set `stroke-width` on the line (e.g., `1.5`) — the class only sets color and dasharray.

### Boundary classes

| Class               | Purpose                            |
|---------------------|------------------------------------|
| `c-security-group`  | Dashed rose boundary for SGs       |
| `c-region`          | Large dashed amber region/cluster  |

### Typography

Inherit from the SVG root (already wired to JetBrains Mono). Font sizes: 12px for component names, 9px for sublabels, 8px for annotations, 7px for tiny labels.

### Visual Elements

**Background grid:** Automatically themed via `.c-grid` inside the `<pattern id="grid">`. Don't modify.

**Component boxes:** Rounded rectangles (`rx="6"`), `stroke-width="1.5"`, using the `.c-<type>` classes.

**Arrow z-order:** Draw connection arrows BEFORE component boxes (earlier in the SVG). SVG paints in document order, so arrows drawn first appear behind shapes drawn later.

**Masking arrows behind transparent fills:** Component fills are semi-transparent, which means arrows behind them bleed through. The template solves this with a two-rect pattern — an opaque mask rect, then the styled component on top:

```svg
<!-- 1. opaque mask (themed: dark=#0f172a, light=#ffffff) -->
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-mask"/>
<!-- 2. styled component on top -->
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-database" stroke-width="1.5"/>
```

Always use `c-mask` instead of hardcoded `fill="#0f172a"` — the mask color itself is themed.

**Message buses / Event buses:** Small connector elements between services:

```svg
<rect x="X" y="Y" width="120" height="20" rx="4" class="c-messagebus" stroke-width="1"/>
<text x="CENTER_X" y="Y+14" class="t-messagebus" font-size="7" text-anchor="middle">Kafka / RabbitMQ</text>
```

### Spacing Rules

**CRITICAL:** When stacking components vertically, ensure proper spacing to avoid overlaps:

- **Standard component height:** 60px for services, 80-120px for larger components
- **Minimum vertical gap between components:** 40px
- **Inline connectors (message buses):** Place IN the gap between components, not overlapping

**Example vertical layout:**
```
Component A: y=70,  height=60  -> ends at y=130
Gap:         y=130 to y=170   -> 40px gap, place bus at y=140 (20px tall)
Component B: y=170, height=60  -> ends at y=230
```

**Wrong:** Placing a message bus at y=160 when Component B starts at y=170 (causes overlap)
**Right:** Placing a message bus at y=140, centered in the 40px gap (y=130 to y=170)

### Security Group & Region Boundary Padding

When a component sits inside a `c-security-group` or `c-region` boundary, the small label on the boundary (e.g., `sg-name :port`, `AWS Region: us-west-2`) needs room above the inner component — otherwise the label visually crashes into the box below it.

**Rule:** boundary `y` = inner-component `y` − 30, boundary `height` = inner-component `height` + 50. Place the label 18px below the boundary top (baseline). This yields ~12px clear gap between the label baseline and the inner component's top edge.

**Example** — a Load Balancer (y=280, h=50) inside a security group:

```svg
<!-- Security group — extends 30px above and 20px below the inner box -->
<rect x="350" y="250" width="120" height="100" rx="8" class="c-security-group" stroke-width="1"/>
<text x="358" y="268" class="t-security" font-size="8">sg-name :port</text>

<!-- Inner component — unchanged coordinates -->
<rect x="360" y="280" width="100" height="50" rx="6" class="c-mask"/>
<rect x="360" y="280" width="100" height="50" rx="6" class="c-cloud" stroke-width="1.5"/>
```

If the inner component is taller (e.g., a 100px multi-line box), keep the 30/50 offsets — the extra vertical room on top stays the same, the bottom padding grows naturally.

### Legend Placement

**CRITICAL:** Place legends OUTSIDE all boundary boxes (region boundaries, cluster boundaries, security groups).

- Calculate where all boundaries end (y position + height)
- Place legend at least 20px below the lowest boundary
- Expand SVG viewBox height if needed to accommodate

### Layout Structure

1. **Header** — Title with pulsing dot indicator, subtitle
2. **Toolbar** (auto-included from template) — theme toggle + export menu, top-right fixed position
3. **Main SVG diagram** — contained in rounded border card
4. **Summary cards** — grid of 3 cards below diagram with key details
5. **Footer** — minimal metadata line

## Component Box Pattern

```svg
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-mask"/>
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-<type>" stroke-width="1.5"/>
<text x="CENTER_X" y="Y+20" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">LABEL</text>
<text x="CENTER_X" y="Y+36" class="t-muted" font-size="9" text-anchor="middle">sublabel</text>
```

## Arrow Patterns

```svg
<!-- Standard -->
<line x1="..." y1="..." x2="..." y2="..." class="a-default" stroke-width="1.5" marker-end="url(#arrowhead)"/>

<!-- Emphasis (live events / hot path) -->
<line x1="..." y1="..." x2="..." y2="..." class="a-emphasis" stroke-width="1.5" marker-end="url(#arrowhead-emphasis)"/>

<!-- Security / auth flow (dashed) -->
<path d="..." class="a-security" stroke-width="1.5" marker-end="url(#arrowhead-security)"/>

<!-- Async / secondary (dashed) -->
<path d="..." class="a-dashed" stroke-width="1" marker-end="url(#arrowhead-dashed)"/>
```

Pair each arrow class with the matching marker id (same suffix).

## Info Card Pattern

```html
<div class="card">
  <div class="card-header">
    <div class="card-dot COLOR"></div>
    <h3>Title</h3>
  </div>
  <ul>
    <li>&bull; Item one</li>
    <li>&bull; Item two</li>
  </ul>
</div>
```

Valid `card-dot` colors: `cyan`, `emerald`, `violet`, `amber`, `rose`, `orange`, `slate` — all automatically re-theme. Pair the dot to its component semantic (e.g., `orange` for a "Messaging" card, `slate` for an "External Services" card).

## Template

Copy and customize the template at `assets/template.html`. Customization points:

1. Update the `<title>` and header `<h1>` text + subtitle
2. Modify SVG `viewBox` dimensions if needed (default: `1000 x 680`)
3. Add/remove/reposition component boxes using the `.c-<type>` classes
4. Draw connection arrows using `.a-<variant>` classes
5. Update the three summary cards
6. Update footer metadata

Do NOT remove the `.toolbar` element, the `<script>` blocks, or the `:root` / `[data-theme="..."]` CSS. Those are what give every generated diagram the theme toggle and export buttons.

## Output

Produce a single self-contained `.html` file with:

- Embedded CSS (no external stylesheets except Google Fonts)
- Inline SVG (no external images)
- Small amount of embedded JS (theme toggle + export) — keep as-is from template

The file should render correctly when opened directly in any modern browser. The **Export** menu should cleanly copy PNG to the clipboard, download PNG / JPEG / WebP (all at 4× source resolution, rendered natively by the browser — no bitmap upsampling), and download a **dual-theme self-contained SVG** whose colors follow the embedding host's `prefers-color-scheme` (dark by default; swaps to light under a light host; `svg[data-theme="..."]` still works as a manual override).
