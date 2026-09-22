# 首稿优化实验：反方设计与最小试验

日期：2026-09-21
范围：阶段 1（source understanding）与阶段 2（diagram first draft）。

**状态：这是反方提出的实验草案，不是已执行的作者协议。** 协调者随后用本地反例否决了默认 grid-first；本轮作者与成品盲评调用均为 0。下述扩展测试、事件分类和评审要求未实施，不应读作运行结果。最终裁决见 [研究结果](research-firstdraft-result-20260921.md)。

## 先定反方立场

上一轮证据只支持一个很窄的结论：E1 把修图后的独立 `validate` 合并进现有 `finalize`，固定输入的机器流程中位数少了约 0.37–0.53 秒；4 个真实作者样本中没有一次触发修图，因而没有首稿或端到端提速证据。4 个作者和 2 个评审都记录了 4 条 gateway/transport 类事件后才完成；HTTP 根因、请求/重试数、服务端排队、不可变 provider revision 均未知，不能把事件数当请求数，也不能把失败耗时算成合格交付速度。旧 cohort 已封存，不能盲目续跑。

当前 `SKILL.md` 和 repository-authoring 已经要求证据边读边记、直接写首稿、首稿自动路由、不要增加坐标规划轮次。这些是语义和安全约束，不是可随意削减的延迟预算。以下常见“胜利”都预先判为无效：

- token 少、工具少、读取文件少，但漏掉责任、边界、来源或关系；
- 通过合并节点、删除标签、缩短图或提前加入 route 控制来获得更快或更小的输出；
- 增加一个 outline/planning 模型轮次却把作者总时间拆开报告；
- 换模型、换档位、换 provider 后把 cohort 差异归因于候选机制；
- 用失败运行、gateway 重试、未完成候选，或未知的 HTTP 时间声称“更快”。

## 一个候选：Architecture grid-first 首稿

只测试一个 `C1`：在阶段 1 维持现有的 question-driven source slice 和证据记录；在阶段 2 对 Architecture 首稿优先使用 `layout.mode: "grid"` 加组件 `row`/`col`，省掉模型为每个节点手算 `pos`/`size` 的坐标规划。候选不改语义内容、源码读取或 `finalize`，不增加 outline 文件、摘要回合、辅助代理或第二模型；`pos`、`size` 和显式 route 只在用户给出该几何意图或本地诊断证明 grid 不适用时保留。

这不是“renderer 自动布局”的假设。当前 `grid.mjs` 是固定 cell math：`pos` 优先于 `row`/`col`，没有 `pos` 时按 `origin + col * (cellW + gapX)` 与 `origin + row * (cellH + gapY)` 放置；`size` 仍可缺省为默认节点尺寸。它不会根据标签长度、边界或关系自动改变 cell。候选必须因此保留完整语义和真实来源，并证明 grid 输出的边界、标签、路由和 common viewport 可读；若仅靠缩小文字、删除标签、合并节点或把图压成更短的带状布局才通过，C1 失败。

`C1` 的目标是减少阶段 2 的坐标/尺寸写作和首稿返工，阶段 1 只作为输入证据完整性的配对门槛；不得把少读文件或较少 JSON 字段当成阶段 1 的收益。若不能在本地证明 row/col 首稿序列被使用、且不会掩盖 stage 1 语义缺口，候选不值得消耗模型调用。

## 多角色辩论后的裁决

| 角色 | 质疑或主张 | 裁决 |
| --- | --- | --- |
| 作者效率 | row/col 比每个节点手算坐标更快。 | 只有在 grid 真能覆盖固定 fixture，且首稿进入 `finalize` 的时间可观察时才成立。字段数量本身不是目标。 |
| 语义审计 | 任何“精简图”都可能隐藏控制面、信任边界或持久化。 | 关键责任、关系、边界和来源缺一项即失败；不得用图面变短抵消缺失。 |
| 实验方法 | grid 能在本地先被复现，似乎比模型试验更适合先测。 | 同意，但 grid 不是 auto-layout；固定 cell 可能把长标签和边界问题推迟到首稿之后，必须先做反例 fixture。 |
| 运行观察 | gateway 事件或工具数量可解释波动。 | 只报告公开类别和本地时间；HTTP 请求、重试、排队与 provider 版本保持 `null`。 |
| 视觉评审 | 机器验证通过不等于可读首稿。 | 评审必须看固定视口的成品；裁切、重叠、标签碰撞、误导边界或正文不可读即失败。 |

