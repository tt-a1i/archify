# Levels documents (C4 drill-down)

A levels document binds several already-authored architecture diagrams into one
artifact so a node on one level can open the diagram that explains it. It is a
*document*, not a sixth diagram type, and it owns no geometry.

## When to reach for it

Use levels when one canvas would need more than roughly 14 nodes to stay
readable, or when the user asks for C4 levels. The node ceiling is real: the
showcase profile enforces a 6px minimum projected node text size at a 1440x620
reading width, which caps a single canvas at about 14 components. Splitting the
system across levels is the supported answer; shrinking type is not.

Do not reach for it to avoid layout work. Four sloppy levels are worse than one
considered diagram.

## Shape

```json
{
  "schema_version": 1,
  "diagram_type": "levels",
  "meta": { "title": "ST3 — C4 model", "output": "st3-levels.html", "quality_profile": "showcase" },
  "levels": [
    { "id": "context", "label": "Context", "source": "l1-context.architecture.json",
      "note": "Who uses the system and what it depends on." },
    { "id": "containers", "label": "Containers", "source": "l2-containers.architecture.json",
      "parent": { "level": "context", "node": "st3" } },
    { "id": "components", "label": "Components", "source": "l3-components.architecture.json",
      "parent": { "level": "containers", "node": "api" } }
  ]
}
```

`meta` accepts `title`, and optionally `subtitle`, `output`, `locale`,
`visual_preset`, and `quality_profile`. Each level entry needs `id`, `label`,
and `source`, and may carry a short `note`.

## Rules the validator enforces

- **Exactly one root.** The level with no `parent` opens first. Every other
  level names the level it is reached from and the component id it drills out
  of, and that component must actually exist in the named parent.
- **One child per node.** Two levels may not drill from the same parent node;
  the viewer would have no single truthful destination.
- **Reachable and acyclic.** Every level must be reachable by drilling from the
  root. Levels resolve in breadth-first order from the root, which is the order
  the renderer emits and the breadcrumb follows.
- **Contained sources.** `source` is manifest-relative POSIX. Absolute paths,
  backslashes, control characters, and `.`/`..` segments are rejected, and a
  symlink that resolves outside the manifest directory is rejected too.
- **Unique ids and sources.** Each level id and each source file appears once.

Every problem is reported at once, so fix the whole list rather than iterating
one diagnostic at a time. Diagnostic codes are documented in
`schemas/README.md`.

## Authoring guidance

**Declare the link on the child.** This is what keeps levels additive: a parent
level file never learns that it has children, so an existing architecture
diagram can be bound in unmodified. Never edit a parent to record a child.

**Keep cards per level**, in each level's own file. They describe that level,
and the viewer swaps them with the diagram. `meta.views` stays retired: a
levels document does not install a guided-view strip.

**Author each level to stand alone.** A level that would fail validation by
itself fails the whole document, and the fix belongs in the level file, not the
manifest. Each level must independently satisfy containment and the readability
floor at a 1440x900 desktop, because only one level is visible at a time.

**Do not duplicate a node's meaning across levels.** If a container level and a
component level both carry the same label and sublabel, the child level is not
adding information. Give the parent node the summary and the child the
mechanism.

**A node opens another drawing; it never grows into one.** There is no
expand-in-place and no cross-level automatic layout. Do not author a level
expecting the parent's geometry to make room for it.

## What the checks guarantee

A level's SVG inside a levels artifact is byte-identical to the same level
rendered standalone. Each level is rendered by the ordinary architecture
renderer in its own process, after the same layout, composition, and
readability checks, so binding levels together cannot buy a weaker guarantee
than shipping them separately.

`check-render-output` inspects every level rather than the first: a four-level
document runs the full artifact suite four times, plus two document-level
checks (`levels_identified` and `levels_single_active`). Composition totals
merge across levels and the receipt carries a per-level breakdown.

Delivery freezes the level sources beside the manifest snapshot, so the
committed artifact is built entirely from frozen bytes and the receipt's
specification hash covers the manifest that named them.

## Reading a levels artifact

The viewer adds a breadcrumb rail above the diagram. It shows the path from
the root to the level on screen, and an **Open** group listing the levels
reachable from here.

- **Drill in:** click the magnifier badge in the node's top-right corner. It is
  an explicit control, so one click is enough. Double-click anywhere else on the
  node, or Ctrl/Cmd+Enter with it focused, still works — a plain click on the
  body keeps meaning focus, because that interaction is already established.
- **Go back:** click the zoom-out control in the stage's top-right, which names
  the level it returns to. An ancestor crumb and Escape also work.
- **Deep link:** `#level=<id>` opens directly on that level and binds every
  reader surface to it. The root level carries no fragment.

A drillable node carries a `zoom-in` cursor, a restrained hover lift, and a
magnifier badge drawn into its top-right corner. The badge is an overlay: the
node's authored rectangle is read for placement and never rewritten, the badge
is focusable and activates on Enter or Space, and export removes it along with
the drill attribute. While a child level is on stage the container takes an
inset frame and the zoom-out control appears; both disappear at the root, and
neither is present in embed or presentation mode.

Switching levels is a change of canvas, so the viewer clears transient reader
state that belonged to the level you left — focus, reachability, the lens, a
route in progress, the finder and the radar — and returns the camera to
overview. Search, radar, route probing and export all rebind to the level on
screen; export serializes the level you are looking at, not the first one in
the file.

**Guided views stay retired.** Source diagrams may still carry the old
`meta.views` shape, and the levels manifest keeps a copy so the data is not
thrown away, but the viewer does not install a chapter strip. Do not author
views expecting them to appear.

## Size

The shared viewer template dominates artifact size, so levels are cheaper
together than apart: four levels in one document cost roughly 890KB against
3.2MB as four standalone artifacts.
