# Bundled Viewer catalogs

`manifest.json` enrolls the catalogs that `meta.locale` selects automatically.
The renderer reads only the files listed there, relative to this installed
directory. It never scans this directory, the working directory, or anywhere
else for language files.

`en.json` is the canonical message set and the final fallback. Every other
catalog is validated against it per key: a missing, unknown, or
placeholder-mismatched entry falls back to English and is reported when that
locale is rendered. A new UI key may therefore ship in English first.

Each message resolves as: valid `meta.translations` value → selected bundled
catalog → English. See [the authoring contract](../references/authoring-contract.md).

To enroll a language, add its complete catalog here and one manifest entry.
No renderer or schema change is needed. Locale tags match case-insensitively;
region and script variants (for example `zh-Hant`) are distinct tags and are
never collapsed onto another catalog.

| Locale | Origin | Review status |
| --- | --- | --- |
| `en` | Archify source strings | Canonical |
| `zh-CN` | #108 | Maintained with the renderer |
| `zh-TW` | kevinlincg | Complete; OpenCC `s2twp` conversion hand-reviewed for Taiwan terminology; not independently native-reviewed |
| `es` | Juan Pablo Tamayo (#457, moved to data in #586) | Complete; not independently native-reviewed |
| `ko` | uygnoey (#457) | Complete; not independently native-reviewed |
| `ar` | jahfaliabdulrahman-dev | Complete: 486/486 keys with placeholder parity checked mechanically; not independently native-reviewed |
| `ru` | uygnoey (#457 example catalog) | Complete: 516/516 keys with placeholder parity checked mechanically; count-neutral `.other` wording; UI fit reviewed in the bundled Viewer; not independently native-reviewed |
| `pt-BR` | GabrielMesquitaOliveira | Complete: 542/542 keys with placeholder parity checked mechanically; based on `examples/locales/pt.json`, completed and copy-edited for Brazilian Portuguese with AI assistance; UI fit checked in the bundled Viewer; not independently native-reviewed |

Completeness checks prove key and placeholder coverage, not native wording,
plural grammar, right-to-left layout, or glyph coverage.

The Arabic catalog localizes copy only. Reader text/chrome direction and scene
geometry are unchanged; full RTL support is tracked in [#935](https://github.com/tt-a1i/archify/issues/935).
Route/reach export summaries and reach controls use count-neutral labels within
the existing `.one`/`.other` model. Other counted messages still have that
model's Arabic plural limitations.

The Russian catalog uses the singular at `{count} = 1` and count-neutral
`.other` labels (for example `Узлов: {count}`) because the two-form model has no
Russian few/many categories. This avoids ungrammatical counted nouns such as
`2 узлов`; full Russian plural rules remain a model limitation.

Other reusable, unenrolled examples live in `../examples/locales/`; supply
them through `meta.translations`.
