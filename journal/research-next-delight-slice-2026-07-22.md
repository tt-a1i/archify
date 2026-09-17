# Archify 下一增长切片研究：Last-Good Live Preview

日期：2026-07-22（Asia/Shanghai）
Archify 基线：`main@440e16d`；开放中的 [PR #44](https://github.com/tt-a1i/archify/pull/44) `@212639b` 已加入 opt-in Editable Source Capsule，五项远端检查全绿。**本建议只依赖 `main` 已有的 Atomic Delivery 与 Verified Open，可从 `main@440e16d` 独立落地，不以 PR #44 合并为前置。**
上游快照：Fireworks `50c819d`、draw.io MCP `c3fcfa5`、GitDiagram `20eea55`、D2 `2446e24`、Markmap `99fc93e`、Mermaid Live Editor `f8836bb`。

## 结论

下一刀推荐 **Last-Good Live Preview（保留最后有效成品的本地实时预览）**：

```bash
archify preview <type> <input.json> \
  [--quality standard|showcase] [--no-open]
```

它在仅监听 `127.0.0.1` 的随机端口打开一个桌面预览页；输入 JSON 变化后，先走 Archify 现有 renderer、composition gate 与 artifact checker，**只有完整通过才刷新浏览器**。非法或半写入输入只显示精确诊断，上一份已验证图继续留在画布上。修复后自动恢复。

这是当前最合适的“好用 + 稳定 + 可展示”切片：D2 和 Mermaid Live Editor 已证明实时反馈是文本制图的核心体验；而 Archify 此前推迟 preview 所缺的 Atomic Delivery 与 Verified Open 前置条件现在已经在 `main` 具备。它改善的是作者从“改 JSON”到“看见可信结果”的循环，不再给已经很丰富的成品 Viewer 增加一个控件，也不读取或依赖 PR #44 的 Source Capsule。

## 一手事实，不按 Star 数抄功能

截至本次核验，GitHub API 显示 Fireworks 约 9.2k Star、draw.io MCP 约 4.9k、GitDiagram 约 15.8k、D2 约 24.7k、Markmap 约 13.0k、Mermaid Live Editor 约 6.7k。Star 只说明分发规模，不是采用整套架构的理由。

### Fireworks：视觉宽度必须被共同质量合同约束

- 当前 README 展示 12 种风格、四个工程语义 profile、14 类 UML 映射、offline HTML 和 GIF motion；真正可迁移的不是“12”这个数字，而是所有风格共用 geometry、text-fit、routing 与 motion gate。[README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L43-L150) · [composition contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/composition-quality-contract.md#L1-L75)
- v1.2.0 保留静态 1920px PNG regression baselines，并在发布门中运行 12 风格、852 项 Chromium compatibility comparisons；可选 GIF 才引入 Chromium/FFmpeg，静态路径不被拖重。[v1.2.0 release](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.2.0)
- Archify 已吸收这条纪律：三 preset 同拓扑、Semantic Sigils、有限 motion、确定性/感知式交付门。因此下一步不应再扩 style catalogue。

### D2 与 Mermaid Live Editor：即时反馈是作者体验，但监听和重渲并不简单

- D2 Quickstart 的 `d2 --watch in.d2 out.svg` 会打开浏览器，并随源文件变化 live reload。[D2 README](https://github.com/terrastruct/d2/blob/2446e247b6d7d5b9395a1ae8ad1e9c2641231035/README.md#L111-L124)
- D2 的 watcher 并非一次简单 `fs.watch`：源码明确警告文件通知 API 容易丢事件，另做修改时间补查、写入 burst 合并、重试与 WebSocket 广播。[watch.go](https://github.com/terrastruct/d2/blob/2446e247b6d7d5b9395a1ae8ad1e9c2641231035/d2cli/watch.go#L211-L329) 浏览器端在收到新 SVG 时才替换画布，错误另行显示。[watch.js](https://github.com/terrastruct/d2/blob/2446e247b6d7d5b9395a1ae8ad1e9c2641231035/d2cli/static/watch.js#L1-L55)
- Mermaid Live Editor把实时 edit/preview、SVG 保存和 viewer/edit links 列为核心功能。[README](https://github.com/mermaid-js/mermaid-live-editor/blob/f8836bb1540cf00090f529d776a958c557f24522/README.md#L4-L17) 其 E2E 明确测试复杂图延迟更新、非法输入不进入图而进入错误面。[diagramUpdate.spec.ts](https://github.com/mermaid-js/mermaid-live-editor/blob/f8836bb1540cf00090f529d776a958c557f24522/tests/diagramUpdate.spec.ts#L3-L43) 当前 open issue #1892 也记录了逐键重渲造成卡顿的用户信号，说明 debounce 是稳定要求而非锦上添花。[issue #1892](https://github.com/mermaid-js/mermaid-live-editor/issues/1892)

### GitDiagram：代码图的高价值后续是可核验来源，不是 Mermaid 本身

- GitDiagram 的第一阶段要求 architecture brief 中的核心组件绑定 1–3 个真实 repo-relative paths；第二阶段才产出有上限的 graph schema。[prompts.ts](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/prompts.ts#L1-L50)
- Graph node 的 `path` 会先对真实 file tree 校验；失败会把精确 feedback 送入有界重试。[graph validation](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/graph.ts#L90-L175) 通过后，compiler 才生成指向 GitHub blob/tree 的 click link。[deterministic compiler](https://github.com/ahmedkhaleel2004/gitdiagram/blob/20eea559377fe3f110ac630856351382c4b5fcab/src/server/generate/graph.ts#L323-L409)
- 这使“Node → source evidence”值得进入候选，但 Archify 若没有 revision、private repo 与 opt-in privacy 合同，不能只复制可点击外观。

### draw.io MCP：编辑回路很顺，但其编辑器/格式矩阵不是 Archify 的边界

- 官方仓库提供 inline MCP App、打开 draw.io 的 MCP Tool、原生 `.drawio` Skill + CLI、零安装项目指令四条路径；导出 SVG/PNG/PDF 时可以嵌入 XML，让产物继续在 draw.io 编辑。[README](https://github.com/jgraph/drawio-mcp/blob/c3fcfa5a7227e873e9ee51451b54c291d81b0099/README.md#L7-L71)
- MCP App 的价值是把预览放到创作入口附近并保留 `Open in draw.io` 的后路。[MCP App README](https://github.com/jgraph/drawio-mcp/blob/c3fcfa5a7227e873e9ee51451b54c291d81b0099/mcp-app-server/README.md#L1-L43)
- PR #44 已为 Archify 提供更符合自身 IR 的 Source JSON 交接；再做 draw.io XML round-trip 会形成第二套真相和编辑器依赖。

### Markmap：小而可组合的 Viewer 值得学，mindmap/插件扩张不值得现在学

- Markmap 把 view package 与 transform package 分开以降低不需要浏览器侧能力时的安装体积；toolbar 只保留 zoom、fit、recursive toggle 和 dark mode 等少量动作。[markmap-view README](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-view/README.md) · [toolbar source](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-toolbar/src/toolbar.tsx#L55-L117)
- 它的 README 同时列出 VS Code、Vim/Neovim、Emacs 与 MCP 集成。[README](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/README.md#L1-L27) 对 Archify 的当前启发是保持 preview 与生成 artifact 解耦，不是立刻做 mindmap 或插件矩阵。

## Archify 已有 / 缺口映射

| 竞品中的有效模式 | Archify 当前状态 | 真正缺口 |
|---|---|---|
| Offline artifact、pan/zoom/theme/export | 已有，并且 Viewer 交互远多于竞品 | 无需继续叠普通 Viewer 控件 |
| 多视觉语言 + 统一 gate | 已有 Classic / Signal Flow / Blueprint、Semantic Sigils、同拓扑回归 | 不缺第四 preset；缺的是让作者更快看到每次改动 |
| Candidate → validate → verified output | 已有 schema/layout/composition/artifact checks、perceptual gate、Atomic Delivery | 无需另造成功语义；preview 应复用它 |
| 交付后立即看见 | 已有 `deliver --open` | 只打开一次；源改变后仍要重复命令 |
| 继续编辑 | PR #44 提供 opt-in Source JSON | 已解决 portable handoff；没有必要造全编辑器 |
| 实时 edit/preview | 没有 | **本轮最清晰缺口** |
| Node → verified repo evidence | 没有 | 高价值，但需要独立 provenance/privacy 合同 |
| 平台/IDE 插件 | Skill + CLI + 静态 HTML 已足够分发 | 暂不扩平台矩阵 |

## 候选切片

| 候选 | 用户价值 | 稳定风险 | 必须限制的实现边界 | 可验证证据 | 决策 |
|---|---|---|---|---|---|
| **A. Last-Good Live Preview** | 改 JSON 后自动看到新图；坏输入时不丢上一张好图；明显缩短创作循环，也适合录制一个强 README 演示 | 中：常驻进程、端口、文件替换、重渲抖动、退出清理 | 新建 `preview` 命令；仅 `127.0.0.1` + 随机端口；内容摘要轮询/有界 debounce；复用既有 gate；成功才换 artifact；零依赖、无持久化、无 artifact 注入 | 五类型初始预览；有效→有效、有效→无效→修复；原子替换与快速 burst；旧 artifact SHA 保持；端口/进程/临时目录清理；真实浏览器无 console error | **现在做** |
| **B. Repo Evidence Passport** | 聚焦一个节点即可打开或复制对应源码证据，让代码库图从“看起来对”升级到“可追证” | 中高：路径真实性、commit 漂移、私仓泄露、URL scheme、五 schema 迁移和交互冲突 | 必须 revision-pinned；repo-relative path 经真实 tree 校验；默认关闭；只进 Passport，不把 node click 改成导航；private/offline fail closed | 临时 repo 验证存在/不存在路径；commit 固定；恶意 URL/路径拒绝；默认 HTML/exports 不泄漏 | **下一阶段设计，不塞进 preview** |
| **C. 一个工程语义合同：deployment ownership** | 云部署图能明确 Region/VPC/ownership 与跨边界机制，提升评审可信度 | 中低：规则过度拟合或让弱模型更难通过 | 只做 architecture 的一个 opt-in profile；验证现有字段能证明的事实；不添 renderer/type/style | 正反 fixture；每条错误指向确切实体和修复字段；legacy 图不变；Proof Lab 单场景证明 | **稳定型后续** |
| **D. Machine Visual Evidence Bundle** | 将最终 PNG/关键 WebM 帧与 receipt 绑定，回归更可审计 | 中高：Chrome/字体/OS 像素差异、包体与运行时间 | 可选 CI/maintainer gate，不进 zero-install core；只存可复现实证，不发明审美分数 | 固定环境尺寸/像素非空/布局 bounds/有限 perceptual threshold；静态路径无浏览器仍可交付 | **先不做用户特性** |

## 推荐切片的严格合同

### 命令和状态

1. `preview` 是独立的交互命令，不给 `deliver` 增加 `--watch`，避免把一次性交付变成长生命周期进程。
2. 默认只监听 IPv4 loopback `127.0.0.1`，让操作系统分配空闲端口；不接受 `0.0.0.0`、LAN host、上传或公网 URL。
3. `--no-open` 只用于无 GUI、自动化测试或用户已自行打开 URL；否则复用 Verified Open 的安全参数数组和失败回退。
4. Preview shell 与被预览 artifact 分离。artifact 仍是普通自包含 Archify HTML；preview runtime、reload token、错误 banner、source path 和端口都不能写进 canonical HTML/SVG/图片/WebM。
5. 首次输入合法时，只有 renderer + composition + checker 全部通过后才发布 revision 1。首次输入非法时仍打开 status shell，但不伪造空图或成功 receipt。
6. 后续修改以**文件内容摘要**去重，不只信 mtime，也不依赖单次 `fs.watch` 事件；使用约 300–500ms 的有界稳定窗口吸收编辑器的 truncate/write/rename burst。
7. 每一代只允许一个候选。新一代到达时让旧的未发布候选失效；迟到的旧结果永远不能覆盖更新结果。
8. 候选在临时目录完成现有 render/check，成功后原子替换 preview 的 last-good artifact，再递增 revision。失败只更新诊断，不替换 iframe，不覆盖用户指定输出。
9. 错误面必须报告 generation、stage 与当前 validator/checker 原文摘要，并明确 `Showing last verified revision N`；修复后自动清除。不要只显示红点或“render failed”。
10. 页面刷新只发生于 verified revision 变化；相同 bytes、chmod、无关目录变化和失败重试不得让浏览器闪烁。
11. `SIGINT` / `SIGTERM`、浏览器未打开、端口错误和输入删除都要有明确退出/等待语义；退出后 server、timer、child process 与临时目录必须归零。
12. Preview 默认保持 Source Capsule 关闭；源码本来就在本机。不要把 PR #44 的 portable handoff 与本地创作循环混成一个默认隐私面。

### 建议最小 UI

- 画布占主位，直接 iframe/呈现最后一份 verified HTML。
- 右上角只保留一个小状态：`Verified · rev 3`、`Checking…` 或 `Needs fix · showing rev 3`。
- 失败展开一个可复制诊断区；不弹 modal，不遮住整张上一份好图。
- 不做源代码编辑器、文件树、terminal、drag/drop、history timeline 或多文件 workspace。
- 不开展移动端专项；桌面 1280×720 是主要验收面。

## 验收证据

### 自动化

1. 五种 diagram type 均能启动 preview 并拿到 revision 1；artifact 通过现有 checker。
2. 一份合法输入修改为另一份合法输入：只有新候选完整通过后 revision 才增加，浏览器读取的新 title/node 与输入一致。
3. 合法 → JSON 半写入 → schema 错误 → showcase composition 错误：每次都保持上一份 artifact 的精确 SHA-256，status 指向真实 stage。
4. 修复失败输入后自动恢复，错误清空且只增加一次 revision。
5. 10 次快速写入、truncate/write、同名临时文件 rename、mtime 相同但 bytes 不同，都只发布最终稳定内容；相同 bytes 不重复刷新。
6. 并发慢候选被更新候选取代时，迟到结果无法 commit。
7. Server 仅接受固定 GET/HEAD endpoints；拒绝 traversal、任意文件读取、写请求和外部 Host；响应不回显绝对 source path。
8. `--no-open`、opener 失败、随机端口冲突、输入删除/恢复、SIGINT/SIGTERM 和异常退出均无悬挂进程或 temp residue。
9. 从不含 `node_modules`/tests 的 ZIP Skill 副本运行，零依赖合同保持。
10. 全量 `npm test`、WebM/Share Card/Route Share Card smoke、ZIP freshness、package smoke 与 `git diff --check` 全绿。

### 内置浏览器

1. 用一个真实 architecture 或 workflow fixture 启动 preview，确认第一次出现的是 verified artifact，不是闪烁的空壳。
2. 改 title、一个 node label 与一条 route，观察一次有界刷新；确认主题、Style、Finder、Focus、Route、Presentation 与 Export 仍可用。
3. 写入非法 JSON 和会触发 showcase gate 的合法 JSON，确认旧图不消失、错误可读且没有 console error。
4. 修复后确认自动恢复，状态回到 `Verified`，新图与输入吻合。
5. 验证 preview shell、错误状态和 reload revision 不进入 SVG/PNG/WebM/Share Card/Source JSON。
6. 关闭进程后 URL 立即不可用，临时目录清空；不做移动端专项。

## 明确拒绝或推迟

- **第四/第五 preset、12-style 追数、vendor icon catalogue**：Archify 已有三种同拓扑视觉语言和 sigils；新增目录会成倍扩大主题、导出、动效与截图矩阵，却不缩短创作循环。
- **全量 UML / mindmap 类型扩张**：当前五种 typed renderer 的价值是清晰语义和强 gate；不要把竞品“类型数量”当增长 KPI。
- **WYSIWYG、拖拽、draw.io XML round-trip、Open in editor**：会把 generator + viewer 变成第二个通用编辑器，并产生双格式真相。PR #44 的 opt-in Source JSON 已是更小、更真实的可编辑交接。
- **Mermaid 式压缩源码 share URL / 托管保存**：需要 hosted decoder、URL/XSS/长度、隐私与持久化合同；Archify 的一个 HTML 文件已经是更强的离线分享边界。
- **公网 repo ingestion / GitDiagram 克隆**：会引入 provider 成本、token、quota、缓存、私仓凭据和滥用面。Repo Evidence Passport 可在本地、revision-pinned 的小合同中另做。
- **Obsidian、VS Code、浏览器扩展、MCP 平台矩阵**：Markmap/draw.io 已证明分发宽度有价值，但现在会把维护预算从核心首次成功路径分散出去。
- **依赖原生 file watcher 或 WebSocket 作为唯一真相**：D2 源码已经展示其复杂度。Archify 应用内容摘要轮询 + debounce + generation token，server 只做本地预览，不引入新 npm 依赖。
- **独立移动端产品**：保持现有 contained fallback；preview 是桌面创作工具，不把手机布局加入验收门。

## 为什么现在做

此前不做 watch 是对的：当时没有统一 commit point、last-known-good 语义和安全 opener。现在 `main@440e16d` 的 [Atomic Delivery、Verified Open 与当前 Viewer 合同](../ROADMAP.md) 已经建立。Live Preview 可以只做 orchestration：监听输入、调用既有可信管线、成功才刷新，坏候选永不污染成品。PR #44 的 portable editing handoff 与本切片正交；无论它先合并、后合并或暂缓，preview 合同都不变。

这比新增另一个 Viewer “亮点”更能让用户喜欢：第一次成功更快，弱模型或人工微调的每轮反馈更短，演示也更直观；同时它不改变 JSON IR、五 renderer、布局、美术、导出或分享边界。下一阶段再评估 Repo Evidence Passport，前提是先写清 revision、真实路径、private repo 与 opt-in privacy 合同。
