# jscpd 图复用：原生合同实现与迁移边界

## 当前产品接入范围

本轮在完整 [#1301](https://github.com/tt-a1i/archify/pull/1301)（`2877c1576610fe171c562f37cc53c5d6bb77e91a`）上整合 [C6 重复检测](code-analysis-jscpd.md)：另行安装 jscpd 5.4.3，默认关闭，覆盖 JS、TS、Python、Java、Go、Rust。五个语言 adapter 的依赖解析、调用、函数事实和语言范围继续保留；jscpd 的六语言 token 检测能力不等于 basta 提供了六语言的同等图/调用契约。

本文的本地 native fork 与图桥接均为独立研究，不作为本轮产品依赖或 collector 替换交付。当前组合的测试、平台与分发包结果应记录在对应 PR/CI 回执中；下列实验计数和性能数据保留其原版本、源码与范围。

## 独立实验记录（2026-11-10）：两个本地原生改动

该轮研究冻结 jscpd `master@b82d84186389590fed0813d005391f3b8147dcfa`（5.4.3 / basta 0.3.3），Archify 消费者基于 `labs/code-analysis@bf0a29e7664f52973d06a8e6a608df2db1ecbd39` 的历史 C6 候选。未改版另建基线，旧实验保留；这不是 #1301 六语言 C6 的集成验证。

| 任务 | 本地实现 | 已减少的职责 |
| --- | --- | --- |
| 公开已解析目标边 | `Graph::resolved_imports()` 借用每条 Import 及原生解析得到的 `Option<ModuleId>`，保留 None 和 glob 展开目标。 | 新桥接直接取目标，不再重建 ModuleIndex、装配 alias/import roots 或再次调用 resolver/glob resolver。 |
| 保留来源和执行语义 | Import 新增 `origin`、`statement`、`statement_type_only`、`lazy`、`conditional`；JS/Python AST 收集时填写，glob 展开时保留。 | 消费者按来源过滤提示边、合并同一次导入的绑定，并读取类型、条件和延迟标记，不再从外围猜测。 |

`origin` 区分 Declaration、ReExport、Require、DynamicImport、PathHint、ResolveHint、Glob、Component；原有 `kind` 仍表示绑定形式。basta 的死代码可达性可以继续保守地沿提示边遍历，源码依赖消费者单独过滤 PathHint/ResolveHint，保留真正的 side-effect import。

`statement` 使用 UTF-8 字节位置，区分同一行不同语句。声明/re-export 按 statement offset 合并绑定，require/dynamic/glob 按 start offset 区分加载事件；同一语句两次调用不会被合并。整句 `statement_type_only` 与绑定 `type_only` 分开，支持 `verbatimModuleSyntax` 的擦除差异。

JS 保留真实 import/re-export、require、require.resolve、dynamic import、glob 和执行上下文。Python 补充标准 importlib.import_module / __import__、别名、遮蔽及重绑定保护；计算式和不能确认的 loader 目标保持 opaque。函数体、默认参数、decorator、类体、TYPE_CHECKING 和分支按各语言语义处理。标记描述静态上下文，不能证明运行时导入安全。

### 消费者验收与简化

在最新未改版和候选上运行相同的 16 组输入，仅替换现有事实中的 imports 和相应 unresolved 占位计数，调用真实 `buildGraph` / `evaluateGraph`，并检查 schema/引用不变量。最终候选 133/133 项检查通过，完成 16 次桥接、16 次现有提取及 96 对真实图构建/评估；配对静态核验另有 58/58 项通过。检查数不等于独立样例数。

最新基线重新复现下文五项偏差：普通路径字符串假环、显式扩展名 TS 类型假环、Python/JS 延迟环误升级、Python 动态导入漏环。候选符合固定源码预期，真实 side-effect 环和具名导入对照保留。新增八组覆盖同一行不同语句、glob 目标、resolve hint/未解析、Python 上下文、两种 verbatimModuleSyntax 设置和同语句多次 JS/Python 加载。TS 擦除预期用真实 TypeScript 5.9.3 编译核对，未执行生成代码，也未用结果回填原生事实。

glob 原始模板与实际展开目标分别保留。有展开目标的模板不重复计 unknown；未匹配模板仍显示为未解析 pattern。原生本来就有展开目标，旧公开重解桥接无法取到；相对 Archify 现有提取器，这是扩展能力。

新桥接已省去重复索引、alias 和目标解析；JS 也移除动态上下文 join map 与模板文本重解析，直接使用 AST。消费者实际移除来源过滤、事件聚合、字节身份和执行标记后，分别重现假环、重复计数、不同语句丢失及延迟环误升级，因此保留必要适配。隔离副本移除 Python 跨作用域写保护后，负例产生一条不应存在的 loader 边；该删除未进入候选。

### 成本与检查范围

同一原生 runner、锁定源码/配置，一次预热加五次交替测量；计时只包围 analyze::run，排除输出序列化和清单核验。RSS 为 macOS 单个原生进程最大驻留集。中位数如下：

| 输入 | 原生分析 ms，前 → 后 | 最大 RSS MiB，前 → 后 |
| --- | ---: | ---: |
| Flask，24 个 Python 文件 | 11.132 → 10.908 | 13.125 → 13.203 |
| Archify 后端，40 个 MJS 文件 | 20.435 → 20.696 | 22.484 → 22.391 |

两组观察基本持平，未作显著性或大仓库推断。新语义使 imports 分别从 370→372、448→444，不能当作等量工作的提速比较，也不能凭条数判断准确率。

最新未改 basta crate 为 333 项通过；单独 iterator 补丁为 335 项通过；完整候选 crate 为 358 项通过。完整 Rust workspace 的 release/locked 测试为 2,250 passed、0 failed、16 ignored；workspace 全目标 clippy `-D warnings` 和 `cargo fmt --all --check` 通过。这是 jscpd Rust 工作区检查，不能改称 Archify 全仓测试。

### 整体迁移仍需补齐

- TS import-equals 等语法、继承 tsconfig 和项目选项、glob 的 bundler eager 策略。
- 原生 None 的 external/outside/unknown 分类；当前适配使用显式占位计数。
- source/config 快照与文件清单来自同一分析上下文，Python 包初始化隐式边的口径一致。
- 框架与真实项目覆盖；references 是名字读取，不能称为精确调用图。

该实验完成的是原生库补丁和独立桥接，尚未发布上游 API，也未整体替换 Archify 产品 collector。函数、符号、文件角色仍由实验中的现有提取器提供。模块归属、配置语义、循环/hub/入口/边界规则、ID、证据和 task 是独立职责。只迁移 imports 不能删除 TypeScript 依赖及函数 pass。新增字段影响外部 Rust Import 字面量；basta 为 publish=false 工作区 crate，补丁不宣称已发布稳定 API 兼容。

当时的本地候选分为 `01-resolved-imports.patch`、`02-import-provenance.patch`；在干净 b82d841 基线上依次应用后，五个改动文件与候选逐字节一致。实验回执、原始输出、消费结果、消融与成本记录由贡献者独立保留；共享复查须提供对应的固定源码、命令和回执，本机实验目录不是仓库内已交付的证据入口。该研究由 Codex 与 GPT-6.1-Sol（max）子代理完成，不代表维护者接受或人工评审结论。

上游未改基线：[Graph](https://github.com/kucherenko/jscpd/blob/b82d84186389590fed0813d005391f3b8147dcfa/rust/crates/basta/src/graph.rs)、[Import](https://github.com/kucherenko/jscpd/blob/b82d84186389590fed0813d005391f3b8147dcfa/rust/crates/basta/src/model.rs)、[JS](https://github.com/kucherenko/jscpd/blob/b82d84186389590fed0813d005391f3b8147dcfa/rust/crates/basta/src/lang/javascript.rs)、[Python](https://github.com/kucherenko/jscpd/blob/b82d84186389590fed0813d005391f3b8147dcfa/rust/crates/basta/src/lang/python.rs)。本地新增接口以补丁为准。

## 初始调查记录：jscpd 5.4.2

以下至文末保留初始调查及当时的建议，版本为 `db415b5d7cc34d72a324fe5eae2147646dc3558b`，消费者是基于 Labs `bf0a29e7664f52973d06a8e6a608df2db1ecbd39` 的本地 C6 候选。结论来自固定源码和隔离实验，不代表其他版本、#1301 或整体准确率排名。8 组输入条件实际运行了 8 次桥接、8 次现有提取、40 次现有建图和规则评估；2026-11-10 复核了 168 项输入散列，相关源码与保存的实验输入未变。

## 实际要替换哪一层

| 层次 | 初轮 Archify 实现（Labs 基线） | 当时评估的 basta 迁移边界 |
| --- | --- | --- |
| 语言语法与基础解析 | JS/TS 使用 TypeScript Compiler API；Python 使用标准库 AST | 当前已经在复用成熟 parser。basta 使用 OXC/Ruff，换工具不能直接算作删除自研 parser。 |
| 导入事实提取 | 语句种类、目标、名称、运行时/类型/延迟/条件标记、未解析计数 | 可以迁移的主要层，但原生投影必须保留这些语义。 |
| 文件归属与模块图 | package/depth/groups、角色排除、模块边聚合 | 继续承担产品配置语义。basta 的 Module 是一个文件。 |
| 检测与闭环 | 循环、hub、入口、架构边界、ID、证据、review/task | 成熟事实源仍可供这些消费者使用；更换事实源不要求更换产品规则。 |
| 新增信息 | 初轮 JS/TS symbols/calls 为空；Python symbols 是顶层首次绑定 | basta 可以补充符号、引用和 unused 信号；references 是名字读取，不是精确调用图。 |

JS/TS 的导入和函数复杂度共用现有 AST。只迁移 imports，仍不能删除 TypeScript 依赖和函数分析 pass。Python 也仍需函数指标与动态 loader 语义。完整 #1301 已提供多语言 bounded call model 和语言范围，不能沿用初轮“calls 为空”的状态判断替换成本。是否减少维护应按最终能删除的职责判断。

## 已执行的消费者反例与正常对照

实验保留现有源码快照、functions、symbols 和文件角色，只把 imports 换成公开桥接记录的朴素转换，再调用真实 `buildGraph`、`evaluateGraph` 与循环规则。目标使用公开 resolver 复算。这里验证的是拟议适配器对现有消费者的影响，未修改产品或上游。

| 两文件样例 | 按源码语义的预期 / 现有提取 | 朴素转换后 |
| --- | --- | --- |
| main 只导出字符串 `'./b.js'`；b 真正 import main | 无导入环 | 出现模块级循环 warning：字符串被当成 main→b 导入。 |
| TS `import type { B } from './b'`；b 反向静态导入 | 无运行时环 | 正确，无运行时环。保留这一正常对照。 |
| 同一类型导入改用 `'./b.js'`，实际文件仍为 b.ts | 无运行时环，双方均能解析目标 | 额外非 type-only 保活关系形成假运行时环。触发条件包含显式源码扩展名。 |
| Python 函数内 import b，b 反向 import main | 延迟循环 info | 丢失 lazy 后成为模块级循环 warning。 |
| JS 函数内 `import('./b.js')`，b 反向 import main | 延迟循环 info | 字面量 dynamic 被投影为 namespace，转换后成为 warning。 |
| Python 模块级 `importlib.import_module('b')`，b 反向 import main | 模块级循环 warning | 缺 main→b，漏报循环。 |
| 两侧真实 bare side-effect import | 模块级循环 warning | 能发现循环；用于保护过滤策略。 |
| 一句导入两个名字，另一文件反向导入 | 同一循环，2 条语句边 | 循环仍在，totalImports 变为 5；模块 fanIn/fanOut 仍为 1。 |

warning 表示当前规则识别到模块级环，不能证明程序一定初始化失败；延迟循环 info 也不能证明安全。模块结构图和架构边界可以有意保留类型依赖，表中判断针对文件级运行时循环。

两项简化已实际尝试：

1. 按文件、行、目标去重，能修正多绑定造成的数量变化，不能去掉普通字符串形成的假边，也不能恢复执行语义或缺失边。模块 fanIn/fanOut 原本按不同邻接模块计数，不会仅因同一对模块有重复记录就增大。
2. 删除全部 SideEffect，可以去掉部分保活边，但同时删掉真实 `import './polyfill.js'`，使正常对照中的环消失。因此不能将它作为通用适配。

根因发生在原生事实投影：普通源码路径字符串、某些 require、require.resolve 和真实 side-effect 进入相同类别；ImportKind 表示绑定形式，而 static/dynamic/require/export 表示语句行为。字段改名无法完整恢复已合并的来源。basta 的保守策略用于避免死代码误删，有其自身用途。

## 哪些问题可以薄适配解决

- 文件路径、ID、名称及位置可以转换；按语句聚合最好有 statement identity，单按行不能区分分号隔开的语句。
- 私有 `import_targets` 不会阻止采用：普通目标已能通过公开 resolver 复算。公开只读 `(import, target)` iterator 可进一步删除桥接中重复的索引/别名装配。glob 展开目标尚未验证等价。
- sourceText 可沿用 Archify 已捕获的快照，再交给公开 `AnalyzeInput.source`。解析配置、文件清单必须来自同一上下文。
- 当前 import schema 和任务只要求引用行，不要求导入末行。完整末位置不应列为当前替换的硬阻碍；多行语句仍需保留原语句起始行。
- Python 包初始化边可根据已解析目标和文件清单补充，现有策略约 20 行，不需要再实现 parser。缺失叶模块时的初始化边口径仍待确认。

Python 顶层绑定还有独立迁移机会：以 TOP_LEVEL 过滤原生符号，再映射到 file/name/kind/line，已有冻结样例从 26 条筛成 25 条，与现有 25 条首绑定一一相同。但无赋值的 `x: T` 在两边的源码处理不同，尚未做运行验证；迁移前应确认“声明”和“值已绑定”的区别，保护部分初始化诊断。不能只按 parent 是否为空来筛选顶层。

## 初轮提出的最小原生合同（历史方案）

| 建议任务 | 原生改动位置 | 预期能减少的维护 |
| --- | --- | --- |
| 公开 resolved import iterator | `basta/src/graph.rs` 的私有目标表与 public getters | 桥接不用再次装配索引和解析已知目标，glob 也能拿到真实展开目标。 |
| 保留 origin、syntaxKind、statement identity/line | `model.rs::Import`、JS `CjsImport` 收集点与 `collect_imports` 投影 | 可靠筛选真实导入，聚合语句，减少外围源码重判和 side-effect 猜测。 |
| 保留 lazy/conditional/type-only 的执行语义 | JS/Python AST visitor 和 Import 输出 | 可以逐步替代当前执行语义提取；默认参数、decorator、TYPE_CHECKING、编译选项需要合同对照。 |
| Python 动态 loader 的 per-call 记录 | Python Expr::Call 与 loader 绑定分析 | 通过别名、局部遮蔽、重绑定和计算式对照后，才可删除对应 loader 识别逻辑。 |

前三项中的 iterator 是小接口改动；执行上下文和动态 loader 需要实际语义实现，不能只增加几个字段就宣称完成。这是初始调查时的方案；本地实现和最新验收见本文开头，尚未发布上游。

直接调用 OXC/Ruff 的公开 AST 也是可行路线，但 `basta::Analyzer.analyze` 当前只返回 FileFacts，不返回 OXC ModuleRecord。另建 OXC/Ruff collector 仍需维护导入与执行语义适配，而现有 TypeScript/Python 路径已经复用成熟 parser。若目标是减少自研，优先推动现有原生投影保留必要信息。

## 初轮拟议验收与范围（历史方案）

当时建议先处理 resolved iterator 与 import provenance 两个独立任务，再以这些反例和现有提取器合同测试验收 JS/TS 迁移。该路线用于探索图复用，不属于当前 C6 产品整合计划。若将来重新评估，应通过执行语义、配置、未解析原因和来源快照对照后，再决定能删除哪些 collector/resolver 包装；函数指标、模块分组和产品规则另按其职责评估。

现有提取器也有待补项：JS 条件 require 未标 conditional；缺失 Python 子模块时，双方都未保留预期的已知包初始化边。它们保留为后续口径确认与修复项，未用“工具一致”替代语义正确性。

该调查阶段使用固定版本和最小边界输入，不外推到全语言、框架、glob、总体 precision/recall 或性能收益。当时没有新增产品运行代码，也没有重复运行与该调查无关的全仓测试。源码与命令、原始输出、简化实验、核验脚本和哈希由贡献者独立保留；由 Codex（GPT-6 系列，含子代理）执行的检查不代表维护者已接受范围。

上游源码：[Import 与 FileFacts](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/rust/crates/basta/src/model.rs#L205)、[JS 事实投影](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/rust/crates/basta/src/lang/javascript.rs#L2412)、[公开 Analyzer](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/rust/crates/basta/src/lang/mod.rs#L59)。背景见 [复用与性能说明](code-analysis-jscpd-reuse.md)。
