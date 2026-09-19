# Codex Goal：有限 canonical world + 共享大世界 Viewer 纵向切片

> 状态：**待用户确认；不得自动执行**
>
> 执行门：只有用户后续明确引用本文件并要求执行时，才开始 P0。仅阅读、生成或讨论本 Goal 不构成执行授权。
>
> 前序试点：[自适应画布 + Workflow 约束编译器纵向切片](./codex-goal-adaptive-canvas-workflow-compiler-pilot.md)
>
> 前序结论：[自适应画布 + Workflow 约束编译器试点报告](./adaptive-canvas-workflow-compiler-pilot-report-2026-09-18.md)
>
> 方案复审：[Archify 无限画布适配性重新审核](./infinite-canvas-suitability-reaudit-2026-09-18.md)

## Goal

以用户指定的、已包含前序 Workflow 自适应画布试点的 immutable source commit 为 base，在用户授权的 writable candidate worktree 中，**仅深化现有共享 `Archify.view`**：为 standalone desktop viewer 提供固定阅读 viewport；当 Fit-all 的主标签投影字号低于现有可读性门槛时，确定性进入一个可读局部；聚焦缩放根据目标 bounds 和投影字号动态求解；现有 Reset/`0` 仍一键返回完整 Fit-all。

保持以下合同不变：

- 有限 canonical SVG 是场景、校验和 full export 的唯一真值；
- Workflow v2 的 `layoutBounds → geometryBounds → paintBounds → canonicalFrame`、`layoutDigest` 和 operation budget 不重做；
- 现有 `Archify.view` 公共方法、五类 typed input、五类布局语义和 standalone HTML/SVG 交付方式保持兼容；
- 显式 URL/hash/deep-link 意图优先于自动入口；
- camera 只拥有 session state，不进入 schema、canonical geometry、artifact hash 或 full export。

使用冻结的 Workflow 与 Architecture 30/100/300 节点语料验证正确性、可读性、兼容性和 Viewer runtime 预算；仅在 300 gate 通过后，1000 节点才作 conditional、measurement-only 压力记录。该证据决定是否另开 culling、semantic partition 或 compiler-capacity Goal。**本 Goal 不实现 culling、virtualization、新 LOD 或新 Scene，也不让任何 renderer/compiler 获得新的自动扩容能力。**

## 最终方案

### 产品模型

采用“**交互上是大世界，内容与导出上有界**”的混合模型：

```text
typed document
  → existing renderer/compiler
  → finite canonical SVG + canonicalFrame
  → shared fixed viewer viewport
  → session-only camera
  → full export from the finite canonical SVG
```

“大世界”表示 Viewer 能浏览 renderer 已经交付的任意有限 canonical world，并能在固定屏幕窗口中平移、缩放、搜索和聚焦；不表示本 Goal 会让五类文档自动扩容，也不表示数学无界坐标、无限 DOM、无限内存或无限栅格导出。现有 Workflow v2 implicit frame 的内容驱动扩容仍是 renderer 侧既有能力，Architecture 等图类继续消费各自既有的有限 viewBox。

### Module、interface 与 seam

外部 seam 继续是现有 `Archify.view` interface：

```js
Archify.view.zoomIn()
Archify.view.zoomOut()
Archify.view.reset(options?)
Archify.view.reveal(ids, options?)
Archify.view.centerAt(x, y, options?)
Archify.view.logicalViewport()
Archify.view.sync()
Archify.view.state()
```

不得要求现有调用者迁移。`reset()` 和键盘 `0` 继续严格表示完整 Fit-all；不新增含糊的第二个 Home/Fit Graph 公共概念。

本 Goal 不新建 `WorldView.navigate/snapshot/subscribe` interface、不增加 subscriber fan-out，也不要求 adapter 重构。实现优先留在现有 Viewer module 内，通过私有 helper 隐藏：

- world ↔ screen 坐标换算；
- safe stage 与 viewer chrome 遮挡；
- Fit-all、实体 bounds、点位和 zoom intent 的 camera target；
- 动态 finite zoom、安全上限和 detail level；
- 自动入口 lease、transaction replacement/cancel、resize/font-ready 竞态；
- desktop CSS transform 与必要的 camera ARIA 状态。

几何和状态机属于 in-process 依赖。DOM、`getBBox()`、`requestAnimationFrame`、timer、font readiness 和 ResizeObserver 属于 local-substitutable 依赖；只有两个 production caller，或实现与确定性测试 fake 两个真实 adapter 都出现时，才允许抽取私有 seam。不得为单一实现公开 port；任何仅为测试暴露的新 surface 必须在消融中优先删除。

### Large-world 触发

产品触发条件只由 Fit-all 后的实际投影可读性决定，**不得按节点数、图类型或作者配置硬编码**。

6px 门槛与标签集合继续以 `archify/renderers/shared/desktop-readability.mjs` 为单一事实源：

```text
text[data-node-label]
text[data-boundary-label]
node 内的 text[data-detail="context"]
```

二维投影合同在本 Goal 确认时即冻结，不得由 P1 或 baseline 结果重新选择：

```text
worldScaleFit = min(safeStageWidth / canonicalWorldWidth,
                    safeStageHeight / canonicalWorldHeight)
projectedTextPx = sourceFontWorldUnits * worldToCssScale
requiredReadableScale = 6 / minimumTargetSourceFontWorldUnits
targetFitScale = min((safeStageWidth  - 48) / targetBoundsWidth,
                     (safeStageHeight - 48) / targetBoundsHeight)
maximumWorldToCssScale = max(worldScaleFit,
                             min(worldScaleFit * 32, 4 CSS-px/world-unit))
targetWorldToCssScale = max(worldScaleFit, requiredReadableScale)
cameraMultiplier = targetWorldToCssScale / worldScaleFit
```

