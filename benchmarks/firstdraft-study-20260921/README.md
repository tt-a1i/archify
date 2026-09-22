# First-draft feasibility study, 2026-09-21

Base: `7b9dd07f4ebbfe56dc7b9529afe919fabae85b4c`.

This is a local feasibility/falsification study, **not an end-to-end speedup**.
See [the result](../../docs/research-firstdraft-result-20260921.md) and
[machine-readable receipts](summary.json). No product default was changed.

## Grid preflight

From the repository root, with Node 22 and Python 3:

```sh
python3 benchmarks/firstdraft-study-20260921/grid_preflight.py \
  --skill archify --node node --out /tmp/archify-grid-preflight-new
```

The output directory must not already exist. It contains the exact candidates
and CLI receipts, including failures. A harness exit of zero means records were
collected; inspect each receipt's `ok` and `exit_code` for validation results.
Expected at the pinned base: three baseline passes; two default-grid passes;
production-deployment default-grid fails on partially overlapping boundaries.
Every non-geometry field must remain equal. The row/column mapping reuses original
coordinate ordering; it is not semantic auto-layout. Per-command timing includes
warmup/order effects and must not be used to claim speedup.

## Reproduce the OSS mechanisms

Use the verified release binaries listed in `summary.json`, without installing
them globally. Commands below are the underlying invocations; this study ran
them in an isolated macOS sandbox denying network and user-directory reads.
Clone the pinned public source revisions listed in `summary.json` into the
trial directory; no target package scripts or services need to run.

```sh
"$TRIAL/d2" --layout dagre --timeout 30 \
  benchmarks/firstdraft-study-20260921/web-app-core.d2 "$TRIAL/dagre.svg"
"$TRIAL/d2" --layout elk --timeout 30 \
  benchmarks/firstdraft-study-20260921/web-app-core.d2 "$TRIAL/elk.svg"
"$TRIAL/code2prompt" "$TRIAL/sources/polka" \
  --include packages/polka/index.js,packages/polka/package.json,packages/url/index.js,packages/url/package.json \
  --line-numbers --output-format json --output-file "$TRIAL/selected.json"
```

`TRIAL` denotes a disposable local directory containing those binaries and source
checkouts. No clipboard flag is used. Compare selected file identities, not just
success exit status. The four-file selection is not established as sufficient
architecture evidence. Estimated cl100k token counts are not model usage.

The D2 fixture preserves core node text and directed edge labels only. It omits
Archify boundaries, provenance, types/styles, views, cards and relationship
variants. Successful SVG rendering is not equivalent to Archify acceptance.
Initial newline-escaping and include-pattern mistakes were retained in the
local evidence archive and are identified in `summary.json`.
