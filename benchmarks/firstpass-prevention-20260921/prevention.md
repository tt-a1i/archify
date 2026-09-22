# First-draft preparation experiment

Use the unchanged Skill and source inspection rules. This helper makes the
existing text-size and requirement-coverage planning observable before geometry.
It does not prove semantic completeness, source truth, readability or delivery.

While inspecting source, author the complete normal Architecture content in
`build.mjs`: component/relationship identity and meaning, evidence, boundaries,
views and useful cards. Put each component in an author-chosen `row` and `col`
instead of `pos`. Rows follow the actual main path and branches; cells are unique.
Choose cells only after the visible explanations are settled. Preserve distinct
roles and relationships. Supporting detail can live in a card or view note when
the diagram still explains the actual responsibility and relationship.

For each original task clause, record `coverage: [{clause: 1, anchors: [...]}]`.
Anchors are JSON pointers to the actual visible strings that explain the clause,
such as `/components/0/sublabel`, `/connections/2/label`, `/cards/0/items/1` or
`/meta/views/0/note`. Map every material part of a clause, including conditions
and exceptions; a general heading or a source link alone is not an explanation.
The helper checks that all clause indexes and referenced strings exist. You
still inspect the source and judge whether those words cover the requirement.

Use the helper once to produce the first normal candidate:

```js
import fs from 'node:fs';
import {nodeSize, edgeGap, writeDraft} from './tools/firstpass.mjs';
const task = JSON.parse(fs.readFileSync('./task.json', 'utf8'));
const draft = { /* normal Architecture JSON, components use row/col */ };
const coverage = [ /* every original clause with visible text pointers */ ];
// nodeSize(component) measures preferred 9px sublabels and 7px tags.
// edgeGap(label) reports the existing label-gap estimate.
fs.mkdirSync('output', {recursive:true});
fs.writeFileSync('output/initial-plan.json', JSON.stringify({draft, coverage}, null, 2));
const receipt = writeDraft('output/diagram.architecture.json', draft,
  {coverage, requirements: task.required});
fs.writeFileSync('output/preparation.json', JSON.stringify(receipt, null, 2));
```

`writeDraft` sizes each node, uses the widest node in each column and the tallest
in each row, and gives adjacent same-row connections enough estimated label
space. Optional `gapX` and `gapY` are clear gaps (defaults 112px). It keeps all
semantic fields and connections unchanged, and leaves routes automatic. It
rejects fixed viewBox, explicit positions/routes and occupied cells. Columns
and rows are ranked by their numeric values; skipped indexes do not add space.

Inspect the receipt's node-only width estimate and conservative projected
sublabel estimate; aim for comfortable text by choosing meaningful additional
rows when the content is wide. Those estimates exclude final routed-label and
boundary extents. They are advice, not a replacement for measured validation.

Run normal `finalize` with the task's source root. On a measured failure, repair
the emitted normal JSON using ordinary Skill rules and keep meaning intact.
This is an initial-write helper: it writes inside this workspace's `output/`,
rejects symlinked output directories and refuses to overwrite an existing file.
The timed task's repair/time limits apply to all work, including preparation.
