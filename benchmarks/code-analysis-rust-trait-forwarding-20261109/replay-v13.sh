#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
bench="$root/benchmarks/code-analysis-rust-trait-forwarding-20261109"
samples=/private/tmp/archify-batch-20261108/samples
cli="$root/archify/bin/archify.mjs"
zip_cli=/private/tmp/archify-v13-final-zip/archify/bin/archify.mjs
out="${1:?Pass a new evidence output directory}"
test ! -e "$out"
mkdir -p "$out"

python3 -B "$bench/run20-corrected.py" --cli "$cli" --samples "$samples" --out "$out/batch" --include-reserved > "$out/batch.log" 2>&1
python3 -B "$bench/run-closure-controls.py" --cli "$cli" --out "$out/closure-controls" > "$out/closure-controls.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/futures-io-waker-vectored-read.json" --require-templates --out "$out/futures" > "$out/futures.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/tracing-core-subscriber-event-enabled.json" --out "$out/reserved" > "$out/reserved.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/bytes-try-get-int.json" --require-templates --out "$out/bytes" > "$out/bytes.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$cli" --samples "$samples" --case "$bench/cases/tracing-layer-event-enabled.json" --out "$out/tracing" > "$out/tracing.log" 2>&1

python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --case "$bench/cases/futures-io-waker-vectored-read.json" --require-templates --out "$out/zip-futures" > "$out/zip-futures.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --case "$bench/cases/tracing-core-subscriber-event-enabled.json" --out "$out/zip-reserved" > "$out/zip-reserved.log" 2>&1
python3 -B "$bench/run-closure-controls.py" --cli "$zip_cli" --out "$out/zip-closure-controls" > "$out/zip-closure-controls.log" 2>&1
python3 -B "$bench/run-case.py" --cli "$zip_cli" --samples "$samples" --case "$bench/cases20/bytes-truncate-zero.json" --out "$out/zip-bytes-truncate-zero" > "$out/zip-bytes-truncate-zero.log" 2>&1
