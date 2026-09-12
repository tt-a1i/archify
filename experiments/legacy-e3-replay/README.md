# Historical E3 replay

Recompute the September 9 E3 experiment from local Git objects, the recovered
manual edit schedule, and pinned, already-tracked inputs. This directory is an
offline experiment and is not part of the shipped Skill.

## Run from a fresh local checkout

Requirements: Node.js 18 or newer, Git, and the complete local objects for the
three commits below. No npm installation, browser, renderer, current Locate
implementation, recovery-directory files, or external repository is needed.
The recorded run used Node 26.8.1 and Git 2.50.1.

```sh
cd /path/to/archify
node experiments/legacy-e3-replay/self-check.mjs
node experiments/legacy-e3-replay/run.mjs --repo . --out /tmp/archify-e3-replay-01
```

`--repo` must name a Git top-level directory. `--out` is required, its parent must
exist, and the output directory itself must not exist. Choose a new path for each
run. Existing output paths, including symlinks, are rejected before computation;
previous evidence is never overwritten. All replay output files are created
inside that one directory after input validation and computation finish. A write
failure can leave a partial new directory; inspect it rather than reusing it.
The separate self-check uses and removes one temporary directory to verify this
output-preservation behavior.

The tool never checks out, resets, fetches, updates refs, or edits a Git worktree.
Missing commits or blobs cause a failure; restore the local history separately.
Git lazy fetching is disabled. The receipt records the explicit Git diff and
quoting settings used for this run. Changing the checked-out branch or editing
current files does not change the pinned inputs.

| Purpose | Fixed commit |
|---|---|
| Replay base | `b744b0b43e0507be7709a2b0ead843466f137545` |
| Replay head | `10722002bb8777ecb639d93c49586fae4adf3ae4` |
| Tracked input/report snapshot | `c8816705f8db437901f6a861908ccfceb851d2ad` |

`provenance.json` pins SHA-256 and byte length for the tracked base map, published
head map, replay and anchor-decay JSON. They are read with `git cat-file`, not from
the current working tree. It also records the recovered source-script hashes and
snapshot identifiers. `edits.json` is an exact copy of the recovered human-authored
schedule and its digest is checked before running. The adapted implementation is
in `historical-method.mjs`; the current source hashes and runtime version are
recorded in each `receipt.json`.

## Read the results

The saved evidence in `results/` is one completed run. See [REPORT.md](REPORT.md)
for its findings and [results/comparison.json](results/comparison.json) for precise
equality checks. A new run produces:

- `e3-replay.json`, `e3-map-at-head.json`, `e3-replay-summary.json`: the original
  first-parent projection, schedule application, and resulting ownership map.
- `e3-stats.json`: the original statistics formulas, consuming this run's replay
  and map explicitly. The old stats script instead read an already-published
  replay from a hard-coded worktree path.
- `e3-sources-decay-recovered-script.json`: the recovered anchor script's original
  file selection, including its nonexistent-at-base test file.
- `published-anchor-selection.json` and
  `e3-sources-decay-published-selection.json`: a separately named reconstruction
  using only the published report's component/path/line coordinates. Base text
  and every subsequent observation are recomputed from Git. No old validity,
  event, or summary fields are used as measurements.
- `comparison.json` and `receipt.json`: comparisons, differences, source/input/
  output hashes, versions, and method limitations.

Exit 0 means the replay JSON, normalized head ownership rules, and published
anchor-cohort observations match the archived records. It does **not** mean the
recovered anchor script and published report have identical inputs. That known
difference is always reported separately. Exit 1 records a differing comparison;
exit 2 indicates invalid arguments, missing inputs, or an execution/write error.

## Method intentionally preserved

The old matcher treats trailing `**` differently from current Locate. Exclusions
win before ownership matching. Each of 100 first-parent commits is compared with
its first parent using `-M`; a rename/copy is classified by its destination path
only. Manual edits are applied at their scheduled SHA only if that step has
uncovered or ambiguous paths. No attempt is made to infer a better map or invent
missing edits.

The original anchor script selects up to three positional lines from each
manually chosen file. First invalidation latches, while final HEAD validity is
rechecked independently, so a line may recover without losing its first-failure
record. The historical `anchorFilesTouched` field counts touched **anchors**, not
distinct files. These names and formulas are retained to permit exact comparison.

This measures retrospective repairs to one authored glob map. It does not measure
the time spent choosing the map/edits, prove the edits were minimal, predict real
maintenance effort, measure human reading efficiency, or validate current product
behavior. The 100-step experiment is distinct from the later 190-step E3-deep
replay. Comparing percent of anchors invalidated with percent of commits needing
an ownership edit is not a same-denominator risk ratio.
