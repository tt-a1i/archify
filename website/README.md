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

- `src/pages/*.astro`: five English pages and reusable Chinese route wrappers. Existing English file URLs remain available; the Chinese homepage builds as `zh.html`, with four pages under `zh/`.
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
npm run test:browser
```

CI builds/tests the website when website inputs change and on every main push. It uploads `website-dist`; the existing protected Pages deployment downloads that exact verified artifact. Build output, caches and staged assets are ignored by Git. Existing GitHub required checks and obsolete-deployment protection remain in place.

## Cloudflare Pages migration

The same source can build a second static site for `https://archify.si/`:

```sh
ARCHIFY_SITE_TARGET=cloudflare npm run build
ARCHIFY_SITE_TARGET=cloudflare node --test test/deployment-target.test.mjs
node scripts/check-cloudflare-output.mjs
ARCHIFY_SITE_ROOT="$PWD/dist-cloudflare" ARCHIFY_SITE_BASE='' \
ARCHIFY_SITE_INTEGRATION=1 ARCHIFY_CHROME="/path/to/chrome" npm run test:browser
```

This writes `dist-cloudflare/`; the default build still writes `dist/` for GitHub Pages. Cloudflare uses root asset paths, formal-domain sharing/canonical URLs, and a top-level `404.html` so unknown URLs do not silently return the homepage. Keep file-format pages: changing to directory-format pages would change the base used by relative proof and asset links. Pages redirects `.html` routes to extensionless routes; verify the actual Pages preview, especially `/gallery`, `/gallery.html`, `/gallery/`, standalone diagrams, query strings and fragments.

The `website` CI job verifies both artifacts. The optional `deploy-cloudflare` job runs only on `main` after the same test/package/manifest gates as GitHub Pages, rejects an obsolete source revision, and uploads the verified `website-cloudflare-dist` artifact. Enable it with repository variables `CLOUDFLARE_PAGES_PROJECT` and `CLOUDFLARE_ACCOUNT_ID`, plus secret `CLOUDFLARE_API_TOKEN` restricted to **Account / Cloudflare Pages / Edit** on the selected account. Never commit the token or put it in build artifacts.

When using a Git-connected Pages project, disable automatic production and preview deployments before enabling CI uploads, so Cloudflare does not publish an unchecked parallel build. A Direct Upload project can also receive these GitHub Actions uploads, but cannot later be converted to Git integration. Both approaches retain GitHub as the source and provide automatic deployment from the gated workflow. See [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) and [CI uploads](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

Cut over in this order:

1. Review the migration on `dev`, then promote only the reviewed migration to stable `main`; do not deploy the unrelated development feature batch as part of a hosting change. Record the stable source SHA and tested artifact.
2. Deploy and check the Pages preview: all five pages, mobile navigation, language/theme state, proof iframes and links, images, installation/download destinations and real missing-route 404s. Static hosting uses the free plan; no Functions, server, or paid China Network is required.
3. Add `archify.si` as a free Cloudflare zone. Inventory existing DNS records (including MX/TXT), registrar DNSSEC and DS records before changing nameservers; preserve records used by other services. Bind the root domain inside the Pages project, not only by adding DNS records.
4. Change only `archify.si`'s nameservers at Dynadot to the two assigned by Cloudflare. Keep registration and renewal at Dynadot. Verify authoritative DNS, active zone/domain status and HTTPS certificate issuance before changing public links.
5. Configure `www.archify.si` to redirect permanently to the root domain, preserving paths and query strings. Check both HTTP and HTTPS and avoid redirect loops. Keep the Pages preview available until formal-domain acceptance is complete.
6. Test the formal domain through actual mainland networks without a proxy. Record operator, location, time and observed page/resource behavior; tests through a local proxy or an overseas runner do not establish mainland availability. The current site also uses Google Fonts and links to GitHub, so validate the full user journey.
7. Only after acceptance, update README and repository website metadata. Social profile edits are a separate account action. Keep GitHub Pages and the old `skill-updates/archify/stable.json` endpoint available: existing installed Skills still request that URL. Do not change the Skill updater or install/update live Skills as part of this migration.

For rollback, disable the Cloudflare deployment variable and roll back to the last verified Pages deployment; keep the old GitHub site available. Record DNS before any cutover so changes can be reversed deliberately. Removing a project is not a rollback: first detach custom domains and their DNS records to avoid dangling destinations.

The migration visual receipt is in `test/evidence/visual-parity.json`. Full-page comparisons use identical browser/viewports and wait for fonts. Animation is frozen and iframe pixels are hidden in both versions; iframe files are instead verified byte-for-byte, and unmasked pages are inspected separately.

## Search and AI discovery

The ten main language pages contain their translated body text, metadata and recipe references before JavaScript runs. Language links navigate to real URLs; URL language takes precedence over stored preferences. Existing `?lang=` entry links migrate to the matching route and preserve other parameters and fragments. Guide drafts survive a language switch once in session storage, expire after 30 seconds, and are never placed in the URL or sent over the network.

`src/data/site-urls.mjs` defines the preferred `https://archify.si` URLs for both hosts. Each language has its own canonical and reciprocal `en`/`zh-Hans`/`x-default` links. GitHub Pages retains its `/archify` resource paths while pointing search engines to the official domain. Release identity and recipes come from this checkout: stable and development builds must not advertise each other's capabilities.

The build produces `robots.txt` and `sitemap.xml` from the ten pages and the curated gallery inventory. It checks each advertised artifact's original manifest hashes before adding an explicitly marked metadata block in the deployed HTML head; exported source files, SVG, scripts and updater bytes retain their existing contracts. Source JSON remains accessible and receives `X-Robots-Tag: noindex` on Cloudflare. GitHub Pages cannot set that response header. Robots rules allow crawling these evidence URLs so their indexing headers can be read.

After publication, verify the actual Cloudflare response, including any managed robots rules, redirects, sitemap URLs and headers. Submit the deployed sitemap to verified Google Search Console and Bing Webmaster Tools properties, then inspect real crawl and index results. Google AI controls, search impressions and Bing AI citation reports are separate account observations; successful builds and submissions do not establish rankings or AI citations. Avoid fabricated ratings, install statistics or daily sitemap modification dates. Search access and AI training permissions are independent decisions.
