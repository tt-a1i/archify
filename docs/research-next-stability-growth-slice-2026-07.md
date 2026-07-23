# Archify 下一轮“稳定优先、用户可见、利于增长”切片研究

> 研究日期：2026-07-23
> 本地基线：`codex/reach-share-card` @ `13d58c406dc4d1449c9761deae039ba78ec403fc`
> 资料边界：Archify 当前代码与公开 issues，以及 Fireworks Tech Graph、GitNexus、GitDiagram、Cursor 和 `skills` CLI 的第一方 README、文档或仓库页面。

## 结论先行

下一轮唯一推荐：**Structured Repair Receipt（结构化修复回执）**。

它不是再加一种图、再加一个动画或再加一个 Viewer 面板，而是让 `validate --json` 和 `deliver --json` 在失败时也输出稳定、可解析、带精确证据与受支持修复旋钮的 JSON。Agent 不必从 Node 堆栈和多行英文错误中猜“应该改哪个对象、哪条线、哪个字段”，因此弱模型和不同客户端也更容易在最多两轮内完成准确修复。

这是当前最符合三项约束的交集：

- **稳定优先**：不降低任何现有质量门槛，不自动改图，只把现有确定性证据变成可靠协议。
- **用户可见**：用户会直接感受到首张图更容易成功、失败解释更清楚、来回调整更少。
- **利于增长**：它改善不同模型/Agent 客户端上的一致性，比继续堆视觉功能更能降低“装了但第一次没画好”的流失。

## 1. 先排除已经完成的能力

本研究按当前本地分支而不是旧版 `main` 判断。以下能力已经存在，不应包装成“下一步新功能”：

- Atomic Verified Delivery：同目录候选文件、完整检查、单次原子替换，失败保留旧成品。
- `deliver --open`：只在验证并提交成功后打开最终 HTML。
- Last-Good Live Preview：候选失败时保留上一份通过验证的成品。
- canonical Share Card、Route Share Card、Reach Share Card。
- Authored Reachability、Semantic Passport、revision-pinned Verified Source Passport。
- 11 个有界场景配方、Start 页面、Proof Lab、五种 typed diagram mode。
- 最多两轮的 Perceptual Delivery Gate，以及 `validation / visual_review / correction_rounds` 的诚实交付说明。

