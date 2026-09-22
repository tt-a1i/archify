# First-complete-candidate code audit

**Scope.** Read-only review of base `7b9dd07f4ebbfe56dc7b9529afe919fabae85b4c` for reducing avoidable author-model work before the first complete, source-grounded Architecture JSON. This is not a claim about model request counts: retained native traces do not expose them.

## Result

There is no safe Stage 1 prompt-only change to make. The shipped repository path already directs a question-led, evidence-bounded connected slice:

- `archify/references/repository-authoring.md:17-50` says to follow the entry/configuration/call path to its real input, output, or side effect; record source ranges while reading; stop once requested responsibilities, relationships, and boundaries are entailed and remaining unknowns cannot change coverage; batch independent reads; and do not add a completion-summary step.
- `archify/SKILL.md:27-40` selects the Type-router example in the normal batch, forbids exploratory help/doctor/starter validation/output probing, requires a direct candidate, then one `finalize` invocation. It also preserves every evidence-backed semantic fact during repair.

Restating “explore on demand,” adding a fixed read/node budget, or changing the already-tested example-selection order would add no new executable or author-facing decision rule and would risk losing evidence. The historical trace note only establishes a repeated reference request with a 12.29-second observed interval, not its model-time share or a current-path regression (`auxiliary/traces.md`, supplied with this audit). If addressed later, it needs a measured A/B constraint-bundle experiment, not an assertion that the source-exploration rules are missing.

## Architecture grid: real capability and boundary

`architecture.schema.json:58-100` supports a `layout` with `mode: "grid"` and optional `origin`, `cols`, `gapX`, `gapY`, `cellW`, and `cellH`; components may carry `row`, `col`, `pos`, and `size`. The only required component semantics remain `id`, `type`, and `label`.

This is fixed placement, not auto-layout:

- `renderers/architecture/grid.mjs:3-30` supplies a 4-column default (`origin [40,80]`, `cellW 130`, `cellH 64`, `gapX 30`, `gapY 40`) and resolves one component origin as `origin + row/col * (cell + gap)`.
- `grid.mjs:33-62` only checks a cell is present, in range, and unique. `pos` wins over `row`/`col` (`grid.mjs:19-30,41-43`).
- `render-architecture.mjs:87-94` still gives an omitted component `size` of `120x60`; it does not derive size from its label, sublabel, source claim, or neighbor. The renderer *does* calculate automatic routes, automatic label fallback, boundaries, and a viewBox that includes nodes, frames, routes, labels, and legend (`render-architecture.mjs:168-202,304-320,376-400`).

The checked-in grid demonstration is deliberately small and unlabelled: `examples/archify-repo-grid.architecture.json:9-27` puts eight short nodes in manually selected cells; its connections are largely unlabeled and two supply endpoint-side controls (`:36-44`). It is not a source-backed, dense, long-label first-draft proof. It also is not in the Architecture Type router, which instead names `web-app`, `source-to-diagram`, and `production-deployment` (`SKILL.md:51-59`); those selected examples use explicit geometry.

### Local falsifier

A temporary, untracked local fixture using only `layout.mode: "grid"`, default cells, and a realistic Chinese node was rejected by `validate --layout-json --quality showcase`:

```
Label "跨租户审计日志导出入口" (~145px) is wider than component "entry" (120px)
```

The resolved cells were the default `120x60` boxes at x=40 and x=200. Its long Chinese boundary title and its labelled connection did not make the failure disappear; the first component label did. By contrast, a long *single* edge label between two short default nodes passed: automatic label placement moved its 236px mask above the 40px inter-node gap. This proves only that existing automatic-label fallback can handle that simple one-edge case. It does not make default grid safe for node text, multi-edge hubs, or the requested source-backed layouts.

The four supplied first-complete candidates substantiate the boundary. All used explicit `pos` and `size`, none `row`/`col`. Applying the renderer's actual default-width checks (`label units * 6.6 <= 128`, sublabel minimum width at 6px within 112px) shows that default `120px` nodes would have rejected 7/10, 5/10, 8/9, and 4/9 components respectively. The Chinese development case is expressly selected for a long Chinese component label (`benchmarks/authoring-cost/experiment-manifest.json:95-105`). Thus default-grid-first would predictably create a repair roundtrip for the measured population rather than remove one.

## Decision

Do **not** change the authoring default to “always use grid” and do **not** introduce a new layout engine in this slice. Grid already removes absolute-coordinate arithmetic only when the author can truthfully use default-size components or deliberately supplies the necessary grid dimensions and exceptional sizes. It cannot choose semantic layers, resolve a meaningful row/column map, size text, reserve labelled-edge corridors, or assess aggregate desktop readability.

The current defaults correctly keep these quality floors: component/sub-label fit (`render-architecture.mjs:424-454`), automatic port/route work, label-to-route clearance, source evidence, boundaries, and browser acceptance. `references/authoring-defaults.md:45-58` already says to use automatic routes on a first draft and retain semantic labels; `authoring-contract.md:157-189` exposes resolved layout only as post-failure repair evidence.

## Narrow future hypothesis, not a recommendation to ship now

If a new trial is authorized, test one small **advisory** `architecture grid-suggest` helper, bounded to a complete semantic Architecture skeleton that already has `row`/`col`. It could reuse existing measurements rather than create an independent layout model:

- `textUnits` / `minimumNodeTextWidth` / `availableNodeTextWidth` in `renderers/shared/text-fit.mjs:19-48` for required node text width;
- Architecture's actual connection-label width equation (`render-architecture.mjs:146-165`);
- existing `gridLayout`, router, automatic label placement, auto viewBox, and `validate --layout-json` for the authoritative geometry.

It would emit a suggested `layout` and only necessary component `size` values, preserving the authored topology, labels, evidence, boundaries, and automatic routes. It must decline rather than guess when one global `cellW`/`cellH` would exceed desktop-readability or when routing/label diagnostics remain. That is a new CLI/compatibility surface, even if its first implementation fits roughly 200 lines, because `cellW` is global while text requirements and relationship corridors are per item. It needs matched first-draft trials on the existing English and Chinese cases plus browser evidence. The hypothesis is tens-of-seconds of author decision reduction only if it eliminates a real coordinate/size-planning or repair turn; renderer computation itself is local milliseconds, and current traces cannot attribute model work.

## Evidence limits

The experiment records first complete JSON separately from final acceptance and keeps semantic/source/native/common/visual gates distinct (`benchmarks/authoring-cost/README.md:21-24`; `experiment-manifest.json:50-64`). It explicitly leaves model rounds, read ranges, and model-side timing unknown (`README.md:103-109`). No timing or quality-improvement claim should be made without a registered, matched trial; the observed grid falsifier is a correctness boundary, not performance evidence.
