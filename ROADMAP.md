# Archify Roadmap

Features planned but not yet shipped, in recommended implementation order.

Effort legend: **S** = afternoon · **M** = ~a day · **L** = multi-day.
Target versions are suggestions — bundle them however makes sense.

---

## 1. `?exportScale=N` URL parameter

**Effort:** S &middot; **Target:** v2.4.0

### What

Re-expose 1× / 2× / 3× / 4× raster scale control — via URL parameter only, no UI selector. Default stays 4× for any user who doesn't care.

### Why

v2.3.0 removed the scale selector because "2× default + bitmap upsampling" produced soft output and the UI actively encouraged picking the softest option. The native-rasterization fix from 2.3 stays; this just restores an escape hatch for:

- Sharing compact PNGs in Slack / Notion / Discord where a 4000×2720 file is overkill
- Headless batch scripts wanting a specific output size
- Embedding in pipelines that re-compress anyway (no point in paying the 4× pixel cost upstream)

No UI surface means no regression back to the "soft by default" footgun.

### How

```js
function resolveRasterScale() {
  try {
    var v = parseInt(new URLSearchParams(location.search).get('exportScale'), 10);
    if (v === 1 || v === 2 || v === 3 || v === 4) return v;
  } catch (_) {}
  return 4;
}
var RASTER_SCALE = resolveRasterScale();
```

Also:
- Let the existing canvas-size clamp (16 Mpx) continue to downshift automatically if `scale × viewBox` would exceed limits.
- Update the "Copied" toast to append `(Nx)` when `N !== 4`, so the user sees they got non-default output.
- Document in README's **URL parameters** section.

### Done when

- `?exportScale=2` produces a 2000×1360 PNG for the default viewBox.
- No parameter → output is byte-for-byte identical to v2.3.1.
- Canvas clamp still kicks in on oversized viewBoxes.
- README and CHANGELOG updated.

---

## 2. Color-blind-safe palette

