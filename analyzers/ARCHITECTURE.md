# Archify Analyzers — 代码模块分析子系统架构

状态：草案 v0.2 · 2026-09-08（v0.1 与《Repository Robustness Analyzer 分析设计建议》合并后的取舍版）
所属：`analyzers/`（新增子系统，与 `archify/` 渲染器并列，不修改渲染器）

---

## 0. v0.2 相对 v0.1 的变化

- 采纳"Analyzer 负责事实，LLM 负责解释"作为系统边界；分析核心保持确定性，LLM 解释作为**可选的最后一级消费者**，不进入流水线。
- 中间表示从单一模块图扩展为**五张相互关联的图**（Symbol / Module / Call / Test / Git-Change），因为 pass-through 链、死导出、变更影响、测试覆盖映射都需要符号级和调用级信息，仅有模块图做不了。
- 分析维度从 2 个扩展为 6 个：耦合、复杂度、冗余、错误处理、变更影响、AI 代码异味。
- 明确**不做**的维度：跨函数数据流/污点分析、契约一致性、运行时/并发/资源安全、行为级测试健壮性评分、单一综合评分。原因见 §1.3 与附录 A 的逐项裁定。
- JS/TS 前端改为统一使用 TypeScript Compiler API（`allowJs`），一次遍历同时得到模块边、符号、引用和调用关系，替代 v0.1 的 dependency-cruiser + babel 双工具方案。

---

## 1. 目标、边界与裁定原则

### 1.1 目标

对一个本地 Git 仓库做**确定性的、可复现的、带证据的**静态分析，回答：

1. 模块耦合是否合理（方向、强度、环路、分层、隐藏耦合）。
2. 代码是否简洁、有无冗余（重复、死代码、过度抽象、无价值包装层）。
3. 函数复杂度是否失控。
4. 外部调用的失败路径是否被处理。
5. 改一个模块，静态上会波及哪些模块和测试。
6. 新代码是否偏离仓库既有的依赖模式（面向 AI 生成代码的场景）。

产出：五张图的 JSON、`findings.json`、按维度分组的 `report.json`，以及一份可直接交给 `archify deliver architecture --repo-root` 的 IR。

### 1.2 非目标

- 不改 `archify/` 渲染器、schema、viewer；桥接层只生成 IR。
- 不执行被分析的代码（不跑测试、不采样、不打桩）。
- 分析核心不调用 LLM；每条 finding 可回溯到文件、行号、边或 commit 集合。
- 第一阶段不做自动修复。
- 不输出单一综合分数，不输出没有公开公式的 0–100 分。

### 1.3 裁定原则（用于筛选建议文档中的维度）

一个维度进入本架构，必须同时满足：

1. **静态可判定**：不执行代码就能从 AST / 引用 / Git 历史得到事实。
2. **精确率优先**：宁可漏报不可误报。误报会摧毁"证据可信"这个产品前提。
3. **有成熟基础设施**：能建立在 TypeScript API、Python `ast`、Git 之上，不需要自研数据流引擎。
4. **证据可展示**：每条 finding 的 evidence 能落到 `file:line` 或边/commit 列表，能挂进 Archify 节点 card。

不满足者要么降级为"可选外部工具适配器"，要么明确不做。逐项裁定见附录 A。

---

## 2. 总体流水线

```
target repo ──▶ 1. extract ──▶ 2. build-graphs ──▶ 3. evaluate ──▶ 4. report ──┬─▶ 5a. bridge → archify deliver
(git checkout)   语言适配器       五张图 + 函数度量     规则引擎        按维度汇总    └─▶ 5b. (可选) LLM 解释
                     │                 │                  │               │
              raw-facts.json     graphs/*.json       findings.json    report.json
```

每一层是纯 JSON → JSON 变换，输入输出落盘、有 schema、可单独测试。任一层可独立替换。

### 2.1 提取层 `analyzers/extract/`

语言适配器接口不变：

