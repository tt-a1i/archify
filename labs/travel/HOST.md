# Travel input contract (version 1)

The host LLM authors JSON, then runs:

```sh
node labs/travel/render-journey.mjs input.journey.json output.html
node labs/travel/render-journey.mjs input.journey.json --check
```

No LLM credentials, endpoint or web backend is involved. Run from this checkout
with its development dependencies installed. Output is a portable HTML containing
the fixed renderer and all supplied data; opening it does not invoke a model.
The demo index uses separate integrity-checked day packages fetched only when
entering that day's 3D view. Portable generated HTML embeds those optional layers
but constructs only the active day's geometry and disposes the previous scene.

Required top-level fields:

- `version: 1`, `title`, original `prompt`, `preferences` (array of short strings).
- `places`: unique `id` (letters/numbers/underscore/hyphen), `name`,
  `coordinates: [longitude, latitude]`, coordinate `source` HTTP(S) URL,
  `icon` from the fixed allowlist. Optional `official` is an HTTP(S) venue URL.
- `days`: consecutive `day` numbers starting at 1, `title`, ordered `stops`.
  Each stop has `placeId`, `time` (suggested period, not a verified opening time),
  `duration`, optional `note`. A place may be revisited on different days;
  the compiler creates unique visit IDs so links remain unambiguous.

Optional `days[].geography`: `source` URL, `roads` (arrays of geographic points),
`water` (polygon rings), `buildings` (`coordinates` ring, positive numeric
`height` in meters, `heightSource`, e.g. `OSM height` or `estimated`). All
coordinates remain lon/lat. Cropping excludes out-of-block polygon footprints
and cuts road runs; this is a planning illustration, not a navigable road graph.
The host can supply public OSM/municipal data with attribution. No background
download or unverified fabricated geometry is performed by the generator.

Fixed model icons: `tower`, `museum`, `church`, `chapel`, `arch`, `pearl`,
`shanghai-tower`, `swfc`, `castle`, `garden`, `bund`, `skyline`. These are stylized
symbols, not an unlimited photorealistic landmark library. For a new attraction
without an appropriate bespoke silhouette use `skyline` and describe it as a
generic illustration. Input must not contain CSS, shaders, scripts or new models.

Resource limits: 32 MiB input, 1–120 days, 1–48 stops/day, 1500 distinct places;
these are explicit resource guards, not a three-day or city restriction.
Flowchart rows wrap after six stops. Day colors cycle through the locked palette.
The overview retains every visit, connects consecutive visits across day borders,
and uses one common geographic projection for all coordinate anchors. Do not
rearrange places into a schematic grid. Model dimensions remain illustrative. Daily square blocks use local projection,
including correct longitude unwrapping around the date line. Landmark heights are
artistic. Overview/daily modes both use `air-arc-v1` arrows.

The command validates data and compiles the workflow; its receipt does not assert
coordinate truth, venue availability, booking status, or visual review. The host
must research those facts and perform browser checks before making such claims.

Water rings crossing a tile boundary are clipped instead of dropped. The overview
keeps the available sourced water outlines, while omitting streets and buildings.
Shorelines, muted surface texture and cutaway soil colors use the fixed v7 style;
texture and cutaway layers are illustrative, not DEM terrain heights or geology.

Optional top-level `elevation` adds coarse relief to the **whole-trip overview**:
`{bounds:[west,south,east,north],columns,rows,values,source,attribution}`. Values
are sourced elevations in meters, row-major from northwest to southeast; each
dimension is 2–129. Bounds must cover the full padded square, not only its stops.
Unwrapped east longitude up to 540 is allowed across the date line. Never invent
heights. The renderer resamples to 65×65 vertices, uses a fixed exaggeration rule
(1–80×, aiming for 60 scene units of relief) and labels the resulting factor.
No elevation input preserves the flat fallback. Daily geometry remains isolated.
For Shanghai/Paris snapshots see `prepare-elevation.mjs` and `data/*-elevation.json`;
source provenance and credits are included in the map and export.
