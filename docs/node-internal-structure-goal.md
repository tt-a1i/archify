# Goal：用节点“内部结构”替换开发指南

## 1. 目标

在 `integration/architecture-atlas` 当前实现上，保留现有 Architecture Atlas
多层架构图、子图下探、共享引用、目录、面包屑、历史恢复、画布状态和导出能力。

移除尚未发布的节点 `developer_guide` 功能，改为 Architecture 节点的可选
`internal_structure`。读者在现有“详情”页签看到“内部结构”，可进入：

- **代码结构**：目录、文件及关键类／接口／类型／函数／方法。
- **状态字段**：状态分组、字段名称、字段类型及相关读写关系。

打开内部结构后采用“结构树 + 详情面板”：宽屏左侧浏览树、右侧查看选中项；
窄屏顺序堆叠。它是当前节点的附属资料，不是 Atlas 成员，不产生新的架构层级。

原型仅用于确认信息结构和视觉方向：

`/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/pi-structure-prototype/pi-structure-view.prototype.html`

## 2. 固定概念和用户流程

一级检查器仍只有：

```text
详情｜关系｜源码
```

选中节点后的流程为：

```text
详情
├── 原有职责和基本信息
├── 进入子架构图（节点有 Atlas detail 时）
└── 内部结构（节点有 internal_structure 时）
    ├── 代码结构：目录、文件与关键代码符号
    └── 状态字段：字段分组、类型及读写节点
```

同一节点可以同时拥有 Atlas 子架构图和内部结构。两者行为必须独立：

- “进入子架构图”提交新的 diagram 访问，更新架构目录和面包屑。
- “查看代码结构／状态字段”保留当前 diagram，只切换当前节点的阅读表面。
- 从内部结构返回图时，恢复原节点、检查器页签、相机、图滚动和检查器滚动。

UI 固定用词：

| 位置 | 中文 | 英文 |
| --- | --- | --- |
| 详情分区 | 内部结构 | Internal structure |
| 入口／分段项 | 代码结构 | Code structure |
| 辅助文案 | 目录、文件与关键类/函数 | Directories, files, and key symbols |
| 入口／分段项 | 状态字段 | State fields |
| 辅助文案 | 字段分组、类型及读写节点 | Field groups, types, readers, and writers |

“模块结构”“状态结构”不作为最终 UI 名称。“模块结构”容易与子架构图混淆，
“状态结构”不能直接说明内容是字段及其读写关系。

## 3. 数据接口

### 3.1 Architecture 节点扩展

在 Architecture v1 的 `components[]` 增加可选 `internal_structure`。Atlas manifest、
`details` 和 `references` 的格式保持不变。其他四类图不增加该字段。

`internal_structure` 使用一套数据模型表达两种投影：

```json
{
  "id": "run-loop",
  "type": "backend",
  "label": "Agent Loop",
  "internal_structure": {
    "sources": [
      {
        "id": "loop-source",
        "role": "definition",
        "path": "packages/agent/src/agent-loop.ts",
        "symbol": "agentLoop"
      },
      {
        "id": "messages-source",
        "role": "definition",
        "path": "packages/agent/src/types.ts",
        "symbol": "AgentState"
      },
      {
        "id": "messages-read",
        "role": "callsite",
        "path": "packages/agent/src/agent-loop.ts"
      }
    ],
    "items": [
      {
        "id": "agent-src",
        "domain": "code",
        "kind": "directory",
        "label": "src",
        "summary": "Agent 运行核心。"
      },
      {
        "id": "agent-loop-file",
        "domain": "code",
        "kind": "file",
        "label": "agent-loop.ts",
        "parent": "agent-src",
        "summary": "承载 Agent Loop。",
        "source_refs": ["loop-source"]
      },
      {
        "id": "agent-loop-function",
        "domain": "code",
        "kind": "function",
        "label": "agentLoop",
        "signature": "agentLoop(...)",
        "parent": "agent-loop-file",
        "summary": "协调模型响应与工具调用。",
        "source_refs": ["loop-source"]
      },
      {
        "id": "conversation-state",
        "domain": "state",
        "kind": "group",
        "label": "对话上下文",
        "summary": "进入模型请求的上下文。"
      },
      {
        "id": "messages-field",
        "domain": "state",
        "kind": "field",
        "label": "messages",
        "value_type": "AgentMessage[]",
        "parent": "conversation-state",
        "summary": "保存对话、响应和工具结果。",
        "source_refs": ["messages-source"]
      }
    ],
    "relations": [
      {
        "id": "loop-reads-messages",
        "from": "agent-loop-function",
        "to": "messages-field",
        "kind": "reads",
        "source_refs": ["messages-read"]
      }
    ]
  }
}
```