```ts
interface LanguageAdapter {
  id: 'ts' | 'py';
  detect(repoRoot): boolean;
  extract(repoRoot, options): RawFacts;   // 文件、符号、引用、导入、调用、函数度量
}
```

| 语言 | 前端 | 产出 | 说明 |
|---|---|---|---|
| JS / TS（第一阶段） | TypeScript Compiler API（`createProgram` + `allowJs`） | import 边、符号定义、引用、调用、函数 AST 度量 | 一次遍历拿全；TS 的引用解析对 JS 也够用，Archify 自身可自举 |
| Python（第二阶段） | 标准库 `ast` + 自写 import 解析；调用图用 `pycg`（可选） | 同上，调用解析精度较低 | 通过子进程输出 JSON |

函数级度量在提取阶段直接从 AST 算出并随符号一起输出，**不持久化 CFG**：圈复杂度、认知复杂度（SonarSource 公开定义）、最大嵌套、分支数、返回点数、LOC。

### 2.2 图构建层 `analyzers/graphs/`

从 `raw-facts.json` 构建五张图，全部落盘为 `graphs/<name>.json`：

| 图 | 节点 | 边 | 用途 |
|---|---|---|---|
| **Symbol Graph** | 函数 / 类 / 变量 / 类型 / 导出 | 定义、导出、引用 | 死导出、未用导入、单实现接口 |
| **Module Graph** | 模块（聚合规则同 v0.1：显式分组 > 包边界 > 目录深度） | import，带 weight 与证据 | 环、分层、fan-in/out、不稳定性 |
| **Call Graph** | 函数 | 静态可解析的调用 | pass-through 链、变更影响、外部调用定位 |
| **Test Graph** | 测试文件、测试用例 | 测试 → 被 import 的模块/符号 | 无测试模块、变更影响到的测试 |
| **Git Change Graph** | 文件 | 共同变更计数（最近 N commit） | 变更耦合、热点 |

调用图只收录**静态可解析**的调用（直接调用、同模块方法、命名导入）；动态分发、反射、字符串调用一律不收录并在 `graphs/call.json#unresolved` 计数，让漏报可见。

### 2.3 评估层 `analyzers/evaluate/`

规则接口：

```ts
interface Rule {
  code: string;                         // 'coupling/cycle'
  dimension: Dimension;                 // 见 §4
  severity: 'error' | 'warning' | 'info';
  run(ctx: { graphs, config }): Finding[];
}
```

约束：阈值来自配置且在 evidence 中回显；规则之间无顺序依赖；抑制（`// archify-ignore <code>` 或配置 `ignore`）计入 `summary.suppressed`，不静默。

### 2.4 报告层 `analyzers/report/`

把 findings 按维度分组，输出每个维度的 **error / warning / info 计数与关键度量原值**（例如环的数量、最大 fan-in、重复代码占比）。不做 0–100 打分。若日后需要分数，必须在 `config/scoring.json` 里给出公开公式并在 report 中回显公式版本。

### 2.5 桥接层 `analyzers/bridge/`

与 v0.1 相同：模块图 + findings → Archify `architecture` IR，节点 `sources` 指向模块入口（≤3），`meta.repository` 带 40 位 sha，节点数超过 12 时按 fan-in + fan-out 取 top-N 其余折叠，findings 作为节点 card，两 commit 对比复用 `archify compare`。

新增：`coupling/*` 与 `impact/*` 的 finding 可附带 `views`（Archify guided views，≤5 章）——例如"环路径"一章、"热点模块"一章，让图直接讲分析结论。

### 2.6 LLM 解释层（可选，`analyzers/explain/`）

输入 `findings.json` + `report.json`，输出自然语言解释与改进建议。它**只能引用 findings 中已有的证据**，不得新增事实。这一层不在 CI 门禁路径上，也不影响任何 JSON 产物的确定性。

---

## 3. 数据契约

### 3.1 Finding（合并 Archify diagnostic 与建议文档的 Typed Finding）

