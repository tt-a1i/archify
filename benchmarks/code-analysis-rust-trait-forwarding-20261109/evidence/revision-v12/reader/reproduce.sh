#!/usr/bin/env bash
set -euo pipefail
# Reproduce only the two requested reader queries; no product edits or installations.
CLI=/private/tmp/archify-bytes-20261109/archify/bin/archify.mjs
OUT=/private/tmp/archify-bytes-20261109/benchmarks/code-analysis-rust-trait-forwarding-20261109/evidence/revision-v12/reader
TASK=${1:-all}
case "$TASK" in
  bytes|futures|all) ;;
  *) exit 2 ;;
esac
if [ "$TASK" = bytes ] || [ "$TASK" = all ]; then
  node "$CLI" code-analysis task --question 'Who calls the changed method?' --base-root /private/tmp/archify-batch-20261108/samples/bytes-try-get-int-base --root /private/tmp/archify-batch-20261108/samples/bytes-try-get-int-head --entry src/buf/buf_impl.rs --format json --out "$OUT/bytes-task.json" > "$OUT/bytes-cli.stdout.txt" 2> "$OUT/bytes-cli.stderr.txt"
fi
if [ "$TASK" = futures ] || [ "$TASK" = all ]; then
  node "$CLI" code-analysis task --question 'Who calls the changed method?' --base-root /private/tmp/archify-batch-20261108/samples/futures-io-waker-vectored-read-base --root /private/tmp/archify-batch-20261108/samples/futures-io-waker-vectored-read-head --entry futures-io/src/lib.rs --format json --out "$OUT/futures-task.json" > "$OUT/futures-cli.stdout.txt" 2> "$OUT/futures-cli.stderr.txt"
fi
