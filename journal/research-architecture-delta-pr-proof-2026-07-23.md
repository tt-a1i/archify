# Architecture Delta / PR Proof：研究结论与实现合同

日期：2026-07-23（Asia/Shanghai）
Archify 基线：`codex/architecture-delta-proof@5302d2251ff2aaca56f7c08818ebe8421f41a6f3`

## 结论

下一项值得做的用户可见切片是一个 **Architecture Delta**：给它两份已经存在、已经通过 Archify 校验的 `architecture` JSON，它生成一个离线、自包含、可验证的 HTML，默认回答“架构事实改了什么”，并可切换 Before / Delta / After。**PR Proof 是这个产物的使用场景，不是新的事实来源**；首版不访问 GitHub、不拉取仓库、不分析代码影响，也不声称某个 PR 安全。

它成立的前提不是再加一种红绿风格，而是先冻结四件事：

1. 只用稳定 ID 配对节点与关系，不按标签、位置、类型或相似度猜测。
2. Delta 复用两侧已经验证过的几何；删除项保留 baseline 的原位置，不重新布局整张联合图。
3. “架构事实变化”“证据变化”“布局变化”“展示变化”分开计数，不能都压成一个 `changed`。
4. 比较、渲染、检查、提交和回执是一个 fail-closed 原子流程；证据不足时失败或降级为 `authored`，不能显示虚假的绿色通过。

## 一手证据

### Agents365 drawio-skill：证明评审入口有价值，也暴露了不能照抄的边界

