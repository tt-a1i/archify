# Visual Evolution Round 22 — Diagram Guide

Research date: 2026-07-19 (Asia/Shanghai)

## Reader gap

Archify artifacts now support focus, relationship inspection, search, route
analysis, overview navigation, guided stories, presentation, motion, and export.
The controls are compact, but a first-time reader still has to infer what
`PATH`, `MAP`, the finder glyph, and several undocumented keyboard shortcuts
mean. Feature richness becomes a liability when the useful actions are hidden
behind memory or documentation outside the artifact.

## Primary-source lessons

- [Neo4j Bloom's search bar](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/search-bar/)
  combines graph queries and interface actions in one discoverable suggestion
  surface, with pointer and keyboard activation. The useful lesson is to show
  graph tasks and their shortcuts together, not to copy Bloom's database-backed
  query language.
- [Neo4j Bloom's default actions and shortcuts](https://neo4j.com/docs/bloom-user-guide/current/bloom-appendix/bloom-appendix/)
  gives reader tasks such as Inspect, Path, Fit to selection, and Jump to item
  explicit action names alongside shortcuts. Archify should likewise describe
  outcomes instead of making users decode toolbar glyphs.
- [React Flow Controls](https://reactflow.dev/api-reference/components/controls)
  keeps frequent viewport actions in a stable compact control group and allows
  custom control buttons. Archify's existing diagram navigation should remain
  compact; a guide should open from it rather than replacing it.
- [yFiles' shortcut reference](https://docs.yworks.com/yfiles-html/dguide/interaction-shortcuts/)
  treats viewport control, graph navigation, and selection as first-class
  keyboard interactions. Its
  [interaction guide](https://docs.yworks.com/yfiles-html/dguide/interaction-support/)
  also states that mouse, touch, stylus, and keyboard paths belong to the same
  interaction system. Archify's guide therefore needs real buttons and working
  keys, not a static shortcut poster.

## Borrow / skip decision

### Borrow

1. Put high-value reader tasks and their keyboard accelerators in one surface.
2. Name actions by the question they answer: find, trace, orient, watch, present.
3. Derive the guide's node, relationship, and story counts from the compiled
   artifact so the orientation copy is truthful.
4. Make every primary guide row execute the existing production interaction.
5. Keep direct shortcuts active and make Escape return focus predictably.

### Skip

- No command parser, natural-language graph query, database action, editor
  command bus, user-configurable keymap, or dependency.
- No duplicated implementation of Finder, Route Probe, Semantic Radar, Story
  Trail, Presentation Stage, theme, export, or camera.
- No first-run popover that interrupts every artifact. The guide is deliberate
  help from `?`, not an onboarding tax.
- No schema, JSON IR, layout, or canonical SVG changes.

## Archify implementation

The viewer adds a `?` control and <kbd>?</kbd> shortcut for **Diagram Guide**.
The compact command deck reports exact semantic node, relationship, and guided
view counts, then exposes five outcome-oriented actions:

1. Find any node.
2. Trace a directed route.
3. See the whole system in Semantic Radar.
4. Play the authored guided story when one exists.
5. Enter Presentation Stage.

Each action delegates to the existing runtime instead of reimplementing it.
The footer records the broader shortcut vocabulary for Finder, Route Probe,
Radar, Story, Presentation, Export, Theme, and Reset. Arrow/Home/End navigation
works across action rows; Escape closes the guide and restores the trigger.

Opening the guide pauses active story playback and closes overlapping Finder,
Radar, and export surfaces without clearing semantic focus or an in-progress
route. On narrow screens the underlying Route Probe receipt temporarily
recedes. The guide is absent from embed, print, and canonical SVG export.