- SVG 保持 `preserveAspectRatio="xMidYMid meet"`，禁止非均匀拉伸；48 表示目标四边各 24 CSS px safe padding。
- Fit-all 的 `worldToCssScale = worldScaleFit`。仅当 `targetWorldToCssScale <= min(targetFitScale, maximumWorldToCssScale)` 时，该目标才同时“完整可容纳且可读”。上述 world-to-CSS scale 的单位是 `CSS-px/world-unit`；现有 `Archify.view.state().scale` 与 zoom 百分比始终使用无量纲 `cameraMultiplier`，Fit-all/Reset 必须为 `1`，不得把绝对 scale 暴露进公共 API。receipt 同时记录两种值与单位。
- safe stage 是 stage 内扣除当前可见 Dock、Legend、Focus panel 遮挡后最大的轴对齐可用矩形；其 width/height 与遮挡清单写入 receipt。
- 为避免 profile 循环依赖，分类时先按“固定阅读 viewport”公式构造 prospective stage/safe-stage，再计算 Fit-all 投影；判为 small 后才保留既有 overview 呈现。
- 比较使用未舍入的有限 double；receipt 仅展示到小数点后三位。边界测试固定为 `5.99px → large`、`6.00px → small`、`6.01px → small`。
- 字体加载完成、reader layout 和 viewer chrome 稳定后测量。二维规则以新增 export 写入 authoritative module；现有 `projectedNodeTextPx()`、`minimumReadableSourceTextPx()` 的签名、返回行为及其 renderer 输出必须保持兼容。browser runtime 消费由 `scripts/generate-viewer.mjs` 从新增 export 序列化注入的只读 contract；Node static check、visual-check 与测试直接 import 同一 module。生成测试必须证明注入值逐字段一致，禁止在 classic browser script 中手抄第二份常量。

现有 deterministic readability quality gate 改为 **profile-aware，而不是删除或降级**。证据生命周期固定为：

```text
static check
  → small-static-pass 或 potential-large/pending-browser
  → 生成 candidate artifact
  → real-Chrome 读取实际 font/stage/chrome 并确定 final worldProfile
  → handoff-ready 合并两份 artifact-bound receipt
```

static check 拿不到实际 stageTop、below-stage content、overlay occlusion 或 font-ready 后尺寸，因此不得声称 final `worldProfile`，也不得读取/等待 Chrome receipt。它继续对明确 small 的现有 width-based 合同强制 `>=6px`；对 potential-large 则验证 canonical/font/semantic candidate 数据 finite，记录 overview estimate 与 `browserEvidenceRequired: true`，允许先生成 artifact。real-Chrome 随后用二维公式确定 final profile：small 强制 Fit-all `>=6px`；large 的 Fit-all/overview `<6px` 只记录，entry/focus 强制 `>=6px`。handoff-ready 任一 receipt 缺失都不得宣称 large-world browser evidence passed。质量门数量、其他强度和 small-profile 语义不得减少，两条证据管线不得倒置或合并。

行为矩阵：

| 条件 | 初始行为 |
|---|---|
| Fit-all 主标签投影字号 `>=` 合同门槛 | 保持现有 overview/Fit-all 行为 |
| Fit-all 主标签投影字号 `<` 合同门槛 | 进入 large-world，选择确定性可读入口 |
| bounds、字体或投影测量无效 | 保持现有 runtime 返回语义并安全回退 Fit-all；receipt 记录 typed error，不得把未知当作通过 |
| 达到内部安全 zoom 上限仍不可读 | `viewer/entry-text-unreadable`；不得伪报通过 |

30/100/300/1000 仅是实验规模，不是产品触发阈值。

### 自动入口与用户意图

自动入口优先级固定为：

```text
合法 URL/hash/deep-link intent
→ 第一个有效 guided view
→ 稳定的 start node
→ 按 canonical DOM 顺序的第一个有效 node
→ Fit-all + typed entry failure
```

“有效”表示 ID/endpoint 可解析、union bounds finite 且位于 canonical world，并能按上面的 24px padding、6px readability 和 camera cap 同时完整容纳。过大的 automatic guided candidate 记录 warning 后继续下一个候选，不得裁切目标来伪造有效入口。

合法 URL/hash/deep-link 是显式用户意图，始终优先；目标无法解析时回退完整 world Fit-all 并记录 semantic diagnostic；目标有效但过大时采用最佳完整 Fit 并记录 readability diagnostic。两种情况都不得悄悄改选其他 automatic candidate。用户主动选择的过大 relationship/guided target 也采用相同“完整性优先 + 不可读 diagnostic”规则；单节点 Search/Focus 必须满足 6px 门。

自动入口持有一个私有 lease。以下任一真实用户意图发生后，lease 永久释放：trusted pointer pan、wheel/button/keyboard zoom、Reset/`0`、用户选择 search/focus/relationship/guided view、初始化完成后的 hash 变化，以及外部调用 `Archify.view` camera 方法。内部 automatic entry 与 bootstrap hash sync 使用私有 origin 标记，不释放 lease；不得改变公共方法签名。迟到的 `document.fonts.ready`、ResizeObserver、rAF 或 layout settle 不得覆盖用户已选择的 camera，也不得把内部 `reveal()` 一律误判为用户输入。

### 固定阅读 viewport

large-world 只在普通 standalone desktop viewer 中改变阅读模型：

- profile 仅在 viewport width `>720px` 且 `availableStageHeight >=360px` 时适用；其中 `belowStageRequiredHeight = outerHeight(visible .cards) + shellPaddingBottom + bodyPaddingBottom`，`availableStageHeight = floor(innerHeight - stageTop - belowStageRequiredHeight - 24px)`；
- `stageHeight = min(900px, availableStageHeight)`，stage width 使用 reader content box；canonical world 大小不得进入这两个公式；
- stage 可以裁切当前 viewport 外的 scene；这是 camera 的正常行为；
- document 级横向和纵向 overflow 仍为失败；
- 不允许用内部滚动条冒充 camera；
- scene 完整性必须由 world reachability 和 full export 单独证明，不能由“屏幕上看不见”或 CSS clipping 推断。

同一 viewport/theme/chrome/below-stage content 下，100 与 300 fixture 的 stage `clientWidth` 和 `clientHeight` 差值各不得超过 1 CSS px；stage rect 与其后的 cards 必须完整位于 browser viewport，且 `abs(clientHeight - stageHeight) <=2 CSS px`。`outerHeight` 包含 margin；公式每个输入、输出和差值写入 receipt，不得靠省略 cards 过门。

`<=720px` mobile、`availableStageHeight <360px`、embed、presentation 和 print 在本 Goal 中只做兼容回归，不重设交互模型。若 desktop fixed stage 无法在不改变这些模式的情况下实现，暂停并报告，不得顺手重写它们。

## 执行前置条件 G0

当前工作区在本 Goal 编写时仍是 dirty working tree，`HEAD 8c3af8a1` 不包含全部前序试点改动。因此它不是可执行 baseline。

执行前必须全部满足：