```json
{
  "id": "ARCH-0007",
  "code": "coupling/layer-violation",
  "dimension": "coupling",
  "severity": "error",
  "confidence": 1.0,
  "message": "renderers-shared imports renderers-architecture, against the declared layer order.",
  "subject": { "from": "renderers-shared", "to": "renderers-architecture" },
  "evidence": {
    "edges": [ { "file": "archify/renderers/shared/legend.mjs", "line": 4, "to": "archify/renderers/architecture/grid.mjs" } ],
    "declaredLayers": [["bin"], ["renderers-*"], ["renderers-shared"]],
    "threshold": null
  },
  "supportedFixes": ["move the shared helper into renderers-shared", "invert the edge via a parameter"]
}
```

`confidence` 语义固定：`1.0` = 从静态事实直接推出（环、死导出）；`0.7` = 依赖启发式匹配（外部调用缺 timeout、pass-through 判定）；`0.5` = 统计推断（变更耦合、模式偏离）。规则声明自己的 confidence，不允许运行时浮动。

### 3.2 其他产物

`raw-facts.json`、`graphs/{symbol,module,call,test,git-change}.json`、`report.json` 各有 JSON Schema，放 `analyzers/schemas/`，用 ajv 校验。所有数组按稳定键排序，不含时间戳，保证字节级可复现。

---

## 4. 规则目录（按维度）

### 4.1 `coupling` — 耦合合理性

| code | 级别 | confidence | 检测 | 依赖的图 |
|---|---|---|---|---|
| `coupling/cycle` | error | 1.0 | 模块级强连通分量 | Module |
| `coupling/layer-violation` | error | 1.0 | 违反配置声明的分层 | Module |
| `coupling/pattern-deviation` | warning | 0.5 | **无显式分层时**：对每对目录计算主导依赖方向，逆主导方向且权重 < 20% 的边视为偏离；可限定只看 `--since <ref>` 之后新增的边 | Module, Git |
| `coupling/hub` | warning | 1.0 | fan-in ≥ 5 且 fan-out ≥ 5 | Module |
| `coupling/unstable-dependency` | warning | 1.0 | 稳定模块依赖不稳定模块，I 差 > 0.4 | Module |
| `coupling/internal-leak` | warning | 1.0 | 跨模块引用了非入口文件的符号（绕过模块公开面） | Symbol, Module |
| `coupling/change-coupling` | warning | 0.5 | 无静态依赖的两模块在最近 200 commit 中共变比例 > 0.5 | Module, Git |
| `coupling/orphan` | info | 1.0 | 非入口且无出入边 | Module |

`coupling/pattern-deviation` 是从建议文档 §3.4"学习仓库主导模式"收窄来的可确定版本：不学习"Controller→Service"这类语义，只看依赖方向的多数派。

### 4.2 `complexity` — 复杂度

| code | 级别 | 检测 |
|---|---|---|
| `complexity/cyclomatic` | warning | 圈复杂度 > 15 |
| `complexity/cognitive` | warning | 认知复杂度 > 20（SonarSource 定义） |
| `complexity/nesting` | info | 最大嵌套 > 5 |
| `complexity/exits` | info | 返回点 > 6 |
| `complexity/long-function` | warning | LOC > 80 |
| `complexity/large-file` | info | 文件 LOC > 800 |
| `complexity/hotspot` | warning | 认知复杂度 × 近期改动次数 排名前 5% |

confidence 全部 1.0。"函数职责数"不纳入：无法静态判定。

### 4.3 `redundancy` — 冗余