### 3.2 结构规则

- `sources` 复用现有 repository source 记录的字段和核验实现，但作为
  `internal_structure` 的局部注册表；`id`、`role` 和 `path` 必需。
- `items` 中 ID 在当前节点内部唯一。`domain` 为 `code` 或 `state`。
- `code` kind 为 `directory`、`file`、`class`、`interface`、`type`、
  `function`、`method`；`state` kind 为 `group`、`field`。
- `field` 必须有 `value_type`；代码符号可以有 `signature`。二者均为纯文本。
- `parent` 只能指向同一 domain 的 item。每个 domain 至少一个根；所有 item
  从根可达；多父、孤儿、自父和环均失败。作者顺序就是展示顺序。
- `directory` 和 `group` 是组织容器，可不带来源。其他 item 必须有 1–3 个
  `source_refs`，并解析到局部 `sources`。
- `relations` ID 唯一，端点解析到当前 `items`；kind 为 `imports`、`calls`、
  `uses`、`creates`、`reads`、`writes`。允许 code → state 的读写关系。
- 每条 relation 必须有 1–3 个局部 `source_refs`。`label` 可选且为纯文本。
- `internal_structure` 至少产生一个非空 domain；空对象、空 domain 和只有
  不可达容器的资料失败。
- 每节点最多 64 个 item、96 条 relation、64 个 source，树深最多 8。
  每个 label 最多 80 字符、summary 最多 240 字符、signature/value_type
  最多 200 字符。
- 安全序列化后的 UTF-8 预算：每节点 64 KiB、每 Architecture 成员 256 KiB、
  每 Atlas 512 KiB；每条 payload 文本行不超过 8192 bytes。超过预算时精确指向
  首个越界节点和 JSON path，不截断资料。

### 3.3 真实性

- 含 `internal_structure` 的 Architecture 必须声明固定的
  `meta.repository.url` 和 40 位 `revision`，交付时必须提供匹配 `--repo-root`。
- 局部 sources 使用现有 origin、commit、blob、路径、行范围和 symbol 核验；
  `local-only` 不生成远程链接，也不泄漏本机仓库根。
- 位置核验只证明源码位置存在。`summary`、item kind 和 relation kind 是
  Agent/作者解释；UI 分别显示“源码位置已核验”和“由 Agent 归纳”，不显示
  置信度分数，也不声称运行行为已验证。
- `calls`、`reads`、`writes`、`creates` 必须引用能支持该陈述的 callsite、
  definition、guard、schema 或 test 来源，并进行独立语义审读。
- Viewer 只展示编译后的确定数据，不读取源码、不调用模型、不推断目录依赖或
  运行关系。没有真实 trace 时不显示字段值，不播放字段变化动画。

## 4. Viewer 与导航

### 4.1 详情入口

- 保留原有职责、ID、类型、关系、源码和 Atlas detail/reference 动作。
- 节点有内部结构时，在“详情”页签加入一个“内部结构”区，不新增第四个页签。
- 两个 domain 都存在时显示两张紧凑入口卡，包含名称、固定辅助文案和准确计数。
- 只有一个 domain 时只显示该入口；没有资料时不生成空区块或占位。
- 入口的增加不得移动、缩放或重新布局 SVG 画布。

### 4.2 结构阅读面

- 打开入口后，Atlas 外层标题、架构目录和全局工具栏保持；当前 diagram 和架构
  面包屑不变。内部标题为“<节点名称> · 内部结构”。
- 宽屏使用原型 A 的“结构树 + 详情面板”。树只用缩进和枝线表达 `parent`
  包含关系；调用、依赖、读取和写入只显示在右侧详情关系区。
- 两个 domain 都存在时，顶部使用“代码结构／状态字段”分段控件。一个 domain
  时省略分段控件。切换后保持各自最后选中项和展开状态。
- 右侧详情显示 item 名称、kind、summary、signature 或 value_type、来源以及
  与该 item 直接相关的入向／出向 relation。关系使用明确的类型标签。
- 默认选择作者顺序中的第一个根。目录／分组可展开折叠；键盘支持树的上下移动、
  左收起／上级、右展开／子级、Enter 选择。
- 窄屏按“模式切换 → 树 → 详情”顺序堆叠，使用一个页面滚动根，无覆盖画布、
  内部横向滚动或可调整分栏。

### 4.3 地址和历史

使用以下地址形状：

```text
#focus=run-loop&inspect=structure&section=code&item=agent-loop-file
#diagram=loop&focus=run-loop&inspect=structure&section=state&item=messages-field
```

