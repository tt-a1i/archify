# Sequence Renderer

Render `diagram_type: "sequence"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/sequence/render-sequence.mjs input.sequence.json output.html
```

The renderer validates input against `archify/schemas/sequence.schema.json`
with the bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses the required `meta.output` value
from the JSON file.

## Input

Sequence JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "sequence",
  "meta": {
    "title": "Cache Miss Request Sequence",
    "output": "cache-miss-request.html",
    "viewBox": [920, 760]
  },
  "participants": [],
  "segments": [],
  "messages": [],
  "activations": [],
  "cards": []
}
```

The timeline scales with the viewBox height: a taller `meta.viewBox` buys more
message room, a shorter one shrinks the readable band instead of clipping. A
complete worked example lives at
`archify/examples/cache-miss-request.sequence.json`.

The schema lives at:

```text
archify/schemas/sequence.schema.json
```

## Legend

The default visual legend derives kinds from `messages[].variant` (omitting
`variant` means `default`). Supported `meta.legend.entries` keys, in stable
order, are `emphasis`, `return`, `security`, `dashed`, and `default`. These are
visual message keys, not Semantic Lens controls; label/visibility overrides do
not create edge facts.

The legend sits below all timeline content: the last message and its note,
activation bars, and segment frames, with a 12px gap. Without `meta.viewBox`
the canvas height fits that content (no fixed 760px floor) and grows when late
messages need more room. With an authored `viewBox` that is too short,
`showcase` fails with the exact height to set, and `standard` hides the implicit
legend rather than drawing it over content. Lifelines stop above the legend.
Message labels use their line's color; gray default and return lines keep the
muted text color.

## Layout budget

| Constant | Value |
|----------|-------|
| viewBox | automatic height fits content + legend (minimum 327px readable band); taller when late content needs more room; automatic width packs to 560–800px for 2–3 short-label participants (4+ default 920; long labels still widen). Schema minimum `[480, 480]` |
| Participant boxes | `spread` (default): viewBox-relative width from 86px up to 190px; `fixed`: 86px wide; both 60px tall at y 72 |
| Participant columns | `fixed`: centers at x = 62 + index×108; `spread`: columns distribute across the available viewBox width with at least a 16px card gutter |
| Participant count | the last box must end at or before width − 40; layouts that cannot fit fail closed |
| Lifelines | from y 142 down to height − 65 (drawn to just above the legend); band must be ≥120px tall |
| Message `y` range | `[160, height − 83]` |
| Message spacing | ≥28px vertical between messages that share horizontal space |
| Arrow span | ≥60px horizontal between distinct participants |
| Self-message | Same `from` and `to`: a 42px-high orthogonal loop, right by default and left at the rightmost participant. Width follows the label at the active quality profile. The loop ends at or above `height − 69`; automatic height includes the full loop and wrapped note. Insufficient lane space fails as `sequence/self-message-space`; a loop outside the timeline fails as `sequence/self-message-timeline` |
| Self-message spacing | In shared horizontal space, leave at least 28px after the previous route ends, so the next label clears the loop (70px between unannotated self-call starts). Crowding fails as `sequence/self-message-overlap`; wrapped notes may require more space and use the existing note diagnostics |
| Message notes | 7px context text under the arrow (under the return leg for a self-message), visible at normal Read zoom (Map hides it without changing timeline geometry), wrapped at 11px line spacing inside one gap between neighbouring lifelines (the loop-side gap for a self-message; otherwise the widest gap the message spans; gaps within 0.5px count as equal and resolve to the left-most, where notes have always started), clear of activation bars; long unbroken text breaks after `/ . - ? & = # _`, otherwise at any character, so the full note is kept in every export. In `showcase`, a note that reaches a later message fails as `sequence/note-overlap` with the `y` that message needs, a note past the canvas content limit fails as `sequence/note-canvas-limit` with the `meta.viewBox[1]` it needs, and a segment label still covering a message label, route or note after its four upward steps fails as `sequence/segment-label-overlap`; each diagnostic names the source path and offers a verified `supportedFixes` edit when one exists |
| Segments | y pixel ranges with `to > from`, inside `[72, lifeline bottom + 20]` |
| Legend | last row baseline at height − 54; extra rows wrap upward and stay 12px below the timeline content |

