# Recovered first-look answers

This package preserves 30 original model answers, 15 static ground-truth records and two historical scoring implementations. It independently recomputes first-three-file precision, recall and first-file membership with Python's standard library. No model, original Cursor archive, repository checkout or network is needed for the replay:

```sh
python3 experiments/legacy-first-look/run.py --check
```

The 180 per-answer/reference metric comparisons and the values printed in the old report match. The ten main PRs have P@3 0.7667 without Locate and 0.7000 with it; all 15 have 0.7111 and 0.6444. These selected samples do not demonstrate improved first-file choice, human review speed or runtime-impact understanding.

This is a partial rescore of recorded answers, not a new trial or a reconstruction of the original prompt isolation. One model was used once per condition, and the experimenter supplied non-blind ground truth. Complete B prompts, receipt-derived noise labels, timing and the other heuristic metrics were not reconstructed. P@3 divides by three even for one-file controls; the report also includes Recall@3 to make that limitation visible.

[Report](REPORT.md) and [results](results.json) distinguish exact fractions from the old rounding order. [Provenance](fixtures/provenance.json) records input and transcript hashes. The original scoring excerpts in `sources/` are inert evidence; `run.py` verifies and uses only the extracted pure metric functions. `recover.py` is the optional archive extraction tool, not a prerequisite for checking this package.
