# Verified Immer source and probe brief

Pinned Immer **11.2.9**, npm gitHead and GitHub tag v11.2.9 both **75a290e44ba14bd723c8ef8546b6559c8ef3ae88**. Local Node **22.23.3**, macOS arm64. Installed externally with `--ignore-scripts`, package-lock retained. Three shipped TypeScript modules (`src/immer.ts`, `src/core/proxy.ts`, `src/core/finalize.ts`) are byte-identical to the pinned source; not an independent rebuild of bundled JS. See identity.json.

Primary-source URLs for the generated page:
- https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/produce.mdx
- https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/src/core/finalize.ts (unmodified state returns base_, modified state returns copy_)
- https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/freezing.mdx
- https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/pitfalls.md (plain-tree limit; shared branches across *different versions* do not imply permission for duplicate aliases within one input tree)

Actual probe.cjs creates a fresh tree for each case: `{user:{name:'Lin'},tasks:[{title:'Read',done:false},{title:'Write',done:false}]}`. Default produce, no plugins. Four cases run in two separate processes; probe-1.json and probe-2.json identical. `sameReference` reports strict identity (`next.x === base.x`), not deep value equality or memory addresses.

- change_first_task sets tasks[0].done=true: root/tasks/firstTask new; user/secondTask shared. Base values stay false; next first done true.
- no_op: all references same; values unchanged.
- assign_same_value assigns false to already-false done: all references same.
- change_user sets user.name='Mei': root/user new; tasks and both task objects shared.

Default autoFreeze matters: output tree is frozen; original shared user/second task become frozen in the first case. Therefore say original *data values* are unchanged, not that every observable attribute of the base object remains untouched. Shared references should not be directly mutated outside produce. This fixture does not establish performance, React rendering counts, deep-copy semantics, or support for cycles/aliases/exotic objects/Map/Set/async recipes. No performance claims.

Author may choose subset for clarity. Retain complete executable evidence; use CommonJS `const { produce } = require('immer')` and a .cjs file. Execute with `NODE_PATH=/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/runtime/node_modules node <your-author-file.cjs>`. Do not edit the runtime. The default package API is exercised by probe.cjs. Full install command belongs in reproducibility notes, not necessarily main page flow. Do not use timestamps or fabricated timings.