- `section` 只为 `code` 或 `state`；`item` 必须属于该 section。
- 从图打开内部结构成功后增加一个 history entry。选择 item、展开树和切换 section
  只更新当前 entry，不持续增加历史。
- Back 返回发起访问的图和阅读状态；Forward 恢复最后 section、item、展开状态和
  结构滚动。刷新和冷深链恢复同一内容。
- 从图内“返回图”优先回到匹配的来源访问；冷深链则从当前地址移除
  `inspect`、`section` 和 `item`。
- 非法 node、section、item 或过期链接显示可恢复错误，不静默换成其他内容，
  不复制看似有效的链接。

### 4.4 Atlas 共享引用

- `internal_structure` 归 canonical 节点所有。reference occurrence 作者重复资料时
  构建失败。
- occurrence 的详情入口解析到 canonical 结构；复制的结构链接指向 canonical
  `(diagram,node)`。Back 返回原 occurrence 及其相机、关系、页签和滚动状态。
- `structure` 不进入 Atlas 目录，不改变 `details` 单父树，不参与跨图路径或可达性计算。

## 5. 移除开发指南

`developer_guide` 是当前实验分支的未发布功能，本次直接替换，不提供兼容层、迁移器
或双写。完成后：

- schema 不再接受 `components[].developer_guide`；旧实验输入明确校验失败。
- 移除指南 compiler、payload、receipt、Atlas inventory、i18n、DOM、CSS、地址状态、
  运行时接口、测试 fixture 和公开文档。
- 删除或替换 `docs/node-developer-guide-goal.md`，避免它继续成为活动规格。
- 可以复用现有 surface 准备、历史和快照实现，但公开名称、数据和错误中不残留
  guide 概念；不保留只为兼容旧实验产物的分支。
- 重建模板、生成 validators、示例、gallery 和 `archify.zip`，不能让已生成资产保留
  指南代码或字符串。

## 6. 实施范围

### 本轮包含

- Architecture schema v1 的 `internal_structure`、生成 validator、语义校验和预算。
- repository evidence 对结构局部 source 注册表的复用与核验。
- 确定性编译、HTML-safe inert payload、交付回执和 Atlas compact bundle inventory。
- 详情入口、结构树、详情面板、响应式、主题、i18n、键盘和无障碍。
- standalone Architecture 与 Atlas 中的地址、历史、失败、共享引用及状态恢复。
- 开发指南的完整下架，以及相关测试、文档、示例和发布包更新。
- 使用当前分支从固定 Pi 源码重新生成一个最终 Architecture Atlas 样本。

### 本轮不包含

- 新的 `structure` 图类型、Atlas manifest 字段或第四个检查器页签。
- 自动扫描整个仓库、AST／语言服务器、自动调用图、源码编辑器或在线生成。
- 运行 trace、实时字段值、字段变化动画、性能指标或调试器。
- 状态机转移图、数据库 ER 图、完整类型浏览器或完整仓库文件树。
- 多父结构树、跨节点 structure 引用、跨图 relation、全文搜索或结构差异比较。
- 修改现有架构节点、连接、布局、视觉预设、Atlas detail/reference 语义或导出格式。
- 为 Workflow、Sequence、Dataflow、Lifecycle 增加内部结构。

## 7. 验收标准

