# Archify Travel experiment

## Flowchart first

The travel UI opens with a daily workflow, compiled by Archify's existing
`compileWorkflow` renderer from the same stops used by the 3D diorama. Clicking
a node (or pressing Enter/Space) opens its destination in 3D with height; Disney
opens the separate park. Only “行程流程图” and “3D 有高度” are exposed. Legacy
flat-map internals remain for compatibility, without presentation controls.
Long descriptions and booking links are collapsed. `?view=3d` remains a direct
map link; absent/legacy view parameters open the flowchart.

This browser demo still selects curated Shanghai/Paris three-day plans. It does
not call an LLM or reproduce the full Agent-driven generation capability of the
Archify Skill. The shared workflow input adapter is `build-flow.mjs`.

The 2026-09-29 UI revision changes scene initialization and presentation only;
the approved materials, lighting, model geometry and air arrows are unchanged.
Paris and Shanghai screenshots and the cache pixel equality checks were used
to review the updated renderer fingerprint in `visual-lock.json`.

## Destination packages and stable style

Serve with `node labs/travel/serve.mjs`; open `index.html` or `world.html` over
HTTP (HTTPS outside localhost). The default entry now downloads only the selected
destination base plus shared renderer. Height/building data is fetched when
3D height mode is selected. The full standalone file is `offline.html`; it is
kept for portable use and compatibility tests and is never auto-downloaded.

`packages/manifest.json` pins content-addressed paths, sizes and SHA-256 hashes.
All package bytes are verified before use. The private Cache API store defaults
to a 64 MiB budget (UI: 5–256 MiB). LRU eviction skips active files and pinned
destinations; quota/storage failure keeps the verified download in memory and
shows that it is temporary. No P2P transport is used. The header's cache dialog
shows actual cached bytes, changes the budget and clears only eligible data.
Budget protection is best effort: existing active/pinned files may exceed a
newly reduced budget. Browser eviction or user-cleared site data can still
remove everything. Pinning is an app policy, not a browser persistence grant.

A service worker stores the small page shell; after successful installation and
package downloads, tested cached destinations reopen offline. Uncached cities or
height layers still need network. The server supports gzip, ETag revalidation
and immutable hashed assets. Deploy the shell, worker and packages together;
retain prior hashed releases for open clients. CDN/production hosting is not
configured by this local change. Coverage is still France, Paris and the Shanghai
sample, not a complete worldwide dataset or dynamic city extraction service.

The `illustrated-diorama-v1` preset, original models, fixed day palette and
`air-arc-v1` are versioned together. `visual-lock.json` detects changes to the
renderer/CSS/preset/arrow sources; changing its baseline needs explicit visual
review. Generated itinerary JSON records the style identity and fingerprint.
No theme/model/shader code is generated from prompts or supplied by city packs.
Same-browser regression compares canvas pixels after cache reload and itinerary
regeneration. Different GPUs/fonts/browsers can still differ at the pixel level.

## Illustrated diorama levels

Open `world.html` to choose France, Paris or the Shanghai Lujiazui sample and
one of three presentations: 2D illustration, rotatable 3D without heights,
or 3D with artistic landmark/building heights. The conventional MapLibre map,
remote tile layers and dependency have been removed at the user's request.
All three modes retain the same sourced geometry and pastel illustration style.
This is not global city coverage or real DEM terrain. The approved air-arc-v1
route style remains unchanged for Paris.

Shanghai's bundled `data/shanghai.json` is an ODbL derived OSM snapshot:
1,774 building footprints, 2,445 road line runs and 35 clipped closed water
polygons. Each building retains its OSM ID and height provenance. Missing
heights default to 12 metres before artistic scaling; floors estimate 3 m each.
The three Wikidata coordinates are CC0; the procedural landmark models are
original illustrations. The rectangular floor is a viewport, not a city boundary.
Regenerate the snapshot with `prepare-shanghai.mjs` and the OSM / Wikidata JSON
inputs; its exact query and OSM timestamp are embedded in the committed data.
Normal builds are offline and use the committed snapshot.

