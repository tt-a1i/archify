# Codex Goal：自适应画布 + Workflow 约束编译器纵向切片

> 状态：可直接执行
>
> 决策依据：[Issue #175 / PR #208 数据核验与方案评估](./issue-175-infinite-canvas-performance-assessment-2026-09-18.md)
>
> 市场参考：[无限画布方案研究](./research-infinite-canvas-options-2026-09-18.md)

## Goal

在当前 Archify 仓库中实现并验证一个**有边界的纵向切片**：以 Workflow schema v2 为 compiler-owned geometry 试点，使省略 `meta.viewBox` 的工作流从语义输入确定性地产生可容纳全部内容的 canonical frame；复用现有 `Archify.view` 提供二维 camera 浏览；补齐可归因的 repair/performance receipts；最后用固定输入、固定版本、固定质量合同的 matched A/B 判断该方向是否值得扩展到其余四类图。

本 Goal 的性能主张必须来自真实端到端 matched evidence。冻结候选后的机械流水线提速只能作为辅助指标，不能代替模型创作、验证、修复、视觉检查和交付的 handoff-ready 时间。

## 为什么选择这个切片

- 历史上能明确归因给 viewport overflow 后返工的时间为 `284.759s / 2,637.592s = 10.80%`；无限画布是有价值的 viewer 能力，但不足以独立承担 20–30% 端到端目标。
- PR #208 基线 A 的 Validation/repair 为 931.341s，占 50.9%；Workflow 单类为 268.579s，且 PR 协作者记录了 19 个自动验证轮次。
- 现有 `compileWorkflow()` 已经拥有 schema v2 intrinsic viewBox、受限 feedback loop、确定性 receipt 和 legacy v1 路径；现有共享 HTML viewer 已经拥有 `Archify.view` camera。应深化这两个现成 module，而不是引入第二套 Scene 或替换 SVG。
- Workflow 试点通过后才有资格提炼通用 `compileDiagram()` interface；只有一个 compiler adapter 时，不创建 hypothetical seam。

## 成功结果

Goal 完成时必须同时得到：

1. 一个兼容现有 schema/CLI/HTML/export 的 Workflow v2 自适应场景实现；
2. 一个不改变 canonical geometry 的共享二维 camera 行为；
3. 能把每次失败归因到 bounds、route、label、readability、semantic、language 或 infrastructure 的稳定 receipt；
4. 一组 checked-in 的 matched A/B manifest、原始 receipts 和汇总报告；
5. 明确的 go/no-go 决策：扩展到 Lifecycle/Dataflow/Architecture，或停止把该方向当作性能项目；
6. 没有用降低语义覆盖、质量门、可读性、导出完整性或兼容性换取速度。

## 范围

### 本 Goal 内

- 精确记录当前 HEAD 的 Workflow 端到端基线。
- 深化现有 `compileWorkflow({ workflow, qualityProfile })` module。
- Workflow schema v2 且省略 `meta.viewBox` 时，由 compiler 根据最终 paint bounds 产生 canonical frame。
- Workflow schema v2 显式 `meta.viewBox` 继续作为 fixed capacity contract。
- 复用和完善现有 `Archify.view` 的 pan、zoom、fit、focus、search/guided-view handoff。
- 调整 visual-check，使“页面不 overflow”“入口可读”“全图可到达”“canonical export 完整”成为彼此独立的证据。
- 新增大 Workflow、显式窄 viewBox、负坐标/absolute pin、长 CJK label、复杂 route/channel 的确定性 fixtures。
- exact-commit matched A/B，以及继续迁移或停止的书面决策。

### 本 Goal 外

- 不迁移 Architecture、Sequence、Dataflow、Lifecycle 的 authoring schema 或布局算法。
- 不引入 tldraw、React Flow、Canvas、WebGL 或新的渲染引擎。
- 不新增公共 layout/router/bounds plugin SDK。
- 不新增 `meta.canvas`、`meta.camera` 或并行 Scene schema。
- 不把 minimap、history、collaboration、LOD、virtualization、culling 当作 MVP 必需项。
- 不让模型直接控制 camera 初始状态。
- 不把当前 viewport 或用户最后一次 camera 状态作为默认 export 范围。
- 不把 machine-only ABBA 的结果宣称为端到端提速。
- 不在没有第二个真实 adapter 前公开通用 `compileDiagram()` interface。

## Module、interface 与 seam

### 1. Workflow compiler module

外部 seam 保持现有 interface：

```js
compileWorkflow({ workflow, qualityProfile })
  -> { ok: true, svg, receipt }
  |  { ok: false, diagnostics, receipt? }
```

调用者只提交解析后的 Workflow document 和质量档位。以下 implementation 必须隐藏在 module 内部：

```text
schema + semantic validation
→ canonicalize v1/v2 input
→ measure node/text/legend constraints
→ solve ranks, lanes and groups
→ choose ports, route families and channels
→ place edge labels
→ compute bounds and canonical frame
→ bounded quality fixed-point
→ serialize immutable SVG and deterministic receipt
```

调用者不能选择 solver、router、feedback 顺序或内部 operation budget。测试通过 `compileWorkflow()` 的可观察结果验证行为，不穿透到内部 candidate score 或迭代状态。

### 2. Viewer camera module

继续使用现有 `Archify.view` interface。camera 只拥有 session state：scale、translation、mode 和 transaction；它不得修改：

- authored Workflow document；
- compiler receipt；
- SVG `viewBox`；
- scene/canonical artifact hash；
- full export bytes。

search、guided views、Story、relationship focus 和直接 node focus 均通过同一个 camera seam 完成导航，不各自维护 transform。

### 3. Measurement module

基准运行必须记录 immutable input、environment 和阶段 receipt。性能汇总从 receipts 派生，不从终端文本人工抄写。报告 interface 至少输出：

- `artifact-ready`、`review-ready`、`handoff-ready`；
- authoring、validation/repair、delivery、visual、reporting、barrier wait；
- validate attempt、失败 attempt、candidate mutation 三种独立计数；
- diagnostic code、candidate before/after hash、是否发生 mutation；
- project/Archify revision、model/reasoning、prompt/config/runtime hash；
- artifact、quality receipt、layout receipt hash。

## Bounds 定义

实现和 receipt 必须区分以下概念，禁止继续把它们都称为 canvas：

| 名称 | 定义 | 所有者 |
|---|---|---|
| `layoutBounds` | compiler 解出的节点、lane、group、phase 等结构性矩形并集 | compiler |
| `geometryBounds` | layout 加上最终 edge paths、端口、arrow marker 的几何范围 | compiler |
| `paintBounds` | geometry 加上 stroke、label mask、文本、legend、brand mark 等真实绘制范围 | compiler/renderer |
| `canonicalFrame` | `paintBounds` 加确定性 contract padding 后的完整场景范围；显式 viewBox 时等于 authored fixed frame | compiler |
| `viewport` | 浏览器当前可见 CSS 像素区域 | viewer session |

所有 bounds 使用同一 SVG user-space，数值必须 finite、确定且可序列化。camera transform 不参与任何 canonical bounds 计算。MVP 不保存单独的 `exportFrame`；默认 exporter 直接消费 `canonicalFrame`，避免两份相同状态发生漂移。

## 输入行为矩阵

| 输入 | 行为 |
|---|---|
| Workflow v1 | 完全保留 fixed-v1 语义和 byte-stable golden；不得被自适应布局静默重解释 |
| Workflow v2，无 `meta.viewBox` | compiler 从最终 paint bounds 推导 canonicalFrame；正常内容不得产生 `workflow/viewbox-capacity` |
| Workflow v2，有足够大的 `meta.viewBox` | 该值是 fixed capacity；geometry 不因额外空间被任意拉伸 |
| Workflow v2，显式 viewBox 太小 | 返回稳定 `workflow/viewbox-capacity`，包含 actual、required、content bounds 和 contributors；不得静默扩大 authored frame |
| Workflow v2，absolute pin 导致负原点或不可行 geometry | 返回 typed conflict；不得移动 pin、删除 label 或隐藏 overflow |
| 其余四类图 | 保持现有 schema、renderer、quality 和 export 行为，只共享兼容的 viewer camera 修复 |

## 大图产品合同

“无限画布”在本 Goal 中表示 camera 可以浏览由内容确定的有限 world，不表示坐标无界或验收取消。

- 页面 shell 在四个正式 viewport 中不能产生 document-level 横向或纵向 overflow。
- Fit-all 必须能到达全部 paint bounds，但 Fit-all 时不要求所有细节同时可读。
- 默认入口必须满足以下二者之一：
  - Fit-all 的 projected node text 达到现有 6px desktop readability 门；或
  - artifact 提供有效的首个 guided/focused view，该入口达到相同门槛，且用户能一键回到 Fit-all。
- search、outline/guided view、node focus 和 relationship focus 必须能到达任何语义实体。
- canonical export 必须包含完整图；viewport export 若未来需要，必须是显式的另一个命令，不进入本 Goal。

## 实施阶段

### P0：先建立可归因基线

1. 固定 base/candidate commits、Workflow corpus、项目 revisions、model、reasoning、prompt、runtime 和质量档位。
2. 给 repair receipts 增加稳定 diagnostic family、candidate hash 和 mutation 标记。
3. 分离 agent work、suite wall、barrier wait、shared browser 和 reporting。
4. 生成基线原始 receipts；没有基线不得修改性能结论。

### P1：深化 Workflow compiler

1. 保持 `compileWorkflow()` interface 和 fixed-v1 adapter。
2. 让 readable-v2 的 text measurement、node sizing、rank/lane gap、route/channel、label 和 paint bounds 在一个受限 fixed-point 中收敛。
3. implicit frame 从 paint bounds 推导；explicit frame 只做 capacity validation。
4. receipt 增加稳定 bounds、contributors、layout digest 和 operation-budget outcome，不暴露候选评分细节。
5. 所有自动修复必须通过完整重新规划验证；不得建议删除语义或降低质量档位。

### P2：viewer 与质量合同

1. 保持现有 SVG 与 `Archify.view`；实现有限 world 上的 pan/zoom/fit/focus。
2. camera transaction 必须可完成、替换、取消，并在 pointer cancel、reduced motion、keyboard 操作下正确收尾。
3. visual-check 分别记录 shell containment、entry readability、world reachability 和 export completeness。
4. 让同一 artifact 在 light/dark 和四个正式 viewport 下稳定，不产生外部网络请求。

### P3：matched A/B 与决策

1. A、B 使用不可变 commits，按 AB/BA 交错顺序运行；同一 pair 固定所有非被测变量。
2. machine-only 与 observed-agent 分开报告。
3. 保存原始 manifests/receipts/results；汇总必须能从原始文件重新生成。
4. 根据下述门槛给出 expand、retain-as-UX-only 或 stop 三选一结论。

## 验收标准

### A. 功能与兼容性，全部必须通过

- `node scripts/run-tests.mjs` 零失败；需要 Chrome 的契约测试在可用环境中实际运行，不能永久依赖 skip。
- Workflow v1 官方 fixtures 的 SVG/golden byte-for-byte 不变。
- 其余四类图的 schema、golden、CLI、HTML、SVG 和 export 无回归。
- v2 implicit fixture 的 `paintBounds` 全部包含在 canonicalFrame 内，并带确定性 padding。
- v2 explicit capacity failure 给出精确 required frame 和 contributors，且不会改写输入。
- 同一输入重复运行及无语义影响的数组重排产生相同 SVG、layout digest 和 receipt bytes。
- camera 操作前后 SVG `viewBox`、语义节点/边、artifact hash 和 full export bytes 不变。
- 全部诊断均为 typed、causal、无 Node stack，且 supported fix 已经过完整重规划验证。
- facts、nodes、edges、views、source evidence、语言门和 9/9 质量门均不减少。

### B. 大图体验，全部必须通过

- 增加至少一个 `>=30` nodes、`>=40` edges、含长 CJK labels、跨 lane route、回流 channel 和 guided views 的 Workflow fixture。
- 在 `1440×900`、`1600×1000`、`1920×1080`、`2048×1320` 下，light/dark 均无 document-level overflow、viewer chrome 遮挡或不可恢复 camera transaction。
- Fit-all 能覆盖完整 paint bounds；search/focus/guided view 能到达 fixture 的每个 node 和每条有 ID 的 edge。
- 入口视图符合 6px projected text 合同；若使用 focused entry，必须提供明显且可键盘操作的 Fit-all 返回路径。
- PNG/JPEG/WebP/SVG/WebM 和打印继续使用 full canonical frame，不受最后一次 camera state 污染。

### C. 观测性，全部必须通过

- 每一次 validation attempt 都能关联 input hash、candidate hash、diagnostic code、duration 和 mutation outcome。
- 能分别查询 `viewport-containment`、`viewbox-capacity`、`node-overlap`、`edge-crossing`、`label-clearance`、`readability`、`semantic`、`language`、`infrastructure` 的次数和耗时。
- 汇总中的每个数字都能追溯到 checked-in 或明确归档的原始 receipt；不得只存在于 PR 评论或聊天转录中。
- 并发 agent envelope 不相加冒充用户等待时间，shared visual 不重复计费。

### D. Workflow 试点性能门槛

至少使用 6 个固定 Workflow sources；每个 source 的 A/B 至少运行 3 个交错 pair。以下条件同时成立才判定 compiler pilot 通过：

- paired median Validation/repair 时间下降 `>=30%`；
- paired median handoff-ready 时间下降 `>=10%`；
- handoff-ready P95 不得恶化超过 `5%`；
- implicit 模式的 viewport/viewBox-capacity 返工下降 `>=80%`；
- bounded-stop 数量为 0，首次候选通过率不下降；
- 最终语义、节点、边、views、质量门和人工盲审不回退。

若只通过 machine-only ABBA，功能切片可以合并，但不得声称端到端性能 Goal 已完成。

### E. 扩展决策

- **Expand**：D 全部通过。下一 Goal 按 Lifecycle → Dataflow → Architecture 顺序增加第二、第三、第四个 compiler adapter；第二个 adapter 存在后再评估通用 `compileDiagram()` seam。
- **Retain as UX only**：功能、大图体验通过，但 Validation/repair 或 handoff-ready 未达到门槛。保留 camera/automatic bounds，不再以它宣称 20–30% 性能收益。
- **Stop/Rethink**：质量、兼容、P95 或 bounded-stop 回退；恢复性能相关行为，只保留独立证明有价值且无回归的最小 viewer 修复。

五类图整体达到 20–30% 的声明必须等到至少 Workflow、Lifecycle、Dataflow、Architecture 完成相同 observed-agent matched A/B；Sequence 作为低 repair 对照，不因目标数字被强制重写。

## 必须交付

- 实现与测试；
- bounds/receipt/interface 文档；
- 大 Workflow fixture 和视觉证据；
- 可重跑的 benchmark harness、manifest、raw receipts、聚合脚本和结果；
- base/candidate commit、环境和限制说明；
- 性能与质量对照表；
- expand / retain-as-UX-only / stop 决策；
- 设计消融记录。

## 设计消融要求

完成实现后，逐项移除一个候选并重跑相关验收：

1. 新公共配置或 interface；
2. 仅有一个 adapter 的 seam；
3. 重复的 bounds/state；
4. minimap、LOD、culling、history 等非必要 UI；
5. 与现有 `Archify.view` 或 `compileWorkflow()` 重叠的 module；
6. 只为测试暴露的 implementation detail。

当移除后所有验收仍通过时永久删除；不通过时恢复，并在最终报告中给出失败证据。不得仅以“未来可能有用”保留抽象。

### 本次设计阶段已经完成的消融

- 尝试加入公共 `compileDiagram()`：只有 Workflow 一个真实 adapter，删除后纵向切片仍完整。**已移除，等第二个 adapter 出现再评估。**
- 尝试加入独立 `exportFrame`：MVP 中始终等于 `canonicalFrame`，删除后完整导出验收不变。**已移除，exporter 直接消费 canonicalFrame。**
- 尝试把 camera 写入 schema：删除后 pan/zoom/focus、确定性 artifact 和复现性更清晰。**已移除，camera 只保留 session state。**
- 尝试加入新 Scene schema、渲染引擎和 plugin SDK：删除后当前 Goal 的所有验收仍可由现有 SVG、viewer 和 Workflow compiler 达成。**已移出 Goal。**
- 尝试在一个 Goal 内迁移五类图：删除其余四类 compiler 后仍能验证核心假设，并显著缩小回归面。**已收缩为 Workflow 试点。**
- 尝试删除 fixed-v1 adapter：会破坏既有 fixture、golden 和 schema 合同。**已恢复保留。**
- 尝试合并 `layoutBounds`、`geometryBounds`、`paintBounds`：会失去对布局、路径和真实绘制越界的归因能力。**已恢复保留。**
- 尝试只保留聚合统计、不保存 raw receipts：无法复算 matched A/B，也会重演 PR 评论级证据链中止。**已恢复保留。**

## 执行纪律

- 先测量，再修改；先完成 Workflow 纵向切片，再讨论五类统一抽象。
- 使用现有 schema、SVG、viewer、CLI、quality gates 和 export pipeline。
- 每个阶段保持可合并；不要把 P0–P3 做成一个不可审查的大提交。
- 发现当前 PR/分支含冲突、未提交用户修改或基线不可复现时，先保存证据并停止性能声明，不得补造数据。
- 最终报告必须区分事实、推断和尚未验证的假设，并明确说明消融中删除和恢复了什么。
