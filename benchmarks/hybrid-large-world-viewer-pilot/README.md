# Hybrid large-world Viewer pilot

This directory freezes the Workflow and Architecture 30/100/300 corpus and its artifact-bound browser evidence.

## Reproduce the functional evidence

```sh
node benchmarks/hybrid-large-world-viewer-pilot/generate-corpus.mjs
npm --prefix archify run generate:viewer

for input in benchmarks/hybrid-large-world-viewer-pilot/corpus/*.json; do
  stem=${input%.json}
  type=${stem##*.}
  name=${stem##*/}
  node archify/bin/archify.mjs render "$type" "$input" "benchmarks/hybrid-large-world-viewer-pilot/artifacts/$name.html"
done

for artifact in benchmarks/hybrid-large-world-viewer-pilot/artifacts/*.html; do
  case "$artifact" in *.visual-check.html) continue;; esac
  ARCHIFY_CHROME="/path/to/Google Chrome" node archify/bin/archify.mjs visual-check "$artifact"
done

node benchmarks/hybrid-large-world-viewer-pilot/summarize-evidence.mjs
node --test archify/test/large-world-corpus.test.mjs archify/test/large-world-evidence.test.mjs
```

`manifest.json` binds deterministic inputs. Each schema-3 visual-check receipt binds its HTML artifact by SHA-256 and records all eight light/dark desktop viewport observations. `ablation.json` records the required destructive mutations and their exact failing contracts.

The checked-in evidence establishes candidate-side functional correctness, fixed-stage independence, entry readability, sampled navigation backed by exhaustive canonical static proof, canonical SVG export completeness, and the need for a zoom cap above 3x. It does not contain the Goal's matched P0 base receipts, matched base/candidate P4 performance matrix, or a human Reader A/B study. The resulting decisions are therefore `technicalDecision: not-run: prerequisite-invalid` and `promotionDecision: evidence-incomplete`; the branch remains an experiment and makes no user-time or Issue #175 improvement claim.