## 付费模型前的本地闸门

闸门必须在候选进入 4 次作者调用前通过，且不调用模型、不联网、不重用旧 cohort：

1. **契约检查。** 对 `C1` 的 prompt/Skill diff 做静态检查：没有 planning/outline/代理/模型切换；没有以节点、关系、来源、view、card、boundary 数量为上限；没有首稿 route 控制；没有削减 `finalize` 门禁；Architecture 只在 `layout.mode: "grid"` 时使用 `row`/`col`，不把 `pos` 优先规则误称为自动布局。用现有仓库测试和固定 source-to-diagram、web-app、production-deployment 语义 fixture 验证候选 JSON 仍能通过 schema 与 `finalize`。
2. **grid 反例回放。** 在不联网的本地脚本中，把同一份固定语义 IR 分别渲染为 free-position 与 grid-first 版本，至少覆盖：长中英文标题/副标题、四列以上的主路径、分支和回路、嵌套 region/security-group 边界、shared store、边界外 external actor、关系标签预算，以及不同默认/显式 node size。检查 `layout-json` 的 component boxes、boundary frames、route points、label masks 和 desktop-readability；任一 grid 版本出现重叠、越界、误边界、标签无清晰间隙、6px 以下正文或需要删除语义字段才可修复，C1 在该结构上不可用。这个回放不能用 token、工具数或节点数代替几何证据。
3. **机制回放。** 用不联网的脚本化公开事件回放验证 observer 能区分 `source-read`、`candidate-write`、`grid-layout`、`finalize`、`browser-check` 的阶段类别，并记录相对时间、退出码、artifact hash、首稿完成时间、修复次数和每个关键节点的 source-reference 数。不能解析原始工具参数、文件内容、prompt、模型思维或完整诊断文本。回放中应验证失败、取消、`pos` fallback 和重复读取不会被误算成 grid 成功。
4. **质量闸门。** 用上述固定 fixture 的现有机器门禁验证零 composition error/warning、无水平溢出、来源路径可解析，且 grid 首稿没有删除语义字段或掩盖阶段 1 的来源缺口。若没有可复现的本地信号证明 C1 真的使用了 row/col，或本地脚本只能靠 token/工具数推断改变，则停止，不启动付费作者。

以下任一信号也足以不测试：候选需要额外回合或辅助 agent；只能通过换模型/档位才能“生效”；本地配置读取无法确认固定模型和 effort；source-read/candidate-write 元数据无法区分或会泄露 raw tool content；fixture 的必要语义没有冻结 rubric；预检遇到 authentication、quota 或重复 gateway 故障；或者必须恢复旧 cohort 才能凑样本。单次普通环境波动不自动判失败，但不能把它解释成候选收益。

## 最小可证伪试验

### 固定设计

- **作者 4 次上限：** 两个事先冻结的任务，各运行基线 `M` 与 `C1` 一次，交替顺序；同一模型 `Terra/medium`、同一权限、同一超时、同一仓库/fixture revision。任务 A 是 repository-backed architecture，覆盖 source evidence、控制面和存储边界；任务 B 是中等复杂度的服务架构，覆盖主路径、异常分支和可读标签。提示词、输入、输出路径、质量 profile 和验收 rubric 在启动前固定。C1 只改变 Architecture 的首稿布局提示/允许的 `layout.mode` 与 `row`/`col` 字段；阶段 1 的源码范围和停止条件不变。
- **评审 2 次上限：** `Luna/high` 与 `Terra/high` 各一次；每次盲评两个任务的 M/C 成对成品，隐藏变体、作者耗时和候选目标。评审只基于产物、固定视口截图和机器收据，不看原始工具输出。
- **不重跑：** 作者失败、超时、取消、gateway 受影响或写入失败都保留原样，不替换、不加时、不启动第三模型。旧报告的暂停规则继续适用。

