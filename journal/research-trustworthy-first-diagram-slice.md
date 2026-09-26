# Archify：可信首次交付的最小实现切片

> 调研日期：2026-07-22（Asia/Shanghai）
>
> 口径：只对一手资料与当前源码作结论；`事实`、`推断`、`建议`分开书写。
>
> 目标边界：同时改善首次交付的语义正确性、视觉质量和可验证性；不增加图类型、视觉预设、移动端产品面或托管平台。

## 结论

**建议只做一个纵向切片：`Trustworthy First Delivery v1`。**

它包含同一条交付链上的两个不可拆开的门：

1. **无条件语义安全门**：任何 renderer-owned relationship 穿过无关的、不透明语义节点时，都必须 hard fail；不能再因为输入没有 `meta.quality_profile` 或 CLI `--quality` 而静默放行。更严格的 X 交叉、短段、节奏等审美预算仍保持 profile-aware。
2. **有上限的最终像素复核**：确定性 `render -> validate --json -> check` 全部通过后，若运行时能读图，则检查最终浏览器成品与 canonical raster；最多做两轮只针对已诊断问题的修正，每轮之后重跑全部确定性门。交付时明确报告：

   ```text
   validation: passed
   visual_review: passed
   correction_rounds: 0
   ```

   没有图像读取能力时必须报告 `visual_review: skipped (image reader unavailable)`，不能猜测为 passed。

这仍是一个切片，而不是两个功能：**第一张 renderer 草稿只是 candidate；第一张交给用户的图必须同时有语义安全、机器检查和真实像素复核的证据。** 它不需要新 schema、图类型、preset、布局引擎、移动端状态、服务端或运行时依赖。

## 为什么是这一刀

| 目标 | 当前证据 | 这一个切片的直接作用 |
|---|---|---|
| 首次出图正确性 | #24 证明 `api -> queue` 可因路径藏在 `cache` 后而读成 `cache -> queue`，且无 profile 的 `render` / `validate` / `check` 全部成功；维护者明确把它定性为 correctness issue，倾向 hard error | 无 profile 也执行 Clean Flow；错误不能再进入交付物 |
| 视觉质量 | #6 的核心反馈是箭头混乱、不美观；维护者也承认能力较弱的模型在复杂仓库上不应明显掉队 | 机器门先挡住可判定的错误，最终像素复核补足 clipping、层级、留白、标签和暗/亮主题等机器尚未覆盖的问题 |
| 降低返工与 token | #22 的报告明确说成本来自“沟通调整很多版”；维护者判断不是 renderer 自身异常，而是代码探索、模型/客户端和迭代次数 | 只允许最多两轮、只改已诊断位置；不把审美修正变成无上限自编辑循环 |
| 可验证交付 | 当前 `validate --json` 已把临时 render 与 artifact check 合并，返回 `checks` 和 `composition`；但视觉复核没有真实状态 | 复用现有 JSON receipt，再补 `visual_review` 与真实 correction count，不引入新平台 |

