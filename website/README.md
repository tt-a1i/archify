# Archify website

The public website is an independent Astro + React + TypeScript project in this repository. It builds static files for GitHub Pages at `/archify/`; it does not add dependencies to the distributed Skill.

## Development

Use Node.js 22.12 or newer (CI uses Node 22).

```sh
cd website
npm ci
npm run dev
# Open the printed local URL with /archify/ appended.
npm run check
npm run build
npm test
npm run preview
```

TypeScript stays on the supported 6.x line because the Astro checker currently requires its programmatic API.

## Source ownership

- `src/pages/*.astro`: the four website pages, retaining `index.html`, `gallery.html`, `guide.html`, and `start.html` URLs.
- `src/layouts/SiteLayout.astro` and `src/components/Navigation.astro`: shared document and navigation.
- `src/components/Brand.tsx`: shared server-rendered React identity; no unnecessary hydration is shipped. Future interactive React components can opt into Astro client directives.
- `src/components/GalleryCard.astro` and `src/data/gallery-presentation.mjs`: shared gallery presentation. The existing artifact builder imports the same card renderer and curated case metadata.
- `src/data/site.ts`: version and content derived from the Skill package, canonical recipes and validated gallery manifest. Do not paste generated recipe JSON into pages.
- `src/styles/` and `src/scripts/`: the original page styles and behavior, preserved for migration parity. Tailwind utilities use `tw:` prefixes and omit Preflight so existing CSS classes and variables retain their behavior.
- `public/`: new website-only static files. Existing `docs/` assets remain canonical because README links, standalone cases, update manifests and artifact tooling already use them. `scripts/stage-public.mjs` stages only Git-tracked files, rejects symlinks and URL collisions, and never modifies source files (stage new static assets with `git add` before previewing them); Astro owns the four top-level pages.

`docs/index.html`, `docs/gallery.html`, `docs/guide.html`, `docs/start.html` and the legacy page templates remain compatibility/visual baselines in this migration. They are **not** the deployed page source. Do not implement website features in those snapshots. The legacy builders still support artifact generation and existing integrations; the production website reads the underlying shared data directly. When deliberately changing the design or content in a later PR, review and update the baseline assertions explicitly rather than silently refreshing them.

## Validation and publishing

`npm test` compares the built DOM, original CSS, text, scripts and accessibility attributes with the migration baseline and verifies byte-identical preservation of every existing non-page public file. Generated recipe JSON is compared semantically.

The existing real Chrome integration suite can run against the built site, including its `/archify` deployment prefix:

```sh
ARCHIFY_SITE_ROOT="$PWD/dist" ARCHIFY_SITE_INTEGRATION=1 \
ARCHIFY_CHROME="/path/to/chrome" \
node --test --test-name-pattern='real Chrome' ../archify/test/site-language-continuity.test.mjs
```

CI builds/tests the website when website inputs change and on every main push. It uploads `website-dist`; the existing protected Pages deployment downloads that exact verified artifact. Build output, caches and staged assets are ignored by Git. Existing GitHub required checks and obsolete-deployment protection remain in place.

The migration visual receipt is in `test/evidence/visual-parity.json`. Full-page comparisons use identical browser/viewports and wait for fonts. Animation is frozen and iframe pixels are hidden in both versions; iframe files are instead verified byte-for-byte, and unmasked pages are inspected separately.
