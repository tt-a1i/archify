# Story authoring

Archify provides two complementary story workflows:

1. **Viewer walkthrough attachment** (`story scan | draft | attach`): enhances a single native HTML diagram with in-Viewer playback, soundtrack synthesis, and offline 1080p WebM or MP4 export.
2. **Component choreography & standalone deliverables** (`story validate | svg | stage | video`): orchestrates one or more native diagrams (via a `story-choreography` JSON spec or an existing `<native.html> <brief.json>` pair) into dual-theme animated `.svg`, static `.still.svg`, interactive `.stage.html`, or direct headless-Chrome 1080p `.mp4`/`.webm` video.

## 1. Viewer attachment (`scan`, `draft`, `attach`)

```sh
node bin/archify.mjs story draft <native.html> <brief.json> --json
node bin/archify.mjs story attach <native.html> <brief.json> <enhanced.html> --json
```

`draft` writes the brief and `<brief-stem>.source.json`. Read the source map for
actual node IDs, connection IDs, directions, groups and legends, then replace
the outline with a complete brief in the user's language. To inspect without
writing files, use `story scan <native.html> --json`.

```json
{
  "version": 2,
  "title": "How a task reaches the worker",
  "intro": "Establish the whole path before following its handoffs.",
  "outro": "The queue separates accepting a task from finishing its work.",
  "scenes": [{
    "title": "Dispatch the work",
    "points": [{
      "anchor": "worker",
      "via": "dispatch",
      "title": "The worker receives the task",
      "text": "Explain this responsibility and its consequence.",
      "caption": "The queued task reaches the worker."
    }]
  }]
}
```

Give each area a distinct job:
- **Top (`scene.title`)**: chapter topic or central judgment; stable while points unfold.
- **Bottom (`point.caption`)**: narrate the current action and connect adjacent steps.
- **Side (`point.title`, `point.text`)**: explain responsibilities, conditions, branches, or scope.

Selection & motion rules:
- `anchor` selects a node; optional `via` selects an edge ID or array. Point or scene `action`: `trace` follows edges in order, `parallel` shows branches together, `relation` shows associations without live token transfer (default for `erd`, `class`, `tree`, `timeline`, `waterfall`).
- For code excerpts, pass `--repo-root <repository>` to `story attach`. Point `code` selects `node` (default: `anchor`), `source` index, optional `fromLine`, `toLine`, and `emphasis` line numbers within verified bounds (at most 20 lines).

Attached Viewer video export defaults to **WebM (VP9/Opus), 1080p at 60 fps**. The export menu offers WebM and MP4. Downloads stream via `showSaveFilePicker` when supported. Programmatic `Archify.story.exportVideo()` returns a Blob. Pass `{format: "mp4"}` to request H.264/AAC.

## 2. Component choreography (`validate`, `svg`, `stage`, `video`)

For multi-view choreography, component identity transitions, metric callouts, pinned code panels, or direct CLI `.svg`/`.mp4` output without modifying native HTML:

```sh
node bin/archify.mjs story validate <choreography.json> [--repo-root path] [--json]
node bin/archify.mjs story svg <choreography.json> <out.svg|stem> [--theme both|light|dark] [--still] [--repo-root path] [--json]
node bin/archify.mjs story stage <choreography.json> <out.html> [--theme light|dark] [--repo-root path] [--json]
node bin/archify.mjs story video <choreography.json> <out.mp4|out.webm> [--format mp4|webm] [--fps 30|60] [--repo-root path] [--json]
```

`svg`, `stage`, and `video` also accept the 3-positional single-diagram bridge `<native.html> <brief.json> <out>` to compile an existing brief into standalone SVGs, a stage player, or MP4/WebM video.
With the single-diagram bridge, `story svg diagram.html brief.json story.svg` writes the animated `story.svg` and the static first frame `story.still.svg`. Use `--theme both` to produce one pair per theme.

Minimal `story-choreography` spec (validated against `schemas/story-choreography.schema.json`):

