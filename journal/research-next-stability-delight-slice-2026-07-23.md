# Archify 下一轮稳定与惊喜切片：Deployment Ownership Contract

研究日期：2026-07-23（Asia/Shanghai）

Archify 已提交基线：[`codex/cursor-onboarding@a73047b`](https://github.com/tt-a1i/archify/tree/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782)

上游固定快照：Fireworks [`50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44)、GitDiagram [`041d2fe`](https://github.com/ahmedkhaleel2004/gitdiagram/tree/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9)、GitNexus [`cdbdf21`](https://github.com/abhigyanpatwari/GitNexus/tree/cdbdf219dce797e51cdeb8cfa386e77ab2d35628)、Agents365 drawio-skill [`6f33563`](https://github.com/Agents365-ai/drawio-skill/tree/6f33563adce24450003d1cb61111ebbcc5579f28)。

> 本文只把上述已提交版本作为 Archify 事实基线。研究期间工作区有其他任务并发修改，因此未提交内容不作为“已经具备”的证据。

## 结论

下一刀推荐只做一个产品能力：**Architecture 内可选、选择后 fail-closed 的 `deployment-ownership` 工程语义合同**。

```json
{
  "meta": {
    "engineering_profile": "deployment-ownership"
  }
}
```

它不增加第六种图、不增加第四套风格、不增加 Viewer 面板，也不引入云厂商图标。它把 Archify 已经能画、但目前只能靠作者自觉填写的四类事实变成可执行合同：

1. 运行组件的负责人；
2. Region 与私有网络归属；
3. 有状态组件是否处于私有范围；
4. 穿越 Region / 私有网络的关系是否命名了真实机制。

这比继续加动画更“稳定优先”，又比纯 CI 工作更容易让用户一眼看见价值：一张合格的部署图会天然出现 owner tags、区域边界、私有范围与具名 crossing，不再只是好看的通用拓扑。

**压力测试后的排序：**

1. **现在：Deployment Ownership Contract**，同时把无依赖安装 smoke 扩到 Ubuntu / macOS / Windows 作为发行门。
2. **下一阶段：Architecture Delta / PR Proof**；它很有增长潜力，但 before/after 几何、删除节点、缺失稳定 ID 与导出合同尚需独立设计。
3. **以后再评估：Story-specific motion / GIF**；当前 Archify 已有有限 motion、Guided Story、WebM 与 README GIF，不应先扩第二套媒体系统。

## 1. Archify 真实基线：视觉证明已经有，语义合同还没有

Archify 当前已经有五种 typed renderer、三套同拓扑 preset、Guided Story、Finder、Focus、Route、Reach、Lens、Share / Route / Reach Card、WebM、revision-pinned source evidence、Atomic Delivery、Last-Good Preview、Structured Repair Receipt，以及 Cursor / Codex / Claude Code / OpenCode 共用的一个 Skill。当前 [README](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/README.md#L11-L24) 和 [PRODUCT](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/PRODUCT.md#L13-L37) 已把产品边界写得很清楚：交互必须来自 authored / verified evidence，默认交付仍是自包含文件。

更关键的是，Proof Lab 已经有一张很强的 `Production Deployment Ownership` 成品：

- 组件已有 `tag`，能展示 `platform`、`app team`、`data team`、`SRE` 等归属；
- `region` 与 `security-group` 已表达区域和私有网络；
- cards 已经总结 runtime ownership、named crossings 与 operational evidence；
- Guided Views 已能讲 request boundary、state ownership 与 async operations。

这些事实可在当前 [production-deployment fixture](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/archify/examples/production-deployment.architecture.json#L1-L69) 中直接看到。

但 committed schema 仍把它们当普通可选内容：

- `meta` 没有工程 profile；
- `components[].tag` 是可选 string，空字符串也能过 schema；
- `boundaries` 只定义 `region` / `security-group` 与 `wraps`，没有成员归属合同；
- `connections[].label` 可选，因此跨边界关系可以不命名。

见当前 [Architecture schema](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/archify/schemas/architecture.schema.json#L8-L151)。所以当前状态是：**Archify 有一张部署归属样例，但没有能力保证下一张部署归属图仍然回答了同样的问题。** 这是本切片要关闭的真实缺口。

## 2. 四个一手同类项目：值得吸收、已经具备、不要复制

### 2.1 Fireworks Tech Graph：真正领先的是工程 profile，不是“12 套皮肤”

Fireworks 的公开首页同时展示 12 个 style、14 类 UML 映射、offline HTML 与 GIF motion；但它更值得借鉴的部分是：v1.1.0 把 C4、cloud deployment、event transit、ops review 各自做成了不同的 semantic contract，而不是只给通用图换颜色。[v1.1.0 release](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.1.0) 明确列出 deployment ownership、event rails、Golden Signals、critical paths 等被验证的事实。

Cloud Fabric 的一手合同尤其直接：

- 至少一个 Region boundary；
- 每个节点有 deployment membership；
- 每个跨 deployment edge 必须有非空 mechanism；
- boundary parent 必须无环、节点必须留在 assigned deployment 内；
- 缺少部署证据时退回 generic architecture，不能编造归属。

见 [Cloud Fabric required contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/style-10-cloud-fabric.md#L31-L54) 与 [composition / fallback rules](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/style-10-cloud-fabric.md#L56-L84)。它还用真实反例测试 unknown icons、boundary cycles、boundary gap 与 duplicate IDs，并要求四个工程 profile 在 showcase 下得到 100-point composition report。[semantic contract tests](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/tests/test_semantic_contracts.py#L61-L101) · [render contract tests](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/tests/test_semantic_contracts.py#L168-L195)

**值得吸收**

- 风格与工程事实分离：profile 选择的是“这张图必须回答什么”，不是“看起来像什么”。
- profile 默认不启用；一旦显式启用，缺失事实 hard fail。
- 先做一个经过真实场景证明的 profile，不同时铺开 C4 / Event / Ops 三个合同。

**Archify 已经具备**

- versioned typed IR、确定性 geometry/composition gates、两轮有界 visual review、offline HTML、静态输出、有限 motion 与 motion readback。
- 三套 preset 共用 geometry；没有必要靠 style 数量追赶。

**不要复制**

- 12 styles、14 UML mappings、vendor icon manifest 与 per-style motion schedule。
- GIF 的 FFmpeg / Chromium / Puppeteer 依赖进入 zero-install core。Fireworks 自己也把 GIF 标为可选依赖；静态路径可独立工作。[v1.2.0 release](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.2.0)
- GitHub stable `1.2.0` 与 npm legacy `1.0.4` 的发行漂移；Archify 的 ZIP、文档与实现必须由同一 gate 锁定。

### 2.2 GitDiagram：把一眼入口和真实路径校验学过来，不把 SaaS 搬过来

GitDiagram 的一句话入口仍然极强：把 GitHub URL 中的 `hub` 换成 `diagram`。它也把 interactive source links、streaming generation、private repositories 与 PNG / Mermaid export 放在 README 第一屏。[GitDiagram README](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L6-L21)

更重要的是，其生成链并不把模型输出直接当成图：先限制 repository tree，模型输出 size-bounded graph AST，再校验 identifier、connectivity、limits 与每个真实 repository path，失败只给 focused feedback；之后才 deterministic compile、sanitize、persist。[How generation works](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L49-L59)

**值得吸收**

- 入口必须容易记；Archify 当前 artifact footer → Start 页已经承担这件事，不需要新服务。
- profile 失败必须指出准确组件 / boundary / connection 与受支持修复，而不是泛化为“部署图不完整”。
- 1200×630 social card 是有效增长面；Archify 已经具备并应让新 proof 直接受益。GitDiagram 自身也用固定 1200×630 Open Graph card contract。[social image source](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/og/cards.tsx#L5-L15)

**Archify 已经具备**

- revision-pinned source evidence、真实 repository case、bounded correction、结构化 repair receipt、Share Card 与 artifact-to-install 转化入口。

**不要复制**

- Vercel、R2、Upstash Redis、quota、PostHog、private token 与 hosted persistence。GitDiagram 的 README 明确这些是它的生产架构。[production architecture](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L23-L47)
- Mermaid 作为 Archify 的 canonical IR 或通用 auto-layout；两者产品边界不同。

### 2.3 GitNexus：只有做过真实 code indexing，才能说 impact / blast radius

GitNexus 的核心并不是“图更炫”，而是先索引代码，再预计算 dependency、call chain、cluster 与 execution flow。它公开提供 `impact`、`trace`、`detect_changes`、route map、shape check 等工具，并把 blast radius 与 confidence 建立在 knowledge graph 上。[GitNexus README](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L97-L158)

这反而强化 Archify 的边界：Authored Reach 可以叫 authored reachability，不能借一个 deployment profile 偷换成 runtime impact、availability、failover correctness 或 blast radius。profile 只能验证 JSON 是否完整、自洽，不能证明云上真的这样部署。

GitNexus 另一个值得直接学习的地方是测试分层：完整套件留在 Ubuntu，Windows / macOS 只跑 platform-sensitive subset，覆盖 path separator、CRLF、filesystem、real CLI spawn、native loading；CI 再单列 packaged-install smoke。[GitNexus cross-platform testing](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/TESTING.md#L83-L120)

**值得吸收**

- 只在证据边界允许时使用强词；profile receipt 不得声称 verified deployment。
- Ubuntu 跑全量，macOS / Windows 跑小而真实的无依赖 package smoke。

**Archify 已经具备**

- 作者关系上的 Route / Reach，以及明确“不叫 impact”的产品约束。
- 本地单文件交付，不需要数据库才能读图。

**不要复制**

- knowledge graph、native database、MCP server、embedding、cross-repo contract registry 与 Web UI bridge。
- GitNexus 采用 PolyForm Noncommercial；这里只学习产品与测试模式，不搬代码进入 MIT Archify。

### 2.4 Agents365 drawio-skill：Architecture Delta 很强，但不应挤进本轮

drawio-skill 目前的强项已经不只是画图：它有 code / IaC / SQL import、Graphviz auto-layout、`.drawio` validator、self-check、visual review、diagram diff、PR diff、architecture time-lapse、interactive HTML 与 animated flow SVG。[official README feature map](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/README.md#L153-L266)

其中最值得 Archify 后续研究的是：

- `drawiodiff.py` 把 added / removed / changed 做成一眼可见的 architecture drift；
- `prdiff.py` 为 PR 生成 base / head / diff PNG 与 Markdown report；
- `relabel.py` / `restyle.py` 保持 layout、styles、IDs 不动。

这些能力和 Archify 的 typed stable IDs、Share Card、revision evidence 很匹配，**Architecture Delta 是清晰的 P1**。

但它不适合作为当前最小切片：两份 IR 的 viewBox 与位置可能不同；removed node 在 after geometry 中没有位置；connection 可能没有 authored ID；changed 要区分语义、文案、位置与视觉 preset；canonical export、Share Card、guided state 与 deep link 都要定义新语义。若只做一个颜色 overlay，会把一个真正的 change-review 产品缩水成“diff 配色”。

**值得吸收**

- 把 Architecture Delta 作为独立 RFC：先定义可比性、stable ID、geometry ownership 与 machine receipt，再接 PR Card。

**Archify 已经具备**

- layout-preserving presets、typed identity、Chapter Delta（同一 artifact 内的 authored view 对比）、Share Cards、self-contained viewer 与两轮视觉复核。

**不要复制**

- `.drawio` XML、draw.io desktop、Graphviz、10,000+ icon catalogue、37 个松散脚本与 general-purpose editor surface。
- 仅为“动起来”复制 looping marching ants。Archify 的 motion 必须有限、由读者控制、静态含义完整。

## 3. 决策矩阵

| 候选 | 用户第一眼价值 | 稳定风险 | 是否复用现有能力 | 决策 |
|---|---:|---:|---:|---|
| **Deployment Ownership Contract** | 高：owner、Region、private scope、named crossing 都直接进入画布 | **低到中**：只在显式 profile 下新增确定性语义 gate | **高**：复用 Architecture、tag、boundaries、labels、receipt、现有 proof | **现在做** |
| Cross-platform package smoke | 不直接改变成品，但明显降低发布风险 | 低 | 高：复用 ZIP、doctor、五 mode validate | **作为本切片发行门，不包装成产品特性** |
| Architecture Delta / PR Proof | 很高：变更评审与社交卡都强 | 中到高：两份几何与 removed identity 合同尚未建立 | 中 | 下一独立切片 |
| Story-specific WebM / GIF | 高，但当前已经有 Story、WebM 与 README GIF | 中到高：媒体兼容、帧语义、包体与第二 encoder | 中 | 推迟 |
| 第四 preset / 更多 UML / vendor icons | 高展示宽度，低核心差异化 | 高：回归矩阵与授权面扩大 | 低 | 不做 |
| Structural-scope / 更多 Viewer 控件 | 中；已有 Guide、Radar、Lens、Route、Reach、Story | 中：交互 ownership 更拥挤 | 低 | 不做 |

## 4. 推荐切片的严格合同

### 4.1 触发与兼容

1. 只给 Architecture `meta` 增加一个可选枚举：`engineering_profile: "deployment-ownership"`。
2. 没有该字段时，schema、renderer、HTML、SVG、exports 与 receipt 保持既有语义；未命中 profile 的 golden artifacts 必须 byte-stable。
3. 其他四种 diagram type 不接受该字段，不能静默忽略。
4. 显式选择 profile 后，下列语义缺失均为 hard error，不因 `standard` / `showcase` 降级成 warning。`quality_profile` 管 composition，`engineering_profile` 管事实完整性，两者不可混用。

### 4.2 只复用现有字段

不要新增 `owner`、`deployment_id`、`network_id`、`mechanism` 或 vendor icon 字段。本轮只解释现有字段：

| 事实 | 现有字段 |
|---|---|
| Owner | `components[].tag` |
| Region | `boundaries[kind="region"].wraps` |
| Private scope | `boundaries[kind="security-group"].wraps` |
| Stateful component | `components[].type === "database"` |
| Boundary mechanism | `connections[].label` |

这样 profile 是对现有视觉语言的“truth floor”，不是第二套 Architecture schema。

### 4.3 确定性规则

1. 至少一个 `region` 和至少一个 `security-group` boundary。
2. 每个非 `external` component 必须有 trim 后非空的 `tag`，且必须恰好属于一个 Region。外部参与者可以在 Region 外；profile 不强迫用户给客户或第三方系统伪造内部 owner。
3. 每个 `security-group` 的所有成员必须属于同一个 Region。若一个 private scope 横跨 Region，必须拆成两个 boundary；不能靠同名 label 暗示共享。
4. 每个 `database` component 必须至少属于一个 `security-group`，并因规则 2 同时属于恰好一个 Region。该规则只证明“作者明确把 state 放进 private scope”，不证明 encryption、HA、backup 或 failover。
5. 为每个 component 构造确定性的 boundary membership set，成员以 boundary collection index 标识，label 只用于诊断。若 connection 的 source / target membership sets 在任一 Region 或 security-group 上不同，它就是 crossing。
6. 每个 crossing 的 `label.trim()` 必须非空；该文本承担协议或机制，例如 `HTTPS`、`mTLS`、`inter-region WAL`、`peering`。validator 不猜 label 内容是否真实，只拒绝“无名穿越”。
7. same-membership relationship、自环、完全位于一个 private scope 内的关系不因本 profile 强制 label；普通 Architecture 仍保留原兼容语义。
8. 重复、未知 component ID 继续由现有 schema/layout identity gate 处理；profile validator 不写第二套 endpoint resolver。

### 4.4 诊断与 receipt

建议稳定规则代码：

- `architecture/deployment-owner-required`
- `architecture/deployment-region-required`
- `architecture/deployment-region-membership`
- `architecture/deployment-private-scope-required`
- `architecture/deployment-private-region-conflict`
- `architecture/deployment-crossing-mechanism-required`

每条 diagnostic 必须包含 collection index、可用的 stable ID、boundary kind / label、实际 membership，以及只支持当前 schema 的修复，例如 `components[].tag`、`boundaries[].wraps`、`connections[].label`。不得建议新字段或自动移动节点。

成功的 `validate --json` / `deliver --json` receipt 可以增加 `engineeringProfile: "deployment-ownership"`；措辞必须是 profile **passed**，不能是 `deploymentVerified`。若同时有 revision-pinned repository evidence，两份 receipt 并列存在，也不能推断 repository source 等于 live cloud deployment。

### 4.5 视觉合同

- profile 本身不增加第四 preset、vendor logo、cloud glyph、悬浮面板或装饰动画。
- “一眼可见”来自被强制完整的现有 owner tag、Region/private boundary 与 crossing label。
- 可在 canonical SVG root 增加机器可读 `data-engineering-profile="deployment-ownership"`，但不要为了显示 profile 另加可能撞标题的 stamp。
- Classic、Signal Flow、Blueprint 与 dark/light 必须共享相同语义与 geometry；profile 不参与坐标计算。
- Focus、Route、Reach、Lens、Story 与 Share Cards 直接继承同一 authored graph，不增加 profile-specific viewer state。

## 5. 最小但不缩水的实现面

必须包含：

1. Architecture schema 的可选 profile enum 与预编译 validator 更新；
2. 一个纯确定性 Architecture semantic validator，复用现有 Structured Repair Receipt；
3. 当前 production-deployment source 升级为正向 fixture，并补精确反例；
4. `validate` / `deliver` receipt 公开 profile passed 状态；
5. SKILL、schema reference、README/CHANGELOG/ROADMAP 的窄说明；
6. 重建 `archify.zip`，并让同一 package smoke 在 Ubuntu / macOS / Windows 跑最小静态子集；
7. 内置浏览器对真实 deployment proof 做桌面验收。

明确不做：

- 新 diagram type、renderer、layout algorithm、auto-fix、owner inference、cloud discovery 或 IaC parser；
- vendor icons、C4 multi-page、编辑器、GitHub App、hosted sharing、telemetry、storage；
- impact / availability / DR correctness / blast-radius 声明；
- GIF encoder、第二套 motion runtime或移动端产品；
- 顺手实现 Event Transit、Ops Pulse 或 Architecture Delta。

## 6. 六条可验证验收门禁

1. **兼容门：** profile-less Architecture 与其余四个 mode 的 representative golden output 在实现前后 byte-identical；所有现有 schemas、render/check/deliver 与 deep-link/export tests 继续通过。
2. **正向门：** production-deployment fixture 显式选择 profile，`validate --json` 与 `deliver --json` 通过；receipt 精确报告 `engineeringProfile`，相同输入重复运行的 HTML SHA-256 相同，三 preset 的 canonical relationship geometry 相同。
3. **反向门：** mutation matrix 分别删除 owner tag、region、security-group、database private membership、制造 multi-region membership、删除每一种 crossing label；每个 case 非零退出，只返回对应稳定 diagnostic、精确 subject/evidence/supported fixes，且 Atomic Delivery 保留旧成品 SHA-256。
4. **边界数学门：** outside→Region、Region→Region、public→private、private→public 必须识别为 crossing；same Region/same private、自环与同 membership 的边不误报；security-group 跨 Region 必须 fail closed。测试不依赖 boundary label 唯一或 DOM 几何位置。
5. **载体与浏览器门：** 在 1280×720 内置浏览器中检查 Classic / Signal Flow / Blueprint、dark/light、Presentation、Finder、Focus、Route、Reach 与一个 Guided Story；owner、Region/private、state、crossing labels 第一眼可读，console warning/error 为 0。PNG、dual-theme SVG、WebM、Share / Route / Reach Card 保持非空、无 viewer residue；不开展移动端专项。
6. **发行门：** Ubuntu 跑全量 `npm test` 与 WebM/Chrome/FFmpeg smoke；Ubuntu / macOS / Windows 从 committed ZIP 解压后，不安装 dependencies，运行 `doctor`、五 mode `validate` 与一个 deployment profile render/check。ZIP freshness、README EN mirror、`git diff --check` 全绿。

## 7. 为什么 Architecture Delta 不是现在

Architecture Delta 是本轮研究中唯一比“再做一个 viewer 小功能”更强的后续候选。drawio-skill 已经证明 diff / PR report / time-lapse 很有传播力；GitNexus 的 `detect_changes` 也证明开发者愿意围绕变化而不是静态全景工作。

但 Archify 必须先回答这些问题，才能不缩水：

1. 两份 IR 的 diagram type、schema version、repository revision 与 quality profile 怎样判定可比？
2. 没有 authored relationship ID 时，是 fail closed，还是允许 collection index？
3. removed node 用 before 坐标还是在 after 画布中保留 ghost slot？
4. 节点只移动、只改文案、改 kind、改 source evidence，分别属于 semantic change 还是 layout change？
5. canonical output 是 after graph + overlay、side-by-side，还是独立 Delta Card？
6. Route / Reach / Story / Share Card 在 diff state 下读取哪一个 graph？

这些不是实现细节，而是产品真相。现在仓促做会得到一个好看的红绿 overlay，却不能成为可信 PR Proof。Deployment Ownership Contract 则已经有现成 fixture、字段、视觉语言、repair protocol 与完整导出面，能用更小风险把“样例自律”升级成“产品保证”。

## 8. 推荐实施顺序

1. 落地 `deployment-ownership` profile 与六条门禁；先在现有 production deployment proof 中证明。
2. 合并后观察真实 Agent 是否能一次填全 owner / membership / mechanism；若失败，改 Start recipe 与 diagnostics，不放松合同。
3. 单独写 Architecture Delta RFC，先冻结 comparison receipt 和 geometry ownership，再实现 PR Card。
4. 只有当现有 WebM / README GIF 的传播数据证明格式受限时，再评估可选 GIF；不改变 zero-install static core。

## 一手来源

- Archify committed baseline：[repository](https://github.com/tt-a1i/archify/tree/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782)、[README](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/README.md)、[Architecture schema](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/archify/schemas/architecture.schema.json)、[deployment proof source](https://github.com/tt-a1i/archify/blob/a73047b27e3b423fc8ab6ebd1ac84fd4ecb2e782/archify/examples/production-deployment.architecture.json)
- Fireworks Tech Graph：[README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md)、[Cloud Fabric contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/style-10-cloud-fabric.md)、[semantic tests](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/tests/test_semantic_contracts.py)、[v1.1.0](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.1.0)、[v1.2.0](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.2.0)
- GitDiagram：[README](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md)、[social card source](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/og/cards.tsx)
- GitNexus：[README](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md)、[TESTING](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/TESTING.md)
- Agents365 drawio-skill：[README](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/README.md)、[v1.34.0](https://github.com/Agents365-ai/drawio-skill/releases/tag/v1.34.0)
