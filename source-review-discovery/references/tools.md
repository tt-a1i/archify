# 本地工具接入

运行入口：`python3 <本 skill>/scripts/source_tools.py --help`。需要 Tree-sitter 或 Semgrep 的命令使用 `toolchain.json` 所指 runtime 下的 `venv/bin/python`；LSP 使用独立的 Node/Pyright。工具均分析本地源码，不启动业务应用。`rg`、文件读取、Git 直接使用环境工具。

调查中使用 `source_tools.py --workspace /review COMMAND …` 留存观察并返回摘要，`--workspace` 放在子命令前。目录需先初始化；旧命令不加此选项时仍返回原有结果。六个分析后端及 context 共用留存入口，详细命令、历史结果导入和候选记录见 [investigation-workspace.md](investigation-workspace.md)。

| 想查什么 | 实际调用 | 边界 |
|---|---|---|
| 查实际语言能力 | `capabilities --language python --language typescript` | 不启动引擎；installed、available 和样例验证分开，null 表示须在查询时决定 |
| 组合查看一个源码位置 | `context --root ROOT --file FILE --line N --column C --facet syntax --facet references --facet callers` | 只运行选中项；默认仅 syntax，多个 LSP 项共用一次连接；缺失项返回明确状态 |
| read_symbol | `syntax FILE --line N`；必要时先 `lsp definition` | Tree-sitter 返回包含该行的最小声明，并非符号绑定器 |
| find_references | `lsp references --root ROOT --file FILE --line N --column C` | 默认 Python/Pyright；其他语言需自己的 LSP 命令 |
| get_callers / get_callees | `lsp callers` / `lsp callees`，同上参数 | 检查服务端 callHierarchyProvider，动态调用可能漏掉 |
| get_control_flow | Joern CPG + `inspect.sc` 的 `cfg` 模式 | 真实 CFG；仍需核对语言前端、异常边和动态行为 |
| trace_value | Joern CPG + `flow.sc` 或自写原生 CPGQL 查询 | 返回静态分析可见路径；无路径不证明无依赖 |
| scan_patterns | `scan --config LOCAL.yml --target ROOT` 或 `scan --language python --pattern 'PATTERN' --target ROOT` | Semgrep CE；匹配是线索，非业务缺陷判决 |
| 查重复片段 | `duplicates --root ROOT --scope SRC --out NEW_DIR` | jscpd 5.4.2；双边位置和匹配方法，非业务等价判定 |
| 查函数指标 | `metrics --root ROOT --scope SRC --out NEW_DIR` | Lizard 1.25.0；复杂度、参数数、行/token 数与位置；保留按语言的限制 |

`syntax` 安装 Python、JavaScript（含 JSX）、TypeScript（含 TSX）、Go、Rust、Java、C、C++ 八种语言的 grammar。`--query-file FILE.scm` 可直接运行原生 Tree-sitter 查询。头文件必须显式选择 `--language c` 或 `cpp`。这八种语法覆盖不等于八种语言都有同等级的语义分析。

LSP `--extra-path SDK_SOURCE_ROOT` 可补锁定的依赖源码；`--server '["server", "--stdio"]' --language LANGUAGE_ID` 可使用其他已安装语言服务。命令输入位置为 **1 基行号及 Unicode 字符列**；返回的原生 LSP range 为 **0 基 UTF-16**。服务端返回空集或不支持时，用源码搜索补查，不能声称没有调用方。

Joern 示例（图和输出放审查工作目录，不放被审仓库）：

```sh
python source_tools.py joern build --target /source/module --language PYTHONSRC --output /review/module.cpg
python source_tools.py joern query --script /skill/scripts/inspect.sc --param cpgFile=/review/module.cpg --param out=/review/cfg.json --param 'method=.*process.*' --param mode=cfg
python source_tools.py joern query --script /skill/scripts/flow.sc --param cpgFile=/review/module.cpg --param out=/review/flow.json --param 'method=.*process.*' --param parameter=input --param call=consume
```

