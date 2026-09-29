# Archify Travel experiment

## Global precision explorer

Run `node labs/travel/serve.mjs` and open
`http://127.0.0.1:4319/world.html`. The itinerary header also links to this page
when served by the same server. This optional page uses locally bundled
MapLibre GL JS 6.11.2 (BSD-3-Clause; license in `vendor/maplibre/`). It is separate
from the existing offline itinerary renderer; loading that renderer does not
load MapLibre or request global tiles.

`data/package-catalog.json` is the package registry: delivery mode, coverage,
dependencies, source/license and availability. The bundled 110m Natural Earth
country outlines include actual size and SHA-256; online datasets have variable
viewport-dependent size, not an invented fixed download estimate.

- Default: local generalized world boundaries, no external requests.
- Detailed geography: OpenFreeMap/OpenMapTiles/OSM streets, parks and water.
- Buildings: optional provider building footprints extruded by `render_height`;
  data can include estimated heights, and coverage is not uniformly complete.
  This option enables detailed geography and renders at neighborhood zoom.
- Terrain: optional Mapzen Terrarium DEM tiles on AWS, real elevation at 1x.
  Mercator coverage is approximately ±85 degrees; resolution/source dates vary.
- Detailed textured landmark models: explicitly **not integrated**. The six
  original Paris illustrative landmarks remain in the itinerary view.

Online layers load only when Apply is clicked, then only for the current view.
Saved preferences do not silently enable remote data after reload. Source
failures are visible, with retry; a failed style fetch preserves the current
map. HTTP caching is controlled by the browser/provider. This is NOT a complete
offline world download or a durable region-cache implementation. Online sources
are provider-current snapshots, not pinned data releases. Production regional
archives, provider hosting/availability contracts and offline storage remain
separate work. No global itinerary generation or route-arrow overlay has yet
been connected to this separate explorer; `air-arc-v1` remains the contract
when that integration is added.

Sources: [OpenFreeMap](https://openfreemap.org/quick_start/),
[building schema](https://openmaptiles.org/schema/#building),
[terrain](https://registry.opendata.aws/terrain-tiles/),
[terrain attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
The map retains provider attribution. Live validation is opt-in:
`ARCHIFY_WORLD_LIVE=1` and `ARCHIFY_CHROME` with `node --test labs/travel/world.test.mjs`.
It exercises actual Paris building tiles and Alps elevation, layer removal,
offline initial loading, failure fallback and narrow layout. It does not claim
to exhaustively validate coverage of every country or building.

Open `index.html` directly in a browser. No server, key, network request, live
installation, or account is required. The prototype is on `labs/travel`, after
merging `upstream/labs/infinite-canvas` (`b5d06bb9`) into dev (`e023ea45`).

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
node --test labs/travel/travel.test.mjs labs/travel/travel3d.test.mjs labs/travel/trip.test.mjs
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

All data was retrieved on 2026-09-29 and bundled locally. `data/sources.json`
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