1. 用户明确指定一个已经包含前序试点的 immutable source commit；
2. 用户授权一个基于该 commit 的 writable candidate worktree；branch、HEAD、status 和目标文件 hash 与用户指定来源一致；只有只读 worktree 时仅可跑 baseline，随后暂停，不得进入 P1；
3. 前序 30 nodes / 50 edges Workflow evidence 已归档并能绑定该 commit；
4. Node、Chrome 及版本、reference host、四个正式 desktop viewport、主题和字体环境已记录；
5. 现有 required tests 与真实 Chrome browser contracts 在该 source commit 上通过，required Chrome test 不得以 skip 代替通过；
6. 既有 baseline corpus 与 evidence 的 source hash 可验证；新 100/300/1000 corpus 在 P1 冻结，不作为 G0 的先验条件。

任一条件不满足时，只做只读 inventory，然后暂停并向用户报告。执行代理不得自行：

- commit 当前 dirty changes；
- stash、reset、clean 或覆盖未知改动；
- 把当前 `HEAD` 误称为“本次试点最新代码”；
- 覆盖现有 `archify.zip`、`pi-current.*` 或 `benchmarks/adaptive-workflow-pilot/**` 证据；
- 为获得可执行来源创建未经用户授权的 snapshot commit。

## 范围

### 本 Goal 内

- standalone desktop 的条件化 fixed camera viewport；
- Fit-all 与 large-world 两种派生 presentation profile；
- 动态 finite zoom、可读局部入口和 Reset/Fit-all 返回路径；
- 显式 deep link 优先、automatic-entry lease 和 camera transaction 收敛；
- 复用现有 Search、Focus、Relationship、Guided Views 和 Semantic Radar；
- shell containment、overview completeness、entry/focus readability、world reachability、canonical export completeness 的独立证据；
- edge path/label 的 canonical bounds 证明；
- canvas-backed export 的像素预算 preflight；
- Workflow + Architecture 30/100/300 规模证据；
- 五类现有 standalone artifacts 的 shared-viewer 兼容回归；
- 300 mandatory gates 通过后才生成的 1000 节点 measurement-only stress receipt；未通过时记录 `not-run: prerequisite-failed`；
- 技术决策、性能事实、未验证假设和设计消融报告。

### 本 Goal 外

- 数学无界空白和无限坐标持久化；
- 节点拖拽、创建、删除、手工连线、多人协作、undo/history 或 WYSIWYG；
- 修改任何 authoring schema、renderer、compiler、layout 或 router；
- 移除 Workflow 的六列/rank 约束、Dataflow stage 约束、Lifecycle lane/column 约束或 Sequence 时间轴语义；
- 新 `meta.canvas`、`meta.camera`、作者可配置阈值或公共 camera policy；
- 新的 artifact/runtime Scene Manifest、scene index、通用 vector AST、public plugin SDK 或 `compileDiagram()`；P1 的 test corpus manifest 与 visual-check 进程内一次性 audit inventory 不属于 Scene Manifest；
- tldraw、React Flow、Canvas、WebGL 或其他渲染引擎；
- 新 minimap、Outline 面板、camera history、分页或 viewport/selection export；
- culling、virtualization 或新增语义 LOD；现有 MAP/READ/FULL 样式行为保持；
- 把 1000 stress 当作正式支持声明；
- 把 Viewer runtime 结果宣称为 Issue #175 的 20–30% authoring、validation/repair 或 handoff-ready 提速。

继续实现若需要任一 Goal 外能力，立即暂停；保存触发证据，提出独立下一 Goal，不得在本 Goal 内条件扩张。

## 五类图边界

| 图类 | 本 Goal 证明什么 | 本 Goal 不证明什么 |
|---|---|---|
| Workflow | 复用既有 v2 finite canonical frame；完成 30/100/300 大世界 Viewer 证据 | 不增加第七 rank，不改 lane/route/compiler |
| Architecture | 作为第二个 30/100/300 大世界 Viewer 样本，消费既有 free/grid 坐标和 finite viewBox | 不新增通用自动布局或 boundary schema |
| Sequence | 现有小图 shared-viewer、camera、export、print 回归 | 不证明 100/300 participants，不改变 participant/time-axis 语义 |
| Dataflow | 现有小图 shared-viewer、camera、export、print 回归 | 不扩展 stage/row 布局，不进入规模 benchmark |
| Lifecycle | 现有小图 shared-viewer、camera、export、print 回归 | 不扩展 lane/column，不实现 cluster/fold |

“五类共享 Viewer 兼容”不得表述为“五类图已支持无限节点”或“五类 compiler 已完成大图布局扩容”。

## 实施步骤与完成标准

### P0：冻结来源与 baseline

1. 完成 G0 inventory；
2. 冻结 base source commit、既有 baseline corpus、Chrome/runtime 环境和测试命令；
3. 重跑五类现有小图回归、Workflow 30/50 browser contract 和全部 required Chrome tests；
4. 保存原始 baseline receipts，不从终端文本人工抄数；
5. 记录当前 Viewer 的 Fit-all、zoom、search/focus、Reset、export 和 30-node runtime 指标。

完成标准：来源可复现、baseline 全绿、required browser tests 无 skip、raw receipts 绑定 commit/artifact/environment。否则暂停，代码零修改。

### P1：合同先行

1. 在 `archify/references/delivery-contract.md` 中建立唯一 normative large-world 合同；
2. 把本 Goal 已冻结的二维投影、标签集合、门槛、字体时点、舍入和 profile-aware gate 写入 authoritative readability module，并由生成流程注入 browser contract；
3. 把本 Goal 已冻结的自动入口顺序、lease origin、模式排除、dynamic zoom cap/fallback 和 raster preflight 写成 contract；
4. 新增并冻结 Workflow/Architecture 30/100/300 与 conditional 1000 corpus manifest，包括 generator seed、source hash、nodes、edges、labels、regions、drawable fragments 和 edge density；
5. 先写 failing contracts，使旧实现仅因预期的新行为变红。

新增 corpus 不得靠稀疏图刷过门。除不可修改的原 30/50 Workflow fixture 外，每个新 fixture 必须满足：

- `1.5 <= edgeCount / nodeCount <= 2.5`，且最大弱连通分量包含 `>=90%` 节点；
- `>=10%` 关系跨 Section/lane/boundary；
- `>=20%` 节点含长度 `>=12` 个 CJK 字符的主标签或 context 标签；
- Workflow 至少 3 lanes、3 phases 和 1 条 feedback/return route；
- Architecture 至少 4 个 boundary/region，且 `>=10%` 关系跨 boundary。
- corpus manifest 至少标记一个可读 automatic entry 和一个合法但 oversized 的 guided/relationship target，用于分别证明成功路径与完整性优先 fallback。
- Workflow 与 Architecture 各至少一个 300-node valid target 满足 `3 < required cameraMultiplier <= maximum cameraMultiplier`，确保恢复旧 3× cap 必然使 readability contract 变红。
- 每个图类的 100/300 pair 的 canonical aspect ratio 相对差异 `>=20%`，且 canonical area 至少相差 2×；exact base receipt 还必须显示旧 reader sizing 的 stage-height 差值 `>32 CSS px` 或 document overflow，确保 fixed-stage 验收不是对无差异样本自证。
- 每个图类的 100/300 pair 使用相同且非空的 visible cards block（至少 2 张 card）；不得通过删 cards 获得 viewport containment。