## Scope

- Metropolitan France and Corsica: Paris, Lyon, Nîmes and Nantes.
- Paris: all 20 arrondissement polygons and six located landmarks.
- A sentence entry point supports the curated France/Paris three-day itinerary.
  This is a local, bounded prototype, not a general LLM planner. Other destinations
  and durations report that no new plan was generated. The optional start date
  flags museum weekday closures; it does not check tickets or reschedule bookings.
- Click a day to filter and frame its route; click a timetable stop to focus its
  landmark. Export the itinerary as JSON or the 3D map and timetable together as PNG.
- Country/city switching, atlas-wide search, category/day filters, accessible
  landmark buttons, details, URL state, a local saved list and SVG download.
- Default 3D mode: locally bundled Three.js, extruded geographic boundaries,
  original landmark meshes, orbit, tilt, pan, zoom, top view, reset, optional
  auto-rotation and PNG export. Switch to 2D at any time. Browsers without
  WebGL 2 automatically retain the 2D atlas.
- The existing `viewer/viewer-camera.js` is embedded at build time. Pan, fit,
  pointer-centred zoom and resize continuity are shared with Archify, not copied
  into a separate camera implementation.
- Zoom changes the travel layer's arrondissement numbers and supplementary
  labels. The original engineering diagrams keep their authored text visible.

The travel model is deliberately separate from the five stable diagram schemas.
This experiment does not add unsupported fields to the production CLI. It is a
travel atlas with an OSM street backdrop and three walking-route previews.
Routes follow a selected OSM way graph; nearest graph nodes are not verified
entrances. Dashed endpoint connections are illustrative. Estimates use 4.2 km/h
and exclude endpoint gaps, waits and walking inside attractions. This is not
turn-by-turn navigation: node barriers, accessibility, turn restrictions and
live closures are not modeled. Only Paris currently has a detailed city view. Ground coordinates are
real; SVG and 3D landmark art is original and decorative, not a building footprint.
Landmark models and terrain extrusion remain artistic. Along-route buildings
use OSM footprints with tagged height, estimated floors or a 12 m default,
then a capped artistic vertical scale. Complex building relations/holes are
excluded from this first backdrop; it is not a complete city reconstruction.
An equirectangular local projection with midpoint-latitude correction preserves
location relationships at each scene's scale. It is not a surveying projection.

## Build and check

From the repository root, after installing `archify/` development dependencies:

```powershell
Push-Location labs/travel
npm ci --ignore-scripts
Pop-Location
node labs/travel/build.mjs
node labs/travel/build.mjs --check
$env:ARCHIFY_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test labs/travel/travel.test.mjs labs/travel/travel3d.test.mjs labs/travel/trip.test.mjs labs/travel/packages.test.mjs
```

Set `ARCHIFY_TRAVEL_EVIDENCE` to an output directory to retain desktop country,
city and narrow-screen screenshots. Browser tests exercise actual generated
HTML. The app uses the browser's local storage only for its saved list; it still
works if storage is blocked. 3D inputs: left drag or one finger to orbit,
wheel or two fingers to zoom, right drag to pan, arrow keys to pan when the
canvas is focused, and R to reset. Auto-rotation is opt-in and rendering pauses
when the document is hidden. 3D browser tests use Chrome's software WebGL.
2D camera inputs: right/middle drag or
Space+left drag, ordinary wheel to pan, Ctrl/Cmd+wheel to zoom, and toolbar
buttons. The narrow layout provides the same buttons and touch/pen panning;
native two-finger pinch is not implemented by this experiment.

## Data and attribution

Source snapshots were retrieved on 2026-09-29 and bundled into versioned local packages. `data/sources.json`
records provenance, download endpoints and licenses. `data/places.json` records
each Wikidata entity and its coordinate at retrieval time.

