# Archify 无限画布与超大图方案研究及目标设计（2026-09-18）

> 目的：为 Archify 评估“无限画布”是否能减少大图在校验阶段因节点或连线超出画布而引发的返工，并寻找比“纯无限平面”更稳妥的方案。
>
> 证据规则：只使用产品方官方帮助、官方开发者文档、官方工程博客或官方源码。文中每个链接均为直接 URL；除非特别注明，**所有来源访问日期均为 2026-09-18**。产品事实和本文推断严格分开。

## 1. 范围声明与覆盖方法

不存在可以证明穷尽“市面上所有画图软件”的清单。原因包括：产品不断出现和下线、企业内工具不可见、同一产品在 Web/桌面/移动端和不同套餐中的能力不同，以及厂商把“无限”作为体验描述而不公开坐标或渲染实现。

本次采用分层覆盖，而不是声称穷举：

1. 通用协作白板：FigJam、Miro、Canva Whiteboards、Apple Freeform、Lucidspark、Whimsical。
2. 结构优先的思维导图：XMind。
3. 正式图表/技术图：Lucidchart、diagrams.net（draw.io）。
4. 开源实现基线：tldraw、Excalidraw；用于补充商业产品不公开的 camera、culling、export 实现事实。
5. 视觉知识板补充样本：Milanote；用于观察“无限画布 + 嵌套子板”的层级化路径。

这组样本覆盖了协作白板、思维导图、正式制图、平台原生白板、开源 SDK 五种主要范式，也覆盖了纯平面、Page/Sheet、Frame/Section/Scene、层级子板和受约束 camera 等不同解法。它是一个有意选取的横截面，不是市场占有率排名。

## 2. 先给结论

### 2.1 基于本次样本的归纳（推断）

- 产品使用 “infinite/boundless canvas” 描述时，不应直接推定其坐标域在数学上无界。FigJam 官方称单页 Board 为 infinite，而同一厂商的 Figma Design 官方同时给出每页约 `-130,000` 到 `+130,000` 的坐标范围。
- 本次样本中，多数产品给连续空间加了第二层结构：Figma/Whimsical 的 Page + Section、Miro/Lucidspark 的 Frame、Freeform 的 Scene、XMind 的 Sheet + Branch、draw.io 的 Page + Layer + Tag、Milanote 的嵌套 Board。
- 本次样本反复出现的防迷路组合是：`Fit all`、`Fit selection`、Home/Recenter、minimap/outline、Frame/Section/Scene 目录、搜索、对象深链和 Follow/Spotlight；未有证据表明 minimap 是必需项。
- 大图性能仍有明确上限和拆分建议。Miro 建议低于 5,000 个对象，硬上限 100,000；Whimsical 表示超过 10,000 个 item 可能变慢；tldraw SDK 默认每 Page 最多 4,000 shapes。Figma 编辑画布按 Page 动态加载，prototype viewer 按 Frame 动态加载，并使用 GPU 渲染。
- 本次样本中的导出通常把连续空间重新投影到**有限范围**：整个内容包围盒、选区、Frame/Section/Scene、Page，或按纸张分页。各产品一手资料分别记录了缺字、失败、超时或浏览器位图上限，说明超大导出需要单独设计。

### 2.2 对 Archify 的核心判断（推断）

Archify 不应只做“去掉固定画布边界”。更好的目标是：

> **无限工作区 + 语义分区 + 可恢复 camera + 与视口解耦的校验和导出。**

这能直接消除“节点/连线超出画布即非法”的返工，同时避免把所有复杂度转化为迷路、慢渲染和超大导出失败。

## 3. 产品横向扫描

| 产品 | 工作区/坐标模型 | 防迷路机制 | 协作与关注同步 | 大图/性能公开信号 | 导出边界 |
|---|---|---|---|---|---|
| Figma / FigJam | FigJam 宣称单页 infinite；Figma Design 每 Page 约 ±130,000 | Fit、Selection、Recenter、Pages、Sections、深链；未找到官方 minimap | Spotlight/Follow 同步画布位置、缩放和 Page | 编辑器按 Page 动态加载，prototype viewer 按 Frame 动态加载；WebGL/WebGPU | 整 FigJam Board/选区；Design 可导出 Layer/Frame/Section/Slice/Page |
| Miro | 原点为新建 Board 初始 viewport 中心；顶层对象用相对画布中心的 world coordinates，viewport 单独建模 | 内容 Map、Frames 面板、搜索、对象/Frame 深链、Start view | Follow/Bring everyone；官方给出约 200 人常见、377 人成功会话的案例 | 100,000 对象硬上限；1,000 起可能受影响；建议低于 5,000；部分复杂组件有缩放级别预览 | Frame→PDF 页；选区/整板；大 Frame 可能导出异常 |
| XMind | 内容驱动的层级图；支持 floating topic 和自由定位；未找到“无限坐标”官方承诺 | Fold、Show branch only、Outliner、Sheets | 本轮来源未覆盖实时协作机制 | 无公开对象阈值；官方通过拆 Sheet、折叠和单 Branch 展示控制复杂度 | 整图、当前文件/Sheet、单 Branch；PNG/JPG/PDF/SVG 等 |
| Whimsical | 官方明确称 infinite canvas | Fit all、Fit selection、Sections、Multipage、对象/Section 深链；未找到 minimap | Follow cursor；100+ 人时不再显示全部 cursor | 超过 10,000 items 可能变慢；100+ 人协作更新可能变慢 | Board、Selection、Frames；失败时建议分小 Section |
| Lucidchart / Lucidspark | 可切换 infinite canvas 与有限 page tiles | Mini Map、Table of Contents、Frames、Breakout Boards、Pages、Paths | 跟随演示 Path 时仍可用 sticky、reaction、comment、laser pointer | 未找到官方对象硬上限；官方建议出问题时关掉 infinite canvas、缩小文件或拆文档 | Crop-to-content/custom crop、Page tiles、Layers；PDF/PNG/JPEG/SVG 等 |
| diagrams.net | Page View 可关，关后使用 infinite canvas | Outline、Pages、Layers、Tags、links/viewbox | 本轮来源未覆盖实时协作机制 | 大图片会拖慢浏览器和自动保存；超大 PDF 可能超时 | 内容包围盒、Selection、Page/All Pages、打印分页 |
| Canva Whiteboards | 官方称 infinite canvas，可由 Presentation 扩展而来 | Zoom/Pan/Scroll、Presentation 转换；未找到官方 minimap | 实时 cursor、comment、reaction，可点击 avatar 跟随用户 | 未找到公开对象阈值或具体裁剪算法 | 选择元素下载；PDF/PNG/JPEG/MP4；可转 Presentation/Doc |
| Apple Freeform | 官方称 boundless canvas，无需考虑 page size | Scenes（保存视图）、Scene Navigator；未找到 minimap | 实时 cursor、跳到参与者位置和 Follow Along | 未找到公开对象阈值/渲染算法 | 整 Board PDF；单 Scene/全部 Scenes PDF |
| tldraw | 自由 page-space camera，可选 bounds/constraint | Fit、Selection、Bounds、camera constraints | 本轮来源未覆盖协作机制 | 空间索引 + viewport culling；默认 4,000 shapes/Page；LOD | 任意 shape 集合→SVG/PNG/JPEG/WebP；位图自动受浏览器上限约束 |
| Excalidraw | 官方称 infinite canvas；2026 API 支持 viewport target、fit 和 lock | Zoom-to-fit、Scroll back、Frames、Presentation；可锁定 viewport | 官方源码包含 remote pointer、selection、visible scene bounds 和 following user 逻辑 | 未找到公开对象阈值 | 本轮来源未核验具体导出范围与格式 |
| Milanote | 官方称 infinite canvas | Zoom-to-fit、嵌套 Board 面包屑、Presentation focus | 本轮来源未覆盖实时协作机制 | 官方仅给出持续提高 Board/Export 容量，无公开数值阈值 | Board 导出；大 Board 导出为官方持续优化项 |

## 4. 分产品事实与推断

### 4.1 Figma / FigJam

#### 官方事实

