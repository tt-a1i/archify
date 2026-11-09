# Commands and pins

Baseline CLI worktree: `/private/tmp/archify-bytes-baseline` at `a840c2d07`
(`rust-source-direct-v10`, adapter 10).
Candidate CLI worktree: `/private/tmp/archify-bytes-20261109` at the v11
product commit.

```sh
# bytes case, baseline and candidate
python3 run-case.py --cli <baseline>/archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples --out evidence/baseline-score
python3 run-case.py --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples --out evidence/candidate

# tracing cross-project case
python3 run-case.py --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --case cases/tracing-layer-event-enabled.json --out evidence/tracing-candidate

# corrected 20-case replay
python3 run20-corrected.py --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out evidence/final-v11-corrected --include-reserved
```

Sample roots are the fixed worktrees under
`/private/tmp/archify-batch-20261108/samples`; source trees are read only.
