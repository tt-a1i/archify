# Recovered experiment replay

This suite converts recoverable findings into offline, fixed-input checks. It reuses three authored external maps and their sidecars, small glob counterexamples, and the preset red-team scenarios. It does not replay historical model answers, old screenshots, or a human review study.

Both pinned histories are available from the public repository. The presets pin is preserved on `codex/archive-identity-presets-20260909` solely for historical replay. That branch contains an unadopted experimental policy and old decision notes; it is not current product guidance or a proposal to merge those commits.

From an Archify clone, choose unused worktree paths:

```sh
DELIVERY_CHECKOUT="$PWD/../archify-replay-delivery"
PRESETS_CHECKOUT="$PWD/../archify-replay-presets"
git fetch https://github.com/tt-a1i/archify.git feature/identity-map codex/archive-identity-presets-20260909
git worktree add --detach "$DELIVERY_CHECKOUT" 365fec9cde7237829fc7986a5fbadc50334c9b72
git worktree add --detach "$PRESETS_CHECKOUT" 9306382111aa2cc5a1b376559a7a6bd75b7c2e74
```

The recorded run used **Node.js v26.8.1** and **Git 2.50.1 (Apple Git-155)**. Those version strings are stored in the result, so another runtime or Git build will change the JSON even if classifications agree. Other versions have not been validated by this fixture package; use the recorded versions for a byte comparison, or review version-only differences explicitly. Node 22 used for release ZIP generation is a separate workflow and is not this replay's recorded runtime.

With both pins available, the following run needs no dependency installation or network access:

```sh
node experiments/legacy-replay/run.mjs \
  --delivery "$DELIVERY_CHECKOUT" \
  --presets "$PRESETS_CHECKOUT" \
  --out experiments/legacy-replay/results/pinned.json
```

`DELIVERY_CHECKOUT` must be a clean packaged-source checkout at `365fec9cde7237829fc7986a5fbadc50334c9b72`. `PRESETS_CHECKOUT` must be at `9306382111aa2cc5a1b376559a7a6bd75b7c2e74`. The runner rejects another revision or modified/untracked files under `archify/`. It never changes either checkout. CLI probes create and remove a temporary repository with fixed authors, dates, contents, and commit messages. Do not run the old recovered Shell scripts: this runner calls the pinned product CLI directly and never substitutes a compute-only fallback after CLI failure.

The checked-in result records the full commits, packaged Git tree IDs, packaged-file manifest digests, key source hashes, input hashes, preset expansions, runtime versions, synthetic Git commits, and observed classifications/output files. Paths in results are repository-relative; checkout locations and temporary directory names are omitted. Repeating the run with the same Node/Git versions should produce byte-identical JSON. These pins are different development snapshots, not a controlled estimate of one commit's effect.

`matchesSnapshot: true` means the characterized behavior still matches that revision, including known bad behavior. It is not a product acceptance pass. Updating a pin requires reviewing expectations, with the old result retained as historical evidence.

The fixtures answer bounded questions:

- Does a claimed child-glob subset have a concrete path that escapes the parent?
- Can broad presets classify illustrative product inputs as excluded, and does an explicit owner take precedence?
- Do the recovered Hono/FastAPI/Hugo sidecars retain specific expected ownership boundaries? These are synthetic path probes, not claims that every path exists at the external repository's declared revision.
- Does a source citation alone assign ownership? The migration example must remain visible as uncovered.
- Does a child with fewer presets classify a fixture differently when inherited parent exclusions are applied? This checks the classifier seam, not complete browser or bundle behavior.
- Does the real CLI deliver added-map, ordinary-range and lint artifacts? The presets snapshot's added-map failure is retained, not hidden.

`fixtures/provenance.json` records the exact recovered bytes and transcript session/line provenance of each external map/sidecar. The maps retain their original external repository revisions, but this suite does not fetch or replay those repositories. `fixtures/scenarios.json` contains the explicit synthetic probes and expectations; it is newly authored from the recovered counterexamples, not a recovered run log.

The earlier first-look report used 15 PRs (10 main and 5 controls), one model, one trial per cell, and experimenter-authored non-blind ground truth. Its headline did not establish improved first-file selection or human time savings. This suite makes no new claim about those outcomes. Its value is durable regression and design evidence, at low replay cost.
