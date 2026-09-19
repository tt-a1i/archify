# 自适应画布 + Workflow 约束编译器试点报告

日期：2026-09-18

## 结论

决策为 **Retain as UX only**。

保留有限 canonical world、内容驱动的 implicit frame、共享二维 camera、全图可达性检查和 camera-independent export。这些能力解决了“大图页面放不下”“节点或连线落在固定画布外”“浏览状态污染导出”三类产品问题，并且没有破坏 Workflow v1 或其余四类图。

停止把本切片当作 20–30% 端到端性能收益的依据，也不扩展为五类图统一 compiler。精确机器 A/B 只测到 Validation/repair 中位数下降 `0.6%`、handoff-ready 中位数下降 `0.6%`，远低于 `30%` 和 `10%` 门槛；固定语料中 A、B 都没有 viewport repair 事件，因此也无法证明 `>=80%` 的相关返工下降。没有 observed-agent matched A/B，不能作模型创作与人工交付耗时主张。

## 交付的纵向切片

- `compileWorkflow({ workflow, qualityProfile })` 外部接口不变。
- Workflow v2 省略 `meta.viewBox` 时，最终 canonical frame 从 paint bounds 加确定性 padding 得出；显式 `meta.viewBox` 仍是 fixed capacity。
- receipt 独立记录 `layout`、`geometry`、`paint`、`canonicalFrame`、contributors、`layoutDigest` 和有界 operation budget。
- Workflow v1 继续走 fixed-v1 兼容路径；没有引入 `compileDiagram()`、第二套 Scene、公共 solver/router plugin 或新的渲染引擎。
- 复用现有 `Archify.view`。visual-check 现在分别证明 shell containment、入口可读性、viewer chrome、全 world 可达性和 canonical SVG export 完整性。
- 新增 30 节点、50 条关系、5 个 guided views、长中文标签、跨泳道关系和有界回路的固定大图。
- 新增六源、每源三组 AB/BA pair 的机器基准；每次 attempt 保存输入/候选 hash、diagnostic family、mutation、阶段耗时、layout/quality/artifact hash 和 bounded-stop 状态。

## Bounds 与大图证据

大图编译 receipt：

| 指标 | 结果 |
|---|---:|
| canonical frame | `1220 × 786` |
| layout bounds | `(40, 27) – (1204, 662)` |
| geometry bounds | `(20, 27) – (1204, 678)` |
| paint bounds | `(18, 26) – (1205, 710)` |
| layout passes | `1 / 3` |
| feedback rounds | `0 / 3` |
| layout digest | `e297f93975c565b6699c958ce3c26b0550bcf0da3998fbf15775726b25db08f6` |

真实 Chrome 的 artifact-bound receipt 为 `pass`：

- `1440×900`、`1600×1000`、`1920×1080`、`2048×1320` 的 light/dark 共 8 个观测全部通过 containment、readability 和 viewer-chrome gate；
- 30/30 节点、50/50 关系、5 个 guided views 可通过同一个 camera seam 到达；
- camera 复位后 viewBox、canonical geometry 和 camera state 不变；
- 全量 SVG 导出保留 30/30 节点、50/50 关系，导航前后字节相同，且没有 camera transform/clip 污染；
- standalone HTML SHA-256 为 `3624344c2a7ec31b7f00bd57963e0265acd864bb11f26252196cf7eab9e01ce4`。

自动 receipt 按合同保留 `visualReview: "pending"`。另行对四张端点截图进行了图像目检，light/dark 下节点、泳道、回路、图例、导览条和控制 dock 均可辨认且没有页面级溢出或遮挡：

```text
browser_evidence: passed
visual_review: passed
correction_rounds: 2
```

## 兼容与回归

最终整套命令在 Node `v22.23.1` 和真实 Google Chrome 下退出 `0`：

```text
tests: 2206
pass: 2195
fail: 0
skipped: 11
duration: 482714.267292 ms
```

十一个 skip 均为既有的平台或条件性环境门，不是本切片失败。真实 Chrome 的大图、五类 packaged examples、camera、reader、guided views、导出与 viewer chrome 测试均实际运行。官方 Workflow v1 SVG byte golden、其余四类图 golden、CLI、HTML 与 export 合同通过。发布包用 canonical Node 22 工具链重建，可跨时区字节复现；最终 `archify.zip` SHA-256 为 `e2711ddd99f65b7cd2ab014c5a15bc3966b4966750747029b6456e7cb51e4ae6`。

在完整回归之后，benchmark 汇总增加 P95 对照字段；其定向测试为 `3/3` 通过。

## Exact-commit 机器 A/B

### 版本与环境

