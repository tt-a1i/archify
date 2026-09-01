# Brand marks

Use a brand mark only when a real product, provider, model family, channel, or
service identity helps the reader. Semantic `type` still explains what the node
does; `brand` explains whose product it is.

## Agent decision path

1. Search the built-in catalogue when the request names a recognizable brand:

   ```bash
   node bin/archify.mjs brands "Claude" --json
   ```

2. Put the returned canonical ID in the node, participant, or state:

   ```json
   {
     "id": "planner",
     "type": "backend",
     "label": "Claude",
     "brand": "claude"
   }
   ```

3. If the receipt returns `unavailable`, omit `brand` and keep the product name
   in `label`. Do not work around a bundled rights `HOLD` with a different alias.

4. If there is no catalogue match and the user supplied the official website,
   capture its icon explicitly:

   ```bash
   node bin/archify.mjs brands capture "https://partner.example.com" --json
   ```

   Put the command's digest-pinned `brand` value in the authored node:

   ```json
   {
     "id": "partner",
     "type": "external",
     "label": "Partner portal",
     "brand": {
       "url": "https://partner.example.com",
       "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
     }
   }
   ```

5. If there is no match and no user-provided URL, omit `brand`. Do not invent a
   URL or silently assign a visually similar company.

Known enabled-brand URLs resolve to the bundled vector instead of using the
network. Known held IDs, aliases, and URL strings fail as `brand/unavailable`.
Unknown URL capture accepts only bounded raster image formats, blocks
credentials, nonstandard public ports, and private or link-local destinations,
uses bounded concurrency and one total deadline, and returns the captured
content digest. Later render and validate operations require that exact digest;
blocked, unavailable, changed, oversized, or unsafe content fails closed instead
of silently changing the artifact.

The final artifact never fetches a brand asset when opened. Preset vectors and
digest-verified captured site icons remain embedded in SVG, PNG, WebP, JPEG,
Share Card, and WebM exports.

Use `node bin/archify.mjs brands --json` to inspect enabled canonical IDs,
aliases, categories, domains, provenance, and rights decisions. A direct query
also explains matching held entries. Enabled means present in this release, not
legally cleared or covered by Archify's MIT license; see
`THIRD_PARTY_BRAND_ASSETS.md`. Current categories cover AI, cloud,
engineering, data, collaboration, business systems, channels, languages, and
frameworks.
