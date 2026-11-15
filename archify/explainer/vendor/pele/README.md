# Vendored Pele

Pele 1.3.0 (MIT, <https://github.com/obsidianmd/pele>), from the npm tarball `pele-1.3.0.tgz` (sha256 `8c55d4f2335367c31e77550dfbbd00c99533c432b9323aa37730188c0a355da5`).

Only `dist/esm/core.js`, the chart diagram entries `pie`, `xychart`, `quadrantChart`, `sankey`, `radar` and `venn`, and the chunks they import are copied, unmodified. Explainer pages render these charts to static SVG while the page is built; no Pele code ships inside a delivered page.
