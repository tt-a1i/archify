# Visual evolution round 7: live presentation without a slide DSL

## Question

How can Archify become more useful in meetings and shared reviews without turning a diagram schema into a presentation-authoring system?

## External patterns reviewed

- [Structurizr presentation mode](https://docs.structurizr.com/ui/diagrams/presentation) removes surrounding application chrome so the diagram canvas can carry a talk; Escape exits the mode.
- [Structurizr animation](https://docs.structurizr.com/ui/diagrams/animation) uses progressive reveal to tell a bounded story over one diagram.
- [Structurizr keyboard shortcuts](https://docs.structurizr.com/ui/diagrams/keyboard-shortcuts) treats presentation, animation steps, zoom, and Escape as first-class viewer behavior.
- [LikeC4 views](https://likec4.dev/dsl/views/) gives named views stable identities that can participate in shareable URLs and presentation sequences.

## Product decision

Archify already has the more valuable primitive: typed named views over stable semantic IDs. Round 7 therefore adds a **Presentation Stage around existing views**, not a second slide schema.

The stage:

- fills the viewport with the live diagram;
- keeps guided playback, focus, theme, and pan/zoom available;
- hides supporting cards and footer only while presenting;
- deep-links as `?present=1#view=<id>`;
- uses <kbd>F</kbd> to toggle and layered <kbd>Escape</kbd> behavior to unwind view/focus before exit;
- keeps embed mode authoritative and does not alter SVG geometry or export serialization;
- retains the contained 720px swipe surface for wide diagrams on phones.

## Why this boundary matters

A slide DSL would duplicate titles, sequencing, and focus data already present in `meta.views`, introduce another validation surface, and encourage authored presentations to drift from the architecture source. A viewer-only stage makes every existing diagram more useful while preserving Archify's single-file, zero-runtime-dependency output.

## Validation contract

- All five typed renderers emit the same stage controls and runtime.
- The initial HTML remains in normal mode unless `?present=1` is present.
- Presentation state lives outside the SVG, so canonical exports remain clean.
- Direct stage links preserve theme query parameters and named-view hashes.
- Desktop and mobile layouts must keep page overflow at zero and leave an obvious exit action visible.