| 编号 | 完成条件及证据 |
| --- | --- |
| AC01 功能保全 | 实施前保存当前分支基线。最终总图、任意深度子图、detail/reference、目录、面包屑、Back/Forward、深链、相机恢复、详情／关系／源码、查找、路径、影响范围、主题、预设、演示和全部既有导出仍可实际操作；原有架构 JSON 不需要新增字段。 |
| AC02 指南完整下架 | 代码、schema、模板、生成资产、测试和活动文档中不再提供 `developer_guide`、guide payload、guide URL 或“打开开发指南”。旧实验字段按精确 JSON path 失败。没有隐藏按钮、兼容 reader、双 payload 或死代码。历史说明若保留必须明确标为 superseded 且不能被产品文档引用。 |
| AC03 数据模型 | 覆盖 code-only、state-only、两者都有、无结构四类节点。唯一 ID、kind/domain 配对、field 类型、同域单父树、根可达、最大深度、relation 端点与 kind、source refs 和所有数量／字符串／字节预算逐项验证；孤儿、环、跨域 parent、空 domain、错误 source 和越界输入全部带准确 path 失败。 |
| AC04 来源与真实性 | 固定 revision 下实际核验结构 sources；文件、范围和 symbol 失效时失败。最终真实样本逐条记录“item/relation → source → 独立语义审读”。路径存在不能证明 calls/reads/writes；UI 明确区分位置核验和 Agent 归纳，虚构符号、错误类型和无依据运行关系为 0。 |
| AC05 详情入口 | 真实浏览器选中结构节点后，仍只有详情／关系／源码三个一级页签。详情中显示准确的内部结构入口和计数；一个 domain 时无空切换项，无结构时完全回退旧详情。同时拥有 Atlas detail 的节点显示独立的子架构入口和内部结构入口。选择节点、切页签和显示入口使 SVG bounding rect 各边变化 ≤1 CSS px，相机 scale 误差 ≤0.001、中心误差 ≤2 px、history 增量为 0。 |
| AC06 结构阅读面 | 宽屏呈现树 + 详情两列，树线只表达 parent；calls/imports/uses/creates/reads/writes 只在详情中以文本标签出现。选中 item 后名称、kind、summary、signature/value_type、直接关系和来源完全匹配 payload。两个 domain 保留各自选择和展开状态；重复打开 5 次不存在重复 DOM、事件或活动 surface。 |
| AC07 地址和历史 | 从图打开结构恰好增加一个访问；连续选择 10 个 item、展开树和切换 section 不增加访问。Back 恢复原 diagram/node/tab/camera/scroll，Forward 恢复最后 section/item/tree/scroll；误差沿用 AC05。standalone、Atlas、刷新和冷深链均通过。非法或过期地址显式报错且不复制伪链接，迟到准备结果不能覆盖最新意图。 |
| AC08 子图与引用 | 节点的“进入子架构图”和“内部结构”互不冒充；前者更新架构层级，后者保持当前 diagram。reference occurrence 打开 canonical 结构并能 Back 返回本地 occurrence；重复作者结构、缺失 canonical target 和损坏 payload 在构建期或恢复期 fail closed。Atlas 目录、单父 detail 树、当前项高亮和路径计算不出现 structure 条目。 |
| AC09 响应式与无障碍 | 覆盖 1440×900、1024×768、720×800、390×844、320×568，浅／深主题、`en`／`zh-CN`、reduced motion。宽屏两列、窄屏单滚动根；页面宽度溢出 ≤1 px，主要控件命中区 ≥44px。树具有正确 tree/treeitem 层级、展开状态和键盘行为；焦点可见；隐藏图不可交互并从 accessibility tree 移除；返回后焦点回到入口。 |
| AC10 连续性和失败 | 记录连续帧或视频及地址／DOM 事件，覆盖打开、返回、快速切 section/item、Back/Forward、冷链、断点 resize、损坏 payload、失败重试和 reduced motion。已提交内容不闪白、不出现双 surface 或错误主题；控制台错误、未处理 rejection、重复 DOM ID 均为 0。自动过程证据和人工视觉检查分开记录。 |
| AC11 安全、离线和导出 | 最终 standalone 与 Atlas 在 `file://` 和本地 HTTP 完整工作；除用户点击源码外自主请求为 0。CJK、emoji、引号、反斜杠、控制字符、`<>&`、`</script>` 不能逃逸 inert JSON。结构阅读期间原有 SVG/PNG/JPEG/WebP/WebM、分享卡、路径卡和影响范围卡仍导出当前 canonical graph，结构资料不进入图形导出。`local-only` 不泄漏绝对 repo root。 |
| AC12 确定性、体积和发布包 | 相同输入/revision/locale 连续两次输出 SHA-256 相同，失败不覆盖旧产物。payload 满足 64/256/512 KiB 与 8192-byte 行预算。没有 `internal_structure` 的普通单图和 Atlas 不生成结构 payload/入口/空 DOM。生成 validators、Viewer、示例、gallery 与 deterministic `archify.zip` 全部重建；干净解包且无 `node_modules` 时可交付含结构的 Atlas。 |
| AC13 最终 Pi 样本 | 从第 8 节固定输入复制到全新目录，使用当前分支 CLI 和 `/Volumes/Data/pi` 从 JSON 重新交付，不复用旧 HTML、payload 或截图。保持 5 张成员图、4 条 detail、4 条 reference；`system/coding-agent` 同时具有子架构和代码结构，`loop/run-loop` 同时具有代码结构与状态字段。结构事实全部来自固定 revision。最终 HTML ≤600,000 bytes，并交付详情入口、代码结构、状态字段、子图共存和返回恢复的代表截图及回执。 |
| AC14 回归与消融 | 相关定向测试、完整 `npm test` 和真实 Chrome 验收全部通过；跳过项单独列出，不计为通过。列出新增／受影响的 compiler、payload、surface、状态和辅助层，逐个删除候选并重跑对应原验收；通过则永久删除，失败则恢复。最终 Pi 样本和证据必须来自消融后的代码。 |