| code | 级别 | confidence | 检测 |
|---|---|---|---|
| `redundancy/duplicate-block` | warning | 1.0 | 跨文件 token 级重复（winnowing，窗口 50 token，标识符归一化后比较，即覆盖 exact + near duplicate） |
| `redundancy/dead-export` | warning | 1.0 | 导出且全仓无引用；排除入口、`package.json#exports`、测试 |
| `redundancy/unused-import` | info | 1.0 | 导入未引用 |
| `redundancy/unused-symbol` | info | 1.0 | 模块内未导出且无引用的函数/类/变量 |
| `redundancy/pass-through` | warning | 0.7 | 函数体仅为一次调用并原样转发参数与返回值；沿调用图算链深度，深度 ≥ 2 报告 |
| `redundancy/single-impl-abstraction` | info | 1.0 | 接口/抽象类仅一个实现，或工厂仅产出一种类型（TS/Python class 层面） |
| `redundancy/unreachable` | info | 1.0 | `return`/`throw` 之后的语句、恒真恒假条件下的分支（仅字面量常量） |

"语义重复"收窄为两条可判定规则：`duplicate-block`（归一化后结构相同）和 `pass-through`（建议文档中 `get_user / fetch_user / retrieve_user` 例子实际就是三个 pass-through 指向同一 callee，会被后者以"同 callee 的多个 pass-through"形式报出）。一般意义的语义等价不做。

### 4.4 `error-handling` — 外部调用失败路径

| code | 级别 | confidence | 检测 |
|---|---|---|---|
| `error-handling/external-call-unguarded` | warning | 0.7 | 调用目录内已知的网络/IO API（`fetch`、`axios.*`、`http.request`、`fs.*` 同步族、Python `requests.*`、`urllib`、`open`），且在同一函数内既无 `try/catch` 包裹也无 `.catch` | 
| `error-handling/missing-timeout` | warning | 0.7 | 同上 API，调用参数中无 timeout/`AbortSignal`（按 API 目录中的参数位置判断） |
| `error-handling/unchecked-status` | info | 0.7 | `fetch` 返回值未读取 `.ok`/`.status` 即取 `.json()` |
| `error-handling/swallowed-error` | warning | 1.0 | `catch` 块为空或只有 `console.log`/`pass` |

API 目录放在 `config/external-apis.json`，可扩展。**不做** retry / backoff / fallback / 幂等检测：这些实现形态太多，静态匹配误报率不可接受。

### 4.5 `impact` — 变更影响（静态）

| code | 级别 | 检测 |
|---|---|---|
| `impact/dependents` | info | 每个模块的直接与传递依赖者数量、涉及的测试文件数（Module + Test 图可达性） |
| `impact/untested-module` | warning | 有出入边但没有任何测试文件 import 它的模块 |
| `impact/high-reach` | warning | 传递依赖者 ≥ 总模块数的 50% |

术语固定为 **static dependents / static reach**，不叫 blast radius，不给 risk score。这与 Archify DESIGN.md "Don't call graph reachability runtime impact, blast radius, or breakage" 保持一致：我们有 import 证据，但没有运行时证据。

### 4.6 `ai-smell` — 面向 AI 生成代码的异味（组合规则）

这一维度不新增检测器，而是把上面已有规则按"AI 生成代码常见模式"重新组合成聚合视图：

| code | 由哪些规则合成 |
|---|---|
| `ai-smell/over-abstraction` | `redundancy/single-impl-abstraction` + `redundancy/pass-through` 链深 ≥ 3 |
| `ai-smell/pattern-drift` | `coupling/pattern-deviation` 且边在 `--since` 之后新增 |
| `ai-smell/sibling-inconsistency` | 同一模块内、调用同一外部 API 的多个函数，部分命中 `error-handling/*` 部分不命中 |

它们的 confidence 取组成规则的最小值。

---

## 5. 目录结构

