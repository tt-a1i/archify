# Semantic navigation and local route repair experiment

This is an isolated research benchmark, not a product or live Skill change. The
experiment starts at `55beaa07e6eb46eb301bc40aade3747c25245660` and uses the unchanged
`archify.zip` with SHA-256
`43a922783ed093b70fa470eb0d9916b48c4cf134d8665a570931467c1c00d8ff`.

The result and limitations are in `docs/research-semantic-repair-experiment-20260921.md`.
The helper audit is in `docs/review-semantic-repair-prototypes-20260921.md`.

## Helpers

`navigation/semantic-navigation.cjs` uses TypeScript 5.9.3. Install its locked
dependency into a disposable tool directory with `npm ci --ignore-scripts
--no-audit --no-fund`, then supply the absolute package path via `--typescript`.
The experiment's default dependency path is
`/private/tmp/archify-semantic-repair-20260921/tool-deps/node_modules/typescript`.
No target repository packages or runtime are needed. Node 22 is used throughout.

```sh
/opt/homebrew/opt/node@22/bin/node navigation/semantic-navigation.cjs \
  --repo-root /absolute/pinned/source --scope source \
  --symbol Ky.create --declaration-lines 40 --limit 40 --json \
  --typescript /absolute/tool-deps/node_modules/typescript
```

Definition and reference results are static binding evidence; imported files may
be parsed for resolution, but query/output locations are limited to eligible
scope files. Output reports truncation and scope-filtered locations. Fixed
NodeNext/ES2022 settings do not load a target project's tsconfig.

Run `route-repair/route-repair.mjs` from its checked-in hierarchy so it resolves
the adjacent repository `archify/` package. It accepts only one automatically
routed edge with the two documented route-rhythm diagnostics. A successful
repair still requires full `finalize`; no-op and declined receipts are not
successful repairs. Never change the candidate while a gate is running.

## Repeating the comparison

The archived `tasks.json`, `rubrics.json`, `freeze.json`, prompts and receipts
identify the actual experiment. Pin the three listed source commits and package
hash, create independent clean run directories, and supply each author only its
own `TASK.md`, source, package, tools and writable output directory. The replay
scripts retain original local paths for auditability; choose a new scratch and
evidence directory and update those roots before repeating. Never overwrite the
recorded outputs or reuse completed model contexts.

Use fresh Terra/medium authors serially in the recorded order. Start
`../source-tools-20260921/watch.py --artifact candidate.json` before dispatch.
Capture each content-hash change and native task timing using the reused
`trace_extract.py`; the current collector adds lexical navigation/route-helper
categories and preserves cap interruptions as censored observations. Do not
export reasoning or raw tool arguments. Tool categories are coarse observations,
not a measurement of hidden model reasoning or HTTP time.

For each subject, preserve first/final JSON and the full finalize outputs.
Independently validate exact preserved snapshots against the pinned repo root,
then collect strict-provenance visual-check images for delivered artifacts.
Review source meaning separately from line-range validity and visual gates, with
both conditions at 1440x900. A fast but incomplete/failed result cannot establish
an equal-quality speedup. The two reserve timed slots are available only for the
predeclared independently source-complete, supported frozen-candidate repair
comparison; they are not retries of full authoring.

Scope/dependency setup, prototype development, source clone and independent
review time are separate from author intervals. All helper calls and repair
iterations inside the subject are charged to that interval. Processes are fresh,
but filesystem cache and provider scheduling are uncontrolled. These public
projects are new to this experiment, not proven unseen by the model.

## Actual outcome

Six timed authors ran. Five passed machine delivery gates; only ordinary Query
and ordinary p-queue passed the frozen semantic floor and visual review. Both
independent source reviews agreed. No equal-quality pair remains, so the raw
timings do not establish a speedup. Neither primary p-queue author invoked the
route helper; its supported failure class did not match the experimental case.

No source-complete candidate also had an eligible single automatic route
failure. The two reserved repair authors were therefore not launched. Prepared
`coordinator/prepare_repair.py` and its literal-preservation guard describe that
unused contingency, not evidence of an executed matched repair experiment.
`evidence/repair-pair-skipped.json` records the decision.

The compact archive includes exact first/final JSON bytes, immutable input and
prompt hashes, native timing/categories, gate outcomes, and both original review
receipts. Intermediate snapshots, full HTML, screenshots and the review bundle
remain under the full artifact directory named in the report. Review paths
retain their original scratch roots for auditability; pinned public sources can
be cloned again using the recorded revisions. The observer's largest observed
poll gap was 0.134s and no subject observation expired.
