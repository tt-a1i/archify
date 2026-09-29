# Archify Travel experiment

Open `index.html` directly in a browser. No server, key, network request, live
installation, or account is required. The prototype is on `labs/travel`, after
merging `upstream/labs/infinite-canvas` (`b5d06bb9`) into dev (`e023ea45`).

## Scope

- Metropolitan France and Corsica: Paris, Lyon, Nîmes and Nantes.
- Paris: all 20 arrondissement polygons and four located landmarks.
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
travel atlas, not a street map: the city base shows administrative boundaries;
day lines show editorial visit order, not roads, walking directions or travel
times. Only Paris currently has a detailed city view. Ground coordinates are
real; SVG and 3D landmark art is original and decorative, not a building footprint.
Extrusion and building heights are artistic, not measured terrain or buildings.
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
node --test labs/travel/travel.test.mjs labs/travel/travel3d.test.mjs
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

The generated page, SVG and PNG exports retain source attribution. Three.js
is MIT licensed; its license is embedded in the generated HTML. No online map
tiles, stock images or external fonts are loaded. Editorial descriptions are
original short suggestions; no prices, opening times or navigation claims are
provided. Extend the atlas by adding sourced GeoJSON, verified coordinates and
editorial metadata, then rebuild and exercise both scene and filter behavior.
