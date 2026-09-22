# Source and layout feasibility study

Experimental helpers only; these are not shipped by the Archify package or installed as a live Skill. See `docs/research-source-layout-experiment-20260921.md` for measured results and limitations.

## Tools

- `prepare_index.py`: run an already-downloaded ast-grep binary once from the target checkout; preserve output, stderr, revision, hashes and measured preparation time. It does not install tools or resolve runtime calls.
- `watch.py`: snapshot every observed candidate hash change at 100ms intervals, saving structural completeness separately from quality. Run it before dispatch; write `<out>/done.json` after the author completes. The external span includes dispatch/notification latency.
- `trace_extract.py`: read one completed native Codex child rollout and an observer receipt. Emit only task/model/tool timing metadata and reported usage. Reasoning, ordinary messages, tool arguments and outputs are not copied. Use native task time for author comparisons. Lexical outline categories count attempts, not successful adoption.
- `check_facts.py`: structural, revision and source-range checks for the source-only diagnostic JSON; it does not judge factual entailment.
- `layout-advisor/`: experimental content-aware grid sizing. The author selects row/col; the tool changes geometry only and fails closed on unsupported inputs or failing validation. Source-backed inputs require the matching repository root. Full `finalize` is still required. The optional `--search-gaps` follow-up tries seven predeclared gap pairs; all seven failed on the observed Polka counterexample. It is retained for research reproducibility, not recommended for ordinary authorship.

## Reproduce a run

Use clean checkouts pinned by the frozen manifest and the exact matching package. Preserve the unchanged task text and source rubric, use fresh author contexts with the recorded model/effort, and run authors serially. Do not show timing, other candidates or the evaluator rubric to authors. Pre-register order/caps and do not replace failed runs. Current sample is small and reuses public tasks.

```sh
python3 prepare_index.py --binary /absolute/ast-grep --source /absolute/source --language ts --out /new/index-receipt
python3 watch.py --workspace /absolute/run --out /new/observation --artifact candidate.json
# Dispatch a fresh author with its frozen TASK.md; after completion create observation/done.json.
python3 trace_extract.py --session /absolute/child-rollout.jsonl --receipt /absolute/observation/receipt.json --out /absolute/observation/native-trace.json
node layout-advisor/layout-advisor.mjs candidate.json --repo-root /absolute/source --out advised.json
```

The full index condition adds measured preprocessing time to author and first-candidate latency. The local download is one-time environment setup, recorded separately. Include cold-process parsing; do not claim cold filesystem caches. Always assess first and final artifacts separately for source correctness, source ranges, complete `finalize` gates and common-viewport perceptual readability. If quality fails, report attempted elapsed time, not a qualified-delivery speedup.

## Focused checks

```sh
python3 -W error -m unittest discover -s benchmarks/source-tools-20260921 -p 'test_*.py'
node benchmarks/source-tools-20260921/layout-advisor/test-layout-advisor.mjs
```

The layout module imports the adjacent repository `archify/` implementation using its existing relative path. Preserve this directory layout in isolated trials. Frozen receipts carry hashes for the actual code/tool/package used, not a claim that any current external binary is identical.

Frozen original author helper is `receipts/frozen-layout-advisor.mjs`; the default helper now includes post-trial input/receipt hardening and the optional offline search. Do not attribute frozen timing to the later helper. Prompts preserve original absolute paths: restoring elsewhere requires recording path substitutions and the new prompt hash. Large HTML/image artifacts remain in the local evidence directory; public source commits can be reconstructed from the frozen manifest.
