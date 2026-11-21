# jscpd 额外复用与性能复核

本记录补充 [C6 接入说明](code-analysis-jscpd.md) 与[讨论 #1230](https://github.com/tt-a1i/archify/discussions/1230)。当前产品接入方案为：以完整 [#1301](https://github.com/tt-a1i/archify/pull/1301) 的五个 adapter 保留六语言依赖、调用与语言范围，用另行安装的 jscpd 5.4.3 提供默认关闭的 C6。basta 图桥接及本地原生 fork 继续作为独立研究，不随本轮产品接入交付。

以下调查、性能表和证据计数消融固定在 jscpd 5.4.2 与 `labs/code-analysis@bf0a29e7664f52973d06a8e6a608df2db1ecbd39` 的历史候选上；单独标明的 5.4.3 图合同实验也有自己的源码和范围。它们均不能改标为 #1301 + 5.4.3 六语言 C6 的最终结果，当前组合仍须按[验证方法](code-analysis-jscpd.md#验证方法)记录自己的回执。

## 历史复用调查（5.4.2）

| 职责 | 已验证的现成能力 | 决策 |
| --- | --- | --- |
| 重复检测 | exact、consistent；另有可选 AST/gap 检测 | 当前 C6 使用现成引擎，避免新增自研算法。 |
| 函数 CC | LSP `jscpd/complex-function`，functionLimit=0 可取全部被识别函数 | 纠正“只有文件 CX”的早期概括；不能无损替换当前函数指标，见下方反例。 |
| 克隆基线/增量 | fingerprint 计数、baseline、按 HEAD/配置/版本重建的 changed 流程 | 单独的新增重复 CI 可直接复用；不替代统一的多规则接受理由、证据变化、不可比原因及 task。 |
| 依赖图 | 已编译运行独立 Rust bridge，导出 modules/symbols/imports/references，并用公开 resolver 复算目标 | 可用于符号引用和死代码能力；现有 import facts 不能直接替换，见下方语义、范围和快照验证。 |
| 边界/基础检测 | 复制越界、unused-file、unused-export；已有 summary 的文件 CX/规模 | 复制越界与 JS 死代码正负例通过，适合后续新增规则。复制边界不同于当前 import 分层边界。 |
| 函数身份/范围/深度、Tarjan/hub/入口、证据/task | 未获得对应的等价公共输出和完整产品契约 | 当前保留；不为替换少量 hash 而额外引入 SARIF 联表。 |

官方契约依据：[LSP complexity](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/docs/editors.md#complexity)、[baseline 计数](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/rust/crates/cpd-reporter/src/baseline.rs#L178)、[basta RunResult.graph](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/rust/crates/basta/src/analyze.rs#L26)、[复制越界与死代码说明](https://github.com/kucherenko/jscpd/blob/db415b5d7cc34d72a324fe5eae2147646dc3558b/docs/rust.md)。所用 gitHead 的关键源码已与 v5.4.2 核对一致。

函数 CC 的最小实测反例是 `a ? b : c` 报 2、等价 `a?b:c` 报 1，以及 `value?.case` 报 2、普通属性 `value?.item` 报 1。Flask 的 363 个运行时实现全部对应上；另 6 个 Archify 对象是 overload 声明。363 项中 351 同值、12 不同：9 项属于内层作用域政策，3 项涉及 f-string 决策漏计。不能把所有差异都解释为阈值不同，也不能将对齐比例称为准确率。函数 LSP 还缺完整末行、qualname、nesting 与 deepestLine。

## Rust 图 API 的实际适配

独立的[原生合同实验](code-analysis-jscpd-graph-contract.md)在 5.4.3 基线上验证了两个本地补丁：公开原生 resolved import iterator，以及保留来源、语句位置和执行语义。该实验的 16 组输入、133 项消费者检查通过，新桥接省去重复索引/alias/目标解析；这些是固定实验的结果，尚未成为上游已发布 API，也没有用于替换本轮 #1301 提取器。完整替换仍涉及调用库存、语言工具链/配置、未解析分类、包初始化和来源快照。下文保留 5.4.2 的原始调查与成本。

固定同一 gitHead，独立桥接直接调用 `basta::analyze::run`，没有修改上游。公开图确实有模块、导入绑定、符号起止位置、引用和可达性。`import_targets` 与内部别名组装函数是私有的，真实 compile-fail 验证了这一点；桥接使用公开语言 resolver 和 alias parser 复算目标。这个字段只表示公开 API 的复算结果，尚未证明与私有目标数组等价，尤其不覆盖 glob 展开边。

| 验证点 | 实测结果 | 对替换的影响 |
| --- | --- | --- |
| 记录含义 | JS fixture 导出 32 条 Import 记录；同一语句可以有多个绑定和合成 side-effect，普通路径字符串也可能产生可达性关系 | 不能把记录条数当依赖语句数，也不能直接统计耦合或循环。它为保守死代码可达性服务。 |
| 导入语义 | 原始 import / require / dynamic 分类、lazy / conditional 标记未完整保留；显式 `.js` 路径的 TS type-only 样例旁另有非 type-only 合成关系，无扩展名对照正常 | 直接映射会改变运行时依赖图；要区分源码事实与可达性补边，不能泛化成所有 type-only 都有问题。 |
| Python | 静态、相对导入可解析；本例 `importlib.import_module` 的字面量和变量调用均未记录，TYPE_CHECKING / conditional / lazy 未保留 | 动态导入与运行时边过滤需要补充；Archify 对 package initializer 的隐式边也需保留。 |
| 解析覆盖 | TS paths 别名装配有效；JS `./pkg` 的 package.json main 本例未解析，Archify 可解析；Python src-layout 两者均能解析叶文件 | 不能把单工具当作正确答案，需逐项按语义合同验收。 |
| 位置与失败 | 有导入起点，无导入完整末位置；未解析目标为 None，未区分外部、越界或未知；坏 JS/Python 有 parseFailed，Java 未入图 | 当前 import 消费者只要求行号，缺末位置不是硬障碍；仍需语句起点、未解析分类和显式覆盖报告。 |
| 快照 | 固定副本不受原始文件后续修改影响；移除 tsconfig 等辅助配置会改变别名结果 | 复用时应连同解析配置捕获，不能只暂存 sourceText。 |

该版本公开的格式为 JS/JSX/TS/TSX、Python、Vue、Svelte、Astro；这不是 jscpd 重复检测器的全部语言列表。此次只验证了代表性的 JS/TS/Python 合同，未验收框架语义与 glob。

现有提取器也有待补项：JS 条件分支内的 `require` 本例未标 `conditional`；`from pkg.missing import Absent` 的预期包含已知包初始化文件，但双方输出均未保留该边。39 行语义对照保留这些不匹配，没有把双方一致当作正确或计算成准确率；应列入后续解析合同确认与修复。

成本也已实测：`basta` 0.3.2 是 `publish=false` 的工作区 crate，需固定源码构建。macOS arm64 的独立 release bridge 为 5,634,720 bytes（5.37 MiB），只链接系统库；运行预编译桥接不需要安装 Rust 或模型。首次隔离安装 Rust 1.97 用时 32.0 秒，`cargo build --release -j2` 用时 207.4 秒；构建工具链、Cargo 缓存和 target 共约 1.54 GiB，属于开发构建环境，不能当作用户运行包体积。跨平台构建、发布和接口升级维护仍需安排。

上述结果可供后续评估符号、引用、unused-file / unused-export 等新增能力。它们不等于 #1301 的源调用契约，也没有成为本轮采用 native fork 的决定。当前保留各语言标准工具的事实路径、模块归属、架构映射和产品规则；jscpd 只接入 C6 重复 token 检测。

## 历史性能：5.4.2 优化前的固定输入

环境为 macOS arm64、Apple M2 Pro、16 GiB、Node 22.23.0、Python 3.14.3。每条件一次预热、五次串行新进程计时，另做三次独立内存采样，全部保留文件缓存。180 次调用均成功，既有 facts/graph/非 C6 findings 不变；原生与集成的精确范围、内容哈希、实际分析路径集合一致。下表为中位数，单位 ms：

| 范围 | C6 关闭 | C6 exact | C6 consistent | 原生 exact |
| --- | ---: | ---: | ---: | ---: |
| Flask 24 文件 / 9,202 行 | 827.7 | 908.8 | 952.2 | 31.0 |
| Archify 后端 40 文件 / 17,138 行 | 1,029.2 | 1,383.2 | 1,738.1 | 48.3 |
| Redux src 17 文件 / 1,565 行 | 665.3 | 707.2 | 698.4 | 15.8 |
| Archify runtime 189 文件 / 66,106 行 | 2,291.2 | 3,032.7 | 4,092.7 | 151.7 |

原生列只做检测和报告，不包含现有依赖解析、模块图、其他规则和证据，所以不能宣称它是整个分析器的替代速度。默认 exact 增量为 6.3%–34.4%。runtime 的 C6 只选中 152 文件、实际分析 129（省略 22 个 vendor、1 个原生 inventory 未报告的短文件），并非 189 文件全部完成 C6；其他范围覆盖分别为 23/24、40/40、14/17。各模式都使用同一 eligible 快照。

三次采样进程树 RSS 峰值的中位数，关闭 / exact 分别为 Flask 243.3/243.6 MiB、后端 262.5/303.8 MiB、Redux 227.3/235.0 MiB、runtime 457.7/565.5 MiB。RSS 相加会重复算共享页且可能漏瞬时峰值，不是精确物理内存。Redux 原生进程很短，部分采样不可用，没有填 0。未作冷盘、跨平台或大型 monorepo 推断。

函数替换另测了成本边界：Flask 已有 AST 上的 CC/范围/nesting pass 为 34.0 ms；真实 LSP 启动加诊断为 326.1 ms，初始索引后打开全部文件处理为 284.2 ms。二者职责与生命周期不同，不能当等价速度排名；仅换 CC 还需保留范围/深度，不能省掉整个现有 pass。

## 已接入的证据计数优化

初轮 5.4.2 候选的范围摘要原会为每个候选行窗口重新 SHA256，以计算同一片段的副本数量。当时的隔离消融保留最终摘要和副本数，仅用逐行比较确认候选窗口：runtime exact 的这一阶段从 578.6 ms 降到 23.4 ms，consistent 从 1,476.1 ms 降到 60.6 ms。四个范围、两模式的全部最终摘要一致，1/2/3 副本计数也一致。

上述是历史微基准。逐行窗口比较已接入 `createRangeDigest` 并随 C6 保留，每个引用范围仍计算最终 SHA256，并保留双侧、重叠副本及出现次数。没有引入缓存或第二份状态。异常 JSON 字符串的孤立 surrogate 保留旧哈希匹配回退：当时实际移除该分支后，等价 UTF-8 内容的次数从 3 变为 1，会改变证据合同，因此恢复并保留。

随后用冻结的优化前候选和优化后候选交替执行相同 CLI，四范围 × 三模式 × 两版本，每条件一次预热、五次计时、三次独立内存采样，共 216 次成功调用。同一样本、同模式的五类输出（facts、graph、findings、review、overview）逐字节一致；独立复核重新哈希了全部 1,080 个文件。共享同一产品依赖环境，冻结所列产品源码、工具、测量运行时、输入和配置；没有声称对全部 node_modules 逐文件冻结。

当时成对整条 CLI 的中位数如下，单位 ms。只应在这轮成对结果内比较，不能拿上一表不同时间的数值作优化基线，也不能将它视为 5.4.3 或六语言接入的测量。

| 范围 | exact 优化前 → 后 | 耗时减少 | consistent 优化前 → 后 | 耗时减少 |
| --- | ---: | ---: | ---: | ---: |
| Flask | 849.5 → 796.2 | 6.3% | 888.9 → 810.1 | 8.9% |
| Archify 后端 | 1,289.0 → 1,088.9 | 15.5% | 1,655.7 → 1,147.8 | 30.7% |
| Redux | 652.6 → 628.9 | 3.6% | 653.1 → 650.5 | 0.4% |
| Archify runtime | 2,814.8 → 2,319.0 | 17.6% | 3,733.6 → 2,559.4 | 31.5% |

C6 关闭的控制组耗时变化（后/前减一）依次为 +0.5%、+1.1%、−2.3%、+0.5%。Redux consistent 的收益很小，不能声称明显改善；没有做显著性检验。采样内存基本持平：runtime exact 为 565.4 → 564.3 MiB、consistent 为 573.3 → 577.2 MiB，没有宣称降低内存。

当时的新增回归覆盖重叠、整行匹配、Unicode、CRLF/EOF 和源字符串写入磁盘后的证据验证；该历史候选的 Code Analysis 套件在真实 jscpd 环境通过。其余全量证据沿用更早一轮：3,542 passed、143 skipped、1 个已在基线独立复现的 README showcase 来源哈希失败，不能称全仓全绿。当时另按规范工具链重建并验证了分发包。这些计数和包检查均不属于当前 #1301 + 5.4.3 组合的最终验证。

详细命令、原始输出、失败探针、范围签名和哈希记录由贡献者保留并在讨论中汇总。此结果由 Codex（GPT-6，含子代理）执行，尚未完成全量人工标注或对应平台 CI。
