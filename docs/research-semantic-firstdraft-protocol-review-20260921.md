# 下一轮源码理解与首稿实验：协议评审（2026-09-21）

状态：这是冻结前的协议建议，不是执行收据。实际冻结版本见
[benchmark README](../benchmarks/semantic-firstdraft-20260921/README.md)
及其中的 `tasks.json`。执行时 lilconfig 已核实为 `antonk52/lilconfig`；
条件名为 B/C；截图沿用原有 visual-check 的 1440×900 与 2048×1320
浅色/深色组合，1920×1080 由正常浏览器测量覆盖。以下建议不覆盖冻结版本。

## 受检候选与边界

本轮只评估一项整体干预：**紧凑 JS author-kit**。作者仍照常阅读 `SKILL.md`、`repository-authoring`、`authoring-defaults`、任务源码和用户任务卡；author-kit 用约 75 行 API/schema 格式指南替换首次读取的大型示例和完整 shape 定义。

它保留作者显式写出的 `[x,y,w,h]`、全部标签、关系和来源证据，不推断语义、不做源码导航/摘要、不自动布局、不加入 route。它是组合的 authoring-input 路径，因此结果不能归因为单独的 token 缩减、格式缩短或任一局部说明。此前定向 TypeScript 导航没有形成同质量速度证据，故不作为本轮候选或前置条件；此前低质量/未交付基线也不能构成反事实速度比较。参见 [源码工具实验](research-source-layout-experiment-20260921.md) 与 [语义修复实验](research-semantic-repair-experiment-20260921.md)。

## 任务冻结和作者可见要求

协调者在作者启动前一次性固定三个此前未作为计时作者任务的公开仓库、远端 URL、完整 commit SHA、tree hash、许可证、文件清单、任务范围和 Archify package SHA。建议 shortlist（**尚未 pin**）如下：

| 仓库 | 中等任务范围 | 作者可见的普通问题 |
| --- | --- | --- |
| `sindresorhus/p-retry` | retry、failed-attempt、AbortSignal 与耗尽结果闭包 | 请求如何重试、何时停止/取消、成功与耗尽如何返回、调用者与外部执行边界。 |
| `sindresorhus/quick-lru` | get/set、maxSize 双缓存轮换、eviction callback | 状态由谁持有、命中/写入/淘汰如何流动、回调与 API 边界。 |
| `antonk52/lilconfig` | search/load、loader 选择、错误与文件系统交互 | 配置如何发现和加载、优先级/错误分支、委托关系和文件 I/O 边界。 |

每个任务都须有**作者可见任务卡**，逐条列出所需责任、条件、错误/取消/终态、方向、边界和要求来源支持的节点。相同条目组成评审 rubric；评审版只能加核验位置，不能增加隐藏 gold detail。额外主张若与源码冲突仍失败。卡片不设节点、关系、文件、来源或图面积上限。两位非作者在启动前从冻结源码复核任务卡；任何分歧均在启动前写入版本，之后发现漏项只记为协议缺陷，不事后收紧要求或替换运行。

## 注册筛选运行

三个任务各运行普通基线 `B` 和 author-kit 候选 `K` 一次，共六次，串行且采用预先登记的平衡交替顺序。全部为 Terra/medium、新上下文、同一 packaged Skill/schema、同一工具权限、600 秒总上限和最多 3 次原地修复。除 author-kit 取代首次大示例/shape 读取外，提示、源码、任务卡、读写范围、质量 profile、工具与时间限制完全相同。

观察器从原生 `task_started` 记录到完成/超时，保存候选字节版本、首次结构完整 JSON、每次 finalize、退出码、产物 hash、公开工具类别及时间戳。失败、取消、网关/配额事件、未触发 author-kit 和未合格候选都保留在 ledger；不重跑、不按结果补样本。不得记录 reasoning、原始工具参数/输出或把未观测的 HTTP 重试/排队写成模型耗时。

## 时间口径与质量门槛

| 指标 | 定义与用途 |
| --- | --- |
| `T_author` | 原生 `task_started` 到作者完成；描述作者路径，含读源、写作、修复和收尾。 |
| `T_first-structural` | 到首个结构完整 JSON；只作诊断，不能当作成功。 |
| `T_first-qualified` | 到第一个后来证明通过全部机器、语义和视觉门槛的冻结候选；不存在则为 `null`。 |
| `T_basic-kit` | author-kit 文件读取/解析本体；只作机制诊断，不能单独声称提速。 |
| `T_full` | 从条件专属准备开始到作者完成的全墙钟；唯一比较口径。`K` 包含 kit 读取，`B` 包含相同公共准备。 |

clone、任务卡审计、独立评审、截图和协调单列为 round overhead；若以后测试缓存，冷态 `T_full` 是主结果，热态只能另报。任何失败基线的速度为 `null`，不能与候选构造“如果它合格会多快”的差值；如要扩展，需先取得新的合格证据。

机器门槛保持 source-backed showcase `finalize` 全链路成功（validate、deliver、strict source/check、真实 browser check，零 composition error/warning）。两名独立、盲条件/时间/工具的审阅者分别检查：

1. 语义：任务卡每项均有源码支持的责任、条件、方向、所有者和边界；有效来源范围和“范围支持该主张”分开核验。
2. 视觉：固定 1440×900 与 1920×1080 浅色视图中无裁切、重叠、标签遮挡、误导边界、无关节点穿越或不可读正文；6px 以下是硬失败。允许产品正常的**纵向 reader-page 滚动**，它本身不构成裁切或失败。

首稿和最终稿分别判定。机器和两位评审均通过，才是 qualified；评审分歧或视觉 unavailable 不进速度分母。不得通过删关系/标签/来源、篡改事实、缩到临界字号或添加未授权几何控制来修复质量。

## 选择与确认阈值

这是注册的筛选，不是因果证明或默认流程推广。只有同时满足下列条件，author-kit 才进入确认：

- 三个 `K` 全部 qualified；
- 至少两对 `B/K` 都 fully qualified；
- 在 fully qualified 对中，`T_full` 的配对中位数节省 **≥15% 且 ≥20 秒**；
- 没有一对 qualified `K` 比其 qualified `B` 慢 **>10%**。

未满足任一条即维持基线，报告每个任务的质量和时间观察，不计算失败对的反事实速度，也不以工具本体毫秒数、token、短 JSON 或单项成功宣称收益。

达到筛选阈值后，才在每个原始任务上各做一对预注册确认运行（共 6 次），仍为同一冻结源码和任务卡，并把每对的条件顺序与筛选期反转。确认期独立报告；若质量或阈值不复现，不推广 author-kit。所有最终材料应提供 manifest、任务卡/rubric SHA、条件 diff、候选/成品 hash、finalize/browser receipts、观察 ledger、盲评原件、截图和解盲映射，分别报告机制触发、机器、语义、视觉、`T_author`、`T_first-qualified`、`T_full` 及未知 provider/network 字段。
