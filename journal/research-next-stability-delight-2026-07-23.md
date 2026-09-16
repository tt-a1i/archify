# Architecture Delta 之后的下一刀：Exact-ID Delta Review Navigator

研究日期：2026-07-23
Archify 基线：[`4aeb07b`](https://github.com/tt-a1i/archify/tree/4aeb07b379f09a8fc026df33e2402ad50ef9821e)

## 唯一推荐

下一项只做 **Exact-ID Delta Review Navigator（逐项架构变更审阅器）**：在现有 Architecture Delta HTML 内，把已经生成的确定性 change rows 变成可选择的审阅步骤，并加入 `Previous / Review / Next / Overview`。用户可以手动逐项看，也可以主动开始一次有限、不循环的审阅播放；每一步只突出 compare receipt 已经证明的那一个 component、connection 或 boundary，完整 Delta 仍留在原位作为上下文。

它不是第二个 diff 算法，也不是影响分析。它只把当前已经可信、但仍偏“总览 + 表格”的 Delta 变成更容易讲解和复核的视觉审阅流程。

## 为什么这是一个真实缺口

当前 Archify 已经明确发布下列能力，因此它们全部排除，不再包装成“下一特性”：

- Last-Good Live Preview 已经有独立、loopback-only、last-known-good 合同。([current Skill](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/SKILL.md#L84))
- revision-pinned Repository Evidence、HTML-only source beacons 已经存在。([current Skill](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/SKILL.md#L285-L311))
- Structured Repair Receipt 已覆盖 input、schema、repository evidence、composition、artifact 和 delivery failures。([current Skill](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/SKILL.md#L88))
- Cursor onboarding、`deployment-ownership` profile 和 Architecture Delta 都已发布并带回归证据。([current changelog](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/CHANGELOG.md#L8-L11))

Architecture Delta 当前已经：

1. 生成确定性 `Before / Delta / After` 三视图；
2. 把 components、connections、boundaries 的变化排序成 exact change rows；
3. 显示 counts、proof level、classifications 和 changed fields；
4. 严禁 risk、mergeability 或 verified-PR 结论。

但 current artifact 里的 change rows 只是静态 `<li>`；顶部只有视图、preset 和 theme 控制，没有 change-level selection、previous/next 或 review playback。([Delta renderer](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/delta/architecture-delta.mjs#L545-L580))

因此缺口不是“再生成一种图”，而是：**当变化多于三四项时，审阅者怎样不离开完整上下文，逐项确认每条已经证明的变化。**

## 一手资料结论

### Fireworks Tech Graph：借语义顺序和固定场景，不借循环特效

Fireworks 的 motion contract 要求 metadata 不完整时 fail closed，不把已审核 motion 套到任意同风格拓扑；其通用规则是按 semantic order 展开，同时固定 nodes、labels、containers、marker geometry 和 camera。([motion input contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L26-L36), [fixed-scene rules](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L38-L52)) 它还把 repeated roles 用 exact `(role, stage, order)` 独立寻址，并说明剥离 motion metadata 后应恢复原静态几何。([identity and static recovery](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L251-L273))

**吸收：** Review Navigator 使用现有 receipt 的确定性顺序、精确实体身份和一次性有限播放；选中时不移动或重排图。
**不吸收：** 无限 GIF、ambient flow、任意 motion preset、对缺失身份的猜测。

### GitDiagram：交互必须落回已经校验的结构

GitDiagram 的生成流程先得到 size-bounded graph AST，再验证 identifiers、connectivity 和真实 repository paths，之后才 deterministic compile；最终交互节点仍指向已经验证的 source path。([generation contract](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L49-L59)) 它也把“click component”和 PNG export 当作核心用户行为，而不是让交互重新解释图。([product surface](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L14-L21))

**吸收：** change row activation 只能定位到现有 validated DOM identity。
**不吸收：** hosted ingestion、LLM generation、storage、private-token flow。

### drawio-skill：PR summary 值得保留为下一候选，但不是本轮

drawio-skill 的 `prdiff.py` 会从 git refs 找出变化的 `.drawio`，输出 base/head/diff PNG 和 Markdown report；没有 draw.io CLI 时会明确降级为文件清单。([PR diff contract](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/prdiff.py#L1-L18), [Markdown renderer](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/prdiff.py#L114-L155)) 它的 underlying diagram diff 默认按 cell ID 对齐，但仍提供 `--by-label` 给随机 ID 的手绘图。([matching contract](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/drawiodiff.py#L18-L31))

**吸收：** PR-friendly summary 确实有价值，应保留为后续独立切片。
**不吸收：** label matching；Archify Delta 必须继续 exact-ID、fail-closed。也不在本轮引入 git-ref parsing、Markdown asset hosting 或 CI comment publishing。

### GitNexus：不要把 authored Delta 偷换成 code impact

GitNexus 的 `impact`、`detect_changes` 和 process resources 建立在本地解析、knowledge graph、process trace 和 staleness checks 上。([tool contract](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L136-L175)) Archify 的两份 authored architecture snapshots 没有这些事实来源。

**吸收：** 对证据来源和 freshness 的显式区分。
**不吸收：** blast radius、affected process、confidence、risk level 或 safe-to-merge 文案。

## 两个真正的新候选

| 候选 | 用户价值 | 稳定性成本 | 当前判断 |
|---|---|---|---|
| **A. Exact-ID Delta Review Navigator** | 很高：用户在一个成品里逐条检查、讲解和演示真实 change；不再靠眼睛在全图和表格间来回找。 | 中低：只消费 embedded compare receipt 和已生成 SVG；新增的是一个有限 viewer state machine。 | **现在做。** 它是明显可见的 delight，又不扩大事实边界。 |
| **B. Deterministic CI/PR summary** | 中高：可把 counts 和 rows 放进 CI job summary 或 PR comment。 | 中：Markdown escaping、asset paths、base/head ref provenance、GitHub/CI host、private repo disclosure 和 publishing failure 都要独立定义。 | **后做。** CLI 已经有 `--json` 和 sidecar receipt，机器可消费入口不为空；先把人类审阅体验做好。 |

B 不是坏想法，但现在做它会让核心能力先长出 CI/GitHub 边界，用户打开 Delta 后仍只能看静态 rows。A 的新增事实面为零，且能立即在现有示例、README 演示和真实 PR review 中被看见。

## 冻结产品合同

### 1. 唯一事实源

Navigator 只读当前 document 内唯一的 `#archify-compare-receipt`，并要求：

- JSON 可解析；
- `schemaVersion === 1`、`command === "compare"`；
- `completeness === "complete"`；
- `changes.components / connections / boundaries` 都是数组；
- 当前文档恰好有一个 Delta canvas 和对应 SVG；
- 每个 change 能在 Delta SVG 中得到合同允许的 exact match。

任一条件失败，Navigator 整体不可用并显示 `Review unavailable · compare identity mismatch`；Before / Delta / After、details、theme 和 preset 仍可用。不得部分播放、模糊匹配或跳过坏 row 后声称完整。

### 2. 身份规则

- component：receipt `id` ↔ `data-node-id`；
- connection：receipt `id` ↔ `data-edge-id`；只把 path/line/polyline 与其 exact label/detail group 作为同一 change 的视觉集合；
- boundary：receipt `key` ↔ renderer 新增的 `data-delta-boundary-key`；该 key 仍是 compare 已经验证唯一的 `(kind, label)`，不新增 schema ID；
- moved component、rerouted connection 和 changed boundary 可以有 before phantom 与 head form；同一 exact identity 的全部合法 form 一起被选中；
- 重复、缺失、错误 kind、错误 status 或 DOM/receipt classification 冲突全部 fail closed。

永远不按 label、endpoint、geometry、邻近关系或数组位置猜实体。

### 3. 顺序

直接复用当前 `changeRows(receipt)` 的 codepoint-stable 顺序；不要创建“更聪明”的 risk、severity 或 topology-first 排序。总数必须等于三类 changes 的合计，并与 details summary 一致。

格式化、object-key、entity-order、`wraps` / `sources` set-like reordering 已经不改变 Delta artifact；Navigator 不得破坏这一保证。([current deterministic tests](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/test/architecture-delta.test.mjs#L67-L75), [artifact stability tests](https://github.com/tt-a1i/archify/blob/4aeb07b379f09a8fc026df33e2402ad50ef9821e/archify/test/architecture-delta.test.mjs#L130-L177))

### 4. UX

保持一个 canvas，不增加第二张图或侧边工作台：

- Details summary 上方或现有 proof tools 内加入一个 compact review strip；
- native buttons：`Overview`、`Previous`、`Review/Pause/Replay`、`Next`；
- 一个稳定状态文本：`03 / 11 · Relationship · publish-order · geometry`；
- 每个 change row 变成 native button 或含一个全行 button，显示现有 symbol、kind、label、ID、classifications、fields；
- 手动 row/Previous/Next 选择立即暂停播放，保持当前 exact change；
- `Overview` 清除 selection，恢复完整 Delta；
- Starting Review 是唯一可自动前进的入口，始终先切到 Delta view，从第一项开始，播放一次后停在最后一项；绝不自动开始或循环；
- 用户切到 Before/After、聚焦任意 review control、页面 hidden、print 或出现新 intent 时立即暂停，绝不自行恢复。

行按钮采用一个 roving tab stop，支持 ArrowUp/ArrowDown、Home/End 移动焦点，Enter/Space 选择；Previous/Next 激活后不移动按钮焦点。若提供自动前进，W3C Carousel pattern 要求 keyboard focus 停止 rotation，且只有用户再次触发 control 才可恢复。([WAI-ARIA APG Carousel](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/))

### 5. 视觉

- 完整图、viewBox、node/edge/boundary geometry 和 paint order保持不变；
- 当前 change 为 full emphasis，其他 changed entities 收敛到可读的 secondary opacity；unchanged context 继续保留；
- selected state 同时使用 outline/pattern/symbol/文字状态，不只靠颜色；
- moved/rerouted 的 from + to forms 同时可见，不制造“只有新位置”的假象；
- 不复制 node/edge 作为新的可见拓扑；允许一个无 marker、无 pointer events 的静态 focus outline，但它必须来自 exact matched geometry，并在 clear/print 时删除；
- manual selection 可以有一次不超过 160ms 的 opacity transition；Review 每步至少停留 1400ms；不移动 camera，不缩放，不平移，不闪烁。

`prefers-reduced-motion: reduce` 下取消 transition 和自动 Review，只保留完整手动 Previous/Next/row selection。该 media feature 的语义正是减少或替换非必要动画。([MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion))

### 6. 状态边界

Navigator 状态是 viewer-only：

- 不写入 JSON IR、sidecar receipt、compare hashes、URL、history、localStorage 或 cookies；
- 不改变 Before / Delta / After 的原始 SVG markup；
- print 固定输出完整 Delta，忽略 active step；
- 不加入 Share Card、PNG、WebM 或其他 export，本轮也不借机补 export menu；
- 无新 dependency、server、GitHub API、telemetry 或 mobile product surface。

### 7. 文案边界

允许：`Authored change 3 of 11`、`Revision-pinned inputs`、`Changed fields`、`No authored architecture changes`。
禁止：`impact`、`blast radius`、`affected`、`risk`、`safe`、`mergeable`、`verified PR`、`breaking`，除非未来存在独立、明确的代码事实合同。

## 明确不做

- 不做 CI action、PR bot、GitHub comment、status check 或 asset hosting；
- 不接收 git refs，不自动选择 base；
- 不做 label/endpoints fuzzy identity；
- 不做 risk/severity scoring、affected-process 推断或测试建议；
- 不做 diff editing、accept/reject、approval workflow；
- 不做 infinite autoplay、ambient particles、GIF/WebM 导出；
- 不复用普通 diagram 的 Story/Route/Camera state machine；Delta Navigator 拥有自己的小型、单一 owner；
- 不做移动端产品；只保证现有桌面 proof 不产生页面横向溢出。

## 自动化稳定门

实施必须先写失败测试，再满足以下门：

1. pure identity resolver 覆盖 component、connection、boundary、added、removed、changed、moved、rerouted 和 zero-change；
2. missing / duplicate / conflicting DOM identity 统一 fail closed，且不会只跳过某一 row；
3. row count、step count、summary count 与 embedded receipt 完全一致；
4. stable order 在输入格式、object key、entity order、set-like order 改动后不变；
5. Overview 不留下 `data-delta-review-*`、inline style、outline clone、timer 或 `aria-current`；
6. Review 只运行一次，最后停止；replace/pause/hidden/print/reduced-motion 使旧 timer token 失效；
7. manual activation、keyboard focus、view switch 都停止自动前进且不会 auto-resume；
8. print 强制完整 Delta，禁止 toolbar、selection dimming 和 runtime overlay；
9. forbidden claims audit 继续通过；
10. current Delta artifact bytes仍然 deterministic；只有功能实现本身造成一次受控 golden 更新；
11. `npm test`、`npm run test:webm`、installed ZIP package smoke、`unzip -t`、`git diff --check` 全绿；
12. 不修改普通五 renderer 的 canonical exports、Route/Reach cards、WebM 或 Story behavior。

## 内置浏览器验收

在 `examples/checkout-platform-delta.html` 的桌面视口完成：

1. 冷启动仍是 Delta overview，无选中 row、无 timer、无 console warning/error；
2. 点击一个 component change：exact row 获得 `aria-current="step"`，只有相同 `data-node-id` 的合法 Delta forms 成为 current；
3. 点击一个 connection change：path、对应 label/detail 同步突出，不命中同 endpoints 的另一条 edge；
4. moved node 同时保留 move-from 和 moved form；rerouted edge 同时保留 old/new route；
5. boundary row 只匹配同一个 exact boundary key；
6. Previous/Next、row click、Arrow/Home/End、Enter/Space 行为一致；焦点始终可见；
7. Review 从第一项开始、一次走完、停在最后；Pause 保留当前静态事实，Replay 只有用户点击后才重新开始；
8. 播放期间聚焦 row、切 Before/After、隐藏页面或按 Pause 后不再前进；
9. 浏览器模拟 reduced motion：Review 不自动运行，手动 navigation 完整可用；
10. Overview 清除所有 runtime state，DOM/SVG fingerprint 回到激活前；
11. Classic / Signal Flow / Blueprint × dark / light 都能区分 selected、other change、unchanged context；
12. 1280×720 与 1440×900 无页面横向溢出，controls 不遮住图或 exact change list；
13. `window.print()` / print preview 只呈现完整 Delta，没有 review chrome 或 selection residue；
14. 动态篡改一个 ID 或制造 duplicate 后，Navigator 显示明确 unavailable，三视图和静态 change list 仍可读，绝不 fuzzy-match。

## 成功判断

成功不是“多了一个 Play 按钮”。成功是审阅者可以从 Overview 开始，用完全相同的 authored facts 逐项走完一份复杂 Delta；随时暂停、返回全图、切 Before/After，都不会丢失上下文或得到新的推断。实现前后 compare receipt、stable IDs、三视图和禁用风险结论的真相合同保持不变。

完成这一刀之后，再单独评估 B：从 sidecar receipt 生成 deterministic Markdown/CI summary。那一轮必须独立冻结 git provenance、private path disclosure、asset publication、Markdown escaping 和 publishing failure，不能借本轮 Navigator 顺手带入。
