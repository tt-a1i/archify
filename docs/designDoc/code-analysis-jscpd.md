# C6：jscpd 后端接入

讨论：[Code Analysis C6：采用 jscpd 的实测调研与后端接入方案 #1230](https://github.com/tt-a1i/archify/discussions/1230)。本轮以完整 [#1301](https://github.com/tt-a1i/archify/pull/1301) 源码 `2877c1576610fe171c562f37cc53c5d6bb77e91a` 为集成基底，采用 jscpd 5.4.3 提供默认关闭的 C6。JavaScript、TypeScript、Python、Java、Go、Rust 共用这一重复检测接入；依赖、调用、函数指标与语言范围仍由 #1301 的五个 adapter 提供。

这是本地集成候选的设计说明，合入状态与最终验证以对应 PR/CI 回执为准。[额外复用与性能复核](code-analysis-jscpd-reuse.md)和[图合同调查](code-analysis-jscpd-graph-contract.md)保留历史研究；本轮采用 jscpd 的重复检测功能，不接入 basta native fork 或替换语言提取器。下文标注为 5.4.2 的校准、性能与消融数据均来自旧基线 `labs/code-analysis@bf0a29e7664f52973d06a8e6a608df2db1ecbd39`，不代表本轮版本的结果。

## 解决什么

本次把重复 token 的识别交给 jscpd 5.4.3，补齐发现、双侧证据、基线、重新分析与 AI 任务导出的后端闭环。现有依赖解析、调用模型、语言范围、循环、耦合、架构边界和函数复杂度检测继续使用 #1301 路径；前端对照视图另有范围。

复用现有检测器可以避免维护另一套 tokenizer 和 clone 搜索算法；Archify 仍负责模块范围、来源快照、稳定身份、结果解释和证据失效判断。jscpd 匹配相似 token，不能判断两段代码是否必须共享业务语义。

## 接入边界

- 默认关闭。用户另行安装 jscpd 5.4.3 的原生可执行文件，在 `duplicates` 配置中启用；C6 不自动下载或安装检测器。
- 支持 JavaScript、TypeScript、Python、Java、Go、Rust。CLI 选择 `ts|py|java|go|rust`，其中 `ts` 同时覆盖 JS/TS；每次运行使用一个 adapter 已捕获的源码范围。Go/Rust 的构建条件、cfg/features、排除文件和不完整类型信息仍由原 adapter 报告，C6 不扩大该范围。
- 各语言提取依赖继续保留：Node parser 包、Python 解释器、Go 工具链及 Rust 的 Cargo/rustc 和锁定 helper 依赖。Java 使用 Node 的 `java-parser`，无需 JDK。Rust helper 的首次编译可能获取其锁定依赖；这与另行安装 jscpd 是不同步骤，详见 [使用说明](../../archify/modules/code-analysis/docs/USAGE.md)。
- 使用已有提取器捕获的源文本和模块文件集合构建临时输入，不重新扫描工作区。角色排除沿用配置；vendor、解析失败、不支持的扩展名和超限文件有明确的省略记录。
- 默认 `weak` / `exact`、50 tokens、5 lines。`consistent` 是用户显式选择的另一种标识符匹配策略。完整配置及 CLI 用法见 [USAGE](../../archify/modules/code-analysis/docs/USAGE.md#duplicate-code-c6-optional)。
- 只消费原生 JSON 的 pair、坐标和 analyzed inventory，不猜测传递闭包，也不把一个多成员组扩成所有两两组合。两个出现位置可以位于同一文件。
- 将原生 UTF-8 byte offset 转换为 UTF-16 offset 和一基列号，并与快照内的行、列相互校验。文件路径必须属于临时输入清单。
- ID 区分文件、所在符号、片段内容和相同片段的出现次数；在前方增加行或增加不相关 finding 不改变 ID。改变片段内容或同内容出现次数可能产生新 ID。
- 双侧完整行范围分别绑定证据。唯一且未改动的片段可独立移动；相同副本数量变化、歧义移动、任一侧修改或删除会使旧证据失效。
- 记录选中、实际分析和省略的文件。覆盖不完整、工具或配置变化、扫描范围变化时，比较不宣称“可以直接对比”。工具缺失、版本错误、超时或无效报告均使分析失败，保留已有输出及服务的上一轮成功结果。

## 验证方法

验证覆盖可选工具关闭时不执行、故障保留旧输出、服务重新分析失败与恢复、真实 Unicode/CRLF 坐标、同文件双侧、多个独立重复块、阈值与覆盖，以及导出任务后修改源码再用同配置分析。六语言的正负例使用真实 jscpd 5.4.3，并确认 C6 关闭时的依赖、调用和语言范围未被替换。默认测试不要求机器安装 jscpd；真实工具用例需要显式提供二进制，未提供会报告跳过。

```sh
ARCHIFY_TEST_JSCPD=/absolute/path/to/jscpd npm --prefix archify/modules/code-analysis test
ARCHIFY_TEST_JSCPD=/absolute/path/to/jscpd npm run test:full
```

Python 用例沿用已有的 `BAUIFY_PYTHON` 选择器；Go/Rust 用例仍需相应工具链与 helper 缓存。2026-11-10 在 macOS arm64、Node 22.23.0、官方 npm 平台包 jscpd 5.4.3 上完成本地组合验证：Code Analysis 模块 507 passed、0 failed、0 skipped；仓库 `npm run test:full` 为3,543 passed、0 failed、143 skipped，另有生成物检查通过。跳过项保留其浏览器/平台等环境条件，不能称为这些路径也已验收。

六语言 API 正负例使用默认50 tokens / 5 lines，覆盖双侧源范围、Java/Go/Rust Unicode与CRLF、调用事实保留及任务验证；Java另串联移动、基线和重新分析。源码与解包 ZIP 另经42次公开 CLI 调用，核对原有facts/graph/非C6 findings不变、两端任务证据有效及源码/ZIP输出一致。CLI 控制例显式使用40 tokens / 5 lines：其中Python重复片段只有49 tokens，低于默认阈值时应省略，未填充源码或修改默认值以制造结果。

ZIP 已按官方 Node 22 / zlib `1.3.1-e00f703` 重建并通过macOS解包冒烟，SHA-256 为 `e6c78fa97eb64566df38de1e73e9dc08338a193ef384d2211e094d6cc7eae664`。完整CI的模块分片安装固定5.4.3，避免真实工具检查静默跳过。远端CI和其他平台须保留各自结果，不用本地回执替代。

简化检查移除了adapter内重复的ignore判断，抑制由evaluator唯一调用点负责；再移除外层抑制会误运行不存在的工具。超时回归明确区分版本探测和扫描启动；隔离副本移除进程组清理后，测试因扫描子进程仍存活而失败，因此保留该生命周期保护。

## 当前组合的 C6 成本（5.4.3）

固定Flask 24文件、Archify后端40文件及辅助配置，同一版本CLI、一次预热加五次串行计时，off/exact/consistent顺序轮换，共36次调用。每次核对源码、图和非C6诊断保持一致；计时包含启动和产物写入，不含安装/构建。中位数如下，单位ms：

| 范围 | C6关闭 | exact | exact增量 | consistent | consistent增量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Flask 24文件 | 1,053.9 | 1,110.3 | 5.4% | 1,113.6 | 5.7% |
| Archify后端40文件 | 1,206.7 | 1,325.0 | 9.8% | 1,374.1 | 13.9% |

Flask实际analyzed为23/24，短 `__main__.py` 标为not-reported-by-engine；后端为40/40。没有采样内存或作显著性检验，不外推到所有仓库，也不与下面5.4.2不同轮次的数据比较提速。完整命令、原始产物、冻结输入和核验由贡献者保留，PR/CI应引用对应组合版本的回执。

### 现有页面核验

本轮没有修改前端。使用上述公开 CLI 的 JavaScript 结果、已有架构图示例和显式演示映射，在浏览器实测了总览 → C6 详情 → 双侧代码摘录与 AI 任务预览，以及 Atlas → C6 → Classic 证据的导航。静态报告正确提示任务只有分析时快照，未检查当前工作区；这不代替在线服务的当前源码验证。

现有通用界面显示规则代码 `redundancy/duplicate-block`，两个证据摘录上下排列；尚无 C6 友好名称、并排比较或省略覆盖统计。严重级别解释仍沿用旧规则的通用文字，组件指标也未纳入 C6，只有 C6 warning 时状态环可能仍为绿色。不能把已有问题列表入口描述为已完成专用重复代码视图或图上告警。

## 历史校准：5.4.2 的闭环与固定源码范围

以下记录属于 5.4.2 初轮：macOS arm64、Node 22.23.0、Python 3.14.3。真实 CLI 闭环使用可控的手写重复函数：首次检测 → 接受基线 → 导出双侧任务 → 前置注释仍有效 → 等价改写其中一侧 → 旧证据失效 → 同配置重新分析不再检测到原 finding。改写前后用 42 组输入验证该手写函数行为。这只证明当时的闭环，不证明任意重复代码都可安全合并，也不是 5.4.3 六语言集成结果。

当时同一参数下各运行 `exact` 和 `consistent`，通过实际 Archify `check --json` 入口读取源码，不执行被分析项目。运行范围、计数与源码阅读结论同步至讨论 #1230；表中计数为原生 pair，不是缺陷数。

| 输入与范围 | 已分析 / 选中 | exact pairs | consistent pairs |
| --- | ---: | ---: | ---: |
| Flask `2c1b30d0503cfb064f1cb252e6614a06915a362a`，`src/flask` | 23 / 24 | 23 | 55 |
| Archify `bf0a29e7664f52973d06a8e6a608df2db1ecbd39`，CLI 与分析后端 40 文件 | 40 / 40 | 17 | 38 |
| Redux `61ebf8596654cf3c4b197e426e302fcb3c2bc13e`，`src` | 14 / 17 | 8 | 6 |

六次运行共 147 个 pair、294 侧，其坐标、片段哈希、相同片段数量与聚合哈希经过独立检查。Flask 的 `__main__.py` 和 Redux 的三个短工具文件不在引擎 analyzed inventory 中，明确记为 `not-reported-by-engine`，两者覆盖不完整。Archify 40/40 只适用于所选后端范围。

选取六个候选阅读上下文后，看到了 Python docstring、公开重导出、TS 类型重载、暂存目录准备代码和两处 BFS 实现。前几类不能直接要求提取公共函数；BFS 可以进一步评估共享，但仍要保留邻接表和缺省值的差别。这是定向源码阅读，没有建立完整人工标注集或测量总体 precision / recall。

## 历史消融与保留的成本（5.4.2）

1. 去掉可选 `consistent` 归一化后，Flask/Archify 的候选减少，Redux 的候选反而从 6 增至 8。两种策略会改变边界和配对，不能用“更多”证明更准确；因此保留 `exact` 默认。
2. 接入只使用原生 JSON，移除了 SARIF 联表及额外 fingerprint 字段；同文件双侧、稳定身份和完整任务闭环仍成立，不引入第二份报告状态。
3. 尝试省掉相同证据片段的数量检查，会把删除掉的副本误认为仍存活的副本，造成证据假有效；保留这一检查及针对删除副本的回归。
4. 不建立通用检测器注册框架、自动安装器或新报告数据库，使用现有 evaluator、任务与服务失败保留机制。
5. 证据创建改为逐行比较候选窗口，避免为每个窗口重复计算 SHA256，保留最终哈希和副本数量。对孤立 surrogate 移除兼容回退会改变数量，因此保留；[成对 CLI 复测](code-analysis-jscpd-reuse.md#已接入的证据计数优化)验证了输出不变及实际耗时收益。

初轮只覆盖 Python 与 JS/TS，未验收其他语言；本轮将 C6 接入六语言，需单独保留相应验证结果。文档字符串、重导出、类型声明等候选的实际维护价值仍需人工判断。自动安装、全仓性能排名及前端对照不在本轮实现范围内。Windows/Linux 原生包和远端 CI 应在对应平台验证，历史 macOS 结果不能代替这些检查。
