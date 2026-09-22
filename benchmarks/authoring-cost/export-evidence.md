# Evidence export

The export-evidence.py script copies a fixed allow-list from registered session
roots (S/<run_id>) into R/<run_id>/author-output. It reads run_id values from
the manifest and never recursively walks a session.

The allow-list is based on observed session roots:

- candidate.json
- diagram.html or artifact.html (the runner currently writes diagram.html)
- explicit native delivery, validation, handoff, browser, and finalize JSON
  sidecars listed by the script
- explicit root screenshot names beginning with diagram.visual-check or
  first.visual-check, with the observed 1440x900 and 2048x1320 variants

Missing files are recorded in the evidence tree through the top-level
export-index.json; they are not synthesized. The source tree is never searched
for other images, and home/, .codex/, source/, archify/, auth material,
configuration, and private logs are excluded by construction. A destination
file is reused only when size and SHA-256 match; a differing existing file
stops the export.

The index contains only stable file facts (relative paths, sizes, and hashes);
it does not record whether a particular invocation copied or reused a file.
Running the exporter again over the same inputs therefore produces the same
index bytes.

Run after author sessions and independent checks finish:

    python3 benchmarks/authoring-cost/export-evidence.py \
      --manifest /private/tmp/archify-authoring-20260920-evidence/experiment-manifest.holdout-frozen.json \
      --sessions /private/tmp/archify-authoring-sessions-20260920 \
      --evidence /private/tmp/archify-authoring-20260920-evidence

The retained study exported all 36 registered attempts after author completion.
A small fixture verified identical repeated export and rejection of a broken
symlink; exported bytes were independently checked against the index.
