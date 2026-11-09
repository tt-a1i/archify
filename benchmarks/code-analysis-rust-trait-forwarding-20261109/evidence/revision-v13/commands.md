# Commands and pins (v13)

Start commit: `3b09a193e` (v12 final, Draft #1297), with the v13 product and
benchmark changes uncommitted during these runs. Samples are the fixed
worktrees under `/private/tmp/archify-batch-20261108/samples`; the extractor
reads source and does not build the upstream projects.

```sh
cd /private/tmp/archify-bytes-20261109
CLI=$PWD/archify/bin/archify.mjs
SAMPLES=/private/tmp/archify-batch-20261108/samples
OUT=benchmarks/code-analysis-rust-trait-forwarding-20261109/evidence/revision-v13/final

# full module suite (469 tests)
(cd archify/modules/code-analysis && npm test) \
  > benchmarks/code-analysis-rust-trait-forwarding-20261109/evidence/revision-v13/module-tests-final.log 2>&1

# corrected original 20 cases
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run20-corrected.py \
  --cli "$CLI" --samples "$SAMPLES" --out "$OUT/batch" --include-reserved

# futures closure case, reserved tracing-core case, bytes, tracing
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$CLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/futures-io-waker-vectored-read.json \
  --out "$OUT/futures" --require-templates
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$CLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/tracing-core-subscriber-event-enabled.json \
  --out "$OUT/reserved"
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$CLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/bytes-try-get-int.json \
  --out "$OUT/bytes" --require-templates
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$CLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/tracing-layer-event-enabled.json \
  --out "$OUT/tracing"

# compiled closure control through the normal CLI
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-closure-controls.py \
  --cli "$CLI" --out "$OUT/closure-controls"
```

## Canonical ZIP

Homebrew Node 22.23.3 links zlib 1.2.12 and is rejected by the canonical gate.
The pinned official distribution was unpacked at
`/private/tmp/node-v22.23.2-darwin-arm64` (`v22.23.2`, zlib
`1.3.1-e00f703`).

```sh
export PATH=/private/tmp/node-v22.23.2-darwin-arm64/bin:$PATH
cd /private/tmp/archify-bytes-20261109
scripts/build-zip.sh /private/tmp/archify-v13-final.zip
scripts/build-zip.sh /private/tmp/archify-v13-repeat.zip
rm -rf /private/tmp/archify-v13-final-zip
mkdir -p /private/tmp/archify-v13-final-zip
unzip -q /private/tmp/archify-v13-final.zip -d /private/tmp/archify-v13-final-zip
npm ci --prefix /private/tmp/archify-v13-final-zip/archify/modules/code-analysis \
  --no-audit --no-fund

ZIPCLI=/private/tmp/archify-v13-final-zip/archify/bin/archify.mjs
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$ZIPCLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/futures-io-waker-vectored-read.json \
  --out "$OUT/zip-futures" --require-templates
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$ZIPCLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases/tracing-core-subscriber-event-enabled.json \
  --out "$OUT/zip-reserved"
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-closure-controls.py \
  --cli "$ZIPCLI" --out "$OUT/zip-closure-controls"
python3 benchmarks/code-analysis-rust-trait-forwarding-20261109/run-case.py \
  --cli "$ZIPCLI" --samples "$SAMPLES" \
  --case benchmarks/code-analysis-rust-trait-forwarding-20261109/cases20/bytes-truncate-zero.json \
  --out "$OUT/zip-bytes-truncate-zero"
```

Both builds and the tracked `archify.zip` are byte-identical: SHA-256
`179cdbdbab4c2fb015058a94dd2236f11b211c46bc63f0a43efaf4ee076d42cf`, 405 files.
The helper was rebuilt after the review fixes. On the next batch attempts, two
runs exited 2 with `extract/rust-parser-failed` at different cases (first case,
then `tracing-layer-event-enabled`) before saving query output. Running that
tracing case alone and then the complete batch succeeded. A ZIP reserved replay
earlier in this session also failed once and passed on retry. These are recorded
as Rust-tooling transients, not product results; the failed runs produced no
queries and are not included in any score.

## Answer completion after the reader

The reserved answer was frozen with four calls. After the final candidate run,
the independent reader found a fifth real call at
`tracing-subscriber/src/fmt/mod.rs:402`; it was verified in source and added.
With the completed answer the case is 4/5 with one known miss in both source and
ZIP runs. The earlier 4/4 result used the smaller frozen answer and is retained
as the frozen-answer measurement; it is not a product improvement.