```json
{
  "schema_version": 1,
  "title": "Queue handoff walkthrough",
  "preset": "classic",
  "views": [
    { "id": "arch", "type": "architecture", "input": "arch.json" },
    { "id": "flow", "type": "dataflow", "input": "flow.json" }
  ],
  "steps": [
    { "view": "arch", "title": "Ingress queues requests", "body": "API writes work items to the shared queue.", "focus": ["api", "queue"] },
    { "view": "flow", "transition": { "from": "arch", "shared": [{ "id": "queue", "subtitle": "Durable buffer" }] },
      "title": "Worker drains batches", "body": "Consumer reads from the queue and persists state.", "trace": { "edges": ["queue~worker"], "action": "trace" } }
  ]
}
```

Key capabilities & guardrails:
- **Views & callouts**: each view accepts a native `.json` schema input, rendered `.html`, or inline `diagram` object, plus optional `callouts: { "<nodeId>": { "text": "...", "tone": "accent|added|modified|removed|neutral" } }`.
- **Cross-view transitions**: `step.transition` morphs shared components smoothly from the preceding view (`id`, optional `targetId`, `label`, `subtitle`).
- **Declarative beat ops**: omit `duration` / `at` to auto-time steps, or supply explicit `duration` + strictly increasing `at` timestamps. Each step supports `enter`, `connect`, `fade`, `relabel`, `focus` (`center` or `left` when paired with `detail`), `trace` (`trace`/`parallel`), `metrics` (`before -> after`), and `detail` (`path`, `lines`, `highlight`, `selections`).
- **Timing**: automatic timing includes authored entrance/connection staggers and the complete trace. An explicit step duration cannot overlap the next step or exceed the story. In an intentional gap, the diagram holds its pose while the step's caption and code panel fade out. Returning to a view uses separate visibility windows on the same native layer.
- **Structural safety**: live `trace` tokens on static relation diagrams (`erd`, `class`, `tree`) require `allowStructuralTrace`; removed elements always reject live transfer tokens. Cited `detail` paths and line numbers are checked before emitting SVG, stage HTML, or video. Each view's repository revision also binds its code excerpts, including views supplied as native HTML.
- **Source revisions**: `detail.revision` accepts `head`, `base`, or a full 40-character commit SHA. The aliases use the owning view's repository pins; an omitted revision uses its head pin when present. Pinned excerpts require `--repo-root` and never fall back to workspace text. Unpinned excerpts read relative to `--repo-root` or the choreography directory. Every resolved excerpt is protected against output-path collisions.
- **Outputs**: `story svg` produces Camo-safe standalone dual-theme `<stem>-light.svg` and `<stem>-dark.svg` (plus `.still.svg` static keyframes for `--still` or `stills[]`); `story stage` produces a self-contained HTML player with 1080p60 batched MP4/WebM export; `story video` invokes headless Chrome to emit atomic `.mp4` or `.webm` files directly from the CLI.

The story palette follows the effective preset of the first declared view, or of the native diagram when using the single-HTML bridge. Code details accept up to 20 source lines. The Stage opens paused when reduced motion is preferred and still supports scrubbing, explicit playback, and video export. Standalone animated SVGs use a static overview under that preference.

Stage MP4 is video-only and requires an H.264-capable Chrome. Attached Story MP4 also includes AAC audio. Request MP4 with a `.mp4` CLI output, `--format mp4`, the Stage MP4 button, or `Archify.story.exportVideo({format:'mp4'})` in an attached Viewer. Unsupported codecs produce a format-specific error.

CLI publication is atomic per file. Multi-output `story svg` rolls back earlier writes if rendering or publication of a later SVG fails. If restoration is incomplete, the command preserves available copies of previous outputs and reports their recovery directory when present, in both plain and JSON diagnostics. Inspect those copies before retrying. Playback controls are locked during a Stage video export and restored, with the reader's position, on success, failure, or cancellation. Existing `story scan|draft|attach` commands remain available independently of choreography.
