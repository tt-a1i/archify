# 以联合约束减少架构图修复：定点研究

2026-09-21；只研究“作者已给出源事实和语义字符串后，怎样少写反复
调整的坐标、端口、路由和标签”的机械修复。这里的建议不是自动生成事实，
也不是已测得的提速。基线中的 `labelAt`、`labelDx`、`labelDy`、
`labelSegment`、显式 `route` 和既有几何/浏览器闸门仍是交付真相来源。

## 已核验能力（与推断分开）

| 工具和精确来源 | 官方直接说明 | 对本题的含义 |
| --- | --- | --- |
| ELK 0.12.0 / elkjs 0.12.0（[ELK 0.12.0 release](https://github.com/eclipse-elk/elk/releases/tag/v0.12.0)，2026-07-22；[elkjs 0.12.0 release](https://github.com/kieler/elkjs/releases/tag/0.12.0)，2026-07-17）；[ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) | Layered 可计算节点和 bend-point 坐标；支持 edge labels、ports、compound/cross-hierarchy edges。选择 orthogonal 时尊重任意 port constraints。 | 这是一个有能力同时接收尺寸、端口、边和标签尺寸并输出几何的候选求解器，而非只排节点的 grid。 |
| 同版 [Layered options](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)；[center-label strategy](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-edgeLabels-centerLabelPlacementStrategy.html) | 默认列出 orthogonal routing、edge/node/label spacing、edge label side selection；长边中心标签可选 median/tail/head/space-efficient layer。 | 标签所需空间可作为布局输入的一部分；不能只在路由结束后把文字塞进空隙。 |
| 同版 [port-label placement](https://eclipse.dev/elk/reference/options/org-eclipse-elk-portLabels-placement.html) | 可指定 port label 的 inside/outside/next-to-port-if-possible/space-efficient 等方式。 | 有端口文字时，端口的位置和文字占位需要在同一次候选布局中处理。 |
| Graphviz 官方属性文档（[`splines`](https://graphviz.org/docs/attrs/splines/)，最后改动 `bbef86a`，2024-07-28；[`xlabel`](https://graphviz.org/docs/attrs/xlabel/) 同一来源） | `splines=ortho` 是轴对齐折线，但官方明确说当前 routing **不处理 ports，且在 dot 中不处理 edge labels**。`xlabel` 在节点、边放置之后尝试避免与节点或标签重叠，必要时可能无法放下全部。 | Graphviz 可用于非正交草图或单独标签实验；它不是“正交端口路由＋全部边标签”的可靠替代，不能据此删掉 Archify 标签或路由检查。 |

ELK 支持能力不等于结果可读，也不表示它会保留产品的边界样式、来源
证据、主路径意图或 Archify 自定义语义。Graphviz 的 `constraint=false` 只是不
让一条边参与 dot 的 rank assignment（[官方说明](https://graphviz.org/docs/attrs/constraint/)），
不能表达“标签必须留空”或替代联合几何约束。

## 建议 A：保留 Archify JSON 的确定性联合布局候选器

**输入不变。** 先冻结现有 typed JSON 的 `components`、`connections`、
`boundaries`，包括 connection 的 `from`/`to`、所有 `label`/`sublabel`、
component `sources` 和 boundary `wraps`。用现有文字测量为每个 component 写入
最小 `width`/`height`，为每条 connection 写入测得的 label box；从现有
`fromSide`/`toSide` 派生 ELK ports，boundary 的 `wraps` 映射为 compound children。固定
`elk.algorithm=layered`、方向、随机种子、端口顺序和 spacing；选择 orthogonal。

**只接受可回写的结果。** 读取 ELK 输出的 rectangles、port anchors、edge
bend points 和 label rectangle，转换为 component 的 `pos`、`size` 和 connection
的 `via`；`route` 保持/选择现有 schema 所允许的枚举值（architecture 为
`auto`、`straight`、`orthogonal-h`、`orthogonal-v`），它不是点数组。标签仍用
现有 `labelAt`、`labelDx`、`labelDy`、`labelSegment` 表示。写回前逐项断言：
component ID、connection 端点、boundary `wraps`、所有原始文本、来源引用、
connection 数量和关系语义完全相同。之后照常运行 `validate`、
render-output 检查和浏览器闸门；任一失败就拒绝该候选，保留原 JSON。

**这是推断而非已证实效果。** 一次性让尺寸、端口、路线和 label-space 共同决定
几何，理论上可减少“移动节点后再补 via/labelDx”的循环。需要用同一来源快照、
同一语义 JSON、相同质量档和视口，比较首个通过既有闸门的候选与最终通过件的
修复轮数/时长，才能声称减少修复。

**失败边界。** 先拒绝而非悄悄放宽：长标签超过视口、compound 跨层边、ELK 输出
无法映射为符合已选 `route` 枚举和 `via` 的正交 connection、任何文本/引用/标签丢失、现有 label-route clearance 或
浏览器可读性失败。固定 seed 并不替代跨运行稳定性测试。不要把 ELK 的坐标直接
当作浏览器验收，也不要为了让求解器成功缩小字体或删除语义字符串。

## 建议 B：先做一个小的“候选/拒绝”实验，不接入生产

选当前容易反复修的三类固定 JSON：长中英文 node/edge label、共享存储的多分支、
嵌套 boundary 加跨边界关系。每个样本运行 A 的固定 options，并保留：输入 JSON
hash、ELK/elkjs 版本、完整 layout options、输出 JSON、回写 diff、现有诊断和每个
浏览器视口的结果。验收是无语义/来源/字符串损失且现有 checks 全绿；性能字段只
记录布局耗时和人/模型修复轮数，绝不把单次 engine 时间当端到端提速。

若 compound 或标签空间任一例失败，下一步应是保留现有手工几何并只提取可验证的
子规则（例如文字测量下限和端口侧选择），而不是换成 Graphviz。Graphviz 的上述
正交限制使它不适合该实验的“正交边 + 端口 + 边标签”核心样本。

## 回写顺序（抽象流程，不是可复制 API）

1. 从 `components` 生成带测量尺寸的布局节点；从 `connections` 生成带测量标签和
   `fromSide`/`toSide` 端口约束的布局边；从 `boundaries[].wraps` 生成 compound 层级。
2. 运行固定的 Layered/orthogonal options，得到候选矩形、锚点、折点和标签矩形。
3. 仅回写 `components[].pos`、`components[].size`、`connections[].via`，以及已有
   connection label controls；`connections[].route` 只能是本 diagram type 的 schema
   enum，绝不可写入点数组。
4. 比较冻结面。允许变化的仅是位置、尺寸、端口推导结果、`via` 和标签坐标控制；
   不允许变化 `components` 的标识/文本/`sources`，`connections` 的端点/文本/variant，
   或 `boundaries` 的 kind/label/`wraps`/pad。
5. 用当前 Archify 验证、render-output 和浏览器检查接受或拒绝候选。

ELK 的文档证实
布局特性；上述映射、冻结面和拒绝式验收都是为了适配 Archify 的实现建议，尚未运行。
