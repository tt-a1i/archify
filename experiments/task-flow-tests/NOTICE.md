# Sources and permissions

This experiment independently implements an authored path/test-association projection.
The original projector and final Archify artifact do not copy task-view source,
screenshots, icons, or vendored browser libraries.

The later `upstream-frontend/` comparison separately archives unmodified task-view
front-end source and vendor libraries at a3fa21767bfaeb3077fdda08bddb7249366caa93.
Its MIT and EPL-2.0 notices, authorship, source URLs and byte identities are kept
in that directory. They are research fixtures, not Archify runtime dependencies;
see `upstream-frontend/README.md` for the manually projected data and limitations.

The later `upstream-cli/` packet records execution of the official task-view
v1.2.0 portable release at the same a3fa217 revision. Its native generated HTML
retains upstream browser assets; the original MIT notice and complete release
THIRD_PARTY_LICENSES.txt, including EPL-2.0, accompany the archived sources and
outputs. Only machine paths in public HTML/evidence copies are replaced;
original/public hashes are recorded. The executable is not distributed here.

Inspiration: gtindo/task-view, commit f27b8bef63ec336b8e3487e90ccd484a2fa7a235.
The top-level project is MIT. Its vendor/LICENSES.txt separately lists Cytoscape.js
and cytoscape-elk under MIT and elkjs under EPL-2.0; the project label is not a
license statement for every bundled dependency.

The exact mapping fixture comes from tt-a1i/archify commit
dcedd53856b82d3e403a9651dca0e15840496942,
experiments/task-review-map/output/complete/mapping.json. It retains its original
provenance and historical excerpts. It is data reused from this same repository,
not code taken from task-view. This experiment follows the repository's current
Apache-2.0 LICENSE. Historical source and mapping retain their original notices;
no additional permission or blanket source-verification claim is implied.
