# 源码语义/模块探索工具：阶段 1 取舍（2026-09-21）

## 结论与试验边界

研究阶段针对公开、小中型 JS/TS 仓库的一次架构梳理，选取 **ast-grep 0.45.3 `outline`** 做只读模块清单，再按清单读入口、注册点和关键实现；不要把它画成调用图。它是一枚本地 CLI，无项目配置即可按扩展名解析，适合固定“先读哪些文件”。配对实验应保持任务、模型、提示和验收相同，只替换此工具；记录检索耗时、读取文件及最终语义验收。输出 token 少不等于端到端更快或更正确。

本篇为工具选型的研究记录，依据一手源码/官方文档；后续协调实验的实际运行结果另见同目录实验报告。未全局安装工具。“引用/调用”须区分语法出现、静态绑定和真实运行时路径；动态 `import()`、反射、注册、环境和配置只能由源码及运行/测试补证。

## 四类机制

### 1. ast-grep / Tree-sitter（本轮首选）

官方 `outline` 面向 symbols、imports、exports 和 direct members；`--items all` 包含 import 与显式 export 边，`--view digest` 给签名及直接成员。JS/TS/TSX、HTML/CSS、JSON/YAML 等有内置 grammar；`run` 可补充调用或注册表达式。团队本轮已在 Polka、sirv 用发布版验证 outline 可运行；目录默认视图偏 export，可能漏私有职责，所以架构探索应显式 `--items all`，并按 JS/已知源目录限制范围。离线入口（发布二进制放临时目录，不改 repo）：

```sh
$AST_GREP outline --items all --view digest .
$AST_GREP run -l ts -p '$F($$$ARGS)' src --json=stream
```

首次扫描是逐文件解析，不作类型检查或常驻服务。同名标识符、alias/re-export、dispatch 与 `foo()` 的绑定都不能确认；第二条只是 *call expression*。网页可能先于二进制，须记录 `$AST_GREP --version` 及 `outline --help`。

来源：官方 CLI outline [文档](https://ast-grep.github.io/reference/cli/outline.html)，语言/Tree-sitter [介绍](https://ast-grep.github.io/guide/introduction)，规则与结构匹配 [文档](https://ast-grep.github.io/guide/rule-config)。源码固定参照：[`ast-grep@6175e07`](https://github.com/ast-grep/ast-grep/tree/6175e07b668b388a1a326d8fc543c4856eb5f54b)。

### 2. TypeScript Compiler API / Language Service（语义增强候选）

`createProgram` 由 root files/CompilerHost 建立 Program 和 SourceFiles；TypeChecker 合成跨文件 Symbols。配合 Language Service 的 declaration/reference 查询，可处理被 module-resolution/`tsconfig` 覆盖的 import、alias 与引用，适合确认“此引用指向谁”。

集成面比 outline 更广（本轮未测启动耗时）：本工作树未见 `typescript` 依赖，需隔离临时目录、`tsconfig`/文件系统和 Program（JS 还需 `allowJs`）。它仍不回答 runtime config、动态模块、`eval`/反射或条件分支。一次概览不先付此成本；遇 alias、barrel export 或同名歧义再启用。

来源：官方 [Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)、[Language Service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API)。源码固定参照：[`TypeScript@f29aeb9`](https://github.com/microsoft/TypeScript/tree/f29aeb9f825d96feea27841f3f7342dbf0df68a8)。

### 3. Aider RepoMap（不选）

源码用 Tree-sitter query 抓 `name.definition.*`/`name.reference.*` 为 tags；缺 reference query 时以 Pygments 名称 token 回填，再用 NetworkX 按聊天/提及和 token 上限排序并缓存。它是 Aider 的“优先给模型哪些声明”摘要，不是 import resolver/call graph：同名可错连，排序随会话变。另有 Python/Aider 和 cache 成本，故不选。

来源：固定源码 [`repomap.py@5dc9490`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py)。

### 4. LSP/Serena 与 SCIP（后续规模化，不选）

Serena 的 LSP 后端可给 symbol overview、definition、references 和部分 implementations，支持 JS/TS；但要 `uv`、Serena、language server 和 MCP 接入。适合持续多轮检索/编辑，不是一次任务的最低启动面；结果也不证明 runtime path。

SCIP 在 compiler semantic analysis 后输出 documents/occurrences/symbol roles，可 definition/reference；官方 TS/JS indexer 支持跨文件/仓。它适合持久、可审计导航；本轮一次探索却要生成/维护 `index.scip` 和工具链，前置成本可能更高，本轮尚未量化，暂不引入。

来源：Serena 固定 README [`c4dc91a`](https://github.com/oraios/serena/blob/c4dc91a7dac4ea560dc7658581a63dac33a76e6c/README.md)；Sourcegraph 官方 [SCIP indexer](https://sourcegraph.com/docs/code-navigation/writing-an-indexer) 与 SCIP 固定源码 [`db62094`](https://github.com/sourcegraph/scip/tree/db62094c7f9d464d0a6d9fd7815fcf3c9214b4c2)。

## 可证伪的反例

若任务的验收核心是“列出某 exported API 的所有真实静态 callers，跨 barrel export/alias 后仍不可漏”，不要用 ast-grep outline 作为唯一工具：它只能证明语法结构与文本导入/导出。此时应付出 TypeScript Program + Language Service（或已有 LSP/SCIP 索引）的初始化成本，并把 unresolved dynamic edges 单独列为 runtime 待证项；最终仍须通过对应入口测试或运行观察验证执行路径。