第一方依据：当前 [README](../README.md)、[ROADMAP](../ROADMAP.md)、[SKILL](../archify/SKILL.md)，以及已推送的 [`13d58c4` 基线提交](https://github.com/tt-a1i/archify/commit/13d58c406dc4d1449c9761deae039ba78ec403fc)。

因此，Fireworks 的“有界视觉复核”、GitDiagram 的“仓库到图”、GitNexus 的“路径/影响分析”等概念不能不经核对就再次列为 Archify 缺失项。

## 2. 当前公开反馈揭示的真实痛点

### 2.1 弱模型/不同 Agent 的首轮构图质量仍不稳定

公开 [issue #6](https://github.com/tt-a1i/archify/issues/6) 使用 opencode + DeepSeek 生成架构图和 workflow，反馈箭头混乱且观感差。Archify 已合入 `composition/ambiguous-corridor` 这一具体确定性门槛，但维护者在 [进展回复](https://github.com/tt-a1i/archify/issues/6#issuecomment-5041845293) 中明确保留该 issue，因为“弱模型构图”大于单一 corridor 规则。

这说明下一步不该简单继续增加视觉样式；更重要的是让不同能力的 Agent 都能理解失败证据并做小范围、可验证的修复。

### 2.2 多轮调整的成本对用户真实可感

[issue #22](https://github.com/tt-a1i/archify/issues/22) 报告了长时间、多轮细节调整带来的高 token 消耗。维护者最终确认没有证据表明 Archify renderer 自身异常耗 token，主要成本来自客户端、模型、仓库探索和多轮修订，因此该 issue 已关闭。

正确结论不是“Archify 要承诺节省所有 token”，而是：**Archify 能控制的部分，应让每次确定性失败都给 Agent 一份最短、最精确、无需猜测的修复协议**。这样可以减少无效整图重写和重复解释，但不能虚假承诺控制模型或仓库探索成本。

### 2.3 已修复问题不应重复立项

- [issue #14](https://github.com/tt-a1i/archify/issues/14) 的 CJK/全角宽度边界已由 #31 修复并加入回归覆盖。
- [issue #24](https://github.com/tt-a1i/archify/issues/24) 的“连线穿过无关节点、造成拓扑误读”已进入共享 Clean Flow 硬门槛与回归覆盖。

这些案例证明“可复现问题 → 确定性门槛 → 回归测试”的路线有效。下一切片应增强这套路线上失败信息的可消费性，而不是回到泛化的“自动美化”。

### 2.4 Cursor 是明确的增长入口，但不是本轮最高优先级

2026-07-23 新开的 [issue #46](https://github.com/tt-a1i/archify/issues/46) 表示社区成员已经为 Cursor 制作 Archify skill 并希望共同推进。Cursor 官方在 [2.4 changelog](https://cursor.com/changelog/2-4) 中确认 IDE 与 CLI 都支持 `SKILL.md` Agent Skills；`skills` CLI 的官方 [Supported Agents](https://github.com/vercel-labs/skills#supported-agents) 也已经列出 `cursor`，全局路径为 `~/.cursor/skills/`。

所以 Cursor 值得做，但如果不先改善失败回执，只扩大发行面也可能把同一首轮质量波动带给更多用户。

## 3. 同类项目值得吸收的，不是表面功能数量

### 3.1 Fireworks Tech Graph：把“首稿”当候选，并限制修复轮数

Fireworks 的官方 [Loop Engineering](https://github.com/yizhiyanhua-ai/fireworks-tech-graph#loop-engineering) 明确采用：确定性检查 → PNG 视觉回读 → 针对性修复 → 有界收敛；默认最多两轮，无法读取图片时诚实报告 `visual_review: skipped`。其 [README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) 还用 12 套动图样例在首屏形成强视觉证明。

Archify 已经吸收了正确的“最多两轮 + 不虚报视觉复核”原则，因此不应再次把它当新功能。仍可继续借鉴的是：**让每轮修复输入更结构化、最终状态更可审计**。

### 3.2 GitDiagram：严格 AST、真实路径校验、聚焦反馈重试

GitDiagram 官方 [How generation works](https://github.com/ahmedkhaleel2004/gitdiagram#how-generation-works) 描述了严格、有限大小的 graph AST；服务端校验 identifier、连通性、大小和每条仓库路径，并在模型输出无效时用 focused feedback 重试。成功成品会持久化，重新打开无需再次调用模型。它的另一个增长优势是极短入口：把 GitHub URL 里的 `hub` 换成 `diagram` 即可开始。

Archify 不应复制其托管服务、R2、Redis 或 Mermaid 产品形态；值得吸收的是：**验证失败要成为聚焦、有限、机器可消费的反馈，而不是一段供 Agent 猜测的日志**。

### 3.3 GitNexus：把结构工作前移，让小模型少猜、少查询

GitNexus 官方 [Why a Knowledge Graph](https://github.com/abhigyanpatwari/GitNexus#why-a-knowledge-graph) 把核心价值描述为预计算结构，使 Agent 用一次工具调用获得完整上下文，并明确强调 token efficiency 与 smaller-model reliability。它的 [Quick Start](https://github.com/abhigyanpatwari/GitNexus#quick-start) 只有 `analyze` 和 `setup` 两步；[Editor Setup](https://github.com/abhigyanpatwari/GitNexus#editor-setup) 则把 Cursor、Claude Code、Codex、OpenCode 等多客户端支持放在主路径。

Archify 不需要引入知识图数据库。可吸收的原则是：**把确定性知识放进工具回执，不要把解析错误、归类失败和选择修复手段继续外包给模型**。

## 4. 当前协议层的具体缺口

在本地基线 `13d58c4` 上核对 [CLI 实现](https://github.com/tt-a1i/archify/blob/13d58c406dc4d1449c9761deae039ba78ec403fc/archify/bin/archify.mjs)：

1. `validate --json` 只在成功后打印 JSON。输入读取、schema、layout 或 render 失败时，会把 renderer stderr 原样转发；一次不存在文件的实测得到 **stdout 0 bytes、stderr 782 bytes 的 Node 堆栈**，退出码为 1。
2. `deliver --json` 已经在失败时维持一个 JSON envelope（这是正确基础），但 `error` 仍是自由文本；没有稳定的 `diagnostics[]` 来表示规则代码、对象身份、测量证据和受支持修复字段。
3. renderer 已经产生大量稳定规则标识与精确提示，例如 `clean-flow/edge-through-node`、`composition/proper-crossing`、`composition/ambiguous-corridor`、`composition/label-route-clearance`、`composition/micro-segment`。也就是说，Archify 并不缺检测能力，缺的是从内部事实到外部 Agent 的**结构化错误协议**。
4. 当前 [SKILL 的 Perceptual Delivery Gate](https://github.com/tt-a1i/archify/blob/13d58c406dc4d1449c9761deae039ba78ec403fc/archify/SKILL.md#perceptual-delivery-gate) 已要求最多两轮针对性修复，但如果确定性失败只给自由文本，弱模型仍可能整图重写、选错修复旋钮或重复试错。

这是真实、可复现、范围有限的缺口，也能同时解释 #6 的跨模型波动和 #22 中用户对多轮调整的敏感。

## 5. 三个候选切片

| 候选 | 用户/增长收益 | 主要风险 | 可测试性 |
|---|---|---|---|
| **A. Structured Repair Receipt** | 首次失败更容易理解；Agent 能按对象与规则做局部修复；减少日志猜测和无效整图重写；对所有客户端和模型同时生效 | 若仓促用正则解析旧错误文本，协议会脆弱；若一次覆盖所有错误类型，范围会失控；需维护 JSON 向后兼容 | 很高：五种 mode 的 success/failure fixtures、stdout/stderr 契约、exact diagnostic schema、旧成品字节不变、安装 ZIP smoke 都可确定性测试 |
| **B. First-class Cursor Onboarding** | 直接回应 #46；扩大可安装人群；在 README/Start/landing 给出一条 Cursor 命令，缩短增长入口 | 文档写“支持”不等于不同 Cursor 模型都能稳定产出；若做 Cursor 专属 skill 会造成分叉和维护漂移 | 高：临时目录安装到 Cursor 路径、`doctor`、五 mode 包装 smoke、文档生成一致性；真实模型效果只能另做非阻断 benchmark |
| **C. First Diagram Reliability Scorecard** | 用公开样例显示“哪些客户端/模型能在几轮内通过”，建立信任，也为后续门槛提供数据 | 模型、版本、仓库和费用使结果易漂移；若没有先改善协议，benchmark 只会暴露问题而不解决问题 | 中：IR 与 artifact gates 可确定性复跑；模型/Agent 端到端结果必须时间戳化并与 CI 阻断分离 |

## 6. 唯一推荐：Structured Repair Receipt

### 6.1 建议的有界范围

第一期只做“失败协议”，不做自动修图：

1. `archify validate ... --json` 在成功与失败时都只向 stdout 输出一个 JSON 对象；失败时不得泄漏 Node 堆栈到 stdout。
2. `archify deliver ... --json` 保持现有 envelope，并添加与 `validate` 共用的 `diagnostics` 合约。
3. 先覆盖最常见、最有稳定标识的类别：input、schema、repository evidence、通用 layout，以及现有 Clean Flow / composition 规则；未知内部异常可保留一个 `internal/unclassified` fallback，但必须明确不可自动修复。
4. 每条 diagnostic 只包含已知事实与支持的修复旋钮，例如：

```json
{
  "code": "clean-flow/edge-through-node",
  "severity": "error",
  "subject": {
    "collection": "connections",
    "index": 3,
    "id": "api-to-queue"
  },
  "evidence": {
    "obstacleId": "cache",
    "segmentIndex": 2,
    "clearancePx": 2
  },
  "supportedFixes": [
    "fromSide/toSide",
    "via",
    "route/channel",
    "node placement"
  ]
}
```

5. SKILL 只消费这些 diagnostics 来做局部修复，继续遵守最多两轮；不得因为有 JSON 就扩大重试预算。
6. 非 `--json` 模式继续提供简短人类可读错误，但应从同一 diagnostic 对象格式化，避免两套事实漂移。

### 6.2 实现时最重要的约束

- 不要对现有多行错误做长期正则解析；应在规则产生处保留结构化事实，再由边界层格式化文本/JSON。
- `supportedFixes` 只能列出该 mode 真正支持的字段或动作，不给模型“看起来合理但 schema 不接受”的建议。
- 成功 receipt 尽量保持兼容；若新增字段，保持 additive，并用 schema/version 测试锁定。
- `deliver` 的失败仍必须删除候选并保持旧成品逐字节不变。
- deterministic receipt 仍不代表 visual review；两者必须继续分开。

### 6.3 验收门槛

- 五种 diagram mode 各至少一个成功和一个失败 fixture。
- `validate --json` 的 input/schema/layout/check failure 均为有效 JSON，退出码非零，stdout 只有一个对象，无 Node stack。
- `deliver --json` 与 `validate --json` 对同一失败给出相同规则代码和对象身份。
- 每条已知 diagnostic 都有规则代码、severity、subject、evidence、supported fixes；未知错误明确标记，不伪造修复建议。
- 非 JSON 人类输出继续包含具体对象、阈值和修复提示。
- 失败 delivery 保持旧成品 SHA-256/bytes 不变，候选目录清理干净。
- `archify.zip` 零依赖安装 smoke 通过；现有 `npm test`、WebM/浏览器 smoke 全绿。
- 用内置浏览器完成一次“失败回执 → 一处局部修复 → verified artifact”的真实闭环；最终视觉复核仍单独记录。

## 7. 明确非目标

本切片不做：

- 自动移动节点、自动改 route、自动重写整份 JSON。
- 在 CLI 内调用 LLM、自动无限重试或承诺节省模型探索 token。
- 新 diagram type、新 visual preset、新 GIF/WebM 动效或新 Viewer 面板。
- D2/Mermaid engine 替换；当前问题是诊断协议，不是缺少另一个布局引擎。
- hosted upload、repository ingestion、账号系统、遥测或云端持久化。
- 移动端专项设计。
- blast radius、runtime causality 或 repository impact 推断。
- 把 deterministic validation 冒充 perceptual visual review。
- 同一切片顺带做 Cursor 专属 fork；Cursor onboarding 可作为紧随其后的增长切片，共享同一 `SKILL.md`。

## 8. 推荐顺序

1. 先完成 Structured Repair Receipt，并用当前 #6 类构图失败做一条真实闭环。
2. 再做 First-class Cursor Onboarding，借助统一失败协议扩大安装面，而不是扩大不确定性。
3. 最后建立带日期、客户端/模型版本、correction rounds 和视觉复核状态的 Reliability Scorecard；把它当产品证据，不把随机模型结果直接设为 CI 硬门槛。

这个顺序吸收了同类项目最值得学习的共同点：Fireworks 的有界收敛、GitDiagram 的 focused feedback、GitNexus 的结构前移与多客户端入口；同时保留 Archify 自己最强的差异化——离线、自包含、可验证、读图交互丰富，而且不虚构证据。

## 第一方来源

- Archify 当前仓库与 issues：[repository](https://github.com/tt-a1i/archify)、[#6](https://github.com/tt-a1i/archify/issues/6)、[#14](https://github.com/tt-a1i/archify/issues/14)、[#22](https://github.com/tt-a1i/archify/issues/22)、[#24](https://github.com/tt-a1i/archify/issues/24)、[#46](https://github.com/tt-a1i/archify/issues/46)
- Fireworks Tech Graph：[README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)、[Loop Engineering](https://github.com/yizhiyanhua-ai/fireworks-tech-graph#loop-engineering)
- GitNexus：[README](https://github.com/abhigyanpatwari/GitNexus)、[Quick Start](https://github.com/abhigyanpatwari/GitNexus#quick-start)、[Why a Knowledge Graph](https://github.com/abhigyanpatwari/GitNexus#why-a-knowledge-graph)、[Editor Setup](https://github.com/abhigyanpatwari/GitNexus#editor-setup)
- GitDiagram：[README](https://github.com/ahmedkhaleel2004/gitdiagram)、[How generation works](https://github.com/ahmedkhaleel2004/gitdiagram#how-generation-works)
- Cursor：[Cursor 2.4 Skills announcement](https://cursor.com/changelog/2-4)
- Vercel `skills` CLI：[README](https://github.com/vercel-labs/skills)、[Supported Agents](https://github.com/vercel-labs/skills#supported-agents)
