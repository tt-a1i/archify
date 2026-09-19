# Positions contract

Read this reference only when a diagram must say something the drawing does not
say: what a leg costs, where a stop links, what a kind means, which words the
reader sees, which stretch of the clock an axis covers, or what the reader may
write while reading. Shape belongs to the schemas; this page is what a position
does. One page: what may be declared, what a declaration decides, and what stays
untouched when it is absent.

## The positions

| Position | Written as | When declared | When undeclared |
|---|---|---|---|
| Facts | `nodes[].facts`, `edges[].facts` (up to 32 numbers per carrier) | a rule can read them; nothing else does | no number is stored |
| Rules | `meta.rules[]`, `kind`: `accumulate`, `window`, `sum`, `require`, `compare` | derives, renders through `{value}`, `{band}`, `{minutes}`, or checks | nothing is derived or checked |
| Words | `meta.labels` (key → string, up to 64 keys) | replaces renderer-owned copy at that exact key | renderer default, or the English fallback `meta.locale` allows |
| Kinds | `meta.types[]` (`id`, `label`, `color`) | the document names and colours its own `type` values | a kind draws with no document-declared name |
| Actions | `nodes[].links`, `edges[].links` (`label`, `href`, up to 3) | revealed on focus; the artifact never fetches an `http(s)` target | no action |
| Photos | `nodes[].media` (`href` as `https?://` or `data:image/`, optional `alt`) | shown on focus; a `data:` photo keeps the file offline | no photo |
| Line states | `meta.edgeStates[]`, `edges[].state` | paints the authored line, never a viewer copy of it | no state paint |
| Bands, naming | `meta.bands[]` (`label`, `from`, `to`, optional `id`) with `{band}` | a derived value gains a word for its stretch of the clock; costs no width | `{band}` resolves to nothing and is reported |
| Bands, placing | `phases[].from`/`to` as `HH:MM` | each stop lands under its own band, one column per band | authored `col` (and `fromCol`/`toCol`) stay in charge |
| Frames | `groups[].from`/`to` as `HH:MM` | the frame covers the stops the clock put inside it | authored `fromCol`/`toCol` stay in charge |
| Reader | `meta.reader` | the artifact accepts the input and view below | the artifact is read-only |
| Reader input | `reader.slots[]`, `kind`: `flag`, `point`, `text`, `time`, `minutes` | names the fields the reader may write | nothing can be written |
| Reader view | `reader.view.dim`, `view.stow`, `view.solo` | dims or folds what the reader already passed | every stop keeps full weight |
| Reader state | `reader.store` | keeps what the reader wrote inside a copy of the file | nothing is persisted, and nothing is written back to the document |
| Reader clock | `reader.clock` (`rule`, `anchor`, `at`, optional `dwell`) | replays the declared rule from the reader's own moment | the document's own numbers stand |
| Reader suppression | `reader.suppress: ["chapter_delta"]` | the chapter index keeps its non-delta copy, no delta attribute is written, and the delivery receipt records it | the delta copy behaves as it did |

Rules are skipped by default when they name a field nobody authored; asking for
strictness is explicit, with `missing: "error"`. A conflict is reported, never
resolved silently: `derive/missing-fact`, `derive/unknown-lane`,
`derive/unknown-seed`, `derive/seed-outside-lane`, `derive/band-not-declared`,
`derive/band-out-of-range`, `derive/limit-exceeded`,
`derive/render-slot-conflict`, and, on the band side, `workflow/band-clock`,
`workflow/band-order`, `workflow/group-extent-missing`,
`workflow/group-band-clock`, `workflow/group-band-empty`.

## The one decision the schemas cannot make

Bands can name a value or place it, and the two cost different things. A named
band rides with the moment and costs no width, which is what a document with
several stops in one stretch of the clock can afford. A clock-shaped axis makes
every stop land under its own band — true by construction — at one column per
band, which is worth its width only when the lanes genuinely share their clock.
Measure before choosing; the workflow renderer's [layout
contracts](../renderers/workflow/README.md#layout-contracts) own the geometry that
follows.

## Why this is safe to ignore

No field on this page is required. A document that authorises none of them
compiles exactly as it did before the positions existed, and two invariants hold
that across the whole surface, both re-runnable. `archify/test/undeclared-inert.test.mjs`
compiles every combination of the declarations above and asserts that a feature
appears if and only if it was declared. From a repository checkout,
`node scripts/fuzz-legacy-equivalence.mjs --base <rev>` compiles generated
documents that declare none of them against a base revision's compiler, byte for
byte. `node archify/test/golden.mjs`, run from the repository root, stays the lock
on every checked-in document.

Commands, receipt fields, and repair stages are documented once in
[the delivery contract](delivery-contract.md). The reader's own interface is in
[the viewer runtime reference](viewer-runtime.md).