```
analyzers/
  ARCHITECTURE.md
  package.json                  ← private；devDependencies: typescript, ajv
  bin/analyze.mjs
  config/
    defaults.json               ← 全部阈值
    external-apis.json          ← error-handling 规则的 API 目录
  schemas/                      ← raw-facts / 五张图 / findings / report
  extract/
    index.mjs
    ts/                         ← TypeScript Compiler API 适配器
    py/                         ← 第二阶段
  graphs/
    symbol.mjs  module.mjs  call.mjs  test.mjs  git-change.mjs
    grouping.mjs                ← 模块聚合策略
  evaluate/
    index.mjs
    rules/{coupling,complexity,redundancy,error-handling,impact,ai-smell}/
  report/index.mjs
  bridge/to-archify.mjs
  explain/                      ← 可选，prompt 模板 + 证据引用校验
  test/
    fixtures/<rule>/            ← 每条规则一个最小合成仓库 + 预期 findings
    golden/archify-self/        ← 自举输出冻结
    *.test.mjs
```

---

## 6. CLI

```bash
node analyzers/bin/analyze.mjs run <repo-root> --out out/ [--config f] [--since <ref>] [--json]
node analyzers/bin/analyze.mjs extract|graphs|evaluate|report|bridge ...      # 单步
node analyzers/bin/analyze.mjs run <repo-root> --fail-on error               # CI 门禁
node analyzers/bin/analyze.mjs explain out/findings.json                     # 可选，需 LLM 配置

node archify/bin/archify.mjs deliver architecture out/repo.architecture.json out/repo.html \
  --quality showcase --repo-root <repo-root> --json
```

`--since <ref>` 让 `pattern-deviation`、`ai-smell/pattern-drift` 只看该 ref 之后新增的边，这是"审查一次 AI 生成的 PR"的主要用法。

---

## 7. 测试与验收

1. 规则级 fixture：正例、反例各至少一个，预期 findings 逐字段比对。
2. 契约测试：每个产物过 ajv；桥接产物过 `archify validate architecture --quality showcase`。
3. 自举 golden：对 `archify/` 全流程跑，冻结输出；变化必须显式更新并在 PR 说明。
4. 确定性：同输入两次运行字节级相同。
5. 精确率抽样：M2 起，每条 `confidence < 1.0` 的规则在 3 个真实开源仓库上人工抽查 20 条，误报率 > 20% 的规则降级为 info 或收窄条件。
6. CI：根目录 workflow 新增 `analyzers` job，与上游 `test` job 隔离。

M1 验收：对 `archify/` 自举画出 `bin → renderers/<type> → renderers/shared` 分层，`layer-violation` 零误报，`deliver --repo-root .` 通过 showcase。

---

## 8. 里程碑

进度：M1 第一步（`extract` → `raw-facts.json`）已完成，见 `bin/analyze.mjs`、`extract/`、`test/`。下一步是 `graphs/module.mjs` 与 `coupling/cycle`、`coupling/layer-violation`。

| # | 内容 | 产出 |
|---|---|---|
| M1 | TS 提取 + Module Graph + `coupling/cycle`、`layer-violation` + bridge | archify 自举图 |
| M2 | Symbol / Call / Git 图 + 其余 `coupling/*` + `complexity/*` | 耦合与复杂度完整 |
| M3 | `redundancy/*`（重复块、死导出、pass-through、单实现抽象） | 冗余分析 |
| M4 | Test 图 + `impact/*` + `error-handling/*` + `ai-smell/*` + `--since` | PR 审查用法可用 |
| M5 | `report` 维度汇总 + `--fail-on` 门禁 + 可选 `explain` | fitness function + 解释 |
| M6 | Python 适配器 | 第二语言 |

---

## 9. 待决问题

- 模块聚合默认深度 2 对 monorepo 是否合适；可能需要按 `workspaces` 自动切换到包边界。
- `pattern-deviation` 的"主导方向"阈值（20%）需要在真实仓库标定。
- Python 调用图是否值得引入 `pycg`（研究级工具，维护状态一般），还是先只做 import 级。
- `explain` 层是否放进本仓库，还是作为 Archify SKILL.md 的一段 prompt 由 agent 自己完成——后者更贴近 Archify 现有的"agent 负责解释"分工。

---

## 附录 A. 对《Repository Robustness Analyzer》各维度的裁定

