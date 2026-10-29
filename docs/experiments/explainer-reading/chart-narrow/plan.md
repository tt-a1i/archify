# Chart-native narrow layout capability trial

Previous round disposition: progress, rejected default scrolling. Branch/remote 8ebc41afaa445ef3ad3ee3748e22e3646a4da3eb; dev5ecbd1bfdbf83ea747072112493c940e707569cb. Product runtime unchanged since2d7633e68ec5064cf02e3729db050dfa615f3f78. Goal remains active without a stop request.

Demonstrated problem: whole-SVG shrinking renders bar values at6.9px on390px. Native-width scroll restores10px but hides the key P99/600bar at first view. Prefer a comparison readers can see in one view.

New bounded hypothesis: the vendored renderer may already support useful narrow layout. Source inspection of Pele1.3.0 DKTLEL5E.js shows maxWidth; pie MSKIJHB2.js switches side legends to bottom when constrained; xy L4LY553T.js computes native plot width from maxWidth but also skips categorical ticks when narrow. This is actual code evidence, not an assumed API. The unchanged vendor README records package/version/tarball hash. Do not modify vendored minified code or install another library merely to run this trial.

First stage, <=25minutes: freeze branch runtime; compare existing pie, gzip bars and illustrative two-series latency plus a denser categorical counterexample using built-in maxWidth at332/292. Preserve current fontSize13 first; only add a second fontSize15 trial if a concrete readability result warrants it. Record source/data/category/value preservation and missing/overlapping visible labels, not only dimensions. Keep all generated variants outside product. Evaluate320/390/1440 screenshots only for candidates that preserve data/labels. Retain first failed attempt. No regression suite, ZIP or integration work unless a candidate earns adoption.

Fixed authored inputs, parent renderer capability exploration; no independent author/generation claims. Benchmark exemption recorded before runs: this trial changes frozen rendering options only and does not test the five-project generation pilot. No subagents needed for this fixed-input scope.

If native narrow layouts are useful, decide a separate simple implementation scope afterward. Do not assume universal compact defaults or duplicate mobile SVGs are acceptable. A general solution must preserve desktop and all supported chart types, static/no-JS reading, print/export, identifiers and authored values. Keep costs explicit; do not add a generic responsive rendering system without evidence. If the renderer loses labels, record the limitation and choose a smaller supported improvement or a different reading issue. No merge, release, live installation or remote PR messaging.
