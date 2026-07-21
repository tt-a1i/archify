<p align="center">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/31352?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-31352" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/31352" alt="Archify on Trendshift" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://tt-a1i.github.io/archify/gallery.html"><img src="docs/assets/archify-live-proof.gif" alt="Three verified Archify artifacts moving through Signal Flow, Blueprint, and Classic presets" width="960"/></a>
  <br/>
  <sub><strong>Three real generated artifacts.</strong> Signal Flow · Blueprint · Classic · <a href="https://tt-a1i.github.io/archify/gallery.html">open the interactive Proof Lab ↗</a></sub>
</p>

# Archify

**Generate beautiful architecture, technical workflow, sequence, data-flow, and lifecycle diagrams in chat. Switch dark / light. Add motion. Export crisp PNG / JPEG / WebP / SVG / WebM.**

Archify is an agent skill for Claude, Codex CLI, and opencode. It turns a plain-English description of your system or process into a polished, self-contained technical diagram — a single HTML file you can open, toggle themes on, copy to the clipboard, and export at maximum resolution.

- **No design skills needed** — describe your architecture in English, get a diagram
- **Workflow, sequence, data-flow, and lifecycle diagrams too** — technical flows, approvals, tool calls, CI/CD, runbooks, request call chains, data pipelines, PII boundaries, and state machines can be drawn
- **Built-in theme toggle** — one click between dark and light, persists across sessions
- **Three contract-backed visual presets** — keep the stable `classic` default, choose luminous `signal-flow` for demos, or use precise `blueprint` for deployment and design reviews
- **Semantic Sigils at a glance** — every renderer gives each frontend, backend, database, cloud, security, stream, external, and lifecycle node a small theme-aware inline SVG role stamp; no vendor logo pack, network request, or new schema field is required
- **Semantic Flow Tokens on real paths** — exact-edge previews carry a compact call, data, event, security, or lifecycle-state cue along the authored source-to-target geometry; the finite desktop reading aid respects Still/reduced motion and stays out of canonical exports
- **Semantic Story Carrier** — guided Story Beats reuse those same cues on the one exact authored relationship, so the camera move also communicates what is moving; labeled edges are deduplicated by stable identity, and passive embeds/Still/exports stay static
- **Control motion without losing meaning** — trace-enabled artifacts spend one finite ambient pass, settle back to their authored solid/security/async line styles, and expose one 44px `Live` / `Still` switch; Story, Route, Lens, and previews retain deliberate one-shot motion while `Still` pauses playback at a complete static reading
- **Read the right amount at every zoom** — `MAP` keeps the whole system quiet, `READ` reveals responsibilities and relationship labels, and `FULL` adds tags, notes, steps, and classifications; semantic focus reveals the exact detail it needs automatically
- **Discover the artifact without reading docs first** — press <kbd>?</kbd> for Diagram Guide: exact node, relationship, and story counts plus working actions for Find, Route, Radar, Lens, Story, and Presentation
- **Preview intent before committing** — hover or keyboard-focus any node to animate only its direct incoming and outgoing paths; click or press Enter to lock the same one-hop context into Semantic Passport
- **Inspect and play any real route** — press <kbd>R</kbd> or use `PATH`, search valid starts and reachable destinations, then inspect any stop or play one finite Route Journey over the exact shortest authored directed path before copying its endpoint-only `#route=` link
- **Trace and share named relationships directly** — hover or keyboard-focus any authored line to preview its real source, path, and target; click, tap, Enter, or Space pins that exact Lens row, and an optional authored relationship `id` makes it a durable `#relation=` link
- **Understand and share the focused node** — Semantic Passport shows its renderer-owned kind, responsibility, structural scope, authored tag, and stable ID; copy the existing `#focus=<id>` link in one click
- **Find any node fast** — press <kbd>/</kbd> to search labels, responsibilities, scopes, tags, kinds, or stable IDs; selecting a result resets the viewport, reveals it in a contained wide canvas, and opens the same shareable semantic focus
- **Choose, inspect, anticipate, play, and share a path-aware guided story** — a compact Story Shelf keeps Play and every named chapter visible while giving the cold overview back to the diagram, then expands the complete Director after deliberate entry; every Story Trail stop is a native beat control, and Story Horizon distinguishes the one exact next stop from farther future state
- **Follow the story without losing local context** — reader-started playback frames the previous, current, and next authored stops, settles before advancing, and yields immediately to pause, manual navigation, `Still`, or reduced motion
- **Let meaning drive the camera** — node neighborhoods, relationship jumps, Finder results, and guided-story steps smoothly frame themselves with safe padding; manual zoom or pan instantly takes control and pauses playback
- **Keep your bearings on large diagrams** — press <kbd>M</kbd> for Semantic Radar: a live, type-colored overview that shows the current viewport, focuses nodes by stable ID, and supports click, drag, and arrow-key desktop navigation
- **Compare system roles without losing the map** — press <kbd>L</kbd> for a counted Semantic Lens: select one kind to reveal its real traffic or two kinds to count only their direct authored relationships; a restrained direction signal travels only on those exact matched edges, and the stable `#lens=` view is ready to copy
- **Read exact legends as live maps** — architecture, workflow, and lifecycle type rows show compiled node counts; hover or keyboard-focus for a quiet topology preview, then click, tap, Enter, or Space to pin that kind in Semantic Lens; ambiguous edge and mixed-semantics legends stay honestly static
- **Share a chapter that explains itself once** — add `?play=1#view=...` to show its title, exact Story Trail route, live state, and progress on a readable per-beat cadence, then leave it still and readable; reduced-motion readers get the same chapter labeled `Still`
- **Enter Presentation Stage** — press <kbd>F</kbd> to give the live diagram the viewport, keep the story controls, and share the exact stage with `?present=1&play=1#view=...`; Escape unwinds the current view/focus before leaving the stage
- **Dependency-free pan and zoom** — inspect dense diagrams with the built-in view controls while exports remain clean, canonical full-diagram artifacts
- **Copy PNG to clipboard** — one click, paste straight into Slack / Notion / GitHub
- **Ultra-crisp image export** — PNG / JPEG / WebP rendered natively at up to 4× source resolution (no upsampling blur), or SVG for true vector
- **Shareable motion export** — trace-enabled diagrams record a six-second WebM directly in the browser, with no Puppeteer or ffmpeg dependency
- **SVG follows system dark/light** — exported SVGs ship with both variable sets + `@media (prefers-color-scheme)`, so dropping one into a GitHub README makes it follow the reader's color preference (no more two PNGs wrapped in `<picture>`)
- **Validation loop built in** — renderer-backed diagrams go through JSON schema validation and established layout checks; explicitly selecting `standard` or `showcase` also enables Clean Flow and structural border-run gates, while profile-less v1 files remain backward-compatible. `showcase` additionally rejects sub-8px route hooks, sub-16px interior turns, and unrelated X crossings without misclassifying ordinary endpoint stubs
- **Semantic tech labels** — describe components as `aws.lambda`, `postgres`, `redis`, `github-actions`, `openai`, etc.; Archify maps them to the right visual category without needing a full icon library
- **Self-contained HTML** — the generated file has zero dependencies, share by sending it
- **Iterate by chat** — "add Redis", "move auth to the left", "use emerald for the API"