- FigJam 将单页描述为“one infinite board”，支持二维平移和缩放：[Explore FigJam files](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files)。
- Figma Design 的每个 Page 坐标范围约为每轴 `-130,000` 到 `+130,000`：[Create and manage pages](https://help.figma.com/hc/en-us/articles/360038511293-Create-and-manage-pages)。
- 视口在 Plugin API 中被独立建模为 `center`、`zoom`、`bounds`，并支持把一组节点滚动/缩放进视口：[figma.viewport](https://developers.figma.com/docs/plugins/api/figma-viewport/)。节点同时有逻辑绝对边界和包含阴影、粗描边等效果的 `absoluteRenderBounds`：[Shared Node Properties](https://developers.figma.com/docs/plugins/api/node-properties/)。
- FigJam 提供 Hand tool、滚轮/触控板平移、捏合缩放、`Zoom to fit`、`Zoom to selection`，以及滚离起点后的 `Recenter`：[Pan and zoom in FigJam](https://help.figma.com/hc/en-us/articles/1500004414582-Pan-and-zoom-in-FigJam)。
- FigJam 支持多 Pages；官方建议用 Page 隔离工作流、周期会议并减少单 Board 的尺寸和加载时间：[Create and manage pages in FigJam](https://help.figma.com/hc/en-us/articles/24005082123159-Create-and-manage-pages-in-FigJam)。Section 可聚合、隐藏、锁定并深链：[Organize your FigJam board with sections](https://help.figma.com/hc/en-us/articles/4939765379351-Organize-your-FigJam-board-with-sections)。
- Spotlight/Follow 同步呈现者的画布位置、缩放和 Page 切换：[Present to collaborators using spotlight](https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight)。
- Figma 官方工程文章说明其最初用 WebGL、后引入 WebGPU 渲染交互画布：[Figma rendering: Powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)。编辑画布初始只加载当前 Page，之后按需加载其他 Page；prototype viewer 则先加载当前 Frame。官方报告复杂文件加载提速 33%、客户端节点数减少 70%、OOM 用户减少 33%：[Speeding up file load times, one page at a time](https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/)。
- FigJam 可把整个 Board 或选区导出为 PNG/JPG/PDF：[Export your FigJam board](https://help.figma.com/hc/en-us/articles/4407699832855-Export-your-FigJam-board)。
- Figma Design 可导出 layer、frame、component、group、section、slice 或当前 Page 的整个 canvas：[Export static designs from Figma](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)。

#### 推断

- “无限”适合实现成大范围 world space + camera，不需要无界数值域。
- `logical bounds`、`render bounds`、`scene bounds`、`viewport bounds` 必须分离；连线标签、阴影、描边不应被当成节点越界。
- Figma 没有公开传统 minimap 也能工作，说明 Fit/Recenter + Page/Section + 深链/Follow 可以先于 minimap。

#### 证据缺口

- 未找到 FigJam 精确坐标上限、空间索引类型、可见区剔除算法、单 Page 对象硬上限或传统 minimap 的官方说明。

### 4.2 Miro

#### 官方事实

- Miro 开发者文档把 Board 定义为可缩放、可向四个方向持续平移的 infinite surface；新建 Board 的初始 viewport 中心为 `(0,0)`，顶层对象的 `x/y` 是对象中心相对画布中心的位置：[Boards](https://developers.miro.com/docs/boards)。Viewport API 把当前视图表示为左上角 `x/y`、宽高和 zoom，并支持 `zoomTo` 一个或多个对象：[Viewport API](https://developers.miro.com/docs/websdk-reference-viewport)。
- Frame 形成父子坐标系后，子对象坐标改为相对 Frame 左上角；官方 API 会拒绝把不在 Frame 边界内的对象加入 Frame：[Children inside parent items](https://developers.miro.com/docs/children-inside-parent-items)。
- Frame 用于组织内容、快速导航、演示和 PDF 导出；Frames panel 支持跳转、重排、缩略图/列表视图和按画布几何顺序自动排序：[Frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames)。
- 右下角导航区可显示 Board 内容 Map；新的 UI 允许固定 Map：[Miro's new simplified user interface](https://help.miro.com/hc/en-us/articles/20967864443410-Miro-s-new-simplified-user-interface)。
- 任意对象和 Frame 都可复制直接链接，打开后定位到精确位置：[Internal and external linking](https://help.miro.com/hc/en-us/articles/360017572354-Internal-and-external-linking)。
- Board 内搜索会高亮命中、淡化其他内容并把点击结果定位到视口：[Searching text on the board](https://help.miro.com/hc/en-us/articles/360018109534-Searching-text-on-the-board)。首次进入 Board 的受邀者还可落在预设 Start view：[Sharing boards](https://help.miro.com/hc/en-us/articles/360017730813-Sharing-boards-and-inviting-collaborators)。
- Attention Management 支持 Follow、Bring everyone to me 和 Bring specific collaborator；用户一旦自行平移、点击或缩放就退出跟随：[Attention management](https://help.miro.com/hc/en-us/articles/360013358479-Attention-management)。
- Board 最多 100,000 个对象，但性能可能从 1,000 个对象起受影响；官方建议低于 5,000，并在必要时拆成多个 Board：[Board performance and loading issues](https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues)。
- Layers 可隐藏、锁定、重命名、复制和重排；隐藏状态对所有用户生效并在 reload 后保留：[Layers](https://help.miro.com/hc/en-us/articles/20258488000786-Layers)。Miro Diagram 是 Board 上的结构化 Format，可进入 Focus mode、独立导出并分享 Focus link：[Miro Diagrams](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams)。
- Table、Timeline、Kanban 在缩小时显示简化预览，放大后只展示当前可见区域的细节：[Board performance and loading issues](https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues)。Miro 同时使用 GPU hardware acceleration 与 WASM，无 GPU 时退回 CPU 并明确会使大 Board 平移缩放变慢：[System requirements](https://help.miro.com/hc/en-us/articles/360017731553-System-requirements)。
- 导出 PDF 时每个 Frame 成为一页，顺序由 Board overview 中的 Frame 顺序决定。官方警告含大量对象的 Frame 可能导致缺字等导出异常，建议拆 Board 后分别导出：[How to export your board](https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board)。
- Mobile app 仍保留 Frames、搜索、connector、Follow/Bring to me，但不提供所有桌面能力：[Mobile app](https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app)。
- 官方表示约 200 个 Editor/Commenter 同时在线是常见场景，最大一次成功会话为 377 人；超过 300 人不保证所有人都流畅：[Concurrent collaborators](https://help.miro.com/hc/en-us/articles/360013912300-How-many-users-can-collaborate-on-a-board-simultaneously)。

#### 推断

- Miro 把 Frame 同时用作目录项、演示页和导出页；Archify 可让 Module/Section 成为同类“一份语义，多种消费”的锚点。
- 顶层 Board 可持续平移，不等于局部 Frame 也没有 containment 约束。
- Table、Timeline、Kanban 的缩放级别预览可视为 semantic zoom/LOD 的产品先例。
- 对象上限不等于舒适上限。Archify 应在性能阈值前主动显示复杂度预算，而不是等到浏览器卡顿或导出失败。
- 如果把 Section 做成 Miro Frame 那样的强 containment，固定画布返工只会转移到局部容器。更适合 Archify 的默认是 Section 自动扩张或越界只 warning，只有显式 export frame 才严格裁剪。

#### 证据缺口

- 未找到 Miro 的世界坐标数值上下限、空间索引/裁剪算法、普通 shape/connector 的 LOD 规则或导出最大像素尺寸等官方公开实现。

### 4.3 XMind

#### 官方事实

- 一个 `.xmind` 文件可包含多个 Sheet；官方建议在单张图过于拥挤、影响可读性时分散到多个 Sheet：[Sheet](https://xmind.com/user-guide/sheet-new)。
- XMind 提供自动平衡、Compact Map、自由分支定位、floating topic、允许 Topic overlap 等布局开关：同上。
- 分支可 Fold/Unfold、Show Branch Only、Print Branch 和 Export Branch；官方明确把这些功能定位于内容过多时的阅读、修改和演示：[Branch](https://xmind.com/user-guide/branch-new)。
- Outliner 把同一内容切为线性层级视图，并保留缩放、单 Branch 聚焦和按 Sheet/内容导出：[Outliner](https://xmind.com/user-guide/outliner-new)。
- 导出支持 PNG、SVG、PDF、Excel、Word、OPML、TextBundle、PowerPoint、Markdown 等；PNG/JPEG 可按主分支拆分：[Export](https://xmind.com/user-guide/export-new)。

#### 推断

- 对“节点天然有层级”的图，最好的扩展性可能不是让用户手动在无限平面上摆更多节点，而是保留自动布局、折叠、单 Branch 聚焦和 Outline 双视图。
- XMind 可视为“结构化自动布局 + 局部自由定位”的混合模型。
- Archify 的架构图/数据流图可自由布局，但工作流、序列图、状态图更适合受约束布局；不应为了统一画布而抹平五类图的结构差异。

#### 证据缺口

- 未找到 XMind 对数学无限画布、精确坐标边界、minimap、对象阈值或渲染裁剪算法的官方说明。

### 4.4 Whimsical

#### 官方事实

- 官方明确称 Board 为 infinite canvas；支持空格/hand 平移、以 cursor 为中心缩放、`1` Fit all、`2` Fit selection、对齐与 grid snap：[Working with Whimsical's infinite canvas](https://whimsical.com/learn/get-started/infinite-canvas)。
- Section 用于命名区域、包裹现有内容、选择是否裁剪越过边界的内容，并支持直接链接：[Using sections on the Whimsical canvas](https://whimsical.com/learn/boards/sections)。
- 演示时每个 Section 或 Wireframe frame 成为 slide；Section 可嵌套，越过 Section 边缘的对象会在演示时被裁剪：[Presenting in Whimsical](https://whimsical.com/learn/boards/presenting)。
- Multipage file 可把 Board、Doc 和 Folder 放入同一文件的 Page tab；共享权限作用于整个 Page bundle：[Multipage files](https://whimsical.com/learn/files/multipage-files)。
- 超过 10,000 个 item 时文件可能变慢，官方建议拆分为多个小文件；超过 100 人同时工作时不再显示全部 cursor，更新可能变慢：[Optimizing performance in larger boards](https://whimsical.com/learn/boards/performance)。
- 可跟随协作者 cursor；任何平移或缩放可退出跟随：[Collaborating with others in real time](https://whimsical.com/learn/faqs/collaboration)。
- 导出可按 Board 或 Frames 输出 PNG，也可只导出 selection；失败或模糊时官方建议分小 Section 导出：[Exporting content from Whimsical](https://whimsical.com/learn/imports-exports/exporting-from-whimsical)。

#### 推断

- Section 的边界可以是软边界，裁剪只在演示/导出发生；这比编辑期把节点或连线出界判为非法更适合 Archify。
- “Page 管项目阶段，Section 管单页模块，Frame 管最终交付区域”是可复用的三层模型。

#### 证据缺口

- 未找到官方数值坐标范围、minimap、空间索引或缩放边界的说明。

### 4.5 Lucidchart / Lucidspark

#### 官方事实

- Lucidspark 明确称 infinite canvas；Canvas View Controls 包含 Table of Contents（列出 Frames 和 Breakout Boards）、Mini Map（显示当前 viewport 并可点击跳转）、Zoom 和导航模式：[Navigate the Board and Canvas View Controls](https://help.lucid.co/hc/en-us/articles/15154609056916-Navigate-the-Board-and-Canvas-View-Controls)。
- Lucidchart 支持多 Page、Layer、mini map、zoom to content；Page 可作为独立文档单位：[Welcome to Lucidchart](https://help.lucid.co/hc/en-us/articles/11970952773652-Welcome-to-Lucidchart)。
- Paths/Present 把画布上的区域编排为演示流程，并允许协作者在跟随路径时继续用 sticky、reaction、comment、laser pointer 交互：[Create a presentation in Lucid](https://help.lucid.co/hc/en-us/articles/15994195704596-Create-a-presentation-in-Lucid)。
- 导出支持 PDF、PNG、JPEG、SVG 等；PDF 可按 Page tile 或 Layer 拆页：[Export or print a Lucid document](https://help.lucid.co/hc/en-us/articles/16324571257492-Export-or-print-a-Lucid-document)。
- 官方导出故障排查建议：关掉 infinite canvas、启用 page tiles、调整 content scale、复制到新文档或降低文件大小：[Troubleshooting: Export or print a document](https://help.lucid.co/hc/en-us/articles/17988548286100-Troubleshooting-Export-or-print-a-document)。

#### 推断

- Lucid 展示了最直接的“双模式”方案：编辑期无限，交付期恢复 Page tiles。Archify 可把固定画布从合法性边界降级为可选的 export/print overlay。
- Mini Map 与 Table of Contents 互补：前者给空间方向感，后者给语义导航。超大图不应只实现其中一个。

#### 证据缺口

- 未找到 Lucid 官方数值坐标范围、对象硬上限和底层空间索引算法。

### 4.6 diagrams.net（draw.io）

#### 官方事实

- 默认启用 Page View；关闭后 grid 扩展到整个 drawing canvas，官方直接称为使用 infinite canvas：[Using the draw.io editor](https://www.drawio.com/docs/manual/editor/) 与 [Enable or disable page view](https://www.drawio.com/docs/manual/editor/panels/editor-page-view/)。
- Outline dialog 专门用于导航大图，可在 overview 中点击跳转：[Panels and dialogs in draw.io](https://www.drawio.com/docs/manual/editor/panels/)。
- Layers 可隐藏/锁定/重排复杂图的部分内容；Tags 可跨 Layer 选择、显示和隐藏相关对象：[Using layers in draw.io](https://www.drawio.com/docs/manual/layers/) 与 [Use tags in diagrams](https://www.drawio.com/docs/manual/links-tooltips-tags/tags-in-diagrams/)。
- 官方建议把复杂图拆成多 Page 或 Layers；自定义链接可跳 Page、滚动到对象或设置 viewbox：[Create an interactive diagram with layers and custom links](https://www.drawio.com/docs/tutorials/interactive-diagram-layers/)。
- 导出支持 XML、JSON、PNG、SVG、JPEG、PDF；PNG/SVG/PDF 可嵌入源图数据，HTML viewer 可保留 Page、Layer、Tag、Zoom 和 collapse/expand：[Supported export formats](https://www.drawio.com/docs/manual/export/export-diagram/) 与 [Embed HTML](https://www.drawio.com/docs/manual/export/embed-html/)。
- 大图片会拖慢浏览器、编辑器和自动保存；Confluence Cloud 中超大图的 PDF 导出可能超时并返回空白/损坏文件：[Add images](https://www.drawio.com/docs/manual/insert/add-images/) 与 [Solve PDF export problems](https://www2.drawio.com/doc/faq/pdf-problems-confluence-cloud)。

#### 推断

- draw.io 证明“固定页”和“无限画布”可以只是同一数据模型的两种 view，不必分裂两套 schema。
- Layers/Tags 是处理复杂度的正交维度，但对 Archify MVP 可能过重；更小的可行组合是 Page + Section + 搜索/过滤。

#### 证据缺口

- 未找到 draw.io 的对象硬上限、数值坐标范围或可见区裁剪算法官方说明。

### 4.7 Canva Whiteboards

#### 官方事实

- Canva 官方称 Whiteboards 为 infinite canvas，支持 zoom、pan、scroll，并可把 Presentation 一键扩展为 Whiteboard：[Discover infinite possibilities with Canva's AI Whiteboards](https://www.canva.com/newsroom/news/canva-ai-whiteboards/)。
- 协作包含实时彩色 cursor、comment、reaction；可点击 avatar 跟随用户，避免在无限画布中迷路：[The official launch of Canva Whiteboards](https://www.canva.com/newsroom/news/unveiling-the-canva-visual-worksuite/) 与 [Tap into your second brain with Canva Whiteboards](https://www.canva.com/newsroom/news/canva-whiteboards/)。
- Whiteboard 可转为 Presentation 或 Doc；可选择元素后单独下载：[Free Online Whiteboard](https://www.canva.com/online-whiteboard/)。
- 官方模板页说明白板可保存为 PDF、JPEG、PNG 或 MP4：[Online whiteboard templates](https://www.canva.com/online-whiteboard/templates/)。

#### 推断

- Canva 的强项不是更复杂的空间导航，而是把发散工作区转成受约束交付物。Archify 也应把“浏览/编辑视图”与“审查/导出视图”做成显式转换。

#### 证据缺口

- 未找到 Canva 官方数值坐标范围、minimap、对象阈值、裁剪/LOD 或超大导出限制的说明。

### 4.8 Apple Freeform

#### 官方事实

- Apple 将 Freeform 描述为 boundless canvas，可放置多种文件而无需考虑 layout 或 page size：[Get started with Freeform on iPhone](https://support.apple.com/guide/iphone/get-started-with-freeform-iphb86e84e2b/27/ios/27)。
- Scene 是保存的 Board 视图，可命名、重排、重新取景，并通过 Scene Navigator 前后跳转；可把单个或全部 Scenes 导出为 PDF：[Navigate and present scenes in your Freeform boards on Mac](https://support.apple.com/guide/freeform/navigate-and-present-scenes-frfm7cc55b64/5.0/mac/27)。
- 协作支持实时 cursor、跳到参与者位置和 Follow Along；跟随时 zoom 取决于被跟随者，自己滚动/缩放/编辑即退出：[Collaborate on a Freeform board on iPhone](https://support.apple.com/guide/iphone/collaborate-on-a-board-iph5a2eb2c7b/ios)。
- 整个 Board 也可直接导出 PDF：[Send a copy or PDF of a Freeform board on iPhone](https://support.apple.com/en-ca/guide/iphone/iphcd5447866/ios)。

#### 推断

- Scene 比纯 Frame 更接近“命名 camera bookmark”；它不要求重写图数据即可提供目录、演示和导出范围。Archify 可先实现 Saved View，再决定是否需要复杂容器语义。

#### 证据缺口

- 未找到 Apple 公开坐标范围、minimap、对象阈值、裁剪/LOD 或导出尺寸限制。

### 4.9 tldraw（开源实现基线）

#### 官方事实

- Camera 独立管理 page-space 位置与 zoom，提供 `zoomToFit`、`zoomToSelection`、`zoomToBounds`、`centerOnPoint`；constraints 可对两个轴分别选择 `free/fixed/inside/outside/contain`：[Camera system](https://tldraw.dev/sdk-features/camera)。
- SDK 用空间索引找出 viewport 内的 shapes；viewport 外的 shape 保留在 store 和 DOM 中但设为 `display:none`，仍可被选择、命中测试和导出：[Culling](https://tldraw.dev/sdk-features/culling)。
- 性能文档说明其目标是保持数千 shapes 的流畅度；默认 `maxShapesPerPage = 4000`，还用 reactive signals、debounced zoom、图片分辨率降级和低 zoom 视觉降级：[Performance](https://tldraw.dev/sdk-features/performance)。
- 导出接受任意 shape 集合，先生成自包含 SVG，再按需转 PNG/JPEG/WebP；位图尺寸会自动 clamp 到浏览器 Canvas 上限，超大导出被缩小而不是直接 OOM：[Image export](https://tldraw.dev/sdk-features/image-export)。

#### 推断

- 对 Archify，空间索引 + viewport culling 是比“换用 Canvas/WebGL”更早可验证的性能收益点。
- Camera constraint 可用于 mobile、presentation 和 review mode，而编辑模式保持 free；“无限”和“有限”可以是 camera policy，不必是两套画布。

### 4.10 Excalidraw（开源实现基线）

#### 官方事实

- Excalidraw 官方产品页称其提供 infinite canvas、实时协作、Frames 和 Presentation：[Excalidraw Plus](https://plus.excalidraw.com/)。
- 2026-07 官方 changelog 把旧 `scrollToContent` 重构为 `setViewport`：目标可以是元素、对象链接、Bounds 或 Rect；支持 `scale-down/contain/none`、动画、UI offsets 和 scroll/zoom lock。Zoom-to-fit 在锁定状态下以 locked bounds 为目标：[Excalidraw changelog](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md)。
- 官方源码中的实时协作同步 remote pointer、selection 和 visible scene bounds，并包含 following user 逻辑：[Collab.tsx](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)。

#### 推断

- 评审或嵌入模式需要的是“自由 world + 可锁 camera”，而不是永久把场景裁成固定页。
- Archify 的 validator 错误可直接生成 `setViewport(target=error bounds)` 式导航动作，形成错误列表→位置的闭环。

#### 证据缺口

- 未找到 Excalidraw 官方对象硬上限、空间索引/裁剪算法、精确数值坐标边界的说明。

### 4.11 Milanote（补充样本）

#### 官方事实

- 官方称 Board 为 infinite canvas：[Visual note-taking](https://milanote.com/product/note-taking)。
- Zoom 支持 zoom in/out、回到 100% 和 `Z` Fit all content：[Zoom in/out](https://help.milanote.com/en/articles/1721940-zoom-in-out)。
- Board 可嵌套在其他 Board 中，左上角导航展示到当前 Board 的层级路径：[Nesting boards](https://help.milanote.com/en/articles/9860073-nesting-boards)。
- Presentation mode 可阻止误编辑并点击聚焦单卡片：[Presentation mode](https://help.milanote.com/en/articles/6815489-presentation-mode)。
- 2026 release notes 记录增加 Board 尺寸限制、提升大 Board 导出可靠性，但没有给出数值阈值：[Milanote release notes](https://milanote.com/releases)。

#### 推断

- 嵌套子板是除 Pages 以外的另一种复杂度隔离方式，适合项目→子系统→模块，但不应隐藏跨模块边；Archify 需要在层级拆分和全局依赖视图之间切换。

## 5. 方案空间：纯无限画布之外还能怎么做

以下全部是基于上文事实的设计推断，不是厂商直接结论。

### A. 纯无限平面

- 做法：所有节点和边共享一个 world space，camera 自由平移/缩放。
- 优点：改动直观，直接消灭“页面装不下”。
- 缺点：不能单独解决迷路、性能、导出、信息密度和协作聚焦；巨图最终仍会退化。
- 适用：小到中图、自由白板。

### B. 无限平面 + 语义脊柱（推荐默认）

- 做法：仍是一个 world space，但每个模块自动形成 Section；左侧生成 Module/Section outline；支持 Fit graph/selection/section、Home、Back/Forward、搜索、深链和 validator jump。
- 优点：保留连续空间和跨模块边，同时给导航、导出、校验稳定锚点。
- 缺点：需要定义 Section 与节点/边的关系。
- 适用：Archify 的主编辑和审查体验。

### C. Page/Sheet 分片 + 跨页 Portal

- 做法：Project 内分 Page；跨 Page 边渲染为双向 Portal/Reference，另有全局 dependency overview。
- 优点：性能、认知、移动端和导出最好控制。
- 缺点：跨 Page 路径不再连续，用户可能丢失全局脉络。
- 适用：超大项目、子系统/Bounded Context 明确的架构图。

### D. Saved Views / Scenes，而非刚性容器

- 做法：保存命名 camera bounds，可排序、深链、演示、导出；不改变节点的归属。
- 优点：成本小，不会引入复杂嵌套和裁剪语义。
- 缺点：不能直接用于权限、移动一组节点或局部加载。
- 适用：先解决“迷路 + 一屏装不下 + 导出”的最小切片。

### E. 结构视图与空间视图双模

- 做法：同一图数据可切为 Canvas、Outline、依赖列表、单 Branch/邻域视图；XMind Outliner 是直接先例。
- 优点：大图校验和搜索远比在低倍缩放下扫像素可靠。
- 缺点：需要稳定的图模型和双向选择同步。
- 适用：工作流、序列、状态/生命周期、数据流以及无障碍模式。

### F. 有限 camera、无限数据

- 做法：编辑时 camera free；移动端、嵌入、演示、review 时把 camera constrain 到当前 Section/Scene/Error neighborhood。
- 优点：同一数据模型适配不同设备和任务。
- 缺点：必须清楚显示当前 camera 是否被锁，避免用户误以为内容丢失。

### G. 多分辨率图（LOD）

- 做法：远距离只显示模块/聚合边；中距离显示节点名和关键边；近距离显示端口、标签、证据、状态。
- 优点：从根本上改善几千节点压缩后的认知问题。
- 缺点：聚合边含义、交互和导出一致性较复杂。
- 适用：真正的项目级总览；不应作为第一阶段必做项。

## 6. 对 Archify 的具体建议（推断）

### 6.1 校验边界

把以下规则从“错误”降级为“布局/导出提示”：

- 节点超出初始 viewport；
- 连线、箭头、标签超出 Page/Section 的视觉边缘；
- 整图无法在一屏内以可读字号显示。

保留为错误的应是语义不变量：

- edge source/target 不存在；
- 不允许的连接类型或方向；
- id 冲突、必填字段缺失；
- 尺寸或坐标为非有限数；
- 结构约束被破坏，例如序列时序反向或状态迁移引用不存在。

### 6.2 Camera 与导航最低闭环

MVP 至少应包含：

1. `Fit graph`、`Fit selection`、`Fit section`。
2. `Home/Recenter`，并记住 last meaningful view。
3. Back/Forward camera history。
4. 模块/Section outline + 搜索。
5. 节点、边、Section 深链。
6. Validator issue list 点击后聚焦真实 render bounds。
7. 小型 minimap 可作为方位感补充，而不是唯一导航入口。

### 6.3 数据与边界模型

建议至少区分：

```text
nodeBounds       节点逻辑几何
renderBounds     含标签、端口、箭头、描边、阴影的真实渲染范围
sectionBounds    模块的语义/视觉范围，可自动扩张
sceneBounds      当前 Page/全图内容包围盒
viewportBounds   camera 当前可见区域
exportBounds     一次导出的明确范围
```

任何“是否合法”的判断不得直接读取 `viewportBounds`。`exportBounds` 可以来自 scene、Page、Section、Selection、Saved View 或纸张 tiles。

### 6.4 性能与规模预算

按风险从低到高推进：

1. 只渲染 viewport 与适量 overscan 内的节点/边；空间索引查询可见对象。
2. camera 移动期间降低昂贵细节，停止后恢复。
3. 远距离隐藏端口、次要标签、阴影和装饰；聚合平行边。
4. Page/Section 级延迟加载；预取当前选中节点的一跳邻域。
5. 超阈值时主动建议拆 Page/Section，而不是只报浏览器失败。
6. 保存一组真实大图基准：节点数、边数、长标签、图片、并发 cursor、导出像素数分别施压。

### 6.5 导出契约

- MVP 默认保持当前兼容语义：导出完整 canonical diagram，而不是当前 viewport；后续再显式增加 Selection、Section、Saved View 和 Paper tiles。
- 每次导出都必须有有限 `exportBounds`。它可以来自整图、Selection、Section、Saved View 或纸张 tiles，但不能由“无限工作区”隐式推导出无限位图。
- Whole project 若超过单张位图安全尺寸，优先 SVG/PDF，或自动分块并生成索引页；不能静默缩小到不可读。
- 导出前运行的是“export preflight”，报告裁剪、字体、像素上限、分页和不可渲染资源；不要把这些问题污染图本身的语义校验。

### 6.6 五类图不应完全同构

- Architecture：自由二维布局 + Section/Page + 聚合边最有价值。
- Workflow：保留主方向和泳道，允许纵横扩展；Fit lane/step group。
- Sequence：横轴参与者、纵轴时间是强不变量；适合单轴近似无限滚动，不宜完全自由摆放。
- Dataflow：类似 Architecture，但需要按数据域/信任边界 Section，并支持 lineage focus。
- Lifecycle/State：自动布局 + 单状态邻域/路径聚焦优先；自由拖动只能是布局覆盖。

## 7. 推荐的决策顺序

1. 先把 validator 从“固定画布合法性”改为“语义合法性 + export preflight”。
2. 引入独立 camera 和 `Fit graph/selection/Home`，让现有图不再依赖浏览器页面滚动。
3. 引入自动 Section 与 outline，作为防迷路和导出锚点。
4. 加入 viewport culling 和 scale-dependent detail，并建立大图基准。
5. 再根据真实数据决定是否需要 minimap、Pages/Portals 或 LOD 聚合。

不建议一开始就实现：任意深度嵌套容器、通用 Layers/Tags、跨 Page 任意曲线、多人 CRDT、完全可编程 camera constraints。它们都有市场先例，但不是解决当前“校验返工和一屏装不下”的最短路径。

## 8. 证据强度与未决问题

### 基于本次样本的高置信归纳

- 在本次样本中，无限体验与有限交付范围经常共存。
- Frame/Section/Scene/Page 被反复用作导航、演示和导出单元。
- 大图产品仍设置或建议对象规模阈值，并建议拆分。
- Follow、深链和 Fit 类操作在多个样本中重复出现。
- 超大导出是独立问题，不能由“无限画布”自动解决。

### 经仓库审计已经确认

- 当前同一个根 SVG `viewBox` 同时承担 authored capacity、布局容量、阅读比例、camera world、radar world、可读性分母和完整导出范围；这些本应是不同概念。
- Architecture、Sequence、Workflow 等 renderer 确实会把负坐标或超出 `viewBox` 的几何直接报告为失败；Workflow v2 已有 `measuredContentBounds()`，可作为迁移起点。
- viewer 已有 `{scale,x,y,mode}`、focus、radar 和 `MAP/READ/FULL`，但 camera 被根 `viewBox` 和 `1..3` 缩放范围限制；mobile wide 主要退化为横向 `scrollLeft`。
- radar、reader layout 和 export 都直接读取根 `viewBox`；raster export 有 16M 像素预算，但即使 1x 仍超预算时当前逻辑没有 typed failure。
- 五类图中只有 Workflow 暴露了较纯的 compiler；其他 renderer 仍把 normalization、layout、validation 和 SVG 拼装混在副作用脚本中。

### 仍需用真实项目数据回答

- 实际返工中，纯 `viewBox` containment 错误、真实碰撞/穿线错误和语义错误各占多少。
- 大图瓶颈首先出现在 layout、edge routing、DOM/SVG 数量、文字测量，还是 raster export。
- 真实项目的 P50/P95 节点数、边数、Section 数和最长标签，决定何时需要 culling、LOD、Worker 或分页。
- 使用者最常见的导航任务是找节点、查路径、按模块审查还是演示；这决定 outline、搜索、saved views 和 minimap 的优先级。

## 9. Archify 当前结构：问题不是 SVG，而是边界职责混在一起

以下证据来自本仓库代码，而不是市场类比：

| 关注点 | 当前实现证据 | 后果 |
|---|---|---|
| authored capacity 与合法性 | [`render-architecture.mjs`](../archify/renderers/architecture/render-architecture.mjs)、[`render-sequence.mjs`](../archify/renderers/sequence/render-sequence.mjs) 会用 `viewBox` 做 containment | 节点和连线本身正确，只因纸面装不下就返工 |
| intrinsic extent | [`workflow-compiler.mjs`](../archify/renderers/workflow/workflow-compiler.mjs) 已有 `measuredContentBounds()`，但显式 `viewBox` 仍是硬容量 | 五类图行为不一致，Workflow 已证明可先算内容再定画框 |
| camera world | [`viewer-camera.js`](../viewer/viewer-camera.js) 启动时捕获根 `viewBox`，把平移和逻辑 viewport clamp 回其范围 | 目前是“有限画布里的相机”，不是逻辑无限工作区 |
| mobile | 同文件在 mobile wide 模式主要写 `scrollLeft` | 只能横向浏览，无法形成统一的二维 camera 心智模型 |
| radar 与阅读布局 | [`semantic-radar.js`](../viewer/semantic-radar.js) 和 [`reader-layout.js`](../viewer/reader-layout.js) 都把根 `viewBox` 当全世界 | 改大 `viewBox` 会同时改变 radar、fit 和页面宽高判断 |
| export | [`export.js`](../viewer/export.js) 从主 SVG `viewBox` 序列化；`pickSafeScale()` 最低回退 1x | 阅读边界和输出边界不能独立，极大 raster 仍可能超预算 |
| schema | 五类 schema 的 `meta.viewBox` 只有 `[width,height]`，没有 origin；point 虽允许负数，renderer 常拒绝 | schema 能表达的空间比实现实际接受的空间更大 |

关键结论：**第一步不需要抛弃 SVG；需要先把 canonical content、camera viewport、validator 和 export frame 分离。** 当前 canonical inline SVG、自包含 HTML、搜索、focus、route、story、Semantic Passport 和导出链都可以保留。

## 10. HCI 与超大图：为什么“纯无限平面”仍然不够

### 10.1 多尺度空间需要结构化导航

- [Pad++](https://hci.ucsd.edu/hollan/Pubs/pad.pdf) 和 [Space-Scale Diagrams](https://doi.org/10.1145/223904.223934) 的核心启示是：空间和尺度本身可以成为信息组织维度，但必须有稳定的 world-to-screen 映射和跨尺度导航。
- Shneiderman 的 [Overview first, zoom and filter, then details-on-demand](https://hci.stanford.edu/courses/cs448b/papers/shneiderman96eyes.pdf) 对 Archify 更实用：远景显示模块和主路径，中景显示节点与关键边，近景再显示端口、证据、标签和诊断。
- 低倍时简单隐藏文字不够；聚合结果必须保留拓扑意义。拓扑 fisheye/聚合的经典工作说明应优先保留连接与邻域，而不是只做几何缩小：[Topology-based Fisheye Views](https://www.graphviz.org/documentation/GKN04a.pdf)。

### 10.2 防止“desert fog”

无限工作区最危险的体验不是滚动，而是用户不知道自己在哪里、内容在哪个方向、怎样回去。研究将这种失去地标的状态称为 desert fog；可用稳定 landmarks、路径记录、Home、内容方向提示和层级目录缓解：[Desert Fog](https://doi.org/10.1145/288392.288578)。

对 Archify，防迷路优先级应是：

1. 搜索/validator issue → 精确聚焦。
2. Module/Section outline 与 Home/fit。
3. camera Back/Forward 和稳定深链。
4. Saved Views/Scenes 与 guided story。
5. minimap 作为辅助。研究表明 overview 会帮助一部分空间任务，但也会增加视线切换成本，不能把它当唯一入口：[Overview Maps](https://www.cs.umd.edu/~bederson/images/pubs_pdfs/p362-hornbaek.pdf)。

### 10.3 大图要维护 mental map，而不是每次重排一切

- 新节点或折叠展开时优先 incremental layout，尽量保留未受影响节点的位置。
- 自动动画应短、可打断并尊重 reduced motion；它的目的只是解释“从哪里移动到哪里”，不是展示效果。
- 当整图即使 fit 后也不可读时，正确答案是 overview + focus + hierarchy/folding + multiple views，而不是继续缩小字体。大图可理解性研究同样指出视觉密度和任务复杂度会迅速吞噬“能渲染更多元素”的收益：[Large Graph Exploration](https://arxiv.org/abs/2008.07944)。

## 11. 引擎与布局方案：借鉴架构，不急着换内核

| 方案 | 最值得借鉴 | 主要限制 | Archify 结论 |
|---|---|---|---|
| tldraw | page-space camera、bounds policy、空间索引、culling、LOD、导出任意 shape 集 | SDK 生产使用涉及许可；shape/editor 模型远重于当前需求 | 参考 camera/culling 架构，不直接迁移产品内核 |
| React Flow | 简单的 viewport transform、fit、minimap、可选只渲染可见元素 | 以 React/HTML/SVG node editor 为中心；canonical clean SVG export 不是其核心 | camera 数学与交互可参考，不值得为此引入 React |
| Excalidraw | Canvas2D、viewport target、自由场景和协作行为 | 更适合扁平白板，复杂语义卡片与正式矢量输出不是强项 | 不替换现有 rich SVG scene |
| ELK / elkjs | compound graph、ports、orthogonal routing、layered layout、浏览器/Worker 可运行 | 需要五类语义约束适配；布局确定性、字体测量、包体要验证 | 最值得作为未来可替换 layout adapter 做 PoC |
| Graphviz | cluster、rank、pack、page、成熟自动布局 | 浏览器交互与增量布局不是强项，输出控制风格差异大 | 适合离线对照和特定架构图，不作 viewer 内核 |
| Cytoscape.js | graph 分析、compound graph、Canvas/WebGL 生态 | rich HTML/SVG 卡片和 canonical SVG 导出不自然 | 适合超大标准节点探索器，不适合当前制品主路径 |
| yFiles | folding、incremental layout、edge grouping/bundling、LOD、multipage 非常完整 | 商业许可和平台依赖 | 产品能力上限参考，不作为默认依赖 |
| D2 / Structurizr / C4 | layers/scenarios、一个模型多个 focused views | 不是通用无限画布引擎 | 对“超大图不要只做一张总图”的产品决策价值最高 |

官方实现入口：[tldraw Camera](https://tldraw.dev/sdk-features/camera)、[tldraw Culling](https://tldraw.dev/sdk-features/culling)、[React Flow Viewport](https://reactflow.dev/learn/concepts/the-viewport)、[ELK](https://eclipse.dev/elk/)、[Graphviz Attributes](https://graphviz.org/doc/info/attrs.html)、[Cytoscape.js](https://js.cytoscape.org/)、[yFiles Folding](https://docs.yworks.com/yfiles-html/dguide/advanced/folding.html)、[Structurizr Views](https://docs.structurizr.com/dsl/language#views)。

推荐技术路线：

1. 先保留 canonical inline SVG，以矩阵变换实现独立 camera。
2. 先统一 scene/bounds/index，再做 viewport culling；不要把 culling 绑死在 DOM `getBBox()`。
3. 只有基准证明 DOM/SVG 是首要瓶颈时，才增加 Canvas/WebGL viewer adapter；canonical export 仍由 scene 独立生成。
4. ELK 只作为布局实验 adapter；Sequence 的 participant/time order、Workflow 的 lane/mainPath、Lifecycle 的 state semantics 不能交给通用布局器任意重排。

## 12. Design It Twice：三种 seam 的比较

### 方案 A：一个深模块，`compile / mount / export`

外部只看见三个 entry points；内部隐藏五类 normalize/layout、bounds、validation、camera、LOD、index 和 export。

- 优点：最高 locality，调用方不再负责调用顺序；最能防止五套 renderer 再次各自实现 camera/export。
- 风险：若一次性重写全部实现，迁移面太大；opaque world 需要好的诊断和 inspector。
- 适合：作为长期内部架构方向。

### 方案 B：公开 Layout/Camera/Bounds/Export plugin SDK

把布局、camera、bounds、export planning 和 codec 都做成可注册策略。

- 优点：灵活，未来能形成引擎生态，容易比较 ELK/Graphviz/legacy。
- 风险：插件 SDK 会变成长期兼容承诺；normalized graph 易退化成最低公分母；对于当前只有一种真实实现的能力属于 hypothetical seam。
- 结论：当前不采用。只有出现第二个生产实现且确有替换需求时，才把内部 seam 升级为公共接口。

### 方案 C：保持作者常用路径不变，在 renderer 与 viewer 间统一 finalize

作者不新增 `meta.canvas`/`meta.camera` 配置树：

- 省略 `meta.viewBox`：内容驱动的 intrinsic world，自动得出有限 canonical frame。
- 显式 `meta.viewBox`：保留严格 fixed-frame escape hatch，用于确实需要固定版面的制品。
- 内部引入一个窄 seam：

```ts
finalizeSpatialArtifact(scene, { fixedFrame? }): {
  contentBounds,
  paintBounds,
  canonicalFrame,
  initialCamera,
  focusIndex,
  diagnostics,
  viewerManifest
}
```

- 优点：兼容现有 JSON/Mermaid/证据输入和 standalone HTML；可逐个 renderer 迁移。
- 风险：迁移期 legacy 与 intrinsic 两种路径并存，需要明确 receipt 和 golden tests。

### 推荐组合

采用 **C 的外部迁移方式 + A 的内部深模块边界**：普通作者几乎无新增概念，内部则逐步收敛为 `compile / mount / export`。不采用 B 的公共插件平台。现有 `meta.views` 足以承载 Saved Views/Scenes，首版不再创造一套平行 Scene schema。

## 13. 推荐目标设计

### 13.1 产品定义

不要承诺“数学无限”。推荐措辞是：

> **内容边界自动扩张，camera 近似无边界；编辑/浏览自由，验证看语义与几何，导出永远有明确有限范围。**

这实际上是 **bounded content + near-unbounded camera**。坐标必须是有限数，可为负；world 大到接近浮点/GPU 精度风险时由 renderer 做 origin rebasing。

### 13.2 四类核心 bounds

`BoundsService` 成为唯一真相源：

1. `layoutBounds`：布局器摆放的节点/容器/route 骨架。
2. `geometryBounds`：加入 edge 曲线、label、port、arrow geometry 后的几何范围。
3. `paintBounds`：再加入 stroke、marker、filter、shadow、clip/mask 和真实字体度量。
4. `exportBounds`：某次输出明确选择的有限区域。

`viewportBounds` 属于 camera session，不属于 canonical scene。Section bounds 可从成员和 padding 推导，只有显式 fixed frame 才做硬 containment。

### 13.3 校验分层

| 层级 | 仍然是 error | 不再是 error |
|---|---|---|
| schema / semantic | 非有限数、重复 ID、缺失 endpoint、非法状态迁移、sequence 时间顺序冲突、workflow mainPath 不连续 | 节点在当前屏幕外 |
| layout / geometry | 不可接受重叠、边穿无关节点、标签冲突、route 非法、布局不收敛 | 负坐标、整图大于一屏、超出旧 `viewBox` |
| view session | camera state 非法、focus target 不存在 | pan/zoom 后暂时看不到内容 |
| export preflight | 空范围、像素/内存预算超限、资源不可嵌入、非预期裁剪 | 合法全图需要分页或降低 scale |

每个 geometry diagnostic 应携带稳定 code、subject IDs、evidence bounds 和 `focusTarget`。问题列表点击后直接 frame 真实 `paintBounds`，把“发现问题—定位问题—修复重跑”闭成一跳。

### 13.4 Camera 与导航

- camera 用 `{center, zoom, viewport}` 或等价矩阵表达，不用 authored `viewBox` 定义世界。
- pan/zoom/resize 不能触发重新 layout 或 validation。
- `Fit graph / selection / section / issue`、Home、Back/Forward、搜索、outline 和深链为核心动作。
- 初始 fit-all 若导致不可读，优先主路径、首个 guided view 或第一 Section，同时让 outline/radar 明示还有其他内容。
- `MAP / READ / FULL` 继续保留，但改为 camera zoom 派生的 semantic detail，不改变 topology 和 canonical export。
- mobile 使用同一二维 camera：单指/双指交互、44px 触控目标、较早进入 MAP/READ；不再维护只会横向滚动的第二套世界。

### 13.5 五类图共享基础设施但保留 kind adapter

内部保留五个真实 adapter，而不是公开“任意第六种图”注册表：

- Architecture：compound boundary、orthogonal route、可选 pin；最先验证二维 intrinsic world。
- Workflow：lane、phase/group、mainPath rank 是强约束；直接复用现有 v2 compiler 和 measured bounds。
- Sequence：participant ordered-x、message temporal-order 不得被通用 force/layout 打乱；更接近纵向扩张的专用世界。
- Dataflow：stage 顺序、lineage direction、feedback edge 和 trust boundary 必须保留。
- Lifecycle：lane/band、initial/terminal/main-state 语义优先；fold 的单位应是状态簇而非任意矩形。

### 13.6 导出是独立产品面

最终可支持六种显式语义：`full content`、`viewport`、`selection`、`section/frame`、`share-card`、`print/paged`。但 MVP 只保留当前 full canonical export 并修好超预算失败；不要悄悄把默认改成 viewport，也不要把当前虚拟化 DOM 当导出真相。

Raster 预算必须返回 typed result：`pixel-budget-exceeded`、`unsupported-format`、`resource-tainted`、`encode-failed`、`cancelled`。超预算时由请求明确选择 fail、reduce-scale、paginate 或 tile；receipt 记录实际 scale、裁剪和遗漏对象。

## 14. 分阶段落地、验收与设计消融

### Phase 0：先量化返工和规模

- 为五类图保存最小、小、中、大四档 fixtures，并记录 node/edge/label/image 数量。
- 把当前错误按 `semantic / geometry / fixed-frame / export` 重分类，统计真实项目分布。
- 记录 layout、route、DOM mount、first meaningful view、pan/zoom frame、SVG export、raster export 的分段耗时与内存。

### Phase 1：切开 bounds 与 validation，不改视觉

- 先在 Workflow v2 落地 `BoundsService` 和 `finalizeSpatialArtifact()`，再迁移 Architecture、Dataflow、Lifecycle、Sequence。
- 省略 `meta.viewBox` 时由 `paintBounds + padding` 生成 canonical frame；显式 `viewBox` 保留严格 fixed-frame 兼容。
- 删除 intrinsic 模式下的“超旧画布”错误，保留碰撞、穿线、标签和语义错误。
- 保持当前 standalone HTML 与 full canonical export 的 golden output/receipt 兼容。

### Phase 2：独立 camera 与诊断跳转

- 改造 `viewer-camera.js`，去掉对 authored `viewBox` 的世界 clamp；统一 desktop/mobile 二维 camera。
- radar、finder、guided views、route probe、lens 只通过 camera/session API 聚焦，不各自写 transform/scroll。
- 上线 Fit/Home/Back/Forward、outline/search 和 issue jump；minimap 延后，用任务测试决定是否保留。

### Phase 3：导出 preflight 与可选 frames

- export 改读 immutable scene/bounds，不读虚拟化可见 DOM。
- 先补 1x 仍超像素预算的 typed failure，再加 Section/Saved View/selection 和分页/tiles。
- 保持 canonical export 不受 hover、focus、camera、fold、search 状态污染。

### Phase 4：只在证据要求时加性能层

- 空间索引 + viewport/overscan culling；pointer move 禁止 O(N) DOM scan。
- camera frame 最多一次 render commit；layout 放 Worker 并可取消。
- 远景 topology-preserving aggregation、fold 和 incremental layout。
- 只有 SVG DOM 仍是 P95 瓶颈时再试 Canvas/WebGL viewer adapter；只有布局质量/耗时成为瓶颈时再试 elkjs。

### 接受标准

1. 五类图在省略 `meta.viewBox` 时允许负坐标和任意有限内容范围，不因出当前 viewport 报错。
2. 显式 fixed frame 仍能稳定报告裁剪/containment，旧输入行为可追踪。
3. camera 操作不改变 canonical scene、diagnostics、hash 或 export bytes。
4. `Fit graph/selection/section/issue` 在 desktop/mobile 使用同一 world-to-screen 规则。
5. `paintBounds` 覆盖曲线极值、stroke、marker、label、filter 和 clip/mask；全图 SVG 不丢内容。
6. raster 超预算得到明确失败或显式降级/分页，不能 OOM、空白或静默裁剪。
7. 同一输入、字体度量、算法版本和 seed 得到确定性 geometry/receipt。
8. 现有 search、focus、routes、guided story、Semantic Passport、share-card 和 clean export 不回归。
9. 为 30/100/300/1000+ 节点级别分别保存基准；性能门槛基于基线 P50/P95 制定，而不是先拍一个“无限”数字。

### 设计消融结果

按仓库要求，逐项尝试从设计中移除候选，再用上面的接受标准做静态追踪：

- 公共 plugin SDK：移除后五类图、camera、validation、export 和 ELK PoC 都仍可实现。**永久移除。**
- `meta.canvas` / `meta.camera` 配置树：移除后可用“省略或显式 `meta.viewBox`”表达 common case 与 fixed-frame escape hatch。**永久移除。**
- 新 Scene schema：移除后 Saved Views 可复用现有 `meta.views`。**永久移除。**
- 首版换 tldraw/React Flow/Canvas/WebGL 内核：移除后仍能用现有 SVG 达成核心验收。**永久移出 MVP。**
- 首版 viewport export：移除后 full canonical export 保持兼容，且避免把偶然 camera 状态当交付真相。**永久移出 MVP。**
- minimap 必做：移除后搜索、outline、Fit、Home、history、issue jump 已形成导航闭环。**改为实验项。**
- 独立 export entry point：尝试合并进 viewer session 后，headless CLI 和 canonical export 无法自然表达。**恢复保留。**
- 五类 kind adapter：尝试去除会迫使通用布局器破坏 sequence/workflow/lifecycle 强语义。**恢复保留。**
- 多类 bounds：尝试只保留一个 `bounds` 会再次混淆布局、paint、viewport 和输出。**恢复四类 canonical/export bounds，并把 viewport 留在 session。**

本轮只产出研究和设计文档，没有修改运行时代码。合并文档后已重跑 camera、reader layout、workflow compiler、layout rules、render output、sequence fit 和 share-card 静态基线：**179/179 通过**；未启动需要 GUI 的浏览器测试。

## 15. 来源登记

市场事实只采用产品方官方帮助、官方工程资料、官方源码和官方仓库；HCI 结论采用原始论文或作者公开版本。访问日期均为 **2026-09-18**。本文件未采用评测站、新闻转述、论坛回答或第三方教程。

- HCI 与大图研究：
  - https://hci.ucsd.edu/hollan/Pubs/pad.pdf
  - https://doi.org/10.1145/223904.223934
  - https://hci.stanford.edu/courses/cs448b/papers/shneiderman96eyes.pdf
  - https://publica-rest.fraunhofer.de/server/api/core/bitstreams/db3899b7-9ee3-4f2e-8a32-e1b034242f18/content
  - https://www.cs.umd.edu/~bederson/images/pubs_pdfs/p362-hornbaek.pdf
  - https://doi.org/10.1145/288392.288578
  - https://www.graphviz.org/documentation/GKN04a.pdf
  - https://doi.org/10.1145/230562.230577
  - https://doi.org/10.1145/1054972.1055079
  - https://arxiv.org/abs/2008.07944
  - https://doi.org/10.1057/palgrave.ivs.9500013
- 引擎、布局与多视图：
  - https://tldraw.dev/sdk-features/camera
  - https://tldraw.dev/sdk-features/culling
  - https://tldraw.dev/sdk-features/performance
  - https://tldraw.dev/sdk-features/image-export
  - https://reactflow.dev/learn/concepts/the-viewport
  - https://eclipse.dev/elk/
  - https://graphviz.org/doc/info/attrs.html
  - https://js.cytoscape.org/
  - https://docs.yworks.com/yfiles-html/dguide/advanced/folding.html
  - https://docs.structurizr.com/dsl/language#views

以下按厂商列出市场扫描直接使用的来源入口：

- Figma/FigJam：
  - https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files
  - https://help.figma.com/hc/en-us/articles/360038511293-Create-and-manage-pages
  - https://developers.figma.com/docs/plugins/api/figma-viewport/
  - https://developers.figma.com/docs/plugins/api/node-properties/
  - https://help.figma.com/hc/en-us/articles/1500004414582-Pan-and-zoom-in-FigJam
  - https://help.figma.com/hc/en-us/articles/24005082123159-Create-and-manage-pages-in-FigJam
  - https://help.figma.com/hc/en-us/articles/4939765379351-Organize-your-FigJam-board-with-sections
  - https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight
  - https://www.figma.com/blog/figma-rendering-powered-by-webgpu/
  - https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/
  - https://help.figma.com/hc/en-us/articles/4407699832855-Export-your-FigJam-board
  - https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma
- Miro：
  - https://developers.miro.com/docs/boards
  - https://developers.miro.com/docs/websdk-reference-viewport
  - https://developers.miro.com/docs/children-inside-parent-items
  - https://help.miro.com/hc/en-us/articles/360018261813-Frames
  - https://help.miro.com/hc/en-us/articles/20967864443410-Miro-s-new-simplified-user-interface
  - https://help.miro.com/hc/en-us/articles/360017572354-Internal-and-external-linking
  - https://help.miro.com/hc/en-us/articles/360018109534-Searching-text-on-the-board
  - https://help.miro.com/hc/en-us/articles/360017730813-Sharing-boards-and-inviting-collaborators
  - https://help.miro.com/hc/en-us/articles/360013358479-Attention-management
  - https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues
  - https://help.miro.com/hc/en-us/articles/20258488000786-Layers
  - https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams
  - https://help.miro.com/hc/en-us/articles/360017731553-System-requirements
  - https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board
  - https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app
  - https://help.miro.com/hc/en-us/articles/360013912300-How-many-users-can-collaborate-on-a-board-simultaneously
- XMind：
  - https://xmind.com/user-guide/sheet-new
  - https://xmind.com/user-guide/branch-new
  - https://xmind.com/user-guide/outliner-new
  - https://xmind.com/user-guide/export-new
- Whimsical：
  - https://whimsical.com/learn/get-started/infinite-canvas
  - https://whimsical.com/learn/boards/sections
  - https://whimsical.com/learn/boards/presenting
  - https://whimsical.com/learn/files/multipage-files
  - https://whimsical.com/learn/boards/performance
  - https://whimsical.com/learn/faqs/collaboration
  - https://whimsical.com/learn/imports-exports/exporting-from-whimsical
- Lucid：
  - https://help.lucid.co/hc/en-us/articles/15154609056916-Navigate-the-Board-and-Canvas-View-Controls
  - https://help.lucid.co/hc/en-us/articles/11970952773652-Welcome-to-Lucidchart
  - https://help.lucid.co/hc/en-us/articles/15994195704596-Create-a-presentation-in-Lucid
  - https://help.lucid.co/hc/en-us/articles/16324571257492-Export-or-print-a-Lucid-document
  - https://help.lucid.co/hc/en-us/articles/17988548286100-Troubleshooting-Export-or-print-a-document
- diagrams.net：
  - https://www.drawio.com/docs/manual/editor/
  - https://www.drawio.com/docs/manual/editor/panels/editor-page-view/
  - https://www.drawio.com/docs/manual/editor/panels/
  - https://www.drawio.com/docs/manual/layers/
  - https://www.drawio.com/docs/manual/links-tooltips-tags/tags-in-diagrams/
  - https://www.drawio.com/docs/tutorials/interactive-diagram-layers/
  - https://www.drawio.com/docs/manual/export/export-diagram/
  - https://www.drawio.com/docs/manual/export/embed-html/
  - https://www.drawio.com/docs/manual/insert/add-images/
  - https://www2.drawio.com/doc/faq/pdf-problems-confluence-cloud
- Canva：
  - https://www.canva.com/newsroom/news/canva-ai-whiteboards/
  - https://www.canva.com/newsroom/news/unveiling-the-canva-visual-worksuite/
  - https://www.canva.com/newsroom/news/canva-whiteboards/
  - https://www.canva.com/online-whiteboard/
  - https://www.canva.com/online-whiteboard/templates/
- Apple Freeform：
  - https://support.apple.com/guide/iphone/get-started-with-freeform-iphb86e84e2b/27/ios/27
  - https://support.apple.com/guide/freeform/navigate-and-present-scenes-frfm7cc55b64/5.0/mac/27
  - https://support.apple.com/guide/iphone/collaborate-on-a-board-iph5a2eb2c7b/ios
  - https://support.apple.com/en-ca/guide/iphone/iphcd5447866/ios
- tldraw：
  - https://tldraw.dev/sdk-features/camera
  - https://tldraw.dev/sdk-features/culling
  - https://tldraw.dev/sdk-features/performance
  - https://tldraw.dev/sdk-features/image-export
- Excalidraw：
  - https://plus.excalidraw.com/
  - https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md
  - https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx
- Milanote：
  - https://milanote.com/product/note-taking
  - https://help.milanote.com/en/articles/1721940-zoom-in-out
  - https://help.milanote.com/en/articles/9860073-nesting-boards
  - https://help.milanote.com/en/articles/6815489-presentation-mode
  - https://milanote.com/releases