真实浏览器等待明确的 graph/structure ready 或 error 状态，不用固定 sleep 代替。
静态截图不能证明历史、连续性或键盘行为。位置核验不能替代语义审读。

## 8. 固定 Pi 样本

输入基线：

`/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/pi-from-source-current-20260913-001`

使用其中：

- `pi.atlas.json`
- `system.architecture.json`
- `coding.architecture.json`
- `loop.architecture.json`
- `models.architecture.json`
- `remote.architecture.json`

基线 HTML 为 499,265 bytes，SHA-256：
`c9c57dd01b558ec28f15f25ed546273bca385c58e7500f23debfcf736d9b94d1`。
它只用于回归和体积比较，不能作为最终交付物。

Pi 源码固定为：

- 仓库：`/Volumes/Data/pi`
- revision：`6aedd1066e540642165aa30fa7b4a1b863778aa7`
- origin：`https://github.com/earendil-works/pi`

执行前读取 Archify 与 Pi 工作区的适用本地指令。所有结构事实从固定 revision blob
重新核对；工作区未跟踪文件不作为证据。把六份输入复制到新的可写输出目录，只在副本
中移除 `developer_guide` 并添加 `internal_structure`。不得修改基线目录或 Pi 仓库。

最终至少完成：

1. `system/coding-agent`：代码结构；继续保留进入 `coding` 子架构图。
2. `loop/run-loop`：代码结构和状态字段，包含至少一条经核验的 code → state
   `reads` 或 `writes` 关系。
3. 一个 code-only、一个 code+state、一个无结构节点的真实回退。
4. controlled fixture 覆盖 state-only 和 canonical reference structure。

无法访问固定 revision 时可以完成实现和 controlled fixture，但 AC04/AC13 保持未通过，
不得静默改用其他 revision 或旧产物。

## 9. 执行顺序

1. 保存当前分支、HEAD、工作树和基线测试结果；列出所有 guide 代码与生成资产。
2. 先写 schema／语义／预算／证据失败测试，再实现 `internal_structure` compiler。
3. 替换 guide payload 和 Atlas inventory，验证确定性、compact bundle 与损坏恢复。
4. 在详情中加入入口，实现结构 surface、地址、历史、引用和响应式。
5. 完整移除开发指南并重建生成资产；运行 guide 残留检查和旧输入失败测试。
6. 运行定向测试、完整测试、真实浏览器矩阵、离线／导出／安全／体积检查。
7. 从固定 Pi 输入和源码重新生成最终样本，完成语义审读与视觉检查。
8. 执行实施后消融，使用消融后的代码重跑受影响验收并重新生成最终样本。

每一步只有在其失败测试转绿、完成条件可观测且没有降低 AC01 时才进入下一步。

## 10. 交付

最终报告必须包含：

- 改动文件、最终数据接口和关键 seam。
- AC01–AC14 的逐项状态与证据路径。
- 开发指南删除清单及残留扫描结果。
- 定向测试、完整测试、Chrome、离线、导出、确定性、体积和包验证结果。
- 最终 Pi HTML、六份输入、交付回执、视觉回执和代表截图。
- 每条真实结构关系的固定源码依据及独立语义审读结果。
- 消融中尝试删除的候选、验证结果及永久删除／恢复决定。
- 未解决限制；任何未通过 AC 保持明确，不以旧截图、跳过或静态检查冒充通过。

本 Goal 不包含 commit、push、PR 更新、合并、发布或部署。

## 11. 规格消融结论

- 尝试增加第四个“结构”页签；详情内入口已经可发现且一级页签更稳定，保持删除。
- 尝试把 structure 做成 Atlas 成员或新图类型；它会污染架构层级，并使同一节点的
  子架构和内部资料竞争默认下探入口，保持删除。
- 尝试把完整结构树直接塞进窄详情区；无法在真实目录和字段数量下保持可读，恢复
  独立主阅读 surface，但入口和语义仍属于“详情”。
- 尝试复用每节点最多 3 条的 `components[].sources`；无法支持多个文件、符号、字段和
  relation 的独立证据，恢复结构局部 source 注册表，同时复用同一 source 记录与核验实现。
- 尝试保留 `developer_guide` 兼容 reader；该接口尚未发布，兼容层只会留下双模型、
  双地址和死代码，保持完整删除。
- 尝试删除结构地址中的 `item`；分享和刷新后无法恢复选中项，恢复保留。
