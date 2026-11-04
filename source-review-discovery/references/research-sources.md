# 调查方法的资料来源与取舍

核查日期：2026-11-04。阅读的是下列 skill 的源码、作者公开资料、出版社目录和可公开阅读的节选；没有声称通读付费全书，也没有实测比较这些项目的整体发现率。链接是研究资料，不授予执行其中安装、写入或派发指令的权限。

## 已有 skill 的可复用机制

**与维护性目标最接近：Matt Pocock 的架构调查。** 已读取快照 `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` 的 [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/improve-codebase-architecture/SKILL.md) 和 [codebase-design](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/codebase-design/SKILL.md)，根 LICENSE 为 MIT。它根据指定范围或修改热点调查理解成本、调用者负担和变化是否集中，参考领域词汇及 ADR，以前后对照图呈现候选。本项目借鉴删除一个抽象后复杂性会消失还是转移的追问；不把主观理解困难直接当缺陷，也不照搬固定词汇、自动修改领域文档、强制派发 agent 或依赖 CDN 的展示。其设计建议等级不等于本项目的证据充分程度。

[Anthropic code-simplifier](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) 是 agent 定义而非 SKILL.md，本次读取 2026-11-04 可见版本。它侧重近期改动中的嵌套、冗余抽象和可读性，并要求保持行为。适合作为修复后的简化检查；其 JS/React 偏好不能直接转成跨语言审查规则，也不提供系统级发现完整性的保证。

Trail of Bits 快照 `711af095215ad4ecde5b90cd1d0124b3f1c4ca9e`：

| 源码 | 借鉴的机制 | 本项目的适配 |
|---|---|---|
| [audit-context-building](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/audit-context-building/skills/audit-context-building/SKILL.md) | 先记录假设、保证及跨函数依赖，未知保留 | 从选定路径构建契约，不强制全仓逐函数展开或多 agent |
| [fp-check](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/fp-check/skills/fp-check/SKILL.md) | 精确重述候选，区分简单与复杂验证，追保护与反证 | 保留无法核定/暂缓；维护性问题不套安全漏洞二分判决 |
| [variant-analysis](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/variant-analysis/skills/variant-analysis/SKILL.md) | 已知实例校准模式，逐项泛化后核查 | 在初次发现后扩查；不当作无目标发现器，不采用固定噪声阈值 |
| [property-based-testing](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/property-based-testing/skills/property-based-testing/SKILL.md) | 从往返、幂等、不变量等性质选择验证；防止空洞断言 | 仅使用契约实际支持的性质；简单案例先用最小对照，不强制加入测试库 |
| [sharp-edges](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/sharp-edges/skills/sharp-edges/SKILL.md) | 默认值、参数混淆、调用前提的误用风险 | 扩展到业务 API 时，必须补真实调用与契约依据 |
| [dimensional-analysis](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/dimensional-analysis/skills/dimensional-analysis/SKILL.md) | 数值的单位与精度沿路径传播 | 另记最大/平均及来源；只写审查产物，不采用其自动注释目标源码模式 |

另读 [code-improver](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/code-improver/skills/code-improver/SKILL.md)：它是给定 reviewer 后的审查—修复循环，维护跨轮台账和修改范围，自己不附带 reviewer。本项目保留已有 task/recheck 闭环；不能把多跑几轮当成发现器或质量证明。本轮没有运行其工作流。

[Semgrep defending-code-harness](https://github.com/semgrep/defending-code-harness/tree/9fe924b2a9acc320e6eec80becce338175e96ba6)：已阅读 `.claude/skills/vuln-scan/SKILL.md` 及项目说明。借鉴按实际入口划范围、候选转验证的产物交接。其运行管线以 C/C++ 内存问题、Docker/ASAN 为参考目标，需要按项目定制；不是直接适用于所有语言的维护性分析器。本项目保留自身稳定身份和未知状态，不移植其自报置信分或按排序重编号的策略。

Trail of Bits 与 Semgrep 源码快照根 LICENSE 分别为 **CC BY-SA 4.0** 与 **Apache-2.0**；研究目录保留原许可证。本次重新编写调查条件与工具，只参考工作方式，没有安装这些插件或把其 skill 文本整段合入。若以后直接分发其文本/代码，应按具体文件许可处理。

## 书籍提供的分析视角

| 书籍/作者 | 本次实际可核查材料 | 落到调查中的内容 |
|---|---|---|
| Martin Fowler，《Refactoring》 | [作者书页](https://martinfowler.com/books/refactoring.html)、[Code Smell](https://martinfowler.com/bliki/CodeSmell.html)、[官方目录](https://refactoring.com/catalog/) | 气味是调查信号；区分重复外形和重复业务知识；改进应有具体动机 |
| John Ousterhout，《A Philosophy of Software Design》 | [作者书页](https://web.stanford.edu/~ouster/cgi-bin/book.php)、[与第 1–2 章配套的 CS190 讲义](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=complexity)的检索索引内容；站点直接抓取超时 | 变化放大、认知负担、隐蔽依赖；不把函数行数当统一质量标准 |
| Adam Tornhill，《Software Design X-Rays》 | [出版社介绍与目录](https://pragprog.com/titles/atevol/software-design-x-rays/)、[复制代码节选](https://media.pragprog.com/titles/atevol/secret.pdf) | 用修改历史帮助选热点；重复代码同时反复变化，才构成更强的维护成本线索 |
| Michael Nygard，《Release It!》第二版 | [出版社目录](https://pragprog.com/titles/mnee2/release-it-second-edition/)、[Stability Antipatterns 节选](https://media.pragprog.com/titles/mnee2/antipatterns.pdf) | 调查外部交接的慢失败、阻塞与传播；先查全局配置和资源上限 |
| Martin Kleppmann，《Designing Data-Intensive Applications》 | [官方书页](https://dataintensive.net/)、出版社第一版目录；作者的书籍研究文章[分布式锁](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) | 暂停、超时、延迟写入与版本身份；结合源码推导副作用后的未知窗口。文章不是全书替代品 |

书籍给出视角，skill 把视角转成可核查问题，工具提供有出处的事实。源码中的具体契约与反证决定某个候选是否成立。