原 30/50 Workflow 和既有生产输入不可修改；允许新增 manifest-bound test fixtures/generator。manifest 必须在首次 candidate 功能运行前冻结，此后 base/candidate 使用完全相同的输入、seed 与 source hash。

完成标准：所有阈值和语义只有一个事实源；reference oracle 与 manifest 已冻结以下期望：原 Workflow 30/50 与新 Architecture 30 control 在四个正式 desktop viewport 均应为 `worldProfile: small`，Workflow 与 Architecture 的 100/300 在 `1440×900` 均应为 `worldProfile: large`，且每个 large fixture 应至少有一个有效 `>=6px` 入口。旧 Viewer 对这些新 contract tests 以预期原因失败即完成 P1；不得要求尚未实现的 P2 行为先变绿，也不得修改 fixture 来制造 candidate 优势。

### P2：最小 Viewer 纵向切片

只在 shared Viewer、reader layout、export preflight 及其测试/文档中实现：

1. standalone desktop fixed camera viewport；
2. Fit-all/large-world profile 推导；
3. dynamic finite zoom 与 safe stage；
4. 确定性自动入口及 lease；
5. 现有 `Archify.view` compatibility interface；
6. Reset/`0` 完整 Fit-all；
7. full SVG canonical invariants；
8. canvas-backed export 在创建 canvas 前做格式对应的 preflight：PNG/JPEG/WebP 从 requested integer scale 向下选择满足预算的最大 scale，序列仅为 `requested → … → 1×`；若 1×仍超过 16,000,000 pixels，不创建 canvas并返回 `export/raster-budget-exceeded`。WebM 保持现有 fractional scale `min(1, 1280 / viewBox.width)`，按该实际 output width/height 独立计算同一 16M budget；超限同样不创建 canvas并报错。所有失败都建议 SVG，不存在第二种 fallback。

完成标准：P2 范围内的 deterministic unit/integration contracts 变绿，P1 reference oracle 期望由 candidate 满足；未修改 schema/renderer/compiler，未新增公共 interface、依赖或 UI。P3 的 artifact-bound real-Chrome、P4 的规模/性能和 P5 的最终决策此时尚不要求完成。

P2 实现稳定后、进入 P3 前执行本文件“实施结束必须执行的实际消融”。任何消融造成 candidate bytes/hash 改变，都先重新跑 P2 contracts，再由 P3/P4 只对消融后的最终 artifact 取证；不得让 final report 引用消融前 receipt。

### P3：Visual-check 与 CI

1. 将 scoped large-fixture world audit 拆为“全量静态证明”和“确定性真实导航样本”；五类普通兼容样本只重跑既有合同；
2. 全量静态证明覆盖当前 renderer 已暴露的 node ID、edge endpoint/key、node bbox、完整 edge path、authored edge label，以及存在时的 stroke expansion、marker/arrowhead、label mask、legend/brand 等 canonical drawable paint extent；不得要求 renderer 新增全局唯一 edge ID 或 compiler paint receipt；
3. 真实导航覆盖所有 guided views、四角极值、中心、跨区 node/edge 和固定 seed 样本；edge 样本必须证明 path 代表点与 authored label anchor 实际进入 safe stage，不得只 reveal 两端节点；
4. 30/50 允许继续 exhaustive navigation；100/300 不得用逐实体 camera animation 把 audit 本身变成瓶颈；
5. receipt 明确记录 `worldProfile`、`auditMode`、total/staticProof/navigated counts、sample seed、entry readability 和 export preflight；
6. receipt 语义改变时升级 schema version并提供兼容测试；
7. 把 large-world browser contract 加入 required real-Chrome CI；required lane 遇到 skip 必须失败。

完成标准：所有自动证据绑定 artifact hash；sample 不被表述为逐实体真实交互；Chrome required lane 实际运行。

### P4：规模证据

在固定 reference host 与 Chrome 上，对 base/candidate 使用相同 corpus 和相同交互 trace：

- 本 Goal 中的数值门、次数和算法在用户确认本文件时即冻结；P0 只记录环境，不得查看 base 后移动门槛；
- performance matrix 固定为 `workflow-30-control`（原 30 nodes/50 edges）、`architecture-30-control`、`workflow-100`、`architecture-100`、`workflow-300`、`architecture-300` 六个 artifact；每个 artifact 独立出 receipt、独立过适用门槛，禁止跨图 pooling、挑最快图或只报总体均值；
- performance 环境固定为 CSS viewport `1440×900`、`deviceScaleFactor=1`、browser zoom `100%`、light theme、`prefers-reduced-motion: no-preference`、无 CPU/network throttling；使用单一前台可见且 focused 的 headed Chrome page，reference host 接电且关闭 low-power mode，benchmark 不与其他 workload 并行。任一条件无法保证即暂停，不得用不同环境数字填补；
- cold load/initial stable 使用 10 个 `A→B` 与 10 个 `B→A` 独立 browser-context pair，即每个 condition 各 20 次；cold context 禁用 HTTP/disk cache；
- 每个 condition 的交互指标先运行 5 条完整 trace 丢弃，再按 15 个 `A→B` 与 15 个 `B→A` pair 记录各 30 条；固定 trace 为 `Reset → 10 次 zoom update → 10 次对角 pan update → Search manifest target → Focus → relationship target → guided view → Reset`，target ID/key 在 manifest 中冻结；
- P95 对每个定义的 operation raw sample 使用 nearest-rank `ceil(0.95 × n)`；不得先按 trace 求平均、trim outlier 或只报告最快样本；
- `coldLoad` 从 navigation start 到 `load` event；`initialStable` 从 navigation start 到 fonts ready、reader/stage/chrome stable、startup camera transaction settled，且 stage/camera snapshot 连续 3 个 rAF 不变；
- interaction latency 从 harness dispatch 前的 `performance.now()` 到新 camera transform 已提交后的下一个 rAF；long task 使用 `PerformanceObserver('longtask')` 的原始 entry；
- listener count 由 app script 执行前安装的同一 add/remove instrumentation 统计；heap 在 5 条 warm-up 后和 20 轮固定 navigation cycle 后分别通过同一 CDP garbage-collection protocol 收集；
- 1000 stress 的 initial-stable deadline 为 30s，单 artifact harness 总 timeout 为 180s；达到期限但未语义丢失时只允许 `viewer/stress-budget-exceeded` measurement receipt。