- A：`8c3af8a11318d3e0f46bb123149c4863d358f830`，clean，code hash `74441ed6d2da0aee903fa3163c190abeae6ba2534f4b2137c89819334ca6a975`。
- B：`37998e0dc058297ed75908879eb04828f1fd95df`，clean，code hash `4a8f51fa42518762ef0a8c2819debfd4299cd62c6df722e8101338c4e00af8c2`。
- B 是为测量建立的本地临时 immutable snapshot commit，没有改写或提交用户当前分支。
- Node `v22.23.1`，macOS arm64，16 logical CPUs。
- manifest SHA-256：`3af2a60a53cd2d15f2366e63b53651386b3bae257d43e89b843db705e7b92a73`。
- 6 个固定 Workflow v2 sources × 3 个交错 pairs × A/B = 36 个 raw attempt receipts；0 failure、0 mutation、0 bounded stop，A/B 首次通过率均为 100%。

### 结果

| 性能门 | 要求 | 精确机器 A/B | 判定 |
|---|---:|---:|---|
| paired median Validation/repair | `>=30%` 下降 | `0.6%` 下降；`133.962 → 132.703 ms` | 不通过 |
| paired median handoff-ready | `>=10%` 下降 | `0.6%` 下降；`135.269 → 134.084 ms` | 不通过 |
| handoff-ready P95 | 恶化不超过 `5%` | `0.8%` 下降；`434.256 → 430.832 ms` | 通过 |
| viewport/viewBox repair | `>=80%` 下降 | A=`0`，B=`0`，无可计算分母 | 无法判定 |
| bounded stop | `0` | A=`0`，B=`0` | 通过 |
| first-candidate pass | 不下降 | A=`100%`，B=`100%` | 通过 |

结果文件内部 stable hash 为 `e6cf70e47581574b101240604ad817b64a03a3452f40dfc43d1fd99eeffec771`。同版本 A/A self-control 也只有计时噪声量级的差异，支持“当前约 0.6% 不应解释为真实提速”的判断。

这组结果仍标记为 `machine-only`。它没有观测模型 authoring、模型修复决策、人类复核或多 agent barrier，不能建立端到端收益；但它已经足以否定“compiler 机械流水线本身带来 20–30%”这一解释。

## 设计消融

### 永久移除

1. 大图 fixture 的底部 cards：真实浏览器曾测得 shell 高度溢出（`979/1061`）；删除装饰性 cards 后，30 节点、50 关系、5 views 和全部验收仍保留，故永久删除。
2. 大图 fixture 的非必要 group frames：将节点加宽到可读宽度后，groups 使整体宽高比跌出既有 adaptive-reader 入口；删除 groups 后 camera/readability/semantic coverage 均通过，故永久删除。三段 phase 仍保留结构语义。
3. 新公共配置、通用 `compileDiagram()`、独立 `exportFrame`、新 Scene/schema、minimap、LOD、culling、history 和第二套 camera：纵向切片不需要这些抽象，未加入实现。

### 删除失败后恢复

尝试删除 deterministic `layoutDigest`。定向合同测试立即失败，报错为 receipt 中 digest `undefined`，无法满足可归因与重跑一致性要求；已恢复。恢复后的同一测试通过，完整回归中的 receipt/determinism 测试也通过。

## 证据索引

- 试点 Goal：[codex-goal-adaptive-canvas-workflow-compiler-pilot.md](./codex-goal-adaptive-canvas-workflow-compiler-pilot.md)
- 方案与数据评估：[issue-175-infinite-canvas-performance-assessment-2026-09-18.md](./issue-175-infinite-canvas-performance-assessment-2026-09-18.md)
- 市场研究：[research-infinite-canvas-options-2026-09-18.md](./research-infinite-canvas-options-2026-09-18.md)
- 基准说明：[../benchmarks/adaptive-workflow-pilot/README.md](../benchmarks/adaptive-workflow-pilot/README.md)
- Exact A/B raw result：[../benchmarks/adaptive-workflow-pilot/results/exact-machine-8c3af8a1-vs-37998e0d.json](../benchmarks/adaptive-workflow-pilot/results/exact-machine-8c3af8a1-vs-37998e0d.json)
- A/A self-control：[../benchmarks/adaptive-workflow-pilot/results/baseline-self-control-8c3af8a1.json](../benchmarks/adaptive-workflow-pilot/results/baseline-self-control-8c3af8a1.json)
- 大图 layout receipt：[../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.layout-receipt.json](../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.layout-receipt.json)
- 浏览器 receipt：[../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.workflow.visual-check.json](../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.workflow.visual-check.json)
- 视觉 contact sheet：[../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.workflow.visual-check.html](../benchmarks/adaptive-workflow-pilot/evidence/large-adaptive-world/large-adaptive.workflow.visual-check.html)

## 后续边界

可以合并本次 UX/可靠性切片，但不应启动 Lifecycle → Dataflow → Architecture 的 compiler 迁移，也不应宣称五类图耗时下降 20–30%。若未来要重新打开性能结论，下一步必须先收集 observed-agent matched A/B：冻结可长期获取的 candidate commit、相同 prompt/model/reasoning/runtime、每个 source 的真实 authoring/repair/visual/handoff receipts，以及包含 viewport 返工事件的压力语料。没有这些证据时，继续扩展只会放大实现和回归成本，而不能回答原始耗时问题。
