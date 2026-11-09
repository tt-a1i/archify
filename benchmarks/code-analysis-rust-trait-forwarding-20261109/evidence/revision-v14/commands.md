# v14 commands and results (2026-11-09)

CLI under test: `/private/tmp/archify-bytes-20261109/archify/bin/archify.mjs`
(v14 working tree) and the unpacked canonical ZIP
`/private/tmp/archify-v14-final-zip/archify/bin/archify.mjs`.

## Source answers frozen first

1. Read the pinned tracing and ripgrep base/head worktrees and wrote
   `answers/tracing-dispatch-event.md`,
   `answers/ripgrep-ignore-ref-is-absolute-parent.md` and their case files.
2. Only then ran the normal CLI. Later corrections were limited to span
   convention (end-exclusive call ends and an inherent item's declaration
   start); no call, receiver, caller or target line changed.

## Candidate runs (v14 source tree)

```sh
cd benchmarks/code-analysis-rust-trait-forwarding-20261109
python3 run-case.py --cli /private/tmp/archify-bytes-20261109/archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --case cases/tracing-dispatch-event.json --out /private/tmp/archify-v14-probe/v14-real/tracing  # 3/3 pass
python3 run-case.py ... --case cases/ripgrep-ignore-ref-is-absolute-parent.json  # 0/1 gap
python3 run-case.py ... --case cases/futures-io-waker-vectored-read.json --out evidence/revision-v14/futures  # 2/2 gap
python3 run20-corrected.py --cli ... --include-reserved --out .../batch20        # 81/86, 5 missed, 0 wrong, 2 extras
python3 run-closure-provenance.py --cli ... --out .../provenance                 # provider 2, caller 0
```

The `--out` directory in the saved commands was
`/private/tmp/archify-v14-probe/v14-real`; selected query JSONs and summaries
were copied into this evidence directory.

## Regression suite

```sh
cd archify/modules/code-analysis && npm test     # 472 passed, 0 failed
npm --prefix archify run check:release-identity  # release identity ok
npm --prefix archify run check:validators        # ok
```

## v13 comparison

`node_modules` for the v13 checkout was linked read-only from the v14 tree;
the v13 Rust extractor was built on demand by the normal CLI. Results:
tracing 0/3, ripgrep 0/1, futures 2/2, original 20 81/86. The query files are
`queries/*.v13.json`.

## Canonical ZIP

```sh
PATH=/private/tmp/node-v22.23.2-darwin-arm64/bin:$PATH scripts/build-zip.sh /private/tmp/archify-v14-final.zip
PATH=/private/tmp/node-v22.23.2-darwin-arm64/bin:$PATH scripts/build-zip.sh /private/tmp/archify-v14-repeat.zip
unzip -q archify-v14-final.zip -d /private/tmp/archify-v14-final-zip
npm ci --offline --prefix /private/tmp/archify-v14-final-zip/archify/modules/code-analysis
```

Both builds are byte-identical (405 files, SHA-256
`e7358404773caef411c60e0b22d593922d6a4dd5c00e59c46f27b5ee7b77a27c`). The
tracked `archify.zip` was replaced with the same bytes. ZIP replays:
provenance provider 2 / caller 0, tracing 3/3, ripgrep 0/1, futures 2/2.