- **Natural Earth**, 1:50m Admin 0 Countries. Public domain. `france.geojson`
  retains the original France rings for metropolitan France and Corsica, with
  overseas polygons excluded. [Source](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson),
  [terms](https://www.naturalearthdata.com/about/terms-of-use/).
- **© Ville de Paris, Direction de l'Urbanisme**, Arrondissements, ODbL.
  `paris-arrondissements.geojson` is the downloaded dataset without geometry
  edits. The bundled database remains available under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
  [Dataset](https://opendata.paris.fr/explore/dataset/arrondissements/).
- **Wikidata**, P625 coordinates, CC0. [License](https://www.wikidata.org/wiki/Wikidata:Licensing).
- **© OpenStreetMap contributors**, ODbL. `data/trip.json` includes route
  coordinates, OSM way IDs, a street backdrop, 343 nearby simple building rings,
  the source timestamp and transformation notes. This derived database is
  available under [ODbL](https://www.openstreetmap.org/copyright).
  Rebuild it with `node labs/travel/prepare-trip.mjs roads.osm.json core.osm.json`.
  Inputs are Overpass `out geom` snapshots: the core bbox is
  `(48.85,2.285,48.872,2.365)` with highways, buildings, building parts,
  parks and water; roads add `(48.871,2.289,48.878,2.31)` around the Arc.
  The original downloads and queries from this run are in `out/city-map-size/`.
  Input regeneration from live OSM may change the output; normal builds use the
  committed snapshot and do not query a service.

The generated page, SVG and PNG exports retain source attribution. Three.js
is MIT licensed; its license is embedded in the generated HTML. No online map
tiles, stock images or external fonts are loaded. Editorial descriptions are
original suggestions with suggested visit times, not confirmed reservations.
Official opening/booking links are provided per stop; weekday closure guidance
was checked on 2026-09-29. No live inventory or transport service is connected.
Extend the atlas by adding sourced GeoJSON, verified coordinates and
editorial metadata, then rebuild and exercise both scene and filter behavior.

The 3D itinerary now uses one elevated arc and one screen-space arrowhead per
stop pair. These indicate visit order, not road geometry. The 2D view and walking
distance estimates retain the OSM routes. Map extrusion is 60/72 scene units;
building heights use a more visible artistic scale, with shadows. No DEM or
measured terrain elevation has been added. The 3D browser regression and exported
image were checked after this change (`out/travel-air-tests.log`,
`out/travel-air-evidence/france-three-days.png`).

## Shanghai three-day itinerary

The local curated Shanghai template covers Oriental Pearl → Lujiazui → SWFC
(exterior), a full Disneyland day, and Yu Garden → Bund. Stops retain sourced coordinates. Disneyland uses a separate OSM park view
with an original symbolic castle anchored to its OSM footprint; it is not an
official attraction or navigation map. The general
Shanghai view shows the central-city stops; day buttons, the day select and
schedule stops switch between views. Shanghai arrows indicate order only; no
road routing, verified transit duration, ticket inventory or dated opening
confirmation is implied. Official reference links accompany available stops.
Both Shanghai and Paris retain the fixed air-arc-v1 arrows and three display
levels. PNG export includes the selected view and itinerary; JSON exports the
current destination plan.

## Disney park geography

The map heading now links directly to day 2; legend day titles are also buttons.
Disney uses OSM boundary way 494725605, 211 in-park road runs, 174 building
footprints and 13 closed water surfaces. The same illustrative castle is anchored
to the OSM castle footprint center (way 494348161), replacing the generic park
coordinate. Its shape and proportions remain artistic, not a surveyed model.
Snapshots are in `data/disney.json` under ODbL; regenerate using
`prepare-disney.mjs` and the recorded Overpass inputs. Edge-crossing buildings,
complex relations and water polygons are omitted. This is not an official park
map, verified pedestrian route or live attraction/queue dataset. Park geography
is included in the Shanghai base and park buildings in its height layer.
The visual lock was reviewed for scene/data wiring and navigation additions;
materials, landmark geometry, lighting and air-arc-v1 remain unchanged.
