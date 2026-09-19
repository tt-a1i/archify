# Archify 无限画布适配性重新审核

日期：2026-09-18  
范围：独立 HTML + 内联 SVG 的五类图（Architecture、Workflow、Sequence、Dataflow、Lifecycle）  
方法：仅采用当前仓库直接证据，以及 React Flow、tldraw、Cytoscape.js、Miro、Figma、W3C/Chrome 的官方或第一方资料。

## 修正结论

用户的质疑成立：**当一张图可能同时存在很多模块节点时，无限画布体验确实应当生效。**此前若概括为“无限画布不适合当前项目”，结论过于绝对；准确说法应是：

> Archify 适合“大世界/无限画布浏览”，但不适合把“数学上无界的坐标平面”单独当成布局、性能和导出的总解决方案。

节点很多时，大世界相机可以让内容不必压进一张固定纸面，并允许搜索、聚焦、平移和缩放到任意区域；但它不会自动减少 SVG/DOM 元素、避免节点重叠、整理连线、让缩小后的标签可读，或定义全图导出的边界。React Flow 把默认无界的 `translateExtent`/`nodeExtent`、`fitView` 与 `onlyRenderVisibleElements` 分成不同配置，正说明“坐标无界”“适配内容”“只渲染可见元素”是三件事（[React Flow API](https://reactflow.dev/api-reference/react-flow)）。

建议采用条件化混合模型：**编辑或交互上可近似无界；任一时刻的内容、canonical frame 与全图导出仍有有限边界；节点规模达到实测阈值后再启用 culling、virtualization 与 LOD。**

## 必须分清的能力

| 能力 | 本报告定义 | 它不等于什么 |
|---|---|---|
| Unbounded world | 预先不规定内容必须落在某张纸内；新增或移动节点后，世界可继续扩张。React Flow 默认坐标范围为正负无穷；tldraw 的相机选择无限画布中的可见区域（[React Flow](https://reactflow.dev/api-reference/react-flow)、[tldraw Camera](https://tldraw.dev/sdk-features/camera)）。 | 不等于无限节点、无限内存或无限导出图片。 |
| Content-bounded finite world | 当前文档的有限节点集合形成有限内容包围盒，并据此生成 canonical frame。`fitView`、`getNodesBounds` 和 tldraw 导出都依赖有限 bounds（[React Flow bounds](https://reactflow.dev/api-reference/utils/get-nodes-bounds)、[tldraw export](https://tldraw.dev/sdk-features/image-export)）。 | 不等于固定纸张；内容增加时 bounds 可以增长。 |
| Viewport camera | 用 `x/y/zoom` 把世界坐标映射到屏幕，模型坐标不因平移缩放而改变（[React Flow Viewport](https://reactflow.dev/api-reference/types/viewport)、[Cytoscape.js](https://js.cytoscape.org/)）。 | 不等于布局算法。 |
| Culling | 不绘制或隐藏视口外对象。tldraw 用空间索引判定可见性，但视口外 shape 仍留在 store/DOM 中并可被选择、命中和导出（[tldraw Culling](https://tldraw.dev/sdk-features/culling)）。 | 不等于完整 virtualization。 |
| Virtualization | 只物化当前需要的渲染对象，控制 DOM/渲染规模；Chrome 官方也建议对大型集合采用 windowing（[Chrome DOM size](https://developer.chrome.com/docs/lighthouse/performance/dom-size)）。 | 不等于删除 canonical scene 中的数据。 |
| LOD | 随缩放级别减少标签、阴影、细节或改成聚合表示；tldraw 明确采用低缩放简化与 zoom debounce（[tldraw Performance](https://tldraw.dev/sdk-features/performance)）。 | 不等于把完整信息永久丢掉。 |
| 自动布局 | 决定节点位置、间距和边路由。React Flow 明确不内置布局引擎，而是接 Dagre、D3、ELK 等（[React Flow Layouting](https://reactflow.dev/learn/layouting/layouting)）。 | 不会因有无限画布而自动获得。 |
| 编辑器自由放置 | 用户在运行时拖放、创建和持久化坐标。 | 不等于只读产物拥有 pan/zoom。 |
| 全图导出 | 从完整 scene 计算有限导出 bounds。Cytoscape.js 区分当前视口和 `full: true`，并警告超大同步栅格导出可能阻塞浏览器（[Cytoscape.js](https://js.cytoscape.org/)）；W3C 的 SVG `viewBox` 本身也是有限矩形（[SVG 2 Coordinates](https://www.w3.org/TR/SVG/coords.html)）。 | 不应默认为“只导出当前视口”。 |

## 当前 Archify 的事实

Archify 目前是五类 typed JSON 到单文件 HTML/SVG 的编译器，[CLI 明确列出五类图](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/bin/archify.mjs:13)，项目也明确说它[不是通用绘图编辑器](/Users/sunhonghao/.codex/worktrees/b09f/archify/README.md:194)，WYSIWYG 与通用自动布局仍在[范围之外](/Users/sunhonghao/.codex/worktrees/b09f/archify/README.md:276)。

用户提出的规模问题是真实的：Architecture `components`、Workflow/Dataflow `nodes`、Sequence `participants`、Lifecycle `states` 的主集合均未声明 `maxItems`（[Architecture](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/schemas/architecture.schema.json:85)、[Workflow](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/schemas/workflow.schema.json:255)、[Sequence](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/schemas/sequence.schema.json:93)、[Dataflow](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/schemas/dataflow.schema.json:108)、[Lifecycle](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/schemas/lifecycle.schema.json:115)）。但“schema 未设上限”只表示未来文档可很大；每次实际编译仍是有限节点集合，因此一定可以计算有限 paint bounds。

现有 Workflow v2 试点正是这种 **content-adaptive finite world**：它测量 layout、geometry、paint 三层边界，再生成有限 `requiredViewBox`；省略 `meta.viewBox` 时自动采用该尺寸，显式尺寸不足则报容量错误（[编译器](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/renderers/workflow/workflow-compiler.mjs:4012)、[frame 决策](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/renderers/workflow/workflow-compiler.mjs:4122)）。这不是无界坐标，负方向越界仍会报错。

Viewer 也不是独立的大世界相机：逻辑视口被根 SVG `viewBox` 夹住，缩放限制为 `1..3`（[viewer-camera.js](/Users/sunhonghao/.codex/worktrees/b09f/archify/viewer/viewer-camera.js:30)、[zoom](/Users/sunhonghao/.codex/worktrees/b09f/archify/viewer/viewer-camera.js:238)）。导出会克隆完整 SVG 并复用有限 `viewBox`（[export.js](/Users/sunhonghao/.codex/worktrees/b09f/archify/viewer/export.js:226)）。当前大图证据仅为 30 节点、50 条边、5 个 guided views，验证了全部可达与完整导出（[fixture](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/test/fixtures/large-adaptive-workflow.mjs:18)、[browser contract](/Users/sunhonghao/.codex/worktrees/b09f/archify/archify/test/adaptive-workflow-browser.test.mjs:21)）；本次静态审计未发现 viewport culling、virtualization 或 LOD，因此不能外推到数百、数千节点。

## “很多节点同时显示”时到底发生什么

需要分别回答四个目标：

1. **全部存在且可到达**：大世界相机直接有效。
2. **全部缩略轮廓同时可见**：Fit-all 可以做到，但标签会越来越小。
3. **全部标签同时可读**：无限画布无法突破有限屏幕像素，必须依靠局部放大、语义分区、搜索、折叠或 LOD。
4. **平移缩放仍流畅**：必须控制实际渲染工作。tldraw 官方即使采用空间裁剪，也设置默认每页 4,000 shapes，并为低缩放做简化（[tldraw Performance](https://tldraw.dev/sdk-features/performance)）；Miro 将画布称为 infinite，却仍建议大 board 分拆并给出对象规模指导（[Miro board](https://developers.miro.com/docs/boards)、[Miro performance](https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues)）；FigJam 同样提供无限 board，却建议用多页维持加载速度（[FigJam board](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files)、[FigJam pages](https://help.figma.com/hc/en-us/articles/24005082123159-Create-and-manage-pages-in-FigJam)）。

因此，无限画布对多节点是**必要的导航候选**，但不是充分的规模方案。Cytoscape.js 的官方布局文章也指出，完整巨大网络即便能画出来也可能成为视觉 hairball，应允许过滤子图并导航（[Cytoscape.js Layouts](https://blog.js.cytoscape.org/2020/05/11/layouts/)）。

## 五类图的条件化适用性

以下是结合现有 schema 语义的工程推断，而非第三方库的通用结论：

| 图类 | 大世界相机 | 真正自由放置编辑 | 必须保留的语义 |
|---|---|---|---|
| Architecture | 高：模块多、分区多时价值最大 | 有在线建模需求时高 | 层级、边界、依赖方向 |
| Dataflow | 中高 | 条件适用 | 数据方向、存储与处理层次 |
| Workflow | 中高 | 较低 | 泳道、阶段、rank；当前 `col` 仍为有限逻辑列 |
| Sequence | 中低 | 低 | 参与者顺序与时间轴；优先考虑分段/分页 |
| Lifecycle | 中 | 较低 | 状态层级、可达性与转移语义 |

若产品仍是“编译后阅读”，相机只需在有限内容 bounds 上提供稳定的大世界浏览与少量 overscan；若产品要让用户持续拖入模块、把节点移到当前内容之外并保存位置，则 unbounded world 才成为编辑模型的一等能力。

## 方案与验收门槛

建议把能力命名为“**大世界 / 无限画布浏览模式**”，合同分四层：编译器产生完整有限 scene 与 `contentBounds/canonicalFrame`；相机独立维护 `x/y/zoom`；渲染层按规模选择 culling/virtualization/LOD；导出始终从完整 scene 重建有限全图，而不是克隆可能已虚拟化的可视 DOM。tldraw 的导出同样先收集 shapes、计算有限 bbox，再生成 SVG/栅格图（[tldraw export](https://tldraw.dev/sdk-features/image-export)）。

在扩展实现前，用五类图分别构造 30/100/300/1000 节点与不同边密度的 A/B：A 为当前 finite frame，B 为独立大世界相机，C 再加入 culling，D 再加入语义 LOD。共同验收：全部实体可搜索和到达；聚焦后文本可读；pan/zoom 的帧耗时、长任务、DOM 数量与内存有记录；camera 不改变 canonical geometry；全图 SVG 的节点/边语义哈希一致；超大栅格导出要成功降级或给出明确失败，而不是静默缺失。只有 B/C/D 在实际任务中分别带来可测改善，才把相应层纳入产品。

## 不预设结论的风险矩阵

| 决策风险 | 当前可能性 | 影响 | 触发证据 / 缓解 |
|---|---:|---:|---|
| 拒绝大世界相机，继续把巨图压入首屏 | 高 | 高 | Fit-all 后文字不可读或频繁拆图时，应采用固定 viewport、可读入口与导航。 |
| 只放开坐标，却宣称解决性能 | 高 | 高 | DOM、帧耗时随规模恶化；必须分别测 culling/virtualization/LOD。 |
| 全量 SVG 形成视觉 hairball | 中高 | 高 | 路径跟踪错误、搜索时间上升时，增加分区、折叠、邻域视图。 |
| 虚拟化后继续克隆 live DOM 导出 | 中 | 高 | 导出缺失离屏节点；改为从完整 scene/IR 重建。 |
| 巨大 SVG 栅格化超过浏览器画布预算 | 中 | 高 | 现有导出已有 16M 像素保护但最低仍回落 1x（[export.js](/Users/sunhonghao/.codex/worktrees/b09f/archify/viewer/export.js:402)）；增加 typed preflight 或分块。 |
| 五类图共用一种自由布局 | 中 | 高 | Workflow/Sequence 语义退化；按图类保留布局不变量。 |
| 过早引入完整白板 SDK/WYSIWYG | 中 | 中高 | 若没有运行时创作、协作、选择/拖拽需求，先深化现有 SVG viewer。 |
| 永远保持当前 1–3x 有界相机 | 中高 | 中高 | 100+ 节点测试仍无法获得可读局部时，解除固定上限并独立 world/viewport。 |

## 设计消融

本次对建议做了四项概念消融：

- 移除“真无界坐标必须作为 MVP 基础”：现有只读编译、搜索、聚焦与全图导出仍成立，故从 MVP 永久移除，改为产品进入自由编辑时再启用。
- 移除有限 `canonicalFrame`：Fit-all、Radar、确定性验证和全图导出范围失去定义，故恢复。
- 移除首期 culling/LOD：现有 30/50 验收仍通过，故保留为规模测试触发的条件层；这同时意味着目前不能承诺 100/300/1000+ 性能。
- 移除“更换 SVG/引入外部图编辑 SDK”：大世界相机可先在现有架构实现，故从第一阶段永久移除；若未来需求变成自由创作、协作和数千对象编辑，再重新比较。

最终判断不是“用”或“不用”无限画布二选一，而是：**多节点确认了大世界相机的价值；自由编辑需求决定是否需要真正 unbounded world；实测规模决定何时加入 culling/virtualization/LOD；无论哪条路径，全图导出都必须回到有限、确定的 canonical bounds。**
