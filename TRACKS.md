# Tracks in Archify

This public development fork includes the `interval` renderer, bounded label placement, shared Archify presentation, and opt-in diagram/JSON editing. It is based on upstream `dev` at `68b77b73`. Upstream maintainer agreement and final integration evidence remain prerequisites for a final upstream PR.

## Setup and render

Use Node.js 22 and clone the Tracks branch:

```sh
git clone --branch paul/tracks-dev https://github.com/therealpaulschneider/archify.git archify-tracks
cd archify-tracks/archify
npm ci
node bin/archify.mjs validate interval examples/storage.interval.json --json
node bin/archify.mjs finalize interval examples/storage.interval.json /tmp/storage-interval.html --quality standard --json
```

Open the resulting standalone HTML in a browser. Append `?edit=1` to enable editing; download edited JSON and use it as the next CLI input. Changes in the browser do not overwrite your source file.

For agent use, load this checkout's [Archify skill](archify/SKILL.md). Use this checkout's CLI rather than an upstream installation without Tracks. The [authoring reference](archify/references/interval-tracks.md) links the schema and generic example and explains labels, arrows, coordinates, scaling, and validation. Tracks currently supports standard validation.

## Readability

Keep factual interval endpoints intact. Automatic placement tries interior positions, horizontal alternatives, and nearby external labels with leaders. Lane labels reserve a shared gutter; nearby guide captions may move while retaining a leader to their anchor. Inspect both light and dark themes and label ownership after rendering. Tall charts may scroll vertically; fitting an entire chart on screen does not take priority over readable text. The reader's font-size target is constrained by available viewport width.

## Contribution status

This fork is usable independently of upstream acceptance. Before an upstream PR is ready for final review, agree on the new type's scope with maintainers, stay based on current upstream dev, and pass the relevant CI and package checks. Use the source checkout above to ensure you run this fork. Upstream installation links install upstream Archify, which does not include this contribution.

## Verification scope

The current-dev port has local coverage for layout, CLI delivery and preview, deterministic viewer assembly, schema validation, locale catalogs and native paths. The extracted Node 22 ZIP passed the macOS package smoke check and validates the Tracks example without repository dependencies. Installed Chrome through Playwright verified themes, editor opt-in, JSON application and settled reader sizing after viewport changes.

These checks do not replace the full browser gate, upstream CI or package checks on other operating systems. Follow [CONTRIBUTING.md](CONTRIBUTING.md) before requesting final upstream review.