**Effort:** S &middot; **Target:** v2.4.0 (bundle with #1)

### What

A third CSS-variable set `[data-palette="cb"]` orthogonal to the existing `[data-theme]` axis. Uses the Okabe-Ito palette (seven colors designed to be distinguishable under deuteranopia, protanopia, and tritanopia).

### Why

Archify's default palette uses emerald (backend) + rose (security) + violet (database) — emerald and rose are hard to distinguish under red-green deficiency, which affects ~8% of males. For inclusive team docs, architecture reviews, and conference slides, an accessible option matters.

### How

Add a palette axis alongside the theme axis. Existing CSS structure already has every color as a variable, so this is just one more block:

```css
[data-palette="cb"] {
  --frontend-stroke:   #56B4E9;  /* sky blue     */
  --backend-stroke:    #009E73;  /* bluish green */
  --database-stroke:   #CC79A7;  /* reddish purple */
  --cloud-stroke:      #E69F00;  /* orange */
  --security-stroke:   #D55E00;  /* vermillion */
  --messagebus-stroke: #F0E442;  /* yellow */
  --external-stroke:   #0072B2;  /* blue */
  /* matching rgba fills for each */
}
```

Toggle surfaces:
- URL parameter `?palette=cb` (mirrors the existing `?theme=` pattern).
- Optionally: an accessibility button in the toolbar next to the theme toggle. Button label can be a small `◐` glyph with `aria-label="Color palette"`.

Persistence: `localStorage['archify-palette']`, URL param wins.

### Done when

- Dark + default, Dark + cb, Light + default, Light + cb all render cleanly.
- URL override works alongside localStorage persistence.
- README documents `?palette=cb`.
- SKILL.md notes that palette is orthogonal to theme.
- Legend + summary-card dots re-map correctly under the cb palette.

---

## 3. gzip + base64 share links

**Effort:** M &middot; **Target:** v2.5.0

### What

"Share" button in the toolbar that compresses the entire generated HTML into the URL fragment, producing a self-contained link. Opening the link reconstitutes the diagram in-browser. No server, no attachment.

### Why

Today, sharing a diagram means attaching an HTML file. A URL is strictly better for:
- Slack / Discord / Teams (shows as link unfurl inline)
- GitHub / GitLab issue + PR comments
- Jira / Linear / Notion pages
- Email + RFC drafts
- Browser bookmarks + history

### How

Two halves:

**Producer (in the generated HTML):**

```js
async function createShareLink() {
  const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  const stream = new Blob([html]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const b64 = btoa(String.fromCharCode.apply(null, bytes));
  return SHARE_BASE_URL + '#data=' + b64;
}
```

**Consumer (hosted decoder page):**

A static page at `archify.pages.dev/` (Cloudflare Pages, free tier) that:
1. Reads `location.hash`
2. Base64-decodes, runs it through `DecompressionStream('gzip')`
3. `document.open(); document.write(html); document.close();`

Use `CompressionStream` / `DecompressionStream` (native, no pako dep needed — supported across Chrome 80+, Firefox 113+, Safari 16.4+).

### Tradeoffs

- **URL length:** Chrome handles ~32 KB fragments reliably. A typical archify diagram compresses to 5–15 KB. Very large diagrams (30+ components) may bump into the limit — fall back to a "Diagram too large to share as link" message with a download button.
- **Security:** The decoder `document.write()`s arbitrary HTML. The decoder page must live on a dedicated hostname that never holds user credentials, so XSS-via-share-link can't exfiltrate anything interesting. Never run the decoder on the same origin as an account system.
- **Fragment vs query param:** `#data=` stays client-side (never hits server logs). Prefer it over `?data=`.

### Done when

- "Share" button produces a URL < 30 KB for a typical 8-component diagram.
- Opening the link in a fresh tab reconstitutes the exact same page (theme, palette, everything).
- Link works after pasting into Slack / GitHub (tested in a throwaway thread).
- Decoder page is deployed and versioned (e.g., `archify.pages.dev/v1/`).
- Fallback flow triggers cleanly when payload exceeds the threshold.

### Open questions

- Should the decoder sanitize anything? The HTML is self-written by Archify, but a malicious actor could craft a payload. Mitigation: only run decoder on dedicated hostname, set strict CSP on the decoder page.
- Versioning: if the template changes, do older share links still work? Yes — the link contains the entire old template inline, so it's self-contained. Decoder just `document.write()`s whatever's in the blob.

---

## 4. `diagram.yaml` intermediate format

**Effort:** L &middot; **Target:** v3.0.0 (architectural break, worth its own major version)

### What

Claude writes a structured YAML spec describing the diagram (components, connections, groups, positions, metadata) instead of one-shot HTML. A renderer (JS module) turns the YAML into the existing HTML template.

### Why

Today, every iteration ("move Redis to the left") triggers Claude to regenerate the entire HTML, which frequently shifts unrelated coordinates. A structured intermediate format unlocks:

| Capability | How it uses the YAML |
|---|---|
| Stable iterative edits | Modify one field; renderer preserves everything else |
| Version diffing | `git diff` on YAML is human-readable |
| Theme / palette re-render | One YAML × N themes = N HTMLs without re-prompting Claude |
| Mermaid / PlantUML import | Parser: source → YAML → HTML |
| Auto-layout via Dagre / ELK | Read YAML, recompute `pos`, re-render |
| C4 layer navigation | Add `layer: context / container / component` field |
| CI architecture diff bot | PR bot renders before.yaml vs after.yaml side-by-side as PNGs |

### Schema sketch

```yaml
meta:
  title: agmon
  subtitle: AI agent observability
  theme: dark           # dark | light
  palette: default      # default | cb
  viewBox: [1000, 680]

components:
  claude_code:
    type: external      # frontend | backend | database | cloud | security | messagebus | external
    label: Claude Code
    sublabel: AI coding agent
    pos: [40, 80]
    size: [140, 60]

  agmon_emit:
    type: backend
    label: agmon emit
    sublabel: hook stdin bridge
    pos: [410, 80]
    size: [150, 60]

connections:
  - from: claude_code
    to: agmon_emit
    label: "hooks (stdin)"
    variant: default    # default | emphasis | security | dashed

groups:
  - type: security-group
    label: "sg-name :port"
    contains: [load_balancer]

cards:
  - title: Security
    color: rose
    items:
      - OAuth 2.0 via external provider
      - TLS everywhere

footer: "T toggle theme · E open Export"
```

### How (phased)

**Phase A — Renderer only (no LLM changes).** `render.js` (plain JS, runs in browser or Node) reads a YAML file → outputs the existing HTML. Power users can hand-write YAML. Ships as a library + CLI; template still works standalone. Target: v2.6.

**Phase B — SKILL.md rewrite.** Claude produces YAML + a one-line "render this" note first, and the HTML second. Users iterate by asking Claude to modify the YAML; the renderer regenerates the HTML. Target: v3.0.

**Phase C (optional) — Expose the renderer as:**
- CLI: `npx archify render diagram.yaml > diagram.html`
- Cloudflare Worker: POST YAML → HTML
- VS Code extension: side-by-side YAML → preview

### Tradeoffs

- **Pro:** Unlocks diffing, auto-layout, Mermaid import, C4 layers, CI integration — every backlog feature becomes easier.
- **Pro:** Claude output becomes more deterministic and reviewable.
- **Con:** Two artifacts per generation (YAML + HTML) is slightly more complex for first-time users. Mitigate by generating HTML inline in the chat as usual; the YAML is an artifact, not a required read.
- **Con:** Breaks the "generate → open → done" single-artifact promise — there's now a source-of-truth question. We'd need to be clear the YAML is canonical and the HTML is regenerable.
- **Con:** Renderer becomes the canonical implementation path. The current template.html stays, but it becomes a target rather than the source.

### Done when

- `render.js` can reproduce today's `examples/web-app.html` from a hand-written YAML.
- YAML schema documented in `docs/yaml-schema.md`.
- Claude, prompted via the updated SKILL.md, produces valid YAML that renders correctly.
- Re-theming (dark → light, default → cb palette) is a YAML edit + re-render, no re-prompt.
- `git diff` between two diagram YAMLs is actually readable.
- Backward-compat: hand-written or 2.x-generated HTML still works in a browser; it's just no longer the primary output format.

---

## Recommended order

1. **`?exportScale=N`** (S) — fills a gap left by v2.3 at near-zero effort.
2. **Color-blind palette** (S) — CSS-variable system is already in place; high ratio of user impact to effort.
3. **gzip + base64 share** (M) — meaningful UX win for every sharing interaction.
4. **`diagram.yaml`** (L) — architectural; bundle under v3.0.

Features 1 and 2 are good candidates to ship together as v2.4.0.
Feature 3 is v2.5.0.
Feature 4 is v3.0.0.

---

## Not planned (declined or deferred)

| Idea | Why not |
|---|---|
| Zoom & pan | Browser native pinch / Cmd-scroll already works; minimal gain for significant code. |
| Auto-layout (Dagre / ELK) | Conflicts with hand-placed aesthetic; blocked on `diagram.yaml`. |
| Annotation / overlay mode | Pushes toward an editor, not a viewer. |
| C4 layer tabs | Blocked on `diagram.yaml`. |
| Diagram diff UI | Better as a companion CLI than template bloat. |
| Mermaid import | Can be addressed via SKILL.md prompt engineering first; full parser after `diagram.yaml`. |
| PDF export button | `Cmd+P → Save as PDF` already works, print stylesheet handles the rest. |
| Font-embedding in exports | `local()` fallback (2.2) covers the common case; full embed would add ~150 KB per generated file. |