先用 `inspect.sc` 的 `methods` 模式获取精确 `fullName`，再用 `cfg` / `calls` 查看指定方法。内置 flow 查询从指定方法参数追到该方法中匹配调用的参数，仅用于一种常见查询，其他源/汇直接写 Scala 查询文件。`empty_selection` 表示源或汇没有匹配，不能解释成不存在数据流。源码改变后重新建图。大型仓库先选模块，必要时扩大依赖范围，记录排除范围。

CPG 和查询输出使用绝对路径。Joern 的内部工作副本在临时目录，命令完成后清理，显式指定的 CPG 和输出保留。单文件前端可能产生空 filename；这时由建图输入和源码散列定位，不能把行号当成独立完整位置。前端生成的外部 stub 不代表读取了依赖的函数实现。

不下载默认云规则、不登录 Semgrep；仅使用本地明确规则/模式，关闭 metrics 和版本检查。保留原始 JSON 的 errors/skipped 字段。匹配名称不能替代符号解析，CE 数据流能力不能冒充跨文件业务追踪。

工具 `status=error` / `unsupported` 是覆盖缺口，不能转换成“没有问题”。Joern 本身的查询输出在指定 out 文件；CLI JSON 同时保留 stdout/stderr，需查看解析警告。

结构全景使用 `architecture.mjs`，发现后隔离验证使用 `verify_finding.py`，契约见 [verification.md](verification.md)。目前 Pyright 和 Joern 的实际语义验证以 Python 为主；Semgrep 已做多语言模式 smoke check，不代表已配置完整的重复、复杂度、依赖和职责规则库。增加工具是否提高发现率需要相同任务的对照评估，不能把关系数、规则命中数或本次验证过的旧发现当作新发现增益。

## 调查范围与优先级查询

`review_facts.py` 是 Python 标准库适配器，不执行目标代码，不作缺陷判断：

```sh
python3 scripts/review_facts.py dependencies --input architecture.json --node backend:app/simulation --direction both --out NEW-dependencies.json
python3 scripts/review_facts.py history --root /repo --ref PINNED_COMMIT --limit 100 --max-files 50 --min-joint 3 --exclude '*.lock' --exclude 'generated/*' --out NEW-history.json
```

dependencies 查询已有 Archify 结构图，返回穿过指定源码目录边界的 import、方向、位置及源文件散列。默认只返回前 100 条并明确 truncated/总数；需要时提高 limit。类型导入和局部导入标记保留，底图未解析项继续保留为缺口。

history 调用本地 Git，读取固定版本可达的非合并提交及文件清单，不读取提交消息或补丁正文。记录窗口、浅克隆、排除项、被跳过的大提交，输出每文件修改次数和共同修改的提交 ID、两边分母。50 文件/3 次只控制查询成本与输出，不是质量门槛。改名不追溯；删除、机器人和格式化需要另核。快照没有 Git 历史时返回 unavailable，继续源码调查。

目前没有通用的跨语言“自动抽取业务不变量/验证状态机”工具。其他语言语义后端、属性测试生成器按实际未知再接入，不能把这些计划写成已实现能力。

## 多语言重复与函数指标

两个命令复用本入口及 `runtime/venv`，外部引擎版本由 `toolchain.json` 锁定；不一致时返回 error。我们编写的是选文件、保存来源和整理结果的薄适配层，未自研重复检测或复杂度算法。

```sh
python3 scripts/source_tools.py duplicates --root /repo --scope src --matching exact --out /review/dup-exact
python3 scripts/source_tools.py duplicates --root /repo --scope src --matching renamed --exclude '**/generated/**' --out /review/dup-renamed
python3 scripts/source_tools.py metrics --root /repo --scope src --limit 30 --out /review/functions
```

`--out` 必须是被审根目录以外的新目录，已有产物拒绝覆盖。可重复 `--scope` 比较多个模块、重复 `--language` 限定语言、重复 `--exclude` 追加 rg glob。相对 scope 从 root 计算。选择当前文件内容并记录 SHA256；可用 `--revision` 注明固定提交/快照来源，手填标签本身不证明工作区干净，不自动把外层仓库的 HEAD 当成快照版本。

