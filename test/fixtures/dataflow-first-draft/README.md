# Dataflow first-draft regressions

`ml-features.dataflow.json` is an unedited first draft written from the
Skill's Dataflow defaults (stage/row grid, automatic routes, no viewBox). On
`dev` its "online lookup" flow from stage 2 to stage 4 cut straight through
the vertical "model" flow inside stage 3, and `validate --quality showcase`
rejected the proper crossing. The test asserts that the unpinned draft now
renders with a clear detour, and that a pinned route keeps its geometry and
its crossing diagnostic.
