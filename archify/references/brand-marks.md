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

3. If there is no catalogue match and the user supplied the official website,
   put that HTTP(S) URL in `brand`. Archify fetches the site's declared icon once
   during rendering and embeds the bytes in the standalone HTML:

   ```json
   {
     "id": "partner",
     "type": "external",
     "label": "Partner portal",
     "brand": "https://partner.example.com"
   }
   ```

4. If there is no match and no user-provided URL, omit `brand`. Do not invent a
   URL or silently assign a visually similar company.

Known-brand URLs resolve to the bundled vector instead of using the network.
Unknown URL capture accepts only bounded image formats, blocks credentials,
nonstandard public ports, and private or link-local destinations, and uses a
short timeout. A blocked, unavailable, oversized, or unsafe icon becomes a
generic link badge; diagram generation still succeeds.

The final artifact never fetches a brand asset when opened. Preset vectors and
captured site icons remain in SVG, PNG, WebP, JPEG, Share Card, and WebM exports.

Use `node bin/archify.mjs brands --json` to inspect all canonical IDs, aliases,
categories, domains, and provenance. Current categories cover AI, cloud,
engineering, data, collaboration, business systems, channels, languages, and
frameworks.