`segments[].from/to` and `activations[].from/to` are y pixel coordinates, not
participant ids; activations also require `to > from`.

### Column fit

Sequence diagrams default to `meta.column_fit: "spread"`, whether or not
`meta.viewBox` is supplied.
Explicit `"fixed"` preserves the historical 86px boxes and 108px column gap.
To retain historical fixed coordinates, set `meta.column_fit: "fixed"` explicitly.
Use `"spread"` when a wide
viewBox would otherwise leave empty space on the right or when meaningful
participant labels do not fit the fixed 86px boxes. Spread derives box width
and column distance from the viewBox while preserving participant order,
lifelines, and message semantics. Participant cards retain at least a 16px
gutter. Narrow canvases that can fit those cards may reduce the left margin
from 62px down to 40px; ordinary canvases keep 62px and the right margin
remains 40px. Frames too narrow for those margins and gutters fail rather than
enlarge the authored viewBox.

The artifact checker reports `composition.sequenceColumnSpace` from the rendered
participants, routes and text. A large unused right-hand region in a fixed layout
can produce an `inspect-sequence-width` recommendation in `finalize`; it is advice,
not a new warning or failure. See [Sequence width review](../../references/delivery-contract.md#sequence-width-review)
for the bounded authoring repair and explicit-fixed preservation rules.

## Design Rules

- Use identical `from` and `to` IDs for work inside one participant. The loop
  turns right by default and left at the rightmost participant. Keep enough
  lane space for the complete label.
  Loops and their notes retain authored ownership, wording and time order.
  Notes on inward left-turning loops align toward their owner, rather than
  appearing beneath the previous participant.
- Put participants across the top, ordered by the story the reader should
  follow.
- Time moves downward.
- Use `emphasis` for the main request path.
- Use `security` for auth, consent, permission, and policy calls.
- Use `return` for quiet response messages.
- Use `dashed` for async trace, event, logging, and non-blocking work.
- Use segments as light background guides; keep segment labels short and keep each frame edge at least 4px off every message arrow. Check the complete wrapped note as well as its arrow before closing a phase. `validate` and `check` report crossings in `composition.sequenceNoteBorders` as review evidence, without blocking finalization. An offered `supportedFixes` edit extends only the named bottom edge; when no isolated edit fits, adjust the phase boundaries and message spacing together, preserving the full note and message order.
- Keep labels concise, but try `meta.column_fit: "spread"` before shortening a
  meaningful participant label just to fit the fixed boxes.

Schema violations exit non-zero with path-prefixed messages annotated with the
element's id or label. The renderer additionally fails when it can detect
layout problems, including missing participants, duplicate participant IDs,
participant labels wider than their box, unknown message endpoints, messages
outside the readable timeline, overly tight vertical spacing between messages
that overlap horizontally, invalid segment or activation ranges, or
participants that exceed the viewBox. The shared Clean Flow contract treats
participant headers as semantic boxes while explicitly allowing messages to
cross intermediate lifelines, activation bars, and segment frames. Text width is estimated CJK-aware:
fullwidth glyphs count as two units.

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
message X crossings then fail with `composition/proper-crossing`; default
`standard` keeps them as artifact-receipt warnings. Messages may still cross
intermediate lifelines. Collinear corridors remain outside the proper-X rule,
but a separate gate warns in `standard` and fails in `showcase` when unrelated
messages overlap for at least 8px. Shared semantic endpoints, point touches,
and shorter overlaps remain valid. Showcase also rejects any route segment
below 8px and any interior turn segment below 16px; ordinary 8–15px endpoint
stubs remain valid.