已注册并做基础样例验收的 15 种语言为 JavaScript、TypeScript、Python、Go、Rust、Ruby、PHP、Java、Kotlin、Scala、C#、C、C++、Swift、Dart，另有 JSX/TSX。覆盖当前注册扩展名，不等于完整语法支持；`.h` 等有歧义扩展名暂不接收。不同工具的语言覆盖分开记录，不能据此声称所有语言都具备完整引用、调用、控制流和数据流查询。

文件选择使用 `rg --files --hidden`，沿用其 ignore 规则（显式指定文件遵循 rg 的显式路径行为）。默认排除 .git、node_modules、venv/.venv、vendor、dist、build、coverage、__pycache__；不默认排除测试。仓库可能把第三方产物放在 plugins 等普通目录中，先看文件来源再追加排除，不能将这些目录名通用化。manifest 记录选定文件、跳过文件和排除策略；被 ignore/glob 剪掉的目录只记录策略，未逐个遍历列出。

每次最多 1000 个选定文件、每文件 1 MiB；超文件数上限报错，超文件大小则记录跳过。按范围调 `--max-files` / `--max-bytes`。UTF-8 以外文件跳过；不跟随符号链接。没有符合条件的文件为 empty_scope，分析器超时、失败、版本不符为 error。两者和 stale 均返回退出码 2，不能转为“未发现问题”。partial 的具体原因在 coverage、manifest 或 errors；它不等于工具整体失败。新增两个引擎只读取源码，不执行项目代码。

- jscpd 默认 `--matching exact --min-tokens 50 --min-lines 5`，固定 weak 模式忽略注释/空白；这里的 exact 是 token 匹配，不是文件字节相等。`renamed` 增加一致标识符归一化，仍可能返回 exact 或 renamed 片段；保留每项原生 kind。阈值只用于筛选片段，不是项目质量判据。使用显式空配置和独立工作目录，避免目标仓库配置自动开启其他模式。未接入 embedding、AST 相似、跨语言匹配或 MCP 服务。
- Lizard 按圈复杂度降序列出函数。`metrics` 含 cyclomatic_complexity、parameters、nloc、tokens，location 为 1 基首尾行。1.25.0 的 Ruby 范围/复杂度及依赖范围的行/token 数、PHP 参数数、Scala 范围有已验证偏差；规范化结果保守置 null，`unverified_fields` 给原因，原值仍保留。其他字段也只是分析器结果，不是编译器证明；样例通过不保证真实项目所有语法。
- `--limit` 默认 100，只限制原入口的规范化响应；total_records/truncated 明示截断，原始输出完整保存。使用 workspace 留存或 import 后，完整原始结果会重新整理为可分页记录，不重跑引擎；先查下一页或精确路径。单份产物过大时才缩小后续分析范围。

每个输出目录包含 `result.json`、`manifest.json`、`execution.json`、stdout/stderr，以及原生 `jscpd-report.json` 或 `lizard-raw.json`。result 共用 provider/version/status/data/coverage/limitations，记录类型固定为 investigation_signal。每项可回到原始 JSON pointer；双边片段附文件散列、1 基行号、0 基字节区间。指标中 null 的位置不能直接用来采集证据。分析后发现输入变化时返回 stale 并清空可用记录，需重新运行。

原生 jscpd 统计的文件数可能少于选择数，例如文件未达到 token 阈值；返回 partial 并保留两个数量，不虚构具体漏扫文件。无命中也不能说明两处实现语义不同。

**接入发现闭环**：工具返回候选 → Agent 读双边完整定义/高复杂度入口 → 查契约、调用方及保护 → 有具体维护代价或行为违反才进入 findings。用原有 run.tools / coverage 记录工具和覆盖，用 source 证据支持结论，必要时附 kind=tool 引用；随后仍由 publish/render、最小验证和 recheck 完成闭环。不要把整个指标榜、重复对或严重度猜测自动填进 findings。
