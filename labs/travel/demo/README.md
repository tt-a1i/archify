# Shanghai and Paris travel demos

## Download and try

- [Download Shanghai ZIP (contains standalone HTML)](https://github.com/yijiez666-alt/archify/raw/refs/heads/labs/travel/labs/travel/demo/shanghai.zip)
- [Download Paris ZIP (contains standalone HTML)](https://github.com/yijiez666-alt/archify/raw/refs/heads/labs/travel/labs/travel/demo/paris.zip)

Download and extract the ZIP, then open its HTML in Chrome/Edge. GitHub serves raw
HTML as text, so the ZIP links above are the download entry points.
Each HTML file embeds the renderer, itinerary,
DEM and all three daily geometry blocks. No install, server, API key or network
is needed to explore it. Start with the workflow, click **3D 有高度**, then switch
between **全部行程** and individual days. Official venue links still need internet.

These screenshots show the checked-in Travel experiment, captured at 1440×1000
with Chrome/SwiftShader and style `illustrated-diorama-v11`. They are real browser
captures, not generated mockups. Capture source: `../capture-demos.mjs`.

Run `node labs/travel/serve.mjs`, open the printed address, then use these paths:

- Shanghai workflow: `/?destination=shanghai&view=flow#scene=journey`
- Shanghai overview: `/?destination=shanghai&view=3d#scene=journey`
- Shanghai day 1: `/?destination=shanghai&view=3d#scene=day-1`
- Paris workflow: `/?destination=paris&view=flow#scene=journey`
- Paris overview: `/?destination=paris&view=3d#scene=journey`
- Paris day 1: `/?destination=paris&view=3d#scene=day-1`

Overview arrows connect days only; daily scenes show individual stop connections.
Landmark models are illustrations. DEM height exaggeration is labeled; daily
building geometry may contain estimated heights. City detail coverage is limited
to the supplied snapshots. The host LLM authors itinerary JSON; the static browser
form only copies a request for that host and does not call a model itself.

## Shanghai

![Shanghai itinerary workflow](shanghai-flow.png)
![Shanghai three-day overview](shanghai-overview.png)
![Shanghai day-one diorama](shanghai-day-1.png)

## Paris

![Paris itinerary workflow](paris-flow.png)
![Paris three-day overview](paris-overview.png)
![Paris day-one diorama](paris-day-1.png)

## Reproduce

Set `ARCHIFY_CHROME` to a Chrome executable, then run:

```sh
node labs/travel/capture-demos.mjs
node labs/travel/build-demos.mjs
```

Data provenance is retained in `../data/` and exposed by the interactive viewer.