![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-7C3AED?style=flat-square)
![Version](https://img.shields.io/badge/version-2.11.0-0891b2?style=flat-square)

**Project page:** [tt-a1i.github.io/archify](https://tt-a1i.github.io/archify/) · **Scenario guide:** [tt-a1i.github.io/archify/guide.html](https://tt-a1i.github.io/archify/guide.html) · **Generated proof gallery:** [gallery.html](https://tt-a1i.github.io/archify/gallery.html)

The project page puts real generated diagram canvas in the first viewport: one bounded, interactive proof rather than a mockup or rotating carousel.

**Start in 60 seconds:**

```bash
npx skills add tt-a1i/archify -g
```

Then ask your agent: `Use archify to map this repository's runtime architecture.`

## Preview

Same diagram, two themes, one click to switch:

| Dark | Light |
|---|---|
| ![Dark theme](docs/assets/archify-dark.png) | ![Light theme](docs/assets/archify-light.png) |

The Export menu — Copy PNG to clipboard plus static and motion downloads (all raster exports at up to 4× source resolution):

![Export menu](docs/assets/archify-menu.png)

Example file: [`examples/web-app.html`](examples/web-app.html). Download or clone the repository, open the file locally, then press <kbd>?</kbd> for Diagram Guide, <kbd>R</kbd> to probe a route, <kbd>/</kbd> to find a node, <kbd>M</kbd> for Semantic Radar, <kbd>L</kbd> for Semantic Lens, <kbd>F</kbd> for Presentation Stage, <kbd>T</kbd> to toggle themes, or <kbd>E</kbd> to open Export.

## Quick start

### 1. Install

```bash
npx skills add tt-a1i/archify -g
```

This installs Archify for supported agents through the open-source [`skills` CLI](https://github.com/vercel-labs/skills).

To try it without a permanent install:

```bash
npx skills use tt-a1i/archify@archify --agent codex
```

Replace `codex` with `claude-code` or `opencode` when needed.

### 2. Ask for one clear view

Start with an overview instead of asking one diagram to explain the entire repository:

```text
Analyze this repository, then use archify to create a high-level runtime architecture diagram.
Show 8–12 core components, one primary request or data path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
```

For a focused flow:

```text
Use archify to draw this login flow: Browser -> Web App -> API -> JWT validation ->
Redis session lookup -> PostgreSQL fallback. Make the cache-miss path secondary.
```

### 3. Refine in chat

Ask for focused changes such as `add Redis`, `move auth to the left`, or `highlight the rollback path` while the source JSON remains available in the session.

Archify returns a self-contained HTML file that opens in any modern browser and exports to PNG, JPEG, WebP, SVG, or WebM when trace motion is enabled.

## Diagram types

Choose the view that matches the question you need to answer:

Not sure which view fits? Use the [interactive scenario guide](https://tt-a1i.github.io/archify/guide.html), or ask the zero-dependency CLI. It recommends one of 11 bounded recipes and returns the required evidence, usage boundary, presentation settings, and a copy-ready prompt:

```bash
node archify/bin/archify.mjs guide "Show an API request with Redis cache miss"
node archify/bin/archify.mjs guide "Map Kafka topics, consumer groups, replay, and DLQ" --json
```

| Type | Best for | Include in your prompt |
|---|---|---|
| **Architecture** | Components, services, storage, boundaries | Scope, core components, primary path |
| **Workflow** | CI/CD, approvals, tool calls, runbooks | Participants, order, branches, exceptions |
| **Sequence** | API calls, cache fallback, auth, async traces | Callers, callees, returns, timing |
| **Data Flow** | Pipelines, lineage, PII, downstream consumers | Sources, transforms, stores, boundaries |
| **Lifecycle** | State machines, retries, waits, terminal states | States, events, retry and cancellation paths |

Architecture examples:

- [`examples/web-app.html`](examples/web-app.html) — compact SaaS architecture
- [`examples/archify-repo.html`](examples/archify-repo.html) — Archify's skill → JSON IR → renderer pipeline
- [`examples/archify-repo-grid.html`](examples/archify-repo-grid.html) — explicit `row` / `col` grid placement
- [`examples/maka-architecture.html`](examples/maka-architecture.html) — a third-party desktop agent workbench

Workflow uses swimlanes, a clear happy path, and restrained secondary branches.

![Workflow example](docs/assets/archify-workflow.png)

Sequence focuses on one interaction over time.

![Sequence example](docs/assets/archify-sequence.png)

Data Flow makes movement, transformation, and sensitivity boundaries explicit.

![Data Flow example](docs/assets/archify-dataflow.png)

Lifecycle separates normal progress, wait states, retries, and terminal outcomes.

![Lifecycle example](docs/assets/archify-lifecycle.png)

## Why Archify

- **Layout judgment over generic auto-layout** — the agent chooses hierarchy, spacing, routes, and emphasis for the story being told.
- **Typed JSON IR** — architecture, workflow, sequence, data-flow, and lifecycle diagrams use renderer-backed schemas.
- **Validation before delivery** — schema, layout, HTML, and SVG checks catch malformed or unreadable output early; after an explicit quality profile is selected, Clean Flow names exact node pass-through geometry and the composition receipt rejects structural border-riding, classifies final visible relationship crossings, separates endpoint stubs from cramped turns, and keeps bend/stretch evidence neutral until it is role-aware.
- **Portable output** — one HTML file, no server or framework required, with local font fallbacks when external fonts are unavailable.
- **Semantic technology labels** — names such as `postgres`, `redis`, `aws.lambda`, and `github-actions` guide visual categorization without a heavyweight icon runtime.

Archify is not a general-purpose drawing editor or a Mermaid theme. Its job is to turn technical intent into a polished communication artifact.

## Installation options

The primary installation command is:

```bash
npx skills add tt-a1i/archify -g
```

The same [`archify.zip`](archify.zip) can also be installed manually:

| Surface | Install location or method | Capability |
|---|---|---|
| **Claude Code** | `~/.claude/skills/` or `.claude/skills/` | Full renderer + validation workflow |
| **Codex CLI** | `~/.agents/skills/` or `.agents/skills/` | Full renderer + validation workflow |
| **opencode** | `~/.config/opencode/skills/`, `.opencode/skills/`, or `.agents/skills/` | Full renderer + validation workflow |
| **Claude.ai** | Upload `archify.zip` under Settings → Capabilities → Skills | Depends on Node.js access in the sandbox |
| **Project Knowledge** | Upload `archify.zip` to the project | Prompt-driven architecture mode only |

Manual installation means unzipping the archive into the matching directory. No `npm install` is required for the packaged skill.

## How it works

Renderer-backed diagrams follow a small, inspectable loop:

| Step | What happens |
|---|---|
| **Generate JSON IR** | The agent creates a typed description instead of hand-editing final SVG markup. |
| **Validate** | Bundled standalone validators check the schema without installing runtime dependencies. |
| **Render** | The selected renderer produces the HTML/SVG artifact. |
| **Check** | Layout and artifact checks catch invalid coordinates, malformed SVG, and unsafe routes. |
| **Iterate** | Targeted changes are applied to the JSON IR while unrelated structure stays stable. |

The packaged CLI exposes the same workflow. From a repository checkout:

```bash
cd archify
node bin/archify.mjs doctor
node bin/archify.mjs demo /tmp/archify-demo
node bin/archify.mjs guide "Show CI/CD checks, approval, deploy, and rollback"
node bin/archify.mjs render workflow examples/agent-tool-call.workflow.json /tmp/workflow.html
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --json
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --quality showcase --json
node bin/archify.mjs check /tmp/workflow.html
node bin/archify.mjs examples
```

Optional trace animation can be enabled for demos:

```json
{
  "meta": {
    "title": "Release Flow",
    "animation": "trace",
    "visual_preset": "signal-flow"
  }
}
```

`visual_preset` is optional: `classic` remains the stable default, `signal-flow` adds a luminous layered canvas and tighter motion styling, and `blueprint` adds a high-contrast drafting grid, squared review materials, and precise boundary treatment without changing geometry. Trace-enabled artifacts expose one `Live` / `Still` Motion Governor: ambient motion runs once, settles back to authored relationship styles, and yields to stronger semantic actions; `Still` pauses active Story playback without auto-restarting it, and the reader choice is remembered when browser storage is available. Dynamic `prefers-reduced-motion` and hidden-page changes use the same safe stop path; omit `animation` for a truly static diagram with no motion control.

Optional `meta.views` turns one stable overview into a short guided reading sequence. Each view contains a unique ID, label, an ordered list of existing semantic node IDs, and an optional note; it cannot move or restyle the underlying diagram. On the untouched overview, Story Shelf keeps the compact guided-view identity, Play, and every authored chapter visible while hiding director-only controls that cannot yet act; selecting a chapter, starting playback, or restoring a valid deep link expands the complete Director, while Show all or Escape returns to the shelf. A Named Chapter Rail exposes every authored label and two-digit position. Before selection, candidates truthfully read `=0 +N −0` from the overview; once a chapter is current, it keeps its stop count while every other candidate shows the exact `=stay +enter −leave` focus delta. Fine-pointer hover or keyboard focus applies that same static Chapter Delta Preview without changing the current chapter, camera, Story Trail, or URL; Escape dismisses it in place, while touch still activates on the first tap. Selecting a chapter delegates to the same guided-view state as previous/next and `#view=` links. When two chapters share a real stable-ID node, Shared Anchor Handoff holds that node in place, names the continuity, then settles one interruptible camera move; when none exists, Archify uses an explicit `no-anchor` retarget instead of inventing continuity. Story Beat Navigator renders every resolved ordered stop as a native control and classifies only the exact authored edge(s) between consecutive stops as forward, reverse, grouped, or multiple. Story Follow Camera frames the current authored window, while Story Director Strip names its exact route, edge label, responsibility, and context without inventing a relationship. Desktop Presentation playback keeps Previous, Next, and Pause but temporarily removes secondary story chrome, then restores it on pause. Direct activation pins that beat without changing the chapter, focus set, camera, scroll, or URL; one unambiguous edge may run one finite signal, and Play resumes the same beat's remaining dwell. **Copy moment** freezes playback if necessary and creates a stable `#view=<view-id>&beat=<node-id>` link; opening it restores that exact authored node without motion, while invalid beat IDs fail closed to the chapter. JSON, authored edge styling, SVG geometry, and canonical exports stay unchanged.

Story Horizon completes that reader-controlled sequence with a static `past → active → next → pending` hierarchy. It previews exactly one immediate next node and only the authored connector set already resolved for that step: grouped transitions add no edge, multiple transitions keep every real edge, and the final beat has no horizon. It does not pre-move the camera, add autoplay, or enter canonical export.

## Using the output

Open the generated HTML in a modern browser. The controls in the top-right provide:

- **Theme** — switch between dark and light. Shortcut: <kbd>T</kbd>.
- **Present** — enter a viewport-filling live stage without changing the diagram or export. Shortcut: <kbd>F</kbd>.
- **Export** — copy PNG or download PNG, JPEG, WebP, SVG, or a six-second WebM for trace-enabled diagrams. Shortcut: <kbd>E</kbd>.

Reading Depth starts at `MAP 100%` with primary labels and topology, moves to `READ 125%` for responsibilities and relationship labels, and reaches `FULL 175%` for tags, notes, steps, and classifications. Focus, Semantic Lens, Intent Trace, Route Probe, Story Trail, Direct Relationship Pin, and Relationship Preview reveal the exact local detail they need at any scale; print and export always retain the complete diagram.

Every authored relationship is also a direct entrance. Its invisible 24px non-scaling rail follows the exact visible geometry without widening the artwork. Fine-pointer hover or roving keyboard focus previews the real source, path, and target; click, tap, Enter, or Space opens the source Passport and pins the exact existing Relationship Lens row. Give important `connections`, `edges`, `messages`, `flows`, or `transitions` an optional author-controlled `id`: the pin then writes and copies `#relation=<id>`, restores the same authored relationship after array reordering, and keeps that identity in canonical SVG. Legacy ID-less relationships still pin locally and fall back to copying the source node—numeric runtime keys never enter a public URL. Duplicate authored relationship IDs fail validation. Stronger Focus, Story, Route, Lens, and Chapter states take priority, and runtime-only rails never enter embed, print, or canonical export.

The diagram itself is explorable. Before committing, hover a node—or reach it with keyboard focus—to start Intent Trace: unrelated elements recede while a short direction-aware signal previews only that node's incoming, outgoing, and self-loop paths. Touch readers skip hover and go straight to focus; reduced-motion readers receive the same static one-hop contrast. Press <kbd>R</kbd> or use `PATH` to start Route Probe: choose a source, then one of the highlighted reachable destinations, and Archify traces the deterministic fewest-hop directed route, frames it, names every stop in a compact receipt, and offers a copyable `#route=<source>~<target>` link. It never invents an undirected fallback, and reduced-motion readers receive the same static result. Click a node, or press <kbd>Enter</kbd> / <kbd>Space</kbd>, to lock its immediate neighbors and relationships in place. Semantic Camera frames that one-hop neighborhood without covering Relationship Lens. Semantic Passport immediately names the node's renderer-owned kind, responsibility, structural scope, authored tag, and stable ID; its Copy link action writes the current `#focus=<id>` deep link. The Lens names every incoming, outgoing, and self-loop relationship. On phones, its list stays behind an explicit relationship count so the compact Passport does not cover the selected node. Enter a row with a fine pointer—or reach it with Arrow keys, Home, and End—to dim the other connections and send one short source-to-target pulse over that exact authored path; incoming rows retain their real authored direction, the static edge and endpoints remain emphasized after the pulse ends, and reduced-motion readers receive that same static meaning immediately. Touch stays direct: one tap follows the relationship without a fake hover step. Activate the row to move the camera to the neighboring node. Press <kbd>M</kbd> to open Semantic Radar, a simplified type-colored overview with a live viewport rectangle; click a radar node to focus it, drag the surface or use Arrow keys to recenter, and press Escape to close it. The radar docks only while the diagram is visible, avoids the focused node and Passport when space allows, reports visible width on contained mobile diagrams, and remains outside embed, print, and canonical SVG output. Press <kbd>/</kbd> to open Node Finder and search the same labels, responsibilities, scopes, tags, kinds, or stable IDs; each result reports its context and relationship count, then resets and frames the selected node. Diagrams with guided views also expose Play/Pause, previous, next, and Show all controls. Their Named Chapter Rail reveals every authored label and exact chapter-focus delta up front; Left/Right/Home/End move focus and statically preview `stay / enter / leave` membership without changing the current diagram, activation delegates to the same `activeIndex` and `#view=` contract, and entering the rail pauses playback so the reader owns the next move. Escape removes only that preview and keeps focus in place. Story Beat Navigator turns every resolved Story Trail stop into a native control: click, tap, Enter, or Space pauses and pins the exact beat while the chapter, selected focus, camera, contained scroll, and `#view=` URL stay fixed. The receipt distinguishes a real forward edge, a reverse-authored edge, a grouped transition with no direct relationship, and multiple authored edges; only one unambiguous exact edge may run one finite signal. Keyboard focus alone pauses at the current playhead, and Play continues the remaining dwell from that beat instead of restarting the chapter. During playback, earlier beats settle, the current node and exact adjacent relationship stay strongest, future beats remain visible, and the next chapter waits for Shared Anchor Handoff to finish. Press <kbd>P</kbd> to play the full story or <kbd>[</kbd> / <kbd>]</kbd> to change chapters manually. A share link with `?play=1#view=<view-id>` instead plays only that named chapter once for 3.2 seconds, never auto-advances, and remains static for `prefers-reduced-motion`. In embed mode, a Share Chapter Cue names the view, prints its exact authored route, reports the current `Step NN / NN` plus Playing/Settled/Paused/Still state, and follows the same one-shot progress without entering the SVG or exports. Each chapter fits its authored nodes with bounded zoom and padding; manual zoom, pan, or mobile swiping pauses playback and takes control. Presentation Stage hides supporting cards and fills the viewport while preserving those live controls. Playback also pauses when the page is hidden or the reader starts exploring. <kbd>Escape</kbd> closes the radar or Route Probe first, then removes Chapter Delta Preview, unwinds the active guided view/focus, and finally exits the stage. Use <kbd>+</kbd>, <kbd>-</kbd>, and <kbd>0</kbd> to zoom or reset; drag the canvas while zoomed. Node focus is stored in `#focus=<node-id>`, authored relationship pins in `#relation=<relationship-id>`, probed routes in `#route=<source>~<target>`, and guided stories in `#view=<view-id>`. Export always uses the complete untransformed diagram.

A completed Route Probe also exposes Route Journey. Its native path chips, Previous, Next, Journey/Pause/Replay, and Overview controls preserve the whole shortest route while strengthening one ordered position and its exact incoming relationship. Playback starts only after deliberate activation, runs once, resumes the remaining dwell after pause, and yields to path focus, manual pan/zoom, Guide, page hiding, Motion Still, and reduced motion. Manual position inspection remains available without animation. Escape pauses first, returns to Overview next, and clears the route last. The shared `#route=<source>~<target>` remains endpoint-only and always restores to a still Overview rather than autoplaying.

While Route Probe is choosing an endpoint, <kbd>/</kbd>, the normal Finder control, or `Find start` / `Find target` turns Node Finder into a contextual endpoint picker. Source search omits dead ends; destination search contains only nodes reachable in authored direction and previews the shortest hop count. Escape closes Finder without discarding the in-progress route. Outside Route Probe, Finder keeps its normal semantic-focus behavior.

Press <kbd>?</kbd> or use the question-mark control to open Diagram Guide. It reads the compiled artifact and reports exact semantic node, relationship, and guided-view counts, then runs the existing Finder, Route Probe, Semantic Radar, Semantic Lens, Story Trail, and Presentation interactions from outcome-oriented task rows. Arrow keys, Home, End, direct shortcuts, and Escape all work inside the guide; opening it pauses playback and closes overlapping panels without clearing focus or an in-progress route.

Press <kbd>L</kbd> or use `LENS` to compare compiled semantic kinds without losing the map. Exact node-kind rows in architecture, workflow, and lifecycle legends also show their compiled counts inline: fine-pointer hover or keyboard focus gives a quiet preview of matching nodes, touching authored relationships, and connected peers; click, tap, Enter, or Space pins the kind and opens the same Lens. Sequence and data-flow legends remain static because their rows describe edge variants or mixed node/edge meaning rather than one exact kind. Every Lens kind shows its exact node count. One selection keeps its nodes, touching relationships, and connected peers readable; a second isolates and counts only direct authored relationships between the two roles. Only those exact authored paths receive a short, selection-triggered direction pulse: outgoing/forward, incoming/reverse, and within-kind traffic stay visually distinct without moving nodes or rerouting edges. The one-shot signal inherits the active visual preset, becomes static for reduced-motion readers, stays quiet above 24 matched edges, and is omitted in embed, print, and canonical export. Unrelated topology remains softly visible, closing the panel preserves the selection, and `#lens=<kind>~<kind>` restores it. Escape closes the panel before clearing its active selection.

| Format | Use it for |
|---|---|
| **Copy PNG** | Slack, Notion, GitHub comments, and quick reviews |
| **PNG / JPEG / WebP** | Slides, documents, websites, and print |
| **SVG** | READMEs, blogs, Figma, Illustrator, and lossless scaling |
| **WebM** | Product demos, release notes, social posts, and animated documentation |

Raster exports are rendered natively at the highest safe resolution, up to 4×. Oversized diagrams step down automatically to stay within browser canvas limits.

Exported SVGs include dark and light variables plus `prefers-color-scheme`, so one SVG can follow the reader's system theme.

Useful URL parameters:

- `?theme=light` or `?theme=dark` — force the starting theme.
- `?present=1` — open directly in Presentation Stage; combine with `?play=1#view=<view-id>` for a shareable live slide.
- `?play=1` — play the current named view once for 3.2 seconds, with a title/route/state/progress cue in embed mode, then stop; with no `#view`, play the first authored view. Never advances to another view and respects reduced motion.
- `?openExport=1` — open the Export menu on load.
- `#focus=<node-id>` — open with a semantic node and its one-hop neighborhood focused.
- `#relation=<relationship-id>` — reopen one exact authored relationship with a stable ID.
- `#route=<source-id>~<target-id>` — restore the shortest authored directed route between two semantic nodes.
- `#view=<view-id>` — open a named guided reading path defined by `meta.views`.
- `#view=<view-id>&beat=<node-id>` — open one exact, static Story Moment; add `?play=1` only when the remaining chapter should play once.

WebP, WebM, and clipboard support depend on browser capabilities. WebM is available only when the diagram uses `animation: "trace"`. The HTML uses local font fallbacks when an external font cannot be loaded.

## Prompt patterns

**Repository overview**

```text
Map this repository's runtime architecture with no more than 12 core components.
Show the main request path, external systems, and trust boundaries. Move implementation detail into cards.
```

**CI/CD workflow**

```text
Draw a CI/CD workflow: pull request -> tests -> approval -> build image -> staging ->
smoke test -> production. Show rollback as a secondary failure path.
```

**Data lineage**

```text
Draw a data-flow diagram from Web and Mobile events through Consent Gate, Kafka,
Warehouse, and Feature Store to Dashboards and ML consumers. Mark the PII boundary.
```

## Reference

Semantic labels guide color and grouping:

| Examples | Category |
|---|---|
| `react`, `nextjs`, `ios`, `browser` | Frontend |
| `node`, `go-service`, `python-worker`, `api-gateway` | Backend |
| `postgres`, `redis`, `s3`, `bigquery`, `snowflake` | Data and storage |
| `aws.lambda`, `gcp.pubsub`, `azure.functions`, `kubernetes` | Cloud and infrastructure |
| `auth0`, `oauth`, `vault`, `security-group` | Security |
| `kafka`, `rabbitmq`, `sqs`, `nats` | Messaging |
| `stripe`, `github-actions`, `openai`, `slack` | External systems |

See the [schema reference](archify/schemas/README.md) for renderer inputs and [CHANGELOG.md](CHANGELOG.md) for release history.

## Current status and roadmap

The current viewer includes progressive `MAP` / `READ` / `FULL` Reading Depth across all five renderer-backed modes.

Archify 2.11 uses typed JSON IR across all five renderer-backed modes and adds stable semantic hooks, shareable authored relationship IDs, pre-click Intent Trace previews, two-endpoint Route Probe analysis with a finite inspectable Route Journey, Semantic Camera framing, a live Semantic Radar overview, a Named Chapter Rail with Chapter Delta Preview, Shared Anchor Handoff, directly inspectable Story Beat Navigator controls, and Shareable Story Moment links, plus a reader-controlled Live/Still Motion Governor, Semantic Passport context with copyable focus links, a named incoming/outgoing Relationship Lens with exact path preview, searchable Node Finder navigation, one-hop focus, a shareable Presentation Stage, pan/zoom, Signal Flow motion, and browser-native WebM export. The project page now leads with three real, moving, clickable proof artifacts across Signal Flow, Blueprint, and Classic rather than a static product mockup. The [proof gallery](https://tt-a1i.github.io/archify/gallery.html) is regenerated from 11 checked-in scenario examples. Every recipe publishes a matching interactive artifact with three named reader views, its exact JSON source, seven validation checks, and a source digest instead of relying on hand-authored capability claims.

See [ROADMAP.md](ROADMAP.md) for planned work and design boundaries. Automatic Mermaid parsing, generic auto-layout, a hosted sharing service, and a WYSIWYG editor are not current goals.

## Attribution

Archify is a fork and rewrite of [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) v1.0 by Cocoon AI.

The original visual language remains credited to that project. Archify 2.x adds themes, export tooling, typed renderers, validation, accessibility, and the unified CLI. Both projects use the MIT license.

## License

[MIT](LICENSE) — free to use, modify, and distribute.

## Contributing

Issues, pull requests, and shared diagrams are welcome. When reporting generated-output problems, include the prompt, diagram type, and Archify version when possible. Run `node scripts/build-gallery.mjs` after changing bundled examples or the standalone viewer so the generated showcase stays current.