上述 issue 证据分别见 [#6](https://github.com/tt-a1i/archify/issues/6)、[#22](https://github.com/tt-a1i/archify/issues/22)、[#24](https://github.com/tt-a1i/archify/issues/24)；#24 的维护者定性与 hard-error 选择见[该回复](https://github.com/tt-a1i/archify/issues/24#issuecomment-5029635230)。

## Archify 当前事实基线

### main 与已有能力

- **事实**：调研时远端 `main` 是 [`6d5204d`](https://github.com/tt-a1i/archify/commit/6d5204d23dfa2cbf3dfff423beeb32250a3dc727)，最新 release / package 版本仍为 `v2.11.0`。
- **事实**：main 已有共享 `cleanFlowProblems()`，会报告关系集合索引、可选关系 ID、障碍 ID、首个相交 segment、2px clearance 与修复旋钮；但函数在既无环境 profile、又无 IR profile 时立即返回空数组。因此这是**已实现但默认可绕过**的 correctness guard。见 [`geometry.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/renderers/shared/geometry.mjs#L44-L91)。
- **事实**：architecture renderer 已把 components 作为障碍集合传入 Clean Flow，并有完整 `fromSide` / `toSide` / `route` / `via` 修复提示。见 [`render-architecture.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/renderers/architecture/render-architecture.mjs#L189-L238)。
- **事实**：architecture `auto` 当前固定选择一个中点 X 的 H-V-H dogleg；它没有比较另一种 dogleg，也没有避障搜索。见 [`render-architecture.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/renderers/architecture/render-architecture.mjs#L294-L329)。
- **事实**：`validate` 会在临时目录 render，再运行 final HTML checker；成功的 `--json` 返回 `ok`、`checks` 和 `composition`。见 [`bin/archify.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/bin/archify.mjs#L267-L333)。
- **事实**：当前 SKILL 要求 read-schema -> author IR -> render -> validate -> targeted fix，也明确说明 composition gate 在无 profile 时保持 opt-in；现有 self-review checklist 主要检查 DOM/几何约束，并没有最终像素 readback 状态。见 [`SKILL.md`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/SKILL.md#L73-L81) 与 [`SKILL.md`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/SKILL.md#L326-L343)。
- **推断**：因为隐藏在无关节点后会改变读者看到的拓扑，这一条不是“审美偏好”。把它留在 opt-in profile 后面，和其他 profile-less 兼容策略混为一谈了。

### issues 与 PR 的当前状态

#### #6：箭头混乱

- **事实**：[#6](https://github.com/tt-a1i/archify/issues/6) 仍 open，报告来自真实仓库与真实 agent 生成图；维护者回复称强模型能生成效果好的图，但也明确说复杂仓库中不应让能力较弱的模型表现不足。
- **推断**：继续只增强 prompt 或展示强模型样例，不能给低能力模型提供确定性下限。机械安全门与最终像素门更接近问题本体。

#### #14 与 PR #28：CJK 宽度

- **事实**：[#14](https://github.com/tt-a1i/archify/issues/14) 的措辞是 “may be inaccurate” / “likely contributed”；报告者也承认部分 overlap 可能来自坐标放置。它是值得修的 P2，但当前证据没有证明它是 #6 / #22 / #24 的共同根因。
- **事实**：main 的 `FULLWIDTH_RE` 用一个宽区间覆盖 U+2E80–U+A4CF，并已有 ASCII、Han、混排、补充平面汉字和 emoji 测试。见 [`utils.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/renderers/shared/utils.mjs#L145-L153) 与 [`geometry.test.mjs`](https://github.com/tt-a1i/archify/blob/6d5204d23dfa2cbf3dfff423beeb32250a3dc727/archify/test/geometry.test.mjs#L400-L408)。
- **事实**：open 的 [PR #28](https://github.com/tt-a1i/archify/pull/28) 把该宽区间拆成显式 Unicode ranges，并新增 Han、CJK punctuation、fullwidth、Hangul 与混排单测；head `22eb5c8` 当时没有任何 GitHub check run。
- **事实**：PR #28 的新 ranges 不等价于 main：它漏掉 main 会按双宽处理的 Hiragana `あ` (U+3042)、Katakana `ア` (U+30A2)、Hangul Compatibility Jamo `ㄱ` (U+3131) 和 Katakana Phonetic Extension `ㇰ` (U+31F0)。因此 “all CJK blocks” 的 PR 描述并不成立。改动见 [`utils.mjs@22eb5c8`](https://github.com/tt-a1i/archify/blob/22eb5c84e917c677c17e1d3c22bee63a811225ce/archify/renderers/shared/utils.mjs#L145-L155)，新增测试见 [`geometry.test.mjs@22eb5c8`](https://github.com/tt-a1i/archify/blob/22eb5c84e917c677c17e1d3c22bee63a811225ce/archify/test/geometry.test.mjs#L400-L418)。
- **建议**：PR #28 不要原样并入本切片。先补 Kana、Bopomofo / compatibility Jamo 等回归矩阵，并用真实浏览器字体栈的 measured-vs-estimated fixture 证明问题；它应作为独立、可回滚的小修复。

#### #22：多轮打磨消耗 token

- **事实**：[#22](https://github.com/tt-a1i/archify/issues/22) 已按“未发现 Archify renderer / validator 异常 token 消耗”关闭；用户明确说消耗发生在多轮沟通与细节打磨，维护者把主要成本定位到代码探索、模型/客户端与迭代次数。
- **推断**：Archify 不应该承诺控制模型探索成本，但可以控制自身交付循环不无限扩张：确定性检查优先、针对性修正、两轮上限、无法看图则如实 skipped。

#### #24 与 PR #30：静默错误拓扑

- **事实**：[#24](https://github.com/tt-a1i/archify/issues/24) 给出 3 个组件、1 条 connection 的最小复现；`api -> queue` 的 auto route 穿过 `cache`，由于箭头先画、opaque component 后画，成品视觉上像 `cache -> queue`。报告中的无 profile `render`、`validate`、`check` 全部成功。
- **事实**：维护者明确回复“correctness issue rather than cosmetic one”，并选择 hard render / validate error，而不是 warning。见[维护者回复](https://github.com/tt-a1i/archify/issues/24#issuecomment-5029635230)。
- **事实**：open 的 [PR #30](https://github.com/tt-a1i/archify/pull/30) 是 test-only；reject case 主动加了 `quality_profile: standard`，PR 描述还明确记录：省略 profile 时同一文档当前仍能成功 render。它证明 main 上的 gate 能识别路径，但默认交付仍可绕过。
- **建议**：本切片应吸收 #24 的 exact auto-route repro 与安全 `via` workaround，但测试必须省略 profile，锁定“默认也 hard fail”的新语义。

## 三个官方仓库的一手机制对照

对照快照：

- [`yizhiyanhua-ai/fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44)
- [`Agents365-ai/drawio-skill@6f33563`](https://github.com/Agents365-ai/drawio-skill/tree/6f33563adce24450003d1cb61111ebbcc5579f28)
- [`ahmedkhaleel2004/gitdiagram@20eea55`](https://github.com/ahmedkhaleel2004/gitdiagram/tree/20eea559377fe3f110ac630856351382c4b5fcab)

### fireworks-tech-graph

**事实**

- 它把 geometry / composition 约束做成所有 style 共用的 executable contract，而不是靠 style 文档宣称；showcase 明确约束零 crossing / bridge、每边最多两 bend、stretch <= 1.35、segment >= 16px、node gap >= 40px、container gutter >= 20px、label clearance >= 4px。见 [`composition-quality-contract.md`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/composition-quality-contract.md#L7-L26)。
- 它明确规定：成功 render 但没有通过 geometry + composition 两个 gate 仍只是 draft。见[同一 contract 的 validation 段](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/composition-quality-contract.md#L75-L85)。
- 它把第一张 render 当 candidate：先确定性检查，再读回 PNG，最多两轮针对性修正；无法读图时明确报告 skipped。见 [`README.md`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L157-L189) 与 [`SKILL.md`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/SKILL.md#L77-L98)。
- 它用真实 validator tests 覆盖 path-vs-rect、edge crossing、reserved region、clipping、label clearance 与 composition budgets，而不是只测 XML parse。见 [`test_validate_svg.py`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/tests/test_validate_svg.py#L49-L104) 与 [`test_geometry_contracts.py`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/tests/test_geometry_contracts.py#L160-L192)。

**可借鉴**

- “第一张 render 是 candidate”以及 deterministic-first、perceptual-second 的顺序。
- 最大两轮 targeted correction 与 truthful `passed` / `skipped` receipt。
- 同 topology fixture 锁定 geometry metrics，避免把 style 变化误当结构进步。

**明确不借鉴**

- 不扩成 12 styles、14 UML types、vendor icon catalogue 或 GIF contract。
- 不引入 CairoSVG / Puppeteer 到 zero-install core。
- 不把所有质量压成一个不透明分数；保留具体 violation、关系、segment 与坐标。

### Agents365-ai/drawio-skill

**事实**

- 它先用 `validate.py` 检查 duplicate/reserved IDs、broken parents、dangling endpoints、invalid geometry、sibling overlap、waypointed edge-through-node 与 edge crossing；`--strict` 可把 warnings 升为失败，`--score` 只用于比较同一 graph 的 layout variants。见 [`validate.py`](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/validate.py#L212-L238) 与 [`validate.py`](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/validate.py#L241-L336)。
- 它在确定性 lint 后导出 draft PNG，视觉自检 edge-shape overlap、stacked edges、clipped labels、off-canvas、missing connections 与 label overlap；每次修复都重导出、重读，最多两轮。见 [`SKILL.md`](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/SKILL.md#L125-L161)。
- 它对单元素问题做 targeted edit，保留此前 layout tuning；到用户 review loop 才允许更长互动，并有五轮 safety valve。见 [`SKILL.md`](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/SKILL.md#L163-L187)。

**可借鉴**

- 把视觉缺陷分成明确 taxonomy，而不是笼统说“看看好不好看”。
- 确定性 lint 必须早于、且优先于 vision。
- 每轮只修已诊断的坐标、尺寸、label、route、spacing 或 viewBox。

**明确不借鉴**

- 不切换到 `mxCell` XML，不依赖 draw.io desktop / Electron 或 Graphviz。
- 不照搬 5 轮用户 feedback loop 到自动交付环；本切片上限仍是两轮。
- 不照搬其 score 为跨图质量指标；该仓库自己也限定它只能比较同一 graph。

### GitDiagram

**事实**

- 它先从 repo tree + README 生成不超过 650 词、带 exact repo-relative paths 的 architecture brief，再让第二阶段只返回 bounded graph schema。见 [`prompts.ts`](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/prompts.ts#L1-L50)。
- graph IR 上限为 10 groups / 34 nodes / 48 edges，graph planning 最多 3 次；schema 限制 ID、文本、shape、edge style 与 path。见 [`graph.ts`](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/features/diagram/graph.ts#L7-L90)。
- 每次 model graph 都会验证 duplicate IDs、group membership、真实 repo path 与 edge endpoints；失败时把 previous graph、file tree 与精确 validation feedback 送回下一次，最多三次。见 [`server/generate/graph.ts`](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/graph.ts#L90-L175) 与 [`graph-planner.ts`](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/graph-planner.ts#L72-L225)。
- 通过的 IR 再由 deterministic compiler 转 Mermaid；成功 artifact 与 terminal audit 被持久化。README 对整条 pipeline 有一致描述。见 [`README.md`](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/README.md#L49-L59)。

**可借鉴**

- validator 的精确 feedback 进入下一轮，而不是整图重新猜。
- retry 必须 bounded，receipt 应记录实际 attempts / corrections。
- 对“从仓库画图”的更高阶后续，可把节点与关系绑定到真实 source path；但这是 semantic provenance 的下一切片，不应塞进本轮 geometry / perceptual gate。

**明确不借鉴**

- 不用 Mermaid / ELK 替换 Archify 的 typed renderer 与 exact geometry。
- 不引入 R2、Redis、quota、provider、SSE 或 web persistence。
- 不原样照搬 34-node / 48-edge 上限；Archify 的复杂度预算应按 diagram type / profile 校准。
- 不在本轮给所有 Archify schema 新增 source-path 字段；这会把一个可小步验证的交付门扩大为跨五类 IR 的 provenance 迁移。

## 建议实现边界

### 代码与契约

1. 在共享 `cleanFlowProblems()` 中移除“没有 profile 就跳过”的 early return；source / target exemption、container / lifeline intentional pass-through 语义保持不变。
2. profile 仍只控制审美更强的规则：proper X crossing、short / micro segment、route rhythm 等。不要借机把所有 profile-less legacy artifact 变成 hard failure。
3. 在 `SKILL.md` 增加 perceptual delivery gate：最终 HTML + canonical raster、明确 defect taxonomy、最多两轮、每轮重跑确定性门、如实 receipt。
4. 不增加新 CLI command 或 receipt sidecar。v1 复用现有 `validate --json` 作为机器证据；handoff receipt 只补图像复核状态与轮次。

### 不在本轮实现

- obstacle-aware A* / ELK / Graphviz auto-router；hard fail + 现有 `via` / side hints 先建立正确性下限。将来如果要做，应该只在当前 `auto` 路径确实撞障碍时比较少量 deterministic dogleg candidates，避免无谓改动 golden geometry。
- 自动审美打分、跨图排行榜或“100 分”声明。
- repo path provenance / explanation planner；它很有价值，但应独立设计 schema 与 evidence contract。
- PR #28 的当前 regex patch；先补完字符覆盖与真实字体测量证据。
- 新 preset、图类型、vendor icon、mobile UI、托管服务、浏览器依赖或后台 daemon。

## 测试与验收

### 必须自动化

1. **共享单测**：无 `profile`、无 `ARCHIFY_QUALITY_PROFILE` 时，relationship 穿过无关节点仍返回一条 `clean-flow/edge-through-node`；source / target boxes 仍豁免。
2. **#24 exact regression**：使用 issue 中 3 components / 1 auto connection，省略 `quality_profile`：
   - `render` 与 `validate` 必须 non-zero；
   - stderr 必须包含 diagram type、`connections[0]`、`api -> queue`、`cache`、首个 segment、2px clearance 与 `fromSide` / `toSide` / `via` 修复提示；
   - issue 给出的安全 `via` workaround 必须通过。
3. **边界保护**：profile-less 的 unrelated proper X crossing、route rhythm 等仍按原 compatibility 语义处理；本轮只能把 edge-through-node 升为 universal correctness failure。
4. **五 renderer 语义保护**：现有 workflow / architecture / dataflow / lifecycle Clean Flow fixtures 全绿；sequence lifeline、activation、segment 与各种 container 仍保持 intentional pass-through。
5. **交付契约测试**：锁定 SKILL 中 deterministic-first、最终像素检查、最多 2 轮、每轮重跑、`passed` / `skipped`、真实 correction count，以及“vision 不得覆盖 deterministic failure”。
6. 在 `archify/` 运行 `npm test`。
7. 因 `SKILL.md` 是发布物，运行 `scripts/build-zip.sh /tmp/fresh.zip`，将解压内容与 `archify.zip` 比较；准备发布时重建并提交 archive，不能只改源码树。

### 必须人工 / agent 视觉验收

用最终 browser artifact 和 canonical PNG 检查至少一个 architecture 成品：

- 无隐藏在 component 后、会改变 topology 读法的路径；
- 无 clipping、node / label overlap、stacked edges、legend 遮挡；
- 主路径、次要路径与 boundaries 层级清楚，留白均衡；
- CJK 与 ASCII 混排的 label 可读；
- light / dark 都可辨识；
- 若做过修正，最多两轮且每轮后 `validate --json` 仍通过。

### 完成标准

- #24 profile-less repro 从“静默成功”变为“可操作的 hard failure”；安全 route 通过。
- `npm test` 与 ZIP freshness gate 通过。
- 最终 handoff 同时给出机器 validation receipt、`visual_review` 真实状态和 correction count。
- 无 schema / preset / diagram type / mobile / hosted surface / runtime dependency 增量。

## 风险与后续

- **兼容性风险（已知且有意）**：过去靠 paint order 隐藏错误路径的 profile-less v1 文件会开始失败。建议在 release notes 中明确标为 semantic correctness fix，而不是普通 composition tightening。
- **误报风险**：共享 obstacle 集合必须继续只包含 opaque semantic nodes；container、lane、stage、lifeline、activation 等 intentional pass-through geometry 不得误塞进来。
- **视觉复核不可机器证明**：v1 的 `visual_review` 是真实执行状态，不是假装客观的视觉分数；无 image reader 必须 skipped。后续若需要可审计 artifact，可单独设计截图 hash / evidence path，而不是把服务端存储带入本轮。
- **下一优先级**：本切片稳定后，再评估“只在当前 auto dogleg 撞障碍时比较 H-V-H / V-H-V 两个候选”的 renderer-owned 小路由优化；它可减少一次人工 `via` 修正，但不应抢在 universal correctness gate 之前。