1. 原 Workflow 30/50 与新 Architecture 30-node compatibility/control；
2. Workflow + Architecture 100-node correctness 和 navigation；
3. Workflow + Architecture 300-node correctness、runtime 和 export；
4. `workflow-1000` 与 `architecture-1000` 分别只在同图类 300 artifact 的全部 mandatory gate 通过后运行 measurement-only stress；
5. 保存 cold load、initial stable、pan/zoom、search/focus、Reset/Fit-all、long task、DOM/fragment count、heap、export 和 pending transaction raw receipts。

Workflow 使用既有 `layoutDigest`，并校验固定 theme 的 deterministic full-SVG bytes；Architecture 不伪造 `layoutDigest`，改用 `canonicalSvgDigest = SHA-256(existing deterministic full-SVG UTF-8 bytes)` 与 `semanticInventoryDigest = SHA-256(sorted node IDs + sorted edge endpoint/key tuples 的 UTF-8 JSON)`。算法及 theme 写入 harness contract，base/candidate 必须一致。

完成标准：汇总能从 raw receipts 重新生成；base/candidate 按上述图类合同保持 canonical/semantic digest 一致；不存在通过修改 fixture、删实体、缩字体或降低质量门得到的结果。

### P5：证据与决策收口

最终分别输出两个正交决策，不得合并：

`technicalDecision`：

按以下优先级唯一映射；不得择优解释：

1. G0/P0 baseline 或 required environment 未成立时不进入实现，报告 `not-run: prerequisite-invalid`，不伪造 technical decision。
2. `Stop`：任一已执行 `B` gate 回退，或 A–E 中任一 functional/correctness `N` gate实际失败；这包括 schema/API 兼容、viewport containment、camera transaction、audit inventory、a11y、canonical invariant、可读入口、real-Chrome 功能合同和完整导出。
3. `Retain experiment`：不存在上述已知回退，但任一 required receipt 缺失/stale/skipped，或 F 中任一 runtime/performance `N` budget 未通过。
4. `Accept MVP`：全部 `B/N` gate 均有有效 receipt 且通过。

`promotionDecision`：

- `default-on`：Reader A/B 的全部 `P` gate 通过；
- `evidence-incomplete`：Reader A/B 未执行或样本不足；
- `opt-in-only`：Reader A/B 已执行但任一 `P` gate 未通过。

`promotionDecision` 只是 release/rollout 建议，不授权实现 feature flag、配置项、公共 policy 或新 UI。`default-on` 才建议合入默认交付；`evidence-incomplete`/`opt-in-only` 表示保留独立实验 branch/artifact、不得默认发布。“opt-in”不是产品内开关。`P` gate 不得改变 `technicalDecision`；`Accept MVP + evidence-incomplete` 是合法结果。`M` 级 1000 stress 也不改变任一决策或构成 1000 节点支持声明。

若 300 correctness 通过但 profiling 指向 offscreen DOM/paint、认知 hairball 或 compiler capacity，只在报告中分别提出 `next-culling-goal`、`next-semantic-partition-goal` 或对应 compiler Goal；不得继续实现。

完成标准：两个决策均绑定原始证据；“Goal 已执行”“技术可接受”“默认启用”“用户时间改善”“Issue #175 性能收益”分别陈述，不互相替代。

## 验收标准

证据等级：

- `B`：已有 baseline 类合同；必须在用户冻结的 source commit 上重跑；
- `N`：本 Goal 新增的 mandatory 证据；
- `P`：promotion-only；不满足时不能扩大宣传，但不伪造成 mandatory 通过。
- `M`：conditional measurement-only；只在其 prerequisite 通过后运行，不影响 technical/promotion decision，也不构成支持声明。

### A. 来源与兼容

- `[B]` 原 30/50 Workflow 的节点、边、guided views、canonical bounds、layout digest 和 full SVG export 不回退。
- `[B]` 原 30/50 Workflow 在四个正式 desktop viewport 下继续判定为 `worldProfile: small`。
- `[N]` 新 Architecture 30 control 在四个正式 desktop viewport 下判定为 `worldProfile: small`。
- `[B]` Workflow v1 byte golden 不变。
- `[B]` 五类现有 schema、renderer、canonical SVG geometry、CLI、9/9 quality-gate 数量与非 readability 强度、offline/self-contained HTML、camera、Radar、export 和 print tests 零失败。
- `[N]` HTML/viewer golden 可以因共享 Viewer 改变；canonical SVG 不得因此改变。
- `[N]` deterministic readability gate 独立完成：输出 `small-static-pass` 或 `potential-large/pending-browser`；后者只静态验证 finite canonical/font/semantic candidate 数据并输出 `browserEvidenceRequired: true`，不得声称 final profile 或读取 Chrome receipt。artifact 生成后，handoff-ready 再要求 real-Chrome 确定 final `worldProfile` 并证明 entry/focus `>=6px`；两类 receipt 任一缺失均不得宣称 browser evidence passed。
- `[N]` `Archify.view` 现有方法及返回/transaction 语义保持兼容。
- `[N]` mobile、embed、presentation、print 的既有行为逐项通过回归。
- `[N]` required Chrome lane 实际运行；Chrome unavailable/skip 不计为通过。

### B. Fixed viewport 与可读性

在 `1440×900`、`1600×1000`、`1920×1080`、`2048×1320` 的 light/dark 下：

