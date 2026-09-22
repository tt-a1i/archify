# First-pass prevention experiment

Baseline production package: `68c94f9`. The frozen protocol combines an
author-written requirement-to-visible-text map with measured preferred-font
placement in author-selected rows and columns. This is a benchmark experiment;
the production Skill, schema, renderer, validators and live installs are unchanged.

The helper does not read repository source or select facts, roles, relationships,
rows or columns. It validates clause indexes and visible string pointers, sizes
nodes using the existing preferred-font measurements, and reserves estimated
space for adjacent same-row edge labels. Source truth, semantic completeness,
actual routes and perceptual quality remain separate acceptance gates.

`protocol.json` and the exact existing `tasks.json` were fixed before coding.
Two prototype revisions were used: initial implementation, then output-root and
ancestor-symlink protection. Before any author dispatch, a whitespace-only
observer correction was explicitly recorded in `freeze.json`. Helper/guide and
all author-facing inputs are frozen throughout the timed trials.

Six fresh Terra/medium authors run serially, alternating B/P order across three
known repository scopes. B uses the ordinary packaged Skill; P also receives
`PREVENTION.md` and `tools/firstpass.mjs`. Both receive the same task clauses and
600-second/three-repair cap. The import path in the guide refers to the copied
author directory, not this benchmark source directory. Import smoke validation
uses that exact file layout.

Commands from repository root:

```sh
node --test benchmarks/firstpass-prevention-20260921/firstpass.test.mjs
python3 -B -m unittest discover -s benchmarks/firstpass-prevention-20260921 -p evaluate_test.py
python3 benchmarks/firstpass-prevention-20260921/run.py freeze --scratch <scratch> --out <evidence>
python3 benchmarks/firstpass-prevention-20260921/run.py begin --run p-retry-B1 --scratch <scratch> --out <evidence>
# Dispatch one fresh Terra/medium author to the emitted TASK.md, then wait.
python3 benchmarks/firstpass-prevention-20260921/run.py finish --run p-retry-B1 --agent /root/<unique-author> --scratch <scratch> --out <evidence>
python3 benchmarks/firstpass-prevention-20260921/evaluate.py --scratch <scratch> --out <evidence> p-retry-B1
```

Create clean source clones at `<scratch>/repos/<task-id>` using the pinned
revisions in `tasks.json` before freezing. The preceding study's
`prepare_sources.py` supports those same pins. `begin` copies the sources and
unchanged package into an isolated author directory; copying and dispatch are
included in full elapsed time. Repository cloning, prototype work, later
captures and independent review are separate study costs.

The observer saves changed candidate bytes and planning/finalize sidecars at
100ms polling intervals. It records maximum scheduling gaps; this is observed
history, not a guarantee that instantaneous intermediate writes are captured.
Native traces retain public timing and coarse tool categories, not reasoning
or raw tool arguments. Provider/network retries are not visible.

Counts of finalized candidate revisions after first failure describe observed
repair iterations. Pre-finalize candidate changes, repeated identical finalize
calls and unfinished repairs must be recorded separately, not silently counted
as zero. Neither a source citation nor a coverage-map pass proves all semantic
clauses are actually explained. All failed or protocol-ineligible runs remain
in the study record. No faster failed output is a successful-delivery latency.

Only fully qualified pairs may support a time comparison. The protocol also
requires all P finals to pass quality and at least two qualified pairs, plus
repair/time improvement, before reverse-order confirmation. An initial screen
alone never promotes the tool into the installed Skill.

After all six authors finish and `evaluate.py` runs, prepare neutral source and
image cases with `prepare_review.py --out <evidence> --destination <new-directory>`.
Two independent reviewers receive that directory only. Preserve their original
receipts, then adjudicate material findings against the pinned source; record
first/final semantic, perceptual and machine gates separately in
`quality-adjudication.json`. `summarize.py --out <evidence>` reads that receipt;
missing independent quality stays unknown and cannot qualify a time saving.
`content_diff.py --out <evidence>` compares first/final authored content after
removing declared geometry; unchanged content is not proof of source truth.

The committed `evidence/records.tar.gz` preserves this run's observed candidate
versions, public traces, finalize sidecars, author scripts, HTML, captured PNGs,
reviews and adjudication. `evidence/records-manifest.json` records every member
hash and a verified archive readback. Extract into a fresh directory with
`tar -xzf .../records.tar.gz -C <empty-directory>`; source repository checkouts
are reconstructed from `freeze.json` pins. Absolute historical paths in receipts
identify the original run and need rebasing for a new reproduction. Do not run
`begin` against this immutable archive; a new experiment needs fresh directories.
