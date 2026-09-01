# Built-in brand marks

Archify tracks a bounded catalogue of 107 commonly used brands for architecture,
workflow, sequence, data-flow, and lifecycle nodes. The mark is optional authored
identity: it never replaces the node's semantic `type`, color, label, or
relationships.

The rights gate currently makes 63 marks renderable and places 44 known-conflict
assets on `HOLD`. A held ID, alias, or domain fails with `brand/unavailable`;
remove the `brand` field and keep the product name in the authored label. A
diagnostic may suggest an explicit, brand-neutral `capability`; these marks are
hand-authored Archify geometry covered by the repository MIT license and are
kept separate from brand paths, metadata, aliases, and domains. The
remaining marks are "enabled", not "approved" or "cleared". See `rights.json`
and the packaged `THIRD_PARTY_BRAND_ASSETS.md` for the exact boundary.

Unknown sites are handled by an explicit two-stage workflow. Run
`node bin/archify.mjs brands capture <url> --json`, then author the returned
digest-pinned `brand` value. Normal render and validate commands do not perform
an unpinned capture, and changed or unavailable content fails closed.

Most vector paths and brand metadata are generated from Simple Icons 16.28.0.
The OpenAI mark is traced to OpenAI's official brand guidelines. Every generated
entry records its source and, when available upstream, its guidelines and license
metadata in `renderers/shared/generated-brand-marks.mjs`.

Brand names and logos may be trademarks of their respective owners and are not
covered by Archify's MIT license. Simple
Icons' CC0 license covers its collection work, not every underlying trademark or
artwork. Contributors must review the recorded source, current brand guidelines,
and intended referential use before adding or updating a mark. Archify does not
imply sponsorship, endorsement, or partnership.

Edit `catalog.json` and `rights.json` together, then regenerate the committed
zero-runtime-dependency bundle:

```bash
npm run generate:brand-marks
npm run check:brand-marks
```

Do not hand-edit `renderers/shared/generated-brand-marks.mjs`.