- `[B]` small profile 的初始 Fit-all 和现有 6px contract 不变。
- `[N]` Workflow 与 Architecture 的 100/300 fixtures 在 `1440×900` 下均为 `worldProfile: large`；其他 viewport 只按同一公式派生，不硬编码 profile。
- `[N]` authoritative trigger 的 `5.99px → large`、`6.00px → small`、`6.01px → small` 边界测试通过；比较前不得舍入。
- `[N]` 同一 viewport、theme、viewer chrome 和 below-stage content 下，Workflow/Architecture 的 100 与 300 fixtures 的 stage `clientWidth`、`clientHeight` 差值分别 `<=1 CSS px`；stage 与 cards 完全在 browser viewport 内，且 `abs(clientHeight - min(900, floor(innerHeight - stageTop - outerHeight(visible .cards) - shellPaddingBottom - bodyPaddingBottom - 24))) <=2 CSS px`。
- `[N]` `documentElement.scrollWidth <= innerWidth` 且 `scrollHeight <= innerHeight`；stage clipping 合法，但内部滚动条和 document overflow 均失败。
- `[N]` Fit-all 覆盖完整 canonical bounds；large-world Fit-all 标签低于 6px只记录 overview legibility，不使 entry readability 失败。
- `[N]` 每个 large fixture 至少有一个有效自动入口；自动入口、单节点 Search/Focus 及 manifest 标记为 valid 的 relationship/guided target 完成后，目标完整进入 safe stage，指定标签投影 `>=6px`，且不被 Dock、Legend 或 Focus panel 遮挡。
- `[N]` manifest 中专门标记为 oversized 的 guided/relationship target 必须采用“目标完整性优先 + 最佳完整 Fit + `viewer/navigation-text-unreadable`”，不得裁切或静默换目标。
- `[N]` 内部 zoom 始终 finite；100/300 fixture 不得再被固定 3×上限阻止达到可读门。
- `[P]` 200% 浏览器 zoom 下控制区可达、无 document 横向 overflow；失败不授权改写 Finder/Focus/Guided module。

### C. 入口、camera 与可访问性

- `[N]` 显式 URL/hash/deep link 胜过自动入口。
- `[N]` Fit-all 可读时不发生自动聚焦；不可读时入口选择稳定、可复现。
- `[N]` 任一用户 camera intent 释放 automatic-entry lease；迟到 resize/font/rAF 不夺回 camera。
- `[N]` Reset button 和 `0` 在一步内恢复完整 Fit-all；不创建第二套 Home state。
- `[N]` navigation complete、replace、cancel、pointer cancel 和 reduced-motion 后 pending transaction 为 0，state/viewport 均 finite。
- `[B]` 既有 Escape、focus loss、键盘 search/result、focused/guided view、可访问名称和 focus-ring 行为不回退。
- `[N]` 新增 fixed-stage/automatic-entry 不移动 DOM focus、不困住 Tab；既有 zoom/Reset 控件的名称、键盘行为和 focus ring 保持可用。
- `[P]` search/focus 后目标获得可访问焦点或通过 live region 宣告；若现状没有该能力，失败只能形成后续 a11y Goal，不授权本 Goal 大改 Finder/Focus。
- `[N]` 连续 Fit-all ↔ focus 不积累坐标漂移；相同 intent 重复执行得到相同 logical viewport。

### D. World audit 与 canonical invariants

- `[N]` 对 scoped Workflow/Architecture large fixtures，canonicalFrame、所有 node bbox、完整 edge path、authored edge label，以及存在时的 stroke expansion、marker/arrowhead、label mask、legend/brand 等 canonical drawable paint extent 均 finite 且位于 canonical world。
- `[N]` visual-check 进程只使用当前 renderer 已暴露的 node ID 与 edge endpoint/key，从 canonical DOM 建立一次性 `auditInventory`；它不得缓存、序列化进 artifact 或注入 runtime。全部 scoped semantic node/edge 都能直接计算 finite camera target。node ID 缺失/重复、endpoint 无效或 canonical/audit inventory 不一致产生 typed diagnostic；当前合同未要求的全局唯一 edge ID 不得成为 renderer 改造理由。
- `[N]` 所有 guided views、world 四角、中心和跨区代表目标真实 camera navigation 通过；edge 样本的 path 代表点和 authored label anchor 实际进入 safe stage。
- `[N]` receipt 分别声明静态证明总数和真实导航样本数；不得用端点 reveal 冒充完整 edge path 可达。
- `[N]` navigation 前后 authored document、SVG `viewBox`、semantic node/edge inventory 和 artifact hash 不变；Workflow 额外保持既有 `layoutDigest`，Architecture 保持 P4 定义的 `canonicalSvgDigest` 与 `semanticInventoryDigest`，不得要求不存在的 Architecture `layoutDigest`。
- `[N]` 在固定 theme 下，full SVG export 的 bytes、viewBox、semantic inventory 在初始、自动入口、深度聚焦和 Reset 后保持一致；切换 theme 不得改变 canonical geometry 或 semantic inventory。

### E. Export

- `[B]` full SVG 默认消费 finite canonical frame，不消费当前 viewport。
- `[N]` camera transform、clip、focus/search/guided-view 状态和最后 viewport 不进入 full export。
- `[N]` 30/100/300 的 full SVG 成功并保留全部节点/边。
- `[M]` 仅在 300 gate 通过后运行 1000 stress：它须在 30s 内达到 initial stable，或在 180s harness timeout 前返回 `viewer/stress-budget-exceeded`；若 300 未通过，记录 `not-run: prerequisite-failed`，不使 Goal 无法收口。任何已生成的 1000 SVG 都不得静默缺实体。
- `[N]` canvas-backed format 在选择 scale 前执行 pixel-budget preflight。
- `[N]` PNG/JPEG/WebP 的 requested integer scale 从原值逐级降到满足 16M pixel budget 的最大 scale；若 1×仍超限，不创建 canvas，返回 `export/raster-budget-exceeded`。WebM 保留 `min(1, 1280 / viewBox.width)` fractional scale，并对实际 output dimensions 做同一 budget preflight；超限同样不创建 canvas。receipt 包含 format、requested/actual dimensions、requested/actual scale、每个适用候选的 pixel count、16,000,000 limit 和 SVG 建议。
- `[N]` 禁止空白 canvas、OOM 后静默失败、viewport-only 输出或裁掉离屏实体。
- `[N]` 30-node control 的现有 PNG/JPEG/WebP/WebM/print 行为无回归；100/300 不要求超预算 raster 成功，只要求结果确定、可解释、可恢复。

### F. Runtime 与规模

下列门槛、次数、trace、P95 和稳定事件定义在本 Goal 确认时即冻结，不是当前能力；P0 只记录 reference host、Chrome/version、前台可见状态和 raw receipts，不得看完 base 后改协议。base/candidate 必须使用 P4 的六-artifact matrix、固定 browser 环境、交错 AB/BA、20 次 cold、5 次 warm-up + 30 次 measured trace、nearest-rank P95。每个 artifact 独立判门，禁止 pooling；100/300 条款分别适用于两个图类对应 artifact，300 条款须由两个 300 artifact 各自通过。

