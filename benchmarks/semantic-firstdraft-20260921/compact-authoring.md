# Compact Architecture authoring — experimental condition

This condition changes how you write the candidate, not what the diagram must
explain. Read the ordinary Skill, repository-authoring reference and
authoring-defaults. Their source, ownership, composition, routing, language,
repair and complete-finalize rules remain authoritative.

For this condition, this guide replaces only the initial example/field-shape
lookup in the Skill's Architecture Type router. Read a schema or another
reference on demand for a capability not described here. Examples are still
available. Do not inspect helper implementation before authoring.

## Write one source-grounded author script

After inspecting enough source to cover the requested behavior, write
`build.mjs` in your workspace and execute it there. The helper converts your
explicit decisions into ordinary Architecture JSON. It does not inspect source,
infer facts, choose component types, position nodes, size labels, route edges,
or remove content. Preserve all requested semantics and inspected evidence.

```js
import {node, edge, architecture, writeArchitecture} from './tools/author-kit.mjs';

// Shape only: replace all illustrative facts, coordinates and source ranges.
const spec = architecture(
  {title: 'Actual question', locale: 'en',
   repository: {url: 'https://github.com/owner/repository', revision: 'FULL_COMMIT'},
   views: [{id: 'main', label: 'A reader question', focus: ['caller', 'owner'],
            note: 'A concise source-grounded explanation.'}]},
  [node('caller', 'external', 'Caller', 'Actual boundary',
        [40, 200, 160, 70], ['src/entry.ts:20-24']),
   node('owner', 'backend', 'Actual owner', 'Actual responsibility',
        [400, 200, 180, 70], ['src/entry.ts:30-49'])],
  [edge('invoke', 'caller', 'owner', 'Actual invocation')],
  {cards: [{dot: 'cyan', title: 'Actual conclusion', items: ['Verified claim.']}]}
);
await writeArchitecture('output/diagram.architecture.json', spec);
```

`node(id, type, label, sublabel, [x,y,width,height], sourceRefs, extra={})`
preserves your explicit geometry and evidence. A source may be
`'repo/relative.ts:line-end'`, `'repo/relative.ts:line'`, or a normal source object.
Use an object when a source-reference label is useful. `extra` preserves other
ordinary node fields, but cannot override positional arguments.

`edge(id, from, to, label, extra={})` preserves relationship fields. Leave routing
automatic on the first draft, as the ordinary Skill requires. The optional
object can express ordinary variants, or a later diagnostic-driven repair.

`architecture(meta, components, connections, extras={})` supplies only
`schema_version: 1`, `diagram_type: 'architecture'` and a default
`meta.quality_profile: 'showcase'`. `extras` carries normal top-level fields such
as `boundaries` and `cards`. It must not override the required fields.

## Common schema constraints

The frozen baseline schemas remain the authority. These are format constraints,
not content quotas or targets:

- IDs: start with a letter; then letters, digits, underscore or hyphen.
- Node types: `frontend`, `backend`, `database`, `cloud`, `security`,
  `messagebus`, `external`. Nodes have no `variant` field.
- Relationship variants: `default`, `emphasis`, `security`, `dashed`.
- Boundaries: `{kind: 'region'|'security-group', label, wraps: [nodeIds]}`,
  with optional nonnegative `pad`. A boundary must express a source-backed fact.
- Guided views: `{id, label, focus: [nodeIds], note?}`. The existing schema
  permits at most 5; label length is at most 48 and note length at most 140.
- Source objects: `{path, line?, end_line?, label?}`. Lines are positive integers;
  path length is at most 240, reference-label length at most 48. The existing
  schema permits 1–3 references per component. Each actual claim still needs
  supporting evidence; these limits do not license omitted responsibilities.
- Cards: `{dot, title, items: [strings]}`; dot is `cyan`, `emerald`, `violet`,
  `amber`, `rose`, `orange` or `slate`.
- Keep `meta.viewBox`, subtitle, visual preset and engineering profile omitted
  under the same conditions as ordinary authoring-defaults. Node boxes and
  semantic edge-label gaps still require the same text-fit and readability work.

The generated JSON is the artifact of record. Run the complete ordinary
repository-backed `finalize` on it. A helper success is not schema, semantic,
layout or browser acceptance. For a repair, edit either the script and regenerate
or edit the JSON directly; keep one current candidate and all semantic content.
