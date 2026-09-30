# Clean PR validation

Base: `labs/infinite-canvas` at `b5d06bb9489c05f69ab777299cb81964e0401fbb`.
This branch is rebuilt directly from that base. It adds `labs/travel/`, the
scoped travel rule and the root agent routing paragraph. It does not migrate
the previous dev merge, change core renderer/viewer code, remove core tests,
or regenerate unrelated examples. Only current online packages are included.

- Travel suite with Chrome/SwiftShader: **14 passed, 0 failed, 0 skipped**.
- Standalone Shanghai/Paris HTML tests: **2 passed, 0 failed, 0 skipped**.
  Both checked-in files are reproducible from source and were opened from
  `file://` with the browser offline. Workflow, overview and all three days
  worked without external resource requests or JavaScript errors.
- Six demo screenshots regenerated on this clean base at 1440×1000 and visually
  inspected. The overview shows two cross-day arrows; daily views retain their
  own stop-to-stop arrows. These are candidate captures, not a core viewer diff.

The earlier full-core test failures belonged to the superseded mixed branch;
those results do not establish failure or success of this clean branch. Core
sources are unchanged relative to the selected base. Required remote CI remains
the gate for merge readiness. No live Archify installation was performed.

Daily-relief follow-up: all 17 Travel tests passed with Chrome (0 failed, 0 skipped). Rebuilt online packages, standalone HTML/ZIP demos and all six screenshots. Visually inspected Shanghai and Paris daily terrain. Style identity v12 retains the existing palette and arrows while adding sourced, geographically cropped daily relief. No DEM coverage means a flat fallback.

