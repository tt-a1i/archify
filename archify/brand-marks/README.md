# Built-in brand marks

Archify ships a bounded catalogue of 107 commonly used brands for architecture,
workflow, sequence, data-flow, and lifecycle nodes. The mark is optional authored
identity: it never replaces the node's semantic `type`, color, label, or
relationships.

Most vector paths and brand metadata are generated from Simple Icons 16.28.0.
The OpenAI mark is traced to OpenAI's official brand guidelines. Every generated
entry records its source and, when available upstream, its guidelines and license
metadata in `renderers/shared/generated-brand-marks.mjs`.

Brand names and logos may be trademarks of their respective owners. Simple
Icons' CC0 license covers its collection work, not every underlying trademark or
artwork. Contributors must review the recorded source, current brand guidelines,
and intended referential use before adding or updating a mark. Archify does not
imply sponsorship, endorsement, or partnership.

Edit `catalog.json`, then regenerate the committed zero-runtime-dependency bundle:

```bash
npm run generate:brand-marks
npm run check:brand-marks
```

Do not hand-edit `renderers/shared/generated-brand-marks.mjs`.