研究快照：[`Agents365-ai/drawio-skill@6f33563`](https://github.com/Agents365-ai/drawio-skill/tree/6f33563adce24450003d1cb61111ebbcc5579f28)。

- `drawiodiff.py` 默认用 draw.io cell ID 配对节点，并说明导入器产生的语义 ID 适合跨快照对齐；它也提供 `--by-label` 给随机 ID 图兜底。节点分为 added / removed / changed / same，关系按端点集合分为 added / removed / same。([source](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/drawiodiff.py#L2-L31), [matching and output](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/drawiodiff.py#L107-L160))
- 它把比较结果交给 Graphviz 重新布局，且明确丢弃容器、分组、边标签和原形状，只保留一张扁平状态图。([source](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/drawiodiff.py#L12-L28))
- `prdiff.py` 从两个 Git ref 提取 changed `.drawio`，为修改文件生成 base / head / diff 三张 PNG，再汇总为 PR Markdown；新增或删除文件只有存在的一侧。([source](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/prdiff.py#L2-L18), [pipeline](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/scripts/prdiff.py#L30-L110))
- PR bot 用固定 HTML marker 更新同一条 sticky comment，避免每次 push 产生新评论；缺 draw.io CLI 时仍输出文件清单但没有图片。([source](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/references/pr-bot.md#L1-L25), [degradation and sticky comment](https://github.com/Agents365-ai/drawio-skill/blob/6f33563adce24450003d1cb61111ebbcc5579f28/skills/drawio-skill/references/pr-bot.md#L49-L62))

对 Archify 的含义：**吸收 base / delta / head 的评审信息架构和稳定 ID 原则；不吸收按标签猜身份、全图重排、扁平化容器、外部 draw.io / Graphviz 依赖和核心能力对 CLI 缺失的静默降级。**

### GitNexus：事实变化与推断影响必须分层

研究快照：[`abhigyanpatwari/GitNexus@cdbdf21`](https://github.com/abhigyanpatwari/GitNexus/tree/cdbdf219dce797e51cdeb8cfa386e77ab2d35628)。

- `detect_changes` 先把 Git diff hunk 映射到有 ID、文件和行范围的已索引符号，再列出受影响执行流；其输入明确区分 unstaged / staged / all / compare，并处理 linked worktree。([tool contract](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/mcp/tools.ts#L335-L371), [implementation](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/mcp/local/local-backend.ts#L4107-L4211))
- 当前 hunk parser 以 new-side range 建立变更范围，纯删除 hunk 没有 new-side 行时不会进入后续映射；这再次说明 Delta 必须直接解析 base 与 head 两个完整模型，不能只消费 target-side touched symbols。([source](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/storage/git.ts#L516-L548))
- 它把 diff hunk 与符号范围的重叠标为 `touched`，再单独聚合执行流；查询失败会返回 `partial: true`，避免缺失数据伪装成低风险。([source](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/mcp/local/local-backend.ts#L4213-L4335))
- `impact` 的 blast radius 是另一套合同，输出 direct / transitive depth、process、module 和 LOW–CRITICAL / UNKNOWN；模糊目标会要求用 UID 消歧，而不是静默挑一个。([tool contract](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/mcp/tools.ts#L432-L468), [risk calculation](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/gitnexus/src/mcp/local/local-backend.ts#L6075-L6123))

对 Archify 的含义：Architecture Delta 可以证明“输入模型的哪些事实不同”，但没有代码知识图、运行链和可信映射时，**不得**输出 blast radius、风险等级、“will break”或“safe to merge”。若未来消费 GitNexus 回执，也必须把外部 impact 证据与本地 authored delta 分层展示。

### GitDiagram：路径化诊断、有限审计值得吸收，模型重试不属于 Delta

研究快照：[`ahmedkhaleel2004/gitdiagram@041d2fe`](https://github.com/ahmedkhaleel2004/gitdiagram/tree/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9)。

- GitDiagram 给验证问题稳定 category、精确字段 path 和 message，并检查重复 node ID、未知 group、真实文件树路径、未知边端点。([source](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/generate/graph.ts#L12-L38), [validation](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/generate/graph.ts#L90-L175))
- 图规划最多三次；失败后只把上一份 raw graph 和精确 validation feedback 送入下一次，并为每次尝试保存状态、分类和反馈。([limits and audit shape](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/features/diagram/graph.ts#L7-L21), [attempt audit](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/features/diagram/graph.ts#L96-L138), [bounded planner](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/generate/graph-planner.ts#L72-L225))
- 终态审计会去掉成功结果里重复的大对象，失败时保留原始输出和验证反馈，避免回执膨胀但不丢失失败证据。([source](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/src/server/generate/session-audit.ts#L36-L84))

对 Archify 的含义：复用现有 `schemaVersion: 1` repair receipt 的方向，新增 delta 专属的 code / subject / evidence / supportedFixes；**不引入 LLM、重试、provider、SSE、R2/Redis 或托管状态**。比较是纯确定性操作，一次失败就给出可修复诊断。

### 标准约束：模型 ID、差异种类、删除占位与 PR 基线

- The Open Group 的 ArchiMate Exchange XSD 为 element 与 relationship 分别建立 identifier key，并用 keyref 约束 relationship source / target；这说明架构交换合同把节点和关系身份都当作第一等事实。([official schema documentation](https://www.opengroup.org/xsd/archimate/3.0/html-model/))
- Eclipse EMF Compare 的默认 match phase 优先用对象标识符，差异分为 ADD / DELETE / CHANGE / MOVE；其图形比较用 phantom placeholder 标出被删除对象原来的位置。([developer guide](https://help.eclipse.org/latest/topic/org.eclipse.emf.compare.doc/help/developer/developer-guide.html), [user guide](https://eclipse.dev/emfcompare/documentation/latest/user/user-guide.html), [DifferenceKind API](https://help.eclipse.org/latest/topic/org.eclipse.emf.compare.doc/help/developer/javadoc/org/eclipse/emf/compare/DifferenceKind.html))
- GitHub PR 使用 three-dot comparison，以 merge base 到 topic head 表达“这个 PR 引入了什么”；two-dot 是 base tip 与 head tip 的直接比较。([GitHub Docs](https://docs.github.com/en/pull-requests/reference/branches#three-dot-and-two-dot-git-diff-comparisons))
- Git 的 raw diff format 把 A/C/D/M/R 等状态分开，并为 copy/rename 报告相似度分数；rename detection 本身是可配置的相似度推断。因此 Archify 只有显式稳定 ID 才能声称同一实体发生变化，不能把相似 label 当 rename。([Git diff format](https://git-scm.com/docs/diff-format.html), [git-diff](https://git-scm.com/docs/git-diff))
- RFC 8785 说明要对 JSON 做可重复哈希，必须先有不变的规范化表示和确定的属性排序。Archify 不应声称兼容 JCS，除非实现并通过完整兼容测试；但 compare IR 必须采用同样的“先规范化、再哈希”原则。([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html))

## 冻结合同

以下规则是首版实现边界。任何一条未满足，都不能把产物称为 Architecture Delta / PR Proof。

### 1. 可比较性

1. 两个输入都必须先独立通过当前 `architecture` schema、关系、视图、Clean Flow、composition 和已启用 engineering profile 校验；不能为了比较而放宽任何一侧。
2. 两侧必须都是 `schema_version: 1`、`diagram_type: "architecture"`。类型或 schema 版本不同直接失败。
3. 两侧至少有一个完全相同的 `components[].id`。零共享节点意味着没有证据证明它们描述同一系统；返回 `delta/no-shared-component-id`，不把全图猜成 remove + add。
4. `meta.repository` 两侧都存在时，规范化后的 repository URL 必须完全相同；不同仓库返回 `delta/repository-mismatch`。只有一侧有 repository 或两侧都没有时仍可比较，但 `proofLevel` 必须是 `authored`。
5. 两侧 repository URL 相同且 revision 都是 40 位 SHA 时，`proofLevel` 可为 `revision-pinned`；这只证明输入声明并通过了 Archify 既有 repository-evidence gate，不能称为 GitHub PR、merge-base 或代码影响验证。
6. 首版命令只比较两个本地 JSON 文件，不接受 Git ref、URL 或 PR number。未来若增加 Git wrapper，PR 模式必须把 baseline 解析为 merge-base（three-dot 语义），并把解析后的 base/head SHA 写入回执，不能把 two-dot 偷换成 PR diff。

建议入口：

```text
archify compare architecture <base.json> <head.json> [output.html] [--json] [--repo-root path]
```

它不是第六种 diagram type，也不是普通 `render` 的默认行为。

### 2. 稳定节点与关系身份

- 节点身份只认 `components[].id`；ID 改名就是一个 removed + 一个 added。不得按 label、type、sources、row/col、位置或内容相似度推断 rename。
- 关系身份只认 `connections[].id`。只要任一侧存在无 ID connection，比较失败并逐条报告 `delta/relationship-id-required`；不得退化为 `(from,to)`，因为平行关系、标签变化和端点迁移都会使该键含糊。
- 相同 relationship ID 而 `from` 或 `to` 变化是 `topology` change；Delta 同时画旧关系和新关系，并在回执中配成一项，不能只画一条橙线掩盖旧端点。
- 连接 ID 在每一侧都必须唯一，端点必须存在。沿用既有 duplicate/dangling diagnostics，不新增静默修复。
- 当前 boundary 没有 ID。首版以精确 `(kind,label)` 作为**保守键**，只允许唯一键；重复键返回 `delta/boundary-key-ambiguous`。label 改名表现为 removed + added，不做 rename 推断。若后续要支持可靠 boundary rename，再单独给 schema 增加稳定 `id`，不能扩大首版猜测范围。

### 3. 字段变化分类

比较先把 object key、component/connection 顺序和 set-like 字段规范化，再按下表分类。数组原始顺序不能制造节点/关系变化；`wraps` 和 `sources` 作为集合按规范键排序，`via` 和 Story `focus` 保持有序。

| 实体 | 分类 | 字段 | 用户含义 |
| --- | --- | --- | --- |
| component | `semantic` | `type`, `label`, `sublabel`, `tag` | 架构角色或说明变了 |
| component | `evidence` | `sources` | 源码证据绑定变了，不等于组件本身变了 |
| component | `geometry` | `row`, `col`, `pos`, `size` | moved/resized；不计入架构 changed |
| connection | `topology` | `from`, `to` | 关系端点变了；同时展示旧/新关系 |
| connection | `semantic` | `label`, `variant` | 关系机制或含义变了 |
| connection | `geometry` | `fromSide`, `toSide`, `route`, `via`, `labelAt`, `labelDx`, `labelDy`, `labelSegment`, `width` | rerouted/restyled；不计入架构 changed |
| boundary | `scope` | `kind`, `label`, `wraps` | 部署/安全范围变了 |
| boundary | `geometry` | `pad` | 仅容器留白变了 |
| provenance | `provenance` | `meta.repository` | 输入证据级别或 revision 变了 |
| presentation | `presentation` | `meta.title`, `subtitle`, `animation`, `visual_preset`, `quality_profile`, `engineering_profile`, `views`, `viewBox`, `layout`, `cards` | 读图、校验或叙事呈现变了 |
| ignored | — | `meta.output` | 本地输出路径不属于图的事实，也不得影响 artifact hash |

实体的主状态优先级固定为：`added` / `removed` → `changed`（topology、semantic、scope）→ `evidence-changed` → `moved` 或 `rerouted` → `same`。一项可以同时带多个 classification，但 headline count 每个实体只计一次。

纯 geometry / presentation change 必须与架构 change 分栏；“换了坐标”不能显示为“服务职责改变”。同理，source path 调整不能自动推断成运行影响。

### 4. 删除项与联合几何

1. Before 使用 base 自己已经验证的几何；After 使用 head 自己已经验证的几何。
2. Delta 的主层是 head。added 用 head bbox/route；removed 用 base bbox/route，作为带 `−` 文本标记的虚线 phantom，保持 baseline 原位置。
3. shared component 若几何改变，Delta 保留 head 实体，同时在 base 位置画轻量 `MOVE FROM` phantom；不得重新布局联合图，也不得把移动后的 head 节点拉回旧位置。
4. removed connection、旧端点版本和所有连接到 removed component 的关系都使用 base route。新增关系使用 head route。相同 ID 但端点变化时旧关系为 `−`、新关系为 `+`。
5. 联合 viewBox 是 base/head 已验证 viewBox 的确定性并集加固定 margin；坐标保持原值。不得为“好看”对 removed 节点做避让，因为那会伪造它原来的位置。
6. removed phantom 在 head layer 后面，透明但仍有文本/线型/符号差异；added `+`、changed `~`、removed `−`、moved `↔` 必须不依赖颜色。
7. 若 removed 与 added 恰好重叠，保持真实几何并在 receipt 分列两项；视觉上用双描边和符号区分，不猜测 replacement/rename。
8. 首版只做静态、即时切换，不增加循环动画。Still / reduced motion 与普通模式信息等价。

这直接吸收 EMF Compare 的 deleted phantom 思路，同时保留 Archify 最强的“作者几何是真相”边界。

### 5. 确定性输出与回执

- 比较器是纯函数：相同已解析输入 → 相同 compare IR；不得读取当前时间、绝对路径、Git 状态、网络、随机数或 locale 排序。
- 所有 ID、changed field JSON Pointer、diagnostic 和 receipt 数组按 Unicode code-point 顺序稳定排序；不能依赖输入数组顺序、对象插入顺序或文件系统顺序。
- 每侧同时记录 `rawSha256` / bytes（证明精确输入）与 `semanticSha256`（对规范化 compare IR 哈希）。语义等价但空白、object key 或实体数组顺序不同的输入，raw hash 可不同，semantic hash 和 HTML 必须相同。
- canonical form 是版本化的 Archify contract（例如 `canonicalVersion: 1`）。除非实现 RFC 8785 全部要求并用官方向量验证，否则文档只称“deterministic canonical JSON”，不称 JCS-compliant。
- 成功 `--json` 回执最小形状：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "compare",
  "type": "architecture",
  "comparatorVersion": 1,
  "completeness": "complete",
  "proofLevel": "authored",
  "base": { "rawSha256": "…", "semanticSha256": "…", "bytes": 0 },
  "head": { "rawSha256": "…", "semanticSha256": "…", "bytes": 0 },
  "summary": {
    "components": { "added": 0, "changed": 0, "evidenceChanged": 0, "removed": 0, "moved": 0 },
    "connections": { "added": 0, "changed": 0, "removed": 0, "rerouted": 0 },
    "boundaries": { "added": 0, "changed": 0, "removed": 0 },
    "presentationChanged": false
  },
  "changes": {
    "components": [{ "id": "api", "status": "changed", "classifications": ["semantic"], "changedFields": ["/label"] }],
    "connections": [],
    "boundaries": []
  },
  "artifact": { "sha256": "…", "bytes": 0 },
  "validation": { "checksPassed": 0, "checkCount": 0 }
}
```

- 回执不嵌入完整 base/head object，不放 generatedAt，不复制成功 artifact 内已有的大对象。失败回执保留精确 code、side、JSON path/subject、measured evidence 和 supported fixes。
- compare 必须像当前 `deliver` 一样在输出旁生成唯一 candidate，完成 base/head validation、delta validation、artifact check 与 hash 后再原子替换；任何失败删除 candidate、保留旧 target。

### 6. Share Card 语义

Share Card 固定从 canonical Delta 状态生成，不取决于用户当前停在 Before 还是 After。它只回答“模型声明发生了什么”，不是审批结论。

- 标题：head `meta.title` + `Architecture Delta`。
- 主统计：components 与 connections 分别显示 `+ added · ~ changed · − removed`；boundary scope 单独一行。
- `moved` / `rerouted` / presentation-only 只放次级统计，不混进 `~ changed`。
- 同 repo + 双 revision 时显示 `REV <base-short> → <head-short>` 与 `REVISION-PINNED INPUTS`；否则显示 `AUTHORED SNAPSHOTS`。
- 绝不显示 `SAFE`, `LOW RISK`, `MERGEABLE`, `NO IMPACT`, `VERIFIED PR`。零变化写 `No authored architecture changes`，不是绿色安全认证。
- 使用 `+ / ~ / − / ↔`、文字与线型共同编码，颜色只是辅助；静态 PNG/分享图与 HTML headline counts 必须来自同一个 compare IR。
- 默认不写 repository URL、绝对路径或 source path，避免分享卡泄露本地/私仓信息。

## 必须失败或明确降级的情况

| 情况 | 行为 |
| --- | --- |
| 任一输入 JSON/schema/diagram validation 失败 | non-zero；side-specific repair receipt；不写 artifact |
| diagram type 或 schema version 不同 | `delta/type-mismatch` 或 `delta/schema-version-mismatch` |
| 零 shared component ID | `delta/no-shared-component-id` |
| 双方 repository URL 不同 | `delta/repository-mismatch` |
| 只有一侧 repository evidence | 允许，但 `proofLevel: authored`，并记录 provenance change |
| connection 缺 ID、重复 ID、dangling endpoint | fail-closed；不按端点或 label 猜 |
| boundary `(kind,label)` 在任一侧重复 | `delta/boundary-key-ambiguous` |
| 同 connection ID 改端点 | 允许，分类为 topology；旧/新两条都画 |
| node ID 改名、label 相同 | removed + added；不推断 rename |
| removed 与 added 同位置 | 保持重叠事实，用双描边/符号和 receipt 区分 |
| 只有 geometry / presentation change | 成功，但 headline architecture counts 为零，次级栏说明 layout/presentation change |
| compare 过程内部只获得部分结果 | 失败；首版本地纯比较没有可接受的 `partial success` |
| artifact checker 或 atomic commit 失败 | non-zero；旧输出保持字节不变 |

## 不复制什么

1. **Agents365 的 `--by-label`**：重复 label 会折叠，rename/同名组件会被错配。Archify 宁可给出修复提示，也不猜身份。
2. **Graphviz 全图重排 diff**：它适合扁平摘要，但会让未变节点位移、删除位置丢失，破坏 reviewer 的空间记忆。
3. **扁平化容器、丢边标签和换统一矩形**：region/security-group、机制标签和 semantic sigil 是 Archify 的事实，不是装饰。
4. **缺渲染器时仍发布“proof”**：文件清单可作普通 CI 信息，但 Architecture Delta artifact 必须完整校验后才成功。
5. **GitNexus 风险分数和 blast-radius 文案**：没有代码图与执行流证据时，这些都是过度声明。
6. **GitDiagram 的 LLM 修复循环与托管状态**：Delta 不需要模型、provider、quota、SSE、R2、Redis 或私仓 token。
7. **EMF Compare 的 proximity/content matcher 与三方 merge UI**：首版只做 two-snapshot exact-ID review，不做冲突解决、merge 或相似度配对。
8. **GitHub bot / sticky comment / Action**：它们是未来消费者，不应进入 core comparator；先把离线 HTML 与机器回执做对。
9. **新的移动端产品、全屏 dashboard 或第二套 viewer**：继续沿用现有桌面画布和 contained fallback，只新增一个紧凑的 Before / Delta / After 控制与状态 legend。

## 最小用户可见实现建议

第一版只交付一个窄而完整的垂直切片：

1. 新增零依赖 `archify compare architecture base.json head.json output.html --json [--repo-root path]`。
2. 复用现有 architecture loader、schema、engineering profile、renderer、artifact checker、atomic delivery 和 share-card pipeline。
3. 新增纯 `compareArchitecture(base, head)`，输出冻结的 versioned compare IR；renderer 只消费 IR，不在 DOM 中重新推断差异。
4. HTML 默认 Delta，顶部现有控制区内放一个紧凑三段切换 `Before | Delta | After` 和 `Δ +A ~C −R`；不增加侧栏。
5. Delta 以 head 为主层，overlay base removed/moved geometry；所有状态有文本/符号/线型，不依赖色。
6. Finder 可显示已有节点，首版不新增 status filter；Story/Focus/Reach/Route 只在当前 Before 或 After 完整状态工作，Delta overlay 不制造新的可导航语义节点。
7. canonical export、print 与 Share Card 固定到完整、静态的 Delta 状态；运行时选择和动画状态不进入 hash。
8. Skill 必须先问用户选择 base/head，并说明 relationship ID 是比较前置；不把 compare 设为普通 architecture 生成的默认能力。

这个切片已经足够形成对外价值：用户可以把一份真正自包含、可审计的架构变更图放进 PR、issue 或设计评审，而 Archify 仍保持离线、稳定、零依赖和不过度声明。

## 验收门

### 合同与确定性

1. same inputs 连续运行三次，HTML、canonical compare IR、semantic hashes、summary、changes 顺序和 artifact SHA-256 字节完全一致；receipt 不含时间、绝对路径或随机值。
2. 只改变 JSON 空白、object key 顺序、components/connections 顺序、`wraps`/`sources` set 顺序，raw hash 可变，但 semantic hash、delta summary 与 HTML 不变。
3. 所有 failure table 场景都有精确稳定 code、side、path/subject、evidence 和 supportedFixes；失败不覆盖已有 target，也不残留 candidate。

### 身份与语义

4. node rename fixture 必须输出 one removed + one added；同 label 不得配对。duplicate label fixture 结果相同。
5. missing relationship ID 必须失败；parallel relationships 用独立 ID 正确比较；同 ID 改端点同时显示旧/新关系并只计一个 changed relationship。
6. semantic、evidence、scope、geometry、presentation fixtures 各自只进入正确 bucket；pure move/reroute 不增加 architecture changed count。
7. repository same/different/one-sided/absent 四组 fixture 分别得到正确 proofLevel 或 failure；没有任何 fixture出现风险或 mergeability 文案。

### 几何与视觉

8. removed node、removed edge、moved shared node、端点变化关系、同位置 remove+add、跨 region/security-group 六组 fixture 保留准确 base/head 坐标；Delta 不执行联合 auto-layout。
9. Blueprint / Signal Flow / Classic 三 preset，深浅主题各做 1280×720 桌面截图；`+ ~ − ↔`、文字、虚线/双描边都清楚，标签无新碰撞，phantom 不遮住 head 主层。
10. Before / Delta / After 鼠标和键盘切换即时稳定；Still、reduced motion、print、embed 与普通模式语义等价；控制不进入 print/embed。
11. Share Card 的 counts、proof label、短 revision 与 compare receipt 完全一致；零变化显示 `No authored architecture changes`，不显示安全结论。

### 回归与发布

12. 没有调用 compare 的普通 architecture artifacts 保持 golden byte-compatible；五种现有 diagram type、Viewer、Finder、Focus、Reach、Route、Story、Share Card 不回归。
13. 全量 `npm test`、WebM/Share Card smoke、gallery/guide/package freshness、ZIP installed smoke（Ubuntu/macOS/Windows）、`unzip -tq`、README mirror 与 `git diff --check` 全绿。
14. 用真实项目两份 architecture snapshot 生成一次成品，在内置浏览器验证 Before / Delta / After、主题、三 preset、Share Card、console zero error/warning；最多两轮聚焦修正，并把失败→修复→通过回执写进 acceptance record。

## 推荐顺序

先实现 compare IR、身份诊断和确定性回执；再做联合几何；最后接三态 viewer 与 Share Card。不要先画一张好看的红绿图再倒推合同——那会把最难修的身份与删除几何问题固化到 UI 中。
