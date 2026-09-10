# Visual evolution round 17: Semantic Passport

## Reader problem

Archify can already find a node, frame its neighborhood, name incoming and
outgoing relationships, preview the exact edge, and play authored story paths.
The selected node itself is still under-explained. A reader sees a label and a
relationship count, but must inspect the canvas again to recover its technology,
responsibility hint, semantic type, and structural scope.

This is most visible on unfamiliar diagrams: `Approval Gate` is easier to
understand when the viewer immediately says `security · Policy Boundary · scope
+ consent`, and `Warehouse` is easier to place when it says `database · Store ·
analytics tables`.

## Primary-source patterns reviewed

- [LikeC4 React](https://likec4.dev/tooling/code-generation/react/) exposes
  `enableElementDetails` and `enableRelationshipDetails` as optional viewer
  capabilities. Detail belongs in the exploration surface rather than being
  painted permanently onto every node.
- [LikeC4 specifications](https://likec4.dev/dsl/specification/) treat title,
  description, technology, notation, and tags as separate semantic facts. One
  overloaded label is not expected to carry the whole model.
- [Structurizr's diagram viewer](https://docs.structurizr.com/server/diagrams/viewer)
  can toggle element/relationship descriptions and metadata on demand, and its
  navigation keeps structural level visible. The reader decides when secondary
  context should enter the frame.
- [D2 interactive diagrams](https://d2lang.com/tour/interactive/) use tooltips
  for secondary context so the diagram stays tidy. D2 explicitly frames this as
  a way to add information that is useful to some readers without making it
  permanently visible to everyone.

## Product decision

Add a **Semantic Passport** to the existing Relationship Lens instead of adding
a second inspector, modal, or schema-heavy documentation system.

Every renderer will project facts it already owns onto stable semantic SVG
attributes:

- semantic kind;
- sublabel/responsibility;
- authored tag;
- structural context (boundary, lane/phase, sequence role, stage, or lifecycle
  lane);
- stable semantic ID.

The focus lens will present those facts above the existing relationship list.
The Node Finder will use the same facts in search results, and each SVG node will
carry a native `<title>` so exported inline SVGs retain a lightweight tooltip.

The focus lens will also expose a `Copy focus link` action. It copies the
existing `#focus=<stable-id>` URL; it does not introduce a new share format or a
hosted decoder.

On narrow screens, the Passport is the default surface and the relationship
list moves behind an explicit `N relations` disclosure. The compact card is
placed above or below the selected node when space permits. Expanding the list
is deliberate, and following a relationship collapses it again for the newly
focused node.

## Borrow / skip boundary

### Borrow

- details on demand rather than permanently denser nodes;
- separate semantic kind, responsibility, tag, context, and identity;
- one discoverable action for sharing the current semantic focus;
- native SVG tooltip fallback that survives inline export.

### Skip

- a general metadata editor;
- arbitrary external URL fields in this round;
- a second modal/details sidebar competing with Relationship Lens;
- automatic layout or hierarchy inference from coordinates;
- hiding or rearranging geometry when details are shown.

## Validation contract

- The five renderers emit the same Semantic Passport attributes and native
  tooltip shape.
- Context is derived from authored structure, never guessed from pixel
  proximity.
- Passport UI remains viewer-only, outside canonical SVG export; native node
  titles and stable semantic attributes intentionally stay in inline SVG.
- Copying a focus link preserves query parameters and writes exactly one
  `#focus=<id>` fragment.
- Clipboard failure has a dependency-free selection fallback and visible status.
- Finder, focus, relationship preview, guided views, Semantic Camera, export,
  embed, print, and reduced-motion contracts continue to work.
- Desktop and mobile layouts keep the Passport readable without covering the
  selected node or introducing page overflow; mobile relationship disclosure is
  collapsed by default and keyboard-operable.
