#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
bench="$root/benchmarks/code-analysis-rust-trait-forwarding-20261109"
samples=/private/tmp/archify-batch-20261108/samples
baseline=/private/tmp/archify-template-baseline-20261109/archify/bin/archify.mjs
cli="$root/archify/bin/archify.mjs"
zip_cli=/private/tmp/archify-v12-final-zip/archify/bin/archify.mjs
out="${1:?Pass a new evidence output directory}"
test ! -e "$out"
mkdir -p "$out"
python3 -B "$bench/run20-corrected.py" --cli "$cli" --samples "$samples" --out "$out/batch" --include-reserved > "$out/batch.log" 2>&1
python3 -B "$bench/run-template-controls.py" --mode candidate --cli "$cli" --out "$out/controls" > "$out/controls.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --require-templates --out "$out/bytes" > "$out/bytes.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/futures-io-waker-vectored-read.json" --require-templates --out "$out/futures" > "$out/futures.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$baseline" --samples "$samples" --case "$bench/cases/tracing-layer-event-enabled.json" --out "$out/tracing-baseline" > "$out/tracing-baseline.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/tracing-layer-event-enabled.json" --out "$out/tracing" > "$out/tracing.log" 2>&1
python3 -B "$bench/run-template-controls.py" --mode candidate --cli "$zip_cli" --out "$out/zip-controls" > "$out/zip-controls.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --require-templates --out "$out/zip-bytes" > "$out/zip-bytes.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --case "$bench/cases/futures-io-waker-vectored-read.json" --require-templates --out "$out/zip-futures" > "$out/zip-futures.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --case "$bench/cases/tracing-layer-event-enabled.json" --out "$out/zip-tracing" > "$out/zip-tracing.log" 2>&1
