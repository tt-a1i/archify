# Sources and attribution

`upstream/flow.json` is the exact published Catapult fixture from
catapult-project/catapult commit 6fd8bbe723677254ff1130a1a416988b8b3e285e,
path tracing/test_data/flow.json. Its original bytes are preserved.
`upstream/LICENSE.catapult` is the complete original BSD-3-Clause-style license
from the same commit (Copyright 2015 The Chromium Authors).

`selection.json`, evidence and rendered pages are explicitly marked derived
projections of six original records. The added index wrapper is experimental
metadata; event fields and original timestamps remain unchanged. The upstream
trace is not this experiment's measurement and its collection was not reproduced.

No Catapult importer, Perfetto code, Speedscope code, UI, icon, screenshot or
vendored dependency is copied. The generator is independently authored under
this repository's current Apache-2.0 license. Generated viewer code comes from
this repository's existing Archify tooling, with its existing notices retained.