| 建议文档维度 | 裁定 | 理由 / 去向 |
|---|---|---|
| 2.1 Architecture / Coupling | **采纳** | 全部指标静态可得；"Architecture Health 72/100"改为维度计数与原值 |
| 2.2 Complexity | **采纳（部分）** | 圈/认知复杂度、嵌套、返回点、LOC 采纳；"function responsibility count"不可静态判定，去除 |
| 2.3 Redundancy | **采纳（收窄）** | exact/near duplicate、unused、unreachable 采纳；"semantic duplicate"收窄为归一化重复 + pass-through；"duplicate abstraction"并入 single-impl-abstraction |
| 2.4 Data Flow / Taint | **不做** | 跨函数污点分析是 CodeQL / Semgrep 量级的工程，自研不可行且精确率无法保证；日后可作为外部工具适配器把 Semgrep JSON 转成 finding |
| 2.5 Error Handling | **采纳（收窄）** | timeout、异常包裹、状态检查、吞异常四条基于 API 目录可判定；retry/backoff/fallback/幂等去除 |
| 2.6 State & Side Effect | **暂不做** | 模块级全局可变量的读写者统计可做但价值有限；真正的副作用分析需要过程间数据流。列入 M6 之后再评估 |
| 2.7 Contract | **不做** | 返回类型不一致交给 `tsc` / `mypy`（可作为适配器摄入其诊断）；跨服务 producer/consumer 契约需要 OpenAPI/protobuf 等外部 schema，超出仓库静态分析范围 |
| 2.8 Test Robustness | **采纳（收窄为静态映射）** | 测试→模块映射、无测试模块、受影响测试数可做；"happy/failure/boundary 覆盖"与"Behavioral Robustness 43%"无法静态判定，会变成编造的数字。行为级保护应交给变异测试（Stryker/mutmut），那需要执行，可作为可选适配器 |
| 2.9 Change Impact | **采纳（改名）** | 直接/传递依赖者、受影响测试采纳；"blast radius"与"risk score 8.4/10"去除 |
| 2.10 Git History | **采纳** | 共变、热点采纳；bug-fix 频率依赖 commit message 关键词，仅作 info；ownership 集中度作为 info 度量（bus factor），不进入任何门禁 |
| 2.11 Operational Robustness | **不做** | 线程安全、竞态、无界内存无法静态判定，文档中 `results.append` 例子在真实仓库会产生海量误报；资源清理交给现有 linter |
| 3.1 Over-abstraction | **采纳** | 单实现接口 / 单产品工厂静态可数 |
| 3.2 Wrapper Explosion | **采纳** | pass-through 链深度，需要 Call Graph |
| 3.3 Defensive-Code Inconsistency | **采纳（收窄）** | "共享同一 contract"无法判定；收窄为"同模块内调用同一外部 API 的函数错误处理不一致" |
| 3.4 Pattern Inconsistency | **采纳（收窄）** | 不学习语义模式，只统计目录对之间依赖方向的多数派 |
| 4 多图 IR | **采纳 5 张，去 3 张** | Symbol / Module / Call / Test / Git-Change 采纳；CFG 只在提取时算度量不持久化；Data Flow Graph、State Graph 随对应维度一并不做 |
| 5 Pipeline 含 Risk Engine + LLM | **采纳结构，去 Risk Engine** | Risk Engine 本质是打分公式，与 §1.2 冲突；LLM 解释作为可选末端消费者 |
| 6 Evidence-First | **采纳** | 与 v0.1 一致 |
| 7 Typed Finding | **采纳（合并）** | 与 Archify diagnostic 契约合并，新增 `dimension`、`confidence` |
| 8 多维度报告 | **采纳（去分数）** | 保留维度拆分；0–100 分数在没有公开公式前不输出 |
| 9 产品定位 "Can I trust this codebase?" | **部分采纳** | 定位合理，但本子系统只承诺回答其中静态可判定的 6 个问题（§1.1）；数据流安全、production failure、contract 三项明确不在承诺范围内 |
