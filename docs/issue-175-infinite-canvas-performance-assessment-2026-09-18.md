# Issue #175 / PR #208：五类图返工数据、无限画布评估与更优解

> 核验日期：2026-09-18
>
> 本阶段范围：只追溯五类图返工轮数、阶段耗时和端到端耗时的数据来源，解释各字段的计算口径与可比性。本文不会把无限画布先验地当作解法，也不在缺少原始 receipt 时补造精度。

## 1. 先说清楚：哪些是维护者数据，哪些不是

公开证据里存在三个不同角色，不能混称为“维护者给出的五类图数据”：

1. [Issue #175](https://github.com/tt-a1i/archify/issues/175) 的原始基线由 `sunsunsun-java` 发布；GitHub API 标记其 `author_association` 为 `COLLABORATOR`。
2. PR #208 中包含五类图 `10 / 19 / 5 / 9 / 10` 自动验证轮数的[完整 benchmark 评论](https://github.com/tt-a1i/archify/pull/208#issuecomment-5472829403)由 `YunyueLi` 发布；其 `author_association` 同样是 `COLLABORATOR`，不是 `OWNER`。
3. 仓库 OWNER `tt-a1i` 没有重新发布这组五类图原始数据。OWNER 做的是审查和限定证据适用范围：
   - [首次 change request](https://github.com/tt-a1i/archify/pull/208#pullrequestreview-5060377434)明确说 `2,637.592s` 与 `2,689.103s` 不是 matched A/B，不能支持 20–30% 提速声明。
   - [后续 queue update](https://github.com/tt-a1i/archify/pull/208#issuecomment-5702319529)把已发布 benchmark 定性为提交 `1195611` 的 useful evidence，但不是当前 HEAD `c8fc9f5` 的性能验收；原作者对 revision/evidence 负责，维护者只在新 HEAD 上重新审查。
   - [第二次 change request](https://github.com/tt-a1i/archify/pull/208#pullrequestreview-5067983898)仍未宣称 matched 端到端提速或人工视觉验收。

截至本次核验，PR #208 仍为 `OPEN`，远端 HEAD 是 `c8fc9f54b5873dda5bbfcbd40767303b369cfe2c`；五类图 benchmark 固定在更早的 `1195611f84cf02b78c30278ce71b12c5795b7ea1`。因此，下文将它称为“PR 协作者 benchmark”，不会称为“当前 PR HEAD 的维护者验收数据”。

## 2. 一手证据登记

| 证据 | 能证明什么 | 不能证明什么 | 可复算程度 |
|---|---|---|---|
| [Issue #175 原始正文](https://github.com/tt-a1i/archify/issues/175) | 初始五图 aggregate agent work；Architecture/Dataflow 的部分轮次；overflow 后返工、人工复核和 Chrome 失败耗时 | 其余三类图的逐轮数据；各类失败原因的完整分解 | 只有汇总值，无公开逐轮 receipt |
| [PR #208 benchmark 评论](https://github.com/tt-a1i/archify/pull/208#issuecomment-5472829403) | 固定 `1195611`、基线 `7fe139e`、Pi `e868230`；五类图轮数/阶段耗时；machine ABBA 汇总；人审分数 | 当前 `c8fc9f5` 的性能；逐样本时间戳、逐轮诊断、候选 hash 的独立复算 | 评论级汇总；没有附原始结果文件 |
| [OWNER 初审](https://github.com/tt-a1i/archify/pull/208#pullrequestreview-5060377434) | 明确哪些历史数字不可比，要求 exact-head matched receipts | 不提供新的五类图原始样本 | 审查结论可核验 |
| [OWNER queue update](https://github.com/tt-a1i/archify/pull/208#issuecomment-5702319529) | 明确 benchmark 只对 `1195611` 有效 | 不把结果提升为当前 HEAD 验收 | 审查结论可核验 |
| [`1195611` matched-A/B 协议](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/benchmarks/matched-ab/README.md) | clean worktree、固定 revision/runtime/config、ABBA、统计和 agent receipt 所需字段 | 没有本次实际运行的 manifest/receipt/results | 协议和实现可复算，样本不可复算 |
| [引用的 Codex 任务](thread://01a0532d-affc-7a20-9257-b7effc30fc04?hostId=local) | 后续 6 项目 × 5 类图 fresh run 的任务日志、30 个总耗时和完成状态 | 不能替代 GitHub PR 验收；当前已无法从任务里给出的文件路径读取底层 JSON | 任务对话仍可读，未跟踪 artifact 已不在当前文件系统 |

PR 正文本身写明 local benchmark/run artifacts 和 share-only summary 被刻意保持为 untracked、未放入 PR。检查 `1195611` 的 Git tree 也只能找到 harness、schema 和测试，没有这次运行的具体 manifest、逐轮 receipt 或 results 目录。因此公开证据链在“PR 评论汇总”处中止：可以引用评论里的数值，但不能独立重算 6 个 ABBA 样本或 53 个自动验证轮次。

## 3. Issue #175 的原始返工基线

[Issue #175](https://github.com/tt-a1i/archify/issues/175) 给出的原始五图基线是：

| 指标 | 原始值 | 对总 aggregate agent work 的比例 | 可作何种解释 |
|---|---:|---:|---|
| 五图 aggregate agent work | 2,637.592s（43:57.592） | 100% | 五个 agent/run 的工作包络累计，不是并发后的用户等待时间 |
| Architecture rounds 1–23 | 334.544s wall | 12.68% | 只证明这个 Architecture 样本经历了 23 轮观察；没有五类图统一定义 |
| Architecture validate CLI | 4.524s | Architecture wall 的 1.35% | renderer/checker CPU 不是该样本的主要耗时 |
| Dataflow 7 rounds | 133.849s wall | 5.07% | 只覆盖一个 Dataflow 样本 |
| Dataflow validate CLI | 0.704s | Dataflow wall 的 0.53% | 同上，CLI 本身很小 |
| 9/9 后才发现首屏纵向 overflow | 4/5 图 | 不适用 | 是发生率，不是时间占比 |
| 明确标记为 post-overflow rework | 284.759s | **10.80%** | 当前唯一能明确归因给“晚发现 viewport overflow”的返工时间 |
| manual review/reporting | 401.206s | 15.21% | 人工复核和报告合计；可能与其他阶段分类存在嵌套 |
| 其中纯报告抄写 | 至少 133.960s | 5.08% | 是上一行的子集，不能再次相加 |
| sandbox Chrome launch 失败 | 约 23.8s | 0.90% | 环境失败，不是布局返工 |

两个必须保留的限制：

- 原始 Issue 只公开了 Architecture 和 Dataflow 的轮次，没有 Workflow、Sequence、Lifecycle 的同口径 baseline 轮数。
- `284.759s / 2,637.592s = 10.80%` 只是历史样本中“明确归因为 overflow 后返工”的份额。它不是全部画布相关时间，也不是无限画布的实测收益；把它当作潜在可解释上限仍需假设新方案能把这部分完全消除且不会引入新的导航、导出或布局成本。

## 4. PR 协作者 benchmark 的五类图数据

PR 评论固定的版本为：B=`1195611f84cf02b78c30278ce71b12c5795b7ea1`，A=`7fe139ebe2e532941eb4c315057294348e88a2c0`，Pi=`e86823096c5bad39e1ca282ec24bc5eb9bec745b`。Pi + `gpt-5.6-sol/high` 的 B 侧五类图汇总如下：

| 图类型 | 评论原文的“自动验证轮数” | 并发创作包络 | 候选冻结后的独占处理 | 自动门禁 | 语义人审 | 视觉人审 |
|---|---:|---:|---:|---|---:|---:|
| Architecture | 10 | 33:19.324 | 764ms | 9/9，通过 | 94 | 84 |
| Workflow | 19 | 33:19.228 | 881ms | 9/9，通过 | 96 | 88 |
| Sequence | 5 | 33:19.201 | 624ms | 9/9，通过 | 97 | 88 |
| Dataflow | 9 | 33:19.075 | 567ms | 9/9，通过 | 95 | 90 |
| Lifecycle | 10 | 33:18.947 | 613ms | 9/9，通过 | 94 | 86 |

五类合计是 53 个“自动验证轮次”，中位数为 10，但**不能把它改写成 53 次返工或 48 次返工**，原因有三点：

1. 评论没有给“自动验证轮数”的字段定义、原始命令记录或逐轮 candidate hash。
2. `1195611` 的代码里，`repairHistory.attemptCount` 只在 validate **失败**时追加；成功的最终验证并不由 `persistRepairAttempt()` 追加。代码见 [`archify/bin/archify.mjs`](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/archify/bin/archify.mjs#L815-L902)。评论里的“自动验证轮数”是否来自这个字段、命令次数还是 agent 手工统计，没有公开映射。
3. 一次验证失败之后可能发生零次、一次或多次候选编辑；一次候选编辑也可能触发多种门禁。因此“验证调用数”“失败 attempt 数”“candidate mutation 数”和“人工返工回合”是四个不同指标。

五个约 33:19 的包络是并发启动、彼此重叠的，评论明确禁止相加。它们也不适合拿来比较哪种图更慢：相近的结束时间主要反映共享批次边界和同机资源竞争，不是五种图各自的独占 CPU 或 agent 工作量。评论另行给出的可比较批次信息是：候选冻结后五图原生 suite 总墙钟 29.715s，共享 visual batch 16.381s。

## 5. 基线 A 的分阶段耗时

同一 PR 评论还给出了基线 A 的严格串行 20 阶段汇总：

| 图类型 | Authoring | Validation/repair | Delivery | Visual | 行合计 | Validation/repair 占比 |
|---|---:|---:|---:|---:|---:|---:|
| Architecture | 84.159s | 101.945s | 10.347s | 57.136s | 253.587s | 40.2% |
| Workflow | 70.804s | 268.579s | 9.238s | 54.623s | 403.244s | 66.6% |
| Sequence | 47.905s | 11.666s | 11.265s | 166.047s | 236.883s | 4.9% |
| Dataflow | 58.216s | 229.733s | 0.152s | 63.622s | 351.723s | 65.3% |
| Lifecycle | 70.556s | 319.418s | 0.148s | 194.375s | 584.497s | 54.6% |

由表中五个 `Validation/repair` 数相加得到 `931.341s`。以评论声明的总墙钟 `1,829.998s` 为分母，占 `50.9%`。但这 931.341s 没有再拆成 viewport overflow、节点重叠、连线穿越、标签净空、语义补全、工具失败或模型思考，因此不能说其中有 50.9% 会被无限画布消除。

还有一个很小但应记录的公开汇总差异：五个显示到毫秒的行合计相加为 `1,829.934s`，评论总计写作 `1,829.998s`，相差 64ms。它不影响数量级判断，但在缺少原始 receipt 时不能确定是未列出的 overhead 还是汇总转录差异。

这张 A 表和上一节 B 表也不能构成逐类型 A/B：A 给的是串行阶段时间，B 给的是并发创作包络、自动验证轮数和冻结后独占处理，字段并不对称。

## 6. 严格 machine ABBA 能证明的范围

PR 评论中真正满足 matched A/B 的，是**候选已经冻结之后**的机械流水线：warmup=1、rounds=3、ABBA 顺序，因此每臂有 6 个正式样本。

| 指标 | A：PR 前串行 | B：PR #208 批处理 | 变化 |
|---|---:|---:|---:|
| 中位墙钟 | 36,457.138ms | 25,858.507ms | 配对中位 -10,744.190ms / -29.5% |
| P95 | 37,706.133ms | 27,150.590ms | 配对 P95 -25.5% |
| facts / nodes / relations-or-messages / views | 37 / 47 / 68 / 20 | 37 / 47 / 68 / 20 | 相同 |

实现的统计公式可在固定提交的 [`matched-ab.mjs`](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/benchmarks/matched-ab/matched-ab.mjs#L146-L185) 中核验：

- 单臂 median：排序后取中位；偶数样本取中间两项平均。
- P95：nearest-rank，索引为 `ceil(n × 0.95) - 1`。
- 配对差：`B.durationMs - A.durationMs`；百分比为 `(B - A) / A × 100`。
- 运行耗时：以 `process.hrtime.bigint()` 包住同一 observer command，见[实现](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/benchmarks/matched-ab/matched-ab.mjs#L196-L220)。

所以 `-29.5%` 能支持“固定候选后的机械 pipeline 变快”，不能支持“模型画五张图的端到端时间降低 29.5%”，更不能单独支持“无限画布会降低 29.5%”。

同一评论里的真实 agent A=`30:29.998`，B observed=`38:35.149`，B 表面上慢 26.5%；但评论明确说明 B 存在多 session 资源争用，A/B 的计时路径和负载也没有配对，因此同样不能拿来证明 PR 使端到端变慢。

## 7. 引用 Codex 任务中的 6 项目 × 5 类图数据

引用任务固定 Archify `1195611`，新鲜运行 Pi、Maka、OpenPi、Hermes Agent、DynamicTp、MaxKB 的五类图。任务总结为 30/30 个任务收敛，29 个完成，OpenPi Workflow 在 24 次确定性修复预算耗尽后 bounded-stop；实际并发批次 wall-clock 为 `1:08:06.743`，30 个任务的累计 agent work 为 `7:22:48.402`。

按任务最终逐图总耗时表重新聚合，得到下面的描述性统计：

| 图类型 | 成功样本 | 成功样本均值 | 成功样本中位数 | 失败/停止样本 |
|---|---:|---:|---:|---|
| Architecture | 6 | 12:57.291 | 12:46.995 | 0 |
| Workflow | 5 | 15:18.040 | 16:37.762 | OpenPi 1 个 bounded-stop，19:50.823 |
| Sequence | 6 | 12:06.148 | 12:02.105 | 0 |
| Dataflow | 6 | 18:19.871 | 15:24.875 | 0 |
| Lifecycle | 6 | 14:21.254 | 13:50.407 | 0 |

这些均值和中位数是本文从任务最终表重新计算的派生值，不是 task 原文直接发布的统计量。它们只能作为“Dataflow 在这 6 个不同项目中观察到的成功样本平均最慢”等探索性信号，不能用于因果归因：项目规模、语义复杂度、agent 策略、并发负载和返工原因均未匹配。

更重要的是，该任务当时将 `timing-report.json`、`result.json`、图表和 HTML 放在未跟踪的 `/Users/sunhonghao/.codex/worktrees/2c54/archify/artifacts/issue-175-six-projects-fresh-2026-08-30/`。该 worktree 和 artifact 目录在 2026-09-18 已不存在；目前能复核的是 Codex 任务 transcript，而不是底层 JSON。因此本节应作为二级诊断证据，不能升级为 PR acceptance。

## 8. 字段定义与计算口径

| 字段 | 正确口径 | 常见误读 |
|---|---|---|
| `durationMs` / run envelope | `RunRecorder` 用单调时钟记录从 run start 到最后事件的 elapsed；不是阶段之和。固定提交实现见 [`run-recorder.mjs`](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/archify/orchestration/run-recorder.mjs#L139-L234) | 把它当 CPU 时间或纯模型时间 |
| `stagedMs` | 顶层 stage 的 `durationMs` 求和；recorder 拒绝顶层 stage 重叠 | 把并发子任务阶段相加后当用户等待时间 |
| `agentOverheadMs` | `durationMs - stagedMs`；可包含模型推理、源码阅读、编辑、调度、序列化 | 把它全部归为模型思考或浪费 |
| repair-history `attemptCount` | 每次失败的 validate receipt 持久化一次；最多保留 64 条 | 直接当总验证轮数或 candidate 修改次数 |
| stage `attempts.length` | `RunRecorder` 对同一 stage 下同名 attempt 的开始/结束事件计数 | 与 repair-history attempt 混为一谈 |
| aggregate agent work | 多个真实 agent/run 包络的和；并发重叠仍会被重复计入 | 与 suite wall-clock 比较后宣称用户等待时间改善 |
| suite aggregate active work | PR `report.mjs`/`suite-runner.mjs` 在当时版本中为所有非 shared diagram stage 之和，再把共享 final visual 计一次 | 当作完整 suite wall-clock；它不等于 elapsed，且等待时间分类在当时并不完善 |
| concurrent envelope | 最早开始到最晚结束的观察墙钟，或各并发任务从自己的 start 到共享边界的包络 | 将五个重叠包络相加 |
| `artifact-ready` | 成功执行并核验 deliver 后记录的 milestone，见 [`suite-runner.mjs`](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/archify/orchestration/suite-runner.mjs#L1493-L1497) | 当作已完成浏览器视觉检查和人审 |
| `review-ready` | shared visual-check receipt 已映射并通过完整性核验后记录，见 [`suite-runner.mjs`](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/archify/orchestration/suite-runner.mjs#L1505-L1556) | 当作独立人工 review 已通过 |
| `handoff-ready` | agent 协议中人工复核和报告整理完成后的观察 milestone；PR 固定实现没有给出统一公共计算函数 | 与 `review-ready` 或最终 suite completion 混用 |

`1195611` 的 matched-A/B 协议要求真实 agent receipt 固定 project revision、Archify revision、skill/prompt/config/runtime hash、model 和 reasoning effort，并校验时间戳、stage、artifact hash 与 quality receipt hash。详见[协议的 observed-agent 部分](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/benchmarks/matched-ab/README.md#L119-L147)及 [agentic receipt schema](https://github.com/tt-a1i/archify/blob/1195611f84cf02b78c30278ce71b12c5795b7ea1/benchmarks/matched-ab/schemas/agentic-receipt.schema.json)。现有公开评论没有附这些具体 receipts。

## 9. 可比性判定

| 比较 | 判定 | 原因 |
|---|---|---|
| Issue #175 的 284.759s / 2,637.592s | 可作同批次份额，不能作因果效果 | 同一历史汇总；但缺少逐轮原始数据，且“全部消除”是假设 |
| Issue 的 2,637.592s 与旧 run 2,689.103s | **不可比** | OWNER 明确指出不是 matched A/B，旧 run 还含未提交修复 |
| PR machine ABBA 的 A 与 B | **可比，限机械 pipeline** | 固定候选、配置、质量合同和交错顺序；不包含模型创作/修复 |
| PR 真实 agent A 30:29.998 与 B 38:35.149 | **不可作因果比较** | 多 session 竞争，负载和计时路径不匹配 |
| B 侧五类图的 10/19/5/9/10 | 可作单次运行描述，不能作返工分布 | 只有每类一个 Pi 样本，字段定义和原始 receipts 缺失 |
| A 的 Validation/repair 五类占比 | 可比较同一串行 run 内的阶段大小 | 不能与 B 的自动验证轮数直接配对，也不能自动归因给 canvas |
| 6 项目各类型的成功均值/中位数 | 仅探索性可比 | 不同项目复杂度与 agent 行为未控制，且一个失败样本被排除 |
| `1195611` benchmark 与 PR 当前 `c8fc9f5` | **不可当 exact-head 验收** | OWNER 已明确限定版本；代码和质量门后续变化 |

## 10. 要回答“无限画布是否真的省时”仍缺的原始字段

下一轮 matched 实验至少需要每次 validation attempt 保存这些字段：

- `diagramType`、project revision、Archify revision、model/reasoning、prompt/config/runtime hash；
- attempt 起止时间、候选输入 hash、输出 hash、是否真的发生 candidate mutation；
- 稳定的失败原因枚举，例如 `viewport-containment`、`viewbox-capacity`、`node-overlap`、`edge-crossing`、`label-clearance`、`readability`、`semantic`、`evidence`、`infrastructure`；
- 每个原因在修复前后的诊断 fingerprint、错误数、受影响 subject 和 repair mode；
- `layout/geometry/paint/export` bounds，以及失败究竟来自 authored geometry、viewer shell、导出预算还是浏览器环境；
- artifact-ready、review-ready、handoff-ready 和 suite wall-clock；barrier wait、shared browser、独占 agent work 分栏；
- 相同源码、相同语义合同、相同节点/边/标签数量下，固定画布与新方案的 ABBA/BAAB 配对；
- 最终 9/9、四视口、语义覆盖、视觉盲审和 artifact hash，确保省时不是通过降低质量门得到。

在这些字段齐备前，最稳妥的数据结论是：历史上**明确记录**的 viewport-overflow 后返工占五图 aggregate agent work 约 10.8%；更大的 `Validation/repair` 桶确实存在，但现有公开数据没有证明其中多少由固定画布边界造成。

## 11. 引用任务日志能补充什么

由于 6 项目 fresh run 的原始 artifact 已不存在，本节只能从引用任务保留的 command execution 重建**下限**，不能升级为 PR 验收数据。

在能辨认的 28/30 个 repair histories 中，任务日志记录了：

| 图类型 | 可见 validate 调用 | 非零退出 | 限制 |
|---|---:|---:|---|
| Architecture | 42 | 29 | 缺 DynamicTp Architecture history |
| Workflow | 105 | 84 | 包含 layout-json diagnosis、preflight 和最终确认 |
| Sequence | 62 | 40 | 同上 |
| Dataflow | 86 | 69 | 一段 DynamicTp 工具读取遗漏，部分输出截断 |
| Lifecycle | 62 | 42 | 缺 MaxKB Lifecycle history |
| 合计 | 357 | 264 | 不是与 PR “53 轮”同口径的返工次数 |

这些调用包含诊断、环境重试和 frozen confirmation，不能把 264 次非零退出直接叫作 264 次模型返工。能解析到的失败也不是互斥类别；同一次失败可能同时包含 label、route 和 bounds 问题。不过定性分布很稳定：

- Architecture 主要经历 language、label/route clearance 和 micro-segment；未看到 Pi Architecture 的真实画布问题。
- Workflow 只有少量明确 `workflow/viewbox-capacity`，更多是 route preset、explicit pin、corridor、crossing 和 main-path reflow。
- Sequence 有一次明确的 1440×900 高度溢出 26px，但 participant spacing、segment、label 和 activation 仍需要专用布局。
- Dataflow 至少出现过节点横向越界和 label containment；更多问题是标签障碍、字号和回流 route。
- Lifecycle 没有看到 Pi 样本的明确 viewBox 失败，主要是 label obstacle 和 desktop readability。
- OpenPi Workflow 最终 bounded-stop 是 142px 节点无法容纳约 148px sublabel；即使中间出现过 viewBox capacity，无限画布也无法解决最终文本/节点宽度约束。

所以，任务日志支持“边界问题真实存在”，但不支持“边界问题主导全部返工”。

## 12. 无限画布能否优化耗时

答案是：**能优化一类已知返工，但单独不是 Issue #175 的主解。**

### 12.1 可直接命中的部分

采用“内容自动定界 + 独立二维 camera”后，可以消除或降级：

- `viewer/viewport-overflow`；
- intrinsic 模式下的 `viewbox-capacity`；
- 负坐标或节点、boundary、edge paint 超出旧默认纸面的失败；
- 为了把整图压进首屏而产生的字号、间距和反复扩大/缩小 `viewBox` 调整。

按现有唯一明确归因数据，直接机会最多是 `284.759s / 2,637.592s = 10.80%`。20–30% 目标对应 `527.518–791.278s`，因此即使这 284.759s 全部消失，距离 20% 仍差 242.759s。

### 12.2 无法命中的部分

无限画布不会自动解决：

- 节点或状态重叠；
- edge 穿越无关节点、共享 corridor、错误端口和 route pin 冲突；
- label/mask clearance、文字比节点更宽；
- Workflow mainPath/lane、Sequence 时序、Lifecycle transition 等领域约束；
- 源码语义遗漏、语言门和模型不遵守 bounded repair loop；
- 人工语义审查、报告和多 session 资源竞争。

裸无限画布甚至可能把“密而不可读”变成“更大但仍不可读”。若初始状态仍强制 fit-all 且要求所有文字达到投影字号下限，扩大 world 还会继续触发 desktop-readability 失败。

### 12.3 它还改变了验收合同

Issue #175 原合同要求四个桌面 viewport，并禁止用 clipping、overflow hiding 或 internal scrolling 绕过质量门。采用二维 camera 后，需要产品层面把合同改成：

- 页面 shell 不发生 document overflow；
- 初始 focus 或首个 guided view 可读；
- 所有内容可通过搜索、outline、Fit/Focus 和 guided views 到达；
- Fit-all 可用，但不要求 Fit-all 时所有细节均可读；
- canonical export 仍包含完整内容。

如果不先修改这一验收定义，无限画布只会换一种显示方式，并不会让原先的 first-screen gate 消失。

## 13. 三种方案比较

### A. 自动定界场景 + 二维 camera

保持现有 authored geometry；由实际 `paintBounds` 自动生成有限 canonical frame，viewer 用独立 camera 浏览。

- 直接收益：消除 outer-frame/viewport 类返工，改善超大图阅读。
- 数据上限：目前可解释约 10.8%。
- 成本：中等；可保留 SVG、自包含 HTML、现有 search/focus/routes/story/export。
- 局限：模型仍在猜坐标、route 和 label placement。

### B. 当前 schema 上增加约束式布局/路由 compiler

模型仍可提供语义和少量强约束，但节点尺寸、rank/lane 间距、端口、route family、channel、label anchor 和 intrinsic bounds 由编译器在固定 operation budget 内求解。

- 直接收益：同时命中 bounds、overlap、crossing、corridor、label clearance 和部分 readability 返工。
- 迁移风险：低于全新 semantic schema；可以从现有 Workflow v2 compiler 开始。
- 关键 interface：普通调用者只调用一次 `compileDiagram()`，不学习 `layout → route → validate → repair` 的顺序。

基线 A 的 `Validation/repair` 为 931.341s，占总计约 50.9%。下面只是敏感性情景，不是性能预测：

| compiler 让 Validation/repair 下降 | 节省时间 | 对 A 总时间的降幅 |
|---:|---:|---:|
| 30% | 279.4s | 15.3% |
| 50% | 465.7s | 25.4% |
| 80% | 745.1s | 40.7% |

Workflow、Dataflow、Lifecycle 合计占 A 侧 Validation/repair 的 87.8%，应优先于 Sequence。

### C. 无坐标 Semantic IR + compiler 全权拥有 geometry

新 authoring 不再输出 `pos/row/col/yOffset/via/channelX/channelY/labelAt`，只输出五类图各自的领域语义。compiler 负责 view planning、layout、routing、label、paint bounds 和质量 fixed-point。

- 长期收益最高：从源头删除“模型猜像素—validator 报错—模型再猜”的循环。
- 泛化更好：弱模型只需正确表达语义，不需掌握 Archify 几何细节。
- 成本和迁移风险最高：必须保留 legacy adapter，并逐图建立确定性的布局算法。
- 超大图处理：当 density/aspect ratio 超预算时输出 overview + focused views，而不是只把单图继续拉大。

## 14. 推荐方案：B 先落地，逐步演进到 C；A 作为共同底座

最优解不是“无限画布”与“自动布局”二选一，而是：

> **semantic-first constraint compiler + 内容自适应有限 world + 二维 camera + structured focused views。**

建议的深 module seam：

```ts
function compileDiagram(request: {
  kind: 'architecture' | 'workflow' | 'sequence' | 'dataflow' | 'lifecycle';
  document: unknown;
  qualityProfile: 'standard' | 'showcase';
}): CompileOutcome;
```

一次调用内部完成：

```text
normalize semantics
→ semantic validation
→ focused-view planning
→ kind-specific layout
→ text measurement
→ routing and label placement
→ layout/geometry/paint bounds
→ bounded quality fixed-point
→ immutable SVG/scene + deterministic receipt
```

调用者不选择 layout engine、router 或 bounds 算法，也不接触 solver knobs。五类 kind adapters 是 implementation 内部的真实 seam：

- Architecture：compound boundary、membership、ports、orthogonal routes。
- Workflow：lane、phase/group、mainPath、branch/recovery。
- Sequence：participant order、message temporal order、activation/segment。
- Dataflow：stage order、lineage、feedback channel、classification。
- Lifecycle：lane/band、initial/terminal、cycle/recovery transition。

模型或作者显式给出的 fixed frame/pin 若不可行，compiler 返回 typed conflict；它不能删除语义、缩小到质量下限以下、隐藏 overflow 或擅自修改端点和时间顺序。

## 15. 实施顺序

### P0：先补可归因测量，并完成 PR #208 的 exact-head 验收

- repair receipt 增加稳定原因枚举和 candidate mutation hash。
- 分开记录 suite wall、独占 agent work、barrier wait、shared browser 和报告时间。
- 修复 PR 当前 language gate blocker、refresh `dev`、解决冲突。
- 对最终 HEAD 重新运行固定 Pi revision/model/prompt/runtime/quality 的 matched A/B。

### P1：最小 automatic-bounds/camera 切片

- implicit 模式从实际 `paintBounds` 生成 canonical frame；显式 `meta.viewBox` 保留 fixed-frame 兼容。
- viewer camera 与 authored `viewBox` 解耦；desktop/mobile 使用同一二维模型。
- 重写 first-screen preflight 为“入口可读且全部内容可导航到”。
- 保持 full canonical export，不把偶然 viewport 当默认导出。

这一阶段独立验证 outer-frame repair 是否真的接近历史 10.8% 机会，不预先承诺数字。

### P2：以 Workflow v2 为 compiler 试点

- 原因：已有 compiler 基础、B 侧有 19 个自动验证轮次、A 侧 Validation/repair 为 268.579s。
- 让 compiler 自动处理 node/text size、rank/lane gap、route family、channel 和 label anchor。
- 旧 Workflow 固定布局继续走 legacy path；新语义路径做 matched A/B。

### P3：Lifecycle、Dataflow、Architecture；Sequence 做低风险对照

- Lifecycle/Dataflow repair 时间高，优先迁移。
- Architecture 需要 compound layout，风险较高但收益稳定。
- Sequence 当前 repair 仅 11.666s，先用于验证确定性和语义守恒，不作为性能首攻。

### P4：Semantic vNext 与 structured views

- 新 schema 默认无 pixel geometry；旧 v1/v2 进入 `LegacyGeometryAdapter`。
- 复用现有 `meta.views` 表达显式 focused views，不新增平行 Scene schema。
- 只有基准证明 SVG DOM/paint 成为瓶颈时，再加 culling、LOD 或 Canvas/WebGL adapter。

## 16. 验收标准

每个阶段都必须用 exact-head matched A/B，并同时报告：

1. 首次候选通过率和总 repair rounds；
2. 按稳定 diagnostic code 归类的失败数和返工时间；
3. artifact-ready、review-ready、handoff-ready 与 suite wall-clock；
4. bounded-stop 率；
5. facts、nodes、relations/messages、views 和 source evidence 不回退；
6. 9/9、四视口、light/dark、截图和人工盲审；
7. compiler P50/P95、operation budget、layout digest 与 artifact hash；
8. camera state 不改变 canonical diagnostics、scene hash 或 export bytes；
9. 大图必须有可读入口和完整导航路径，不能以“无限”为由放弃信息架构。

## 17. 设计消融

逐项从推荐方案移除后，结果如下：

- 公共 layout/router/bounds plugin SDK：一个生产 implementation 只是 hypothetical seam；移除后验收仍成立。**永久移除。**
- 新 `meta.canvas` / `meta.camera` 配置树：可由 intrinsic/fixed frame policy 和 session camera 表达。**永久移除。**
- 新 Scene schema：现有 `meta.views` 足够承载显式 focused views。**永久移除。**
- 首版替换 SVG/tldraw/React Flow/Canvas/WebGL：核心返工验收仍能用当前 SVG 达成。**移出 MVP。**
- minimap、history、LOD、culling：不直接命中当前返工原因。**移出 P0/P1。**
- 默认 viewport export：会把偶然 camera 状态变成交付真相。**永久移出 MVP。**
- 公共多阶段 `layout()/route()/repair()`：把顺序和实现细节泄漏给调用者。**合并为 `compileDiagram()`。**
- 五类内部 adapter：删除会破坏 Workflow/Sequence/Lifecycle 的领域不变量。**恢复保留。**
- 四类 bounds：删除会再次混淆布局、paint、viewport 与输出。**恢复保留；viewport 只属于 session。**
- independent export 与 deterministic receipt：删除后无法进行 headless CLI、canonical 输出和 matched A/B。**恢复保留。**
- Legacy adapter：删除后既有 schema/golden 兼容失败。**恢复保留。**

结论：无限画布从“性能主方案”降级为 viewer 能力；真正承担 20–30% 目标的，应是 compiler-owned layout/route/label/bounds，以及可归因的 matched 测量。

## 18. 本次验证记录

- 独立复算了 Issue、PR 阶段表和 6 项目任务汇总中的比例、加总与中位数；关键结果为 overflow `10.80%`、Validation/repair `50.9%`、Workflow + Dataflow + Lifecycle repair `87.8%`，与本文一致。
- 运行 `workflow-compiler`、hard-contract、repair-receipt、semantic-zoom、viewer-camera 和 v1 compatibility 六组相关测试文件：共 130 项，129 通过、0 失败、1 项因未设置 `ARCHIFY_CHROME` 按契约跳过。
- 检查 Markdown 尾随空白和工作区差异；本次只新增研究文档，没有修改运行时代码或质量门。
- 设计消融后再次对照原验收目标：保留下来的最小方案仍覆盖大图导航、完整 canonical export、五类语义约束、旧 schema 兼容、确定性 receipt 和 exact-head matched A/B；被移出的 SDK、Scene schema、渲染引擎替换、minimap/LOD/culling 与 viewport export 均不是达成当前目标的必要条件。