- `[N]` Workflow 与 Architecture 两个 30-node control 各自相对 exact base 的 cold load/initial stable P95 增量 `<= max(base × 5%, 50ms)`；pan/zoom/search/focus P95 增量 `<= max(base × 5%, 4ms)`。这是新采 matched regression，不得引用前序 compiler 的 0.6% 代替。
- `[N]` 100/300 warmed pan/zoom update P95 `<=33.3ms`。
- `[N]` 100/300 search/focus/Reset transaction P95 `<=250ms`。
- `[N]` 300-node cold-run initial-stable P95 `<=2s`。
- `[N]` warmed trace 中不得出现 `>100ms` long task；`>50ms` long task 数和总时长必须记录。
- `[N]` 20 轮固定 navigation cycle 后 pending transaction 为 0，instrumented registered-listener count 与 post-warm baseline 完全相等；同一 CDP GC protocol 后 retained heap 增量 `<= max(post-warm baseline × 10%, 5MB)`。heap 只在同 host/Chrome/process policy 内比较。
- `[P]` 16.7ms 是目标值，不是本 Goal 硬门。
- `[M]` conditional 1000 stress 只要求在 30s initial-stable deadline / 180s harness timeout 内有界完成或产生 `viewer/stress-budget-exceeded` measurement receipt；不得崩溃、白屏、静默缺实体或污染 export，且不得宣传支持 1000 节点。

### G. 用户任务与耗时声明

技术自动化不能证明用户阅读效率，也不能证明 Issue #175 authoring/repair 提速。

Reader A/B promotion evidence 在招募前冻结一个偶数 `N >=8` 的可分析参与者数量，不得看结果后改变 N。每人完成固定 12 个 timed task：`{Workflow, Architecture} × {30, 100, 300} × {A, B}`。每个 diagram-type/size stratum 使用两份同构但内容和答案不同的 variant，A/B 分配互换；每个 stratum 恰有 `N/2` 人先 A、`N/2` 人先 B，整体任务顺序用冻结的 counterbalance 表。参与者不得在两个 condition 看到同一答案，条件名称对参与者隐藏。每个 task 都包含：找节点、检查一跳邻域、追踪跨模块路径、进入 guided view、Reset 回全图和导航后完整导出。

- 每项任务 timeout 180s；超时按失败并以 180s 计入 completion time；
- task success 只有在预先冻结的全部目标 ID、路径答案和完整导出 receipt 正确时为 1，否则为 0；每个 condition/diagram-type/size 的 success-rate 分母固定为 N，超时计失败；
- error rate 为 `(错误答案 + 未答 required answer/action) / 冻结的 required answer/action 总数`，按每个 condition/diagram-type/size 独立计算；
- primary endpoint 为 4 个 large strata（Workflow-100/300、Architecture-100/300）共 `4N` 个 participant pair 的 `B_time / A_time` 中位数；超时使用 180s。每个 large stratum 也必须单独报告同一 paired ratio median；
- `[P]` 四个 large stratum 各自及 pooled success rate 均 `>=90%` 且不低于 A；
- `[P]` primary median 与每个 large-stratum median 均 `<=0.80`；
- `[P]` 四个 large stratum 各自及 pooled error-rate 增量均不超过 `5` 个百分点；
- `[P]` Workflow-30 与 Architecture-30 control 的 paired `B_time / A_time` median 各自 `<=1.05`。

Reader A/B 未执行或样本不足时，`promotionDecision = evidence-incomplete`，只能声称 Viewer UX/correctness/runtime 候选，不能声称用户耗时改善。Observed-agent authoring/repair 不得与 Reader A/B 合并；重新声称 Issue #175 的 Validation/repair `>=30%`、handoff-ready `>=10%` 或五类图总耗时 `20–30%`，仍需独立 observed-agent authoring/repair Goal；本 Goal 不承担该声明。

## Typed diagnostics

优先复用语义准确的现有 diagnostic；新增或拆分时至少覆盖：

- `viewer/canonical-bounds-invalid`；
- `viewer/readability-measurement-invalid`；
- `viewer/entry-text-unreadable`；
- `viewer/navigation-text-unreadable`；
- `viewer/camera-target-unreachable`；
- `viewer/camera-transaction-incomplete`；
- `viewer/semantic-id-invalid`；
- `viewer/semantic-endpoint-invalid`；
- `viewer/audit-inventory-mismatch`；
- `viewer/world-audit-incomplete`；
- `viewer/export-incomplete`；
- `viewer/accessibility-contract`；
- `viewer/performance-budget-exceeded`；
- `viewer/stress-budget-exceeded`；
- `export/raster-budget-exceeded`。

这些 Viewer diagnostics 的权威承载面是 visual-check/benchmark/CI receipt，不新增公共 diagnostic API。浏览器运行时保持现有 `Archify.view` 的 `false`/transaction 返回语义；测量或入口失败时安全回退 Fit-all，不抛未捕获异常、不白屏。export pathway 继续通过现有 UI/receipt 呈现 export diagnostic。

severity 冻结如下：

- 30/100/300 mandatory fixture 的 measurement、semantic ID/endpoint/audit inventory、canonical、navigation、export 或 performance contract 失败均为 `error`；
- small profile overview `<6px` 与任意声明为 valid 的 entry `<6px` 为 `error`；large profile overview `<6px` 仅为记录项，不单独报错；
- 1000 measurement-only 的 deadline/resource limit 为 `viewer/stress-budget-exceeded` `warning`，receipt 状态 `measured-limit`，不得记作 pass；若未来声明支持 1000，同一失败升级为 `error`；
- 缺失/重复 node ID、无效 endpoint、canonical/export 语义缺失在任何规模均为 `error`，不得以 stress warning 掩盖。

每个 diagnostic 必须包含稳定 `code`、`severity`、用户可理解的 `message`、具体 `subject`、measured/required `evidence` 和已经被实现支持的 `supportedFixes`。不得输出 Node stack、模糊 catch-all，或建议删除节点、缩小字号、隐藏 overflow、修改 fixture、降低质量门来通过。

## 预期文件影响面

允许直接修改：

- `viewer/viewer-camera.js`；
- `viewer/reader-layout.js`；
- `viewer/template.source.html` 中 fixed-stage CSS；
- `viewer/export.js` 与必要的 export cleanup；
- `archify/bin/visual-check.mjs`；
- `archify/renderers/shared/desktop-readability.mjs`，仅新增 serializable large-world readability export；现有两个函数的签名/行为及图类 renderer/layout 输出不得改变；
- `archify/scripts/check-render-output.mjs`，用于同步 large-world 的静态可读性语义；
- `scripts/generate-viewer.mjs`，仅用于把 authoritative readability contract 序列化注入 standalone classic script，并增加逐字段 identity test；
- authoritative contract 文档；
- Viewer、reader、visual-check、export、accessibility、CI 和 large-world fixture/benchmark tests；
- 本 Goal 的实现报告与 raw evidence manifest。