### 允许的观测

只记录公开文件相对路径、工具/命令类别、事件时间戳、退出码、字节数、artifact/candidate hash、`finalize`/browser-check 状态、首份完整候选时间、修复/重写次数、是否出现 `layout.mode: grid`、使用 row/col 的组件数、组件/关系/来源/view/card/boundary 的计数，以及人工评审结论。路径和工具类别用于复现阶段边界，不用于把“少读一个文件”或“少写几个 pos”当成功。

`logical_request_count`、`network_attempt_count`、`retry_count`、`server_timing`、`actual_provider_revision`、费用和 token 若无可靠来源一律为 `null`。`gateway`、`authentication`、`quota` 等只保留类别；不保存命令参数、原始工具输出、prompt、源码内容、模型 reasoning 或个人数据。

### 首稿质量硬门槛

每个作者产物必须同时满足以下条件才进入速度比较：

1. `finalize` 成功，包含现有 validate、deliver、strict check 和真实浏览器检查；receipt 报告 9 项检查、0 composition error、0 warning。
2. 任务 rubric 中冻结的每项请求责任、主路径、异常分支、控制/信任/存储边界和关系均有表达；每个关键 repository-backed 节点有真实可解析的来源路径和行号。缺责任、误归属、无证据事实或删除有意义标签即失败。
3. 在 1440×900、1920×1080 的固定浅色截图中无水平溢出、裁切、节点重叠、关系穿过无关节点、标签遮挡或不可读正文；6px 是现有硬失败底线，不能把贴着底线的文字包装成“可读”。边界必须与来源支持的所有权/信任/运行时事实一致。
4. 两位盲评者均判定没有 material semantic defect 或 material readability defect；意见不一致时记为未通过，不启动额外裁决调用。

失败运行的耗时只作为失败证据，不能作合格提速分母。首稿和最终 hash 相同可复用质量结论，但仍须记录首稿时间；人工修图后的速度不代表首稿速度。

## 事先登记的判定

先判机制是否触发：两次 `C1` 作者运行都必须出现 `source-read → candidate-write(grid row/col) → finalize` 的公开类别序列，且没有新增 planning/agent 回合；C1 产物不得用 `pos` 覆盖 grid，也不得把失败后的 pos fallback 记为 grid 成功。缺一次即为“未触发”，试验结束，不宣称性能结果。

只有同时满足以下全部条件，才允许说“C1 在本小样本中值得继续验证”：

- 两个 C1 产物都过上述质量硬门槛，M 产物没有被 C1 成对地改善质量却牺牲语义；
- 两个匹配任务中，C1 的首份合格候选时间和合格作者 wall time 都不晚于 M；任一任务变慢、失败或质量下降即为候选未通过；
- 两位评审对 C1 没有 material defect，且机器收据没有新增告警或门禁缺失；
- 公开元数据足以复现阶段边界，所有未观测的 HTTP/server/provider 字段仍明确为未知。

这个门槛是小样本的 falsification rule，不是统计显著性或稳定收益证明。两对都满足也只能登记为“继续做更大验证”的信号；混合结果、零触发、任一语义/可读性失败，均维持当前基线并停止付费扩展。不得用 token、工具数、图面积、节点数、失败耗时或单个 gateway 事件替代上述判定。

## 交付记录

本文件只定义反方方法和试验边界，不修改 `SKILL.md`、渲染器、观测器或模型配置。若未来实际实施 C1，应另建不可变 manifest，记录源 revision、候选/基线 diff、完整调用槽位和每次终止原因；未启动的槽位不计失败率、不赋零耗时。最终报告必须把本地机制回放、作者质量、作者 wall time、评审判断和外部链路未知分别报告。
