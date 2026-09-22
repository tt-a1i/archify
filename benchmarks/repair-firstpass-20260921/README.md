# Fewer model repair rounds — 2026-09-21

This isolated study starts at `9730d49`. Its production Archify runtime is
unchanged from the preceding study. The question is whether deterministic
geometry proposals can prevent repeated model repair while retaining exact
authored content and the existing complete delivery gates.

`protocol.json` was written before prototype implementation. Three compact
first drafts are development inputs. Six previous runtime first drafts are
held out from this prototype's tuning; the repositories and prior outcomes are
already known, so this is not unseen-repository evaluation. Input hashes,
budgets, stop conditions and conditional author trials are fixed there.

The candidate operates on a complete source-backed Architecture specification.
An explicit `--allow-reflow` permits a separate geometry proposal. It preserves
all text, identities, relationship endpoints, source evidence, cards, views,
styles and boundary membership. User-authored routes and constrained sides are
outside the initial adapter's scope. Unsupported inputs and exhausted search
must produce a truthful decline, leaving the source specification intact.

Offline comparisons use:

```sh
python3 benchmarks/repair-firstpass-20260921/offline.py \
  --cohort development --prior <extracted-prior-records> \
  --repos <pinned-source-clones> --out <fresh-result-directory> \
  --helper <prototype.mjs>
```

Prior records are the verified archives in
`../semantic-firstdraft-20260921/evidence/`. Source revisions are in that study's
`tasks.json`; its `prepare_sources.py` can create fresh clones. Holdout runs also
require `candidate-freeze.json` with exact prototype hashes. Results never
overwrite a previous attempt directory. The helper contract is a JSON receipt
on stdout and a separate `--out` candidate only on accepted static validation.

Static acceptance, complete finalize, independent source/perceptual review,
and successful model-author latency are separate measurements. Internal search
attempts and their time are recorded; moving work into a deterministic tool is
not itself proof of lower total cost. No new model authors run unless the
offline and independent-review gates pass. Failed candidates remain evidence.

Live Skills, the original dirty checkout and remote branches remain unchanged.

## Final disposition

The two-revision study stopped at its development gate. V1 passed 0/3 fixed
first drafts; frozen V2 passed 1/3, below the required 2/3. QuickLRU took 4.281
seconds and 22 internal attempts, then passed a separate full finalize in
3.486 seconds. Both independent reviewers found a required semantic omission
already present in the input. Full quality acceptance is therefore 0/3.

No holdout inputs were used for tuning or trial, no fresh model authors ran,
and no end-to-end saving or model repair reduction is established. This is a
research prototype, not an installed or promoted tool. The unchanged runtime
and all declined candidates remain part of the evidence.

See [the result report](../../docs/research-repair-firstpass-result-20260921.md)
and `evidence/summary-metrics.json`. `evidence/records.tar.gz` contains the
complete recorded attempts, geometry, diagnostics, probes and quality reviews.
Its manifest verifies every archived file; large HTML/PNG artifacts remain at
the source locations listed in the same manifest with hashes. No holdout
candidate bytes are added to this archive. Final helper/test hashes remain in
`candidate-freeze.json` and must match the recorded experiment.

Focused checks:

```sh
node --test benchmarks/repair-firstpass-20260921/preflight.test.mjs
python3 benchmarks/repair-firstpass-20260921/offline_test.py
```

An existing V1 hard-link output-alias defect was fixed in V2. The V1 snapshot
is preserved as historical evidence and must not be used as the final helper.
The offline collector qualifies only static first-draft comparisons: its
whole-holdout, author-trial and promotion flags remain false unless a separate
workflow supplies every additional gate. There is no such qualified workflow
result in this study.