修改 authoritative fragments 后，通过仓库现有生成流程更新 `archify/assets/template.html`；不得把生成文件当作手工事实源。只有在用户授权的执行工作树中、完成全部验证后，才按项目交付流程重建发布包。

明确禁止修改：

- `archify/schemas/**`；
- `archify/renderers/{architecture,workflow,sequence,dataflow,lifecycle}/**`，包括现有 Workflow compiler；
- 既有生产输入、冻结 corpus、节点/边语义；允许新增本 Goal 专用 test fixtures，但 P1 manifest 冻结后不得修改其内容来帮助 candidate 过门；不得减少 quality-gate 数量/强度，readability 只能按本 Goal 改为更完整的 profile-aware 证据；
- 现有 evidence 文件来伪造 candidate 结果。

`viewer/semantic-radar.js`、`viewer/viewer-chrome-layout.js` 只允许兼容性小改。若 `node-finder.js`、`focus.js`、`guided-views.js` 或 `route-probe.js` 需要大范围重写，视为 seam 设计失败并暂停复审。

## 暂停条件

出现任一条件立即停止当前实现，保存只读证据并请求用户决策：

1. 用户未提供包含前序试点的 immutable source commit；
2. source tree 存在未归属 dirty changes，或执行中其他 actor 修改相同文件；
3. baseline required test 红，或真实 Chrome required lane 无法运行；
4. base/candidate 无法使用相同 corpus，或无法保持 Workflow `layoutDigest` / Architecture `canonicalSvgDigest + semanticInventoryDigest`；
5. 继续需要公共 schema/interface、新依赖、renderer/compiler/layout 迁移或改变默认 full export 语义；
6. 300 correctness 通过但 runtime gate 失败，下一步需要 runtime scene index、culling、LOD、virtualization 或新 engine；
7. 只有通过缩小字号、删除实体/关系、修改 fixture、降低质量门或跳过测试才能过门；
8. camera 修改了 canonical `viewBox`、geometry、适用图类的 digest、artifact hash 或 full SVG bytes；
9. required browser receipt 只能得到 skipped、stale 或无法绑定 artifact 的结果。

## 必须交付

- 实现与测试；
- large-world normative contract 与 Viewer interface/state 文档；
- 冻结 corpus manifest、source hashes 和生成说明；
- Workflow + Architecture 30/100/300 fixtures 与 artifact-bound browser evidence；
- 1000 measurement-only stress receipt（仅在 300 gate 通过后）；否则交付 `not-run: prerequisite-failed`；
- 可重跑 runtime benchmark harness、raw receipts 和派生汇总；
- 五类 shared-viewer 兼容结果；
- full SVG 与 raster preflight 证据；
- accessibility/keyboard-only 检查记录；
- `technicalDecision` 与 `promotionDecision` 两轴决策；
- 事实、推断、未验证假设和性能声明边界；
- 实际设计消融记录。

## 设计消融

### 设计阶段已经永久移出本 Goal

- 数学无限坐标；
- 新 public/private `WorldView` interface、`meta.canvas`、`meta.camera` 或 threshold schema；
- 新 artifact/runtime Scene Manifest、runtime scene index、public plugin SDK 和新渲染引擎；test corpus manifest 与一次性 audit inventory 不在此列；
- 新/强制 minimap；现有 Semantic Radar 足够作为当前 adapter；
- camera history、viewport export、分页；
- 首期 culling、virtualization 和新增语义 LOD；
- 五类 renderer/compiler 迁移。

### 删除失败后恢复为 mandatory

- fixed desktop viewport：删除后大 world 继续驱动页面高度或被压回首屏；
- dynamic readable zoom：删除后固定 3×无法保证大 world 的局部可读；
- deterministic automatic entry：删除后用户打开巨图仍只看到不可读总览；
- 现有 guided views/search/focus 导航闭环：删除后只能盲目 pan；
- finite canonical frame 和 full export：删除后 Fit-all、验证和完整导出失去确定范围；
- raster preflight：删除后 1×超预算可能产生空白 canvas、OOM 或静默失败。

### P2 实现后、P3 取证前必须执行的实际消融

实际消融在 P2 结束、P3 取证前进行。先逐个做四个核心 mutation，每次只改一个且不得把 kill-switch 留进产品：

1. 临时恢复旧 3× camera cap；`3 < requiredMultiplier` fixture 必须以 `viewer/entry-text-unreadable` 变红；
2. 临时关闭 automatic entry；large-world 初始入口 contract 必须变红；
3. 临时移除 fixed-stage 行为、恢复旧 reader sizing；100/300 stage-independence 或 overflow contract 必须变红；
4. 临时绕过 raster/WebM preflight；使用 fake canvas allocator 的 oversize contract 必须在实际 allocation 前变红，不得真的申请危险 canvas。

四项均记录 exact failing test/receipt 后恢复，再继续逐个移除普通候选：

5. 新公共 surface、配置、状态或 UI；
6. 新 module/seam；
7. 重复的 bounds、threshold 或 camera state；
8. 私有 runtime scene index 或 cache（若实现中出现，本 Goal 原则上禁止）；
9. automatic-entry 的非必要分支；
10. fixed-stage wrapper（若现有直接子 SVG 即可完成）；
11. 只为测试暴露的 implementation detail。

普通候选移除后所有相关验收仍通过则永久删除；失败则恢复并记录 exact failing test/receipt。四个核心 mutation 的预期是证明必要性，必须在取证前恢复。任何发生在 P3/P4 之后且改变 bytes/hash 的消融或修正，都使旧 evidence 失效，必须对最终 artifact 重跑全部 `B/N` suite 和完整 P4 matrix。不得以“未来可能有用”保留抽象。

## 单一事实源与执行纪律

- large-world 产品合同：`archify/references/delivery-contract.md`；
- camera interface/state：`viewer/README.md`；
- readability 公式/门槛：authoritative readability module；browser 注入值必须由 generator 产生并通过 identity test；
- corpus 规模与密度：checked-in manifest；
- 性能结果：raw receipts 派生的汇总；
- 研究与决策背景：本文件顶部引用的报告。

Goal 只负责规定执行顺序、范围和验收，不复制实现后会漂移的环境缓存。每个阶段先达到完成标准，再进入下一阶段。任何 mandatory gate 未通过时，不得用 promotion 证据、旧报告数字或 UI 演示替代。
