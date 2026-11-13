# Go 官方库接入与缺陷修复

2026-11-12，基于 `197980b7` 和本地 gopls 对照实验。实现采用官方库路线，保留此前实验的结果和源码身份；本报告不表示已合入或发布。

## 2026-11-13：PR 集成准备

跟踪 [#1346](https://github.com/tt-a1i/archify/issues/1346)，同步 `labs/code-analysis` 的 `9202eaf48bafb072ed847982201f95bfdca249b5`。新增基线只改文档和归档；本次同时更新语言参考中的旧 SDK 要求。版本拆分证据中的 9 个源码/测试 SHA-256 和 CI workflow SHA-256 仍与提交内容相同，故复用下述完整模块、版本矩阵和语义对照，不将它们重新标作最终提交上新跑的结果。

补充检查使用 macOS arm64、官方 Node 22.23.2 / bundled zlib `1.3.1-e00f703`：Go 调用、加载和版本测试 **32/32**，无跳过；顶层 CLI 路由 **1/1**。从已跟踪源码重建 `archify.zip`，再次独立构建逐字节一致，SHA-256 为 `4b1e4297b3d5d4e1fcca86534f6de6dadc2ef7dade3d9941223416f14a9eb78e`。解压到仓库外通过 `scripts/package-smoke.mjs`；worker、Go helper、go.mod 和 go.sum 均与源码逐字节一致。

随后仅在临时解压包中安装模块 npm 依赖，经公共 CLI 以 Go 1.25.9 项目 SDK / Go 1.26.2 helper 编译器分析 chi v5.0.12：54 文件、298 声明、2,706 调用、932 绑定、73 接口逐方法记录、0 类型错误。文件、声明、导入、调用及接口证据与已记录的 Go 1.25 对照事实逐项相同。该检查验证归档交付路径；没有安装 live Archify，也没有再次运行 gopls。

可执行回归入口为 `node --test --test-concurrency=2 test/go-calls.test.mjs test/go-loading.test.mjs test/go-versions.test.mjs`（模块目录），以及仓库根目录的 `node --test --test-name-pattern='Code Analysis exposes' test/code-analysis.test.mjs`。版本矩阵通过 `ARCHIFY_GO` / `ARCHIFY_GO_BUILD` 选择已安装 SDK；首次构建需准备锁定 helper 模块。历史研究 JSON 中的 `<research-archive>`、`<home>`、`<temporary>` 是脱敏路径，原始一次性脚本未随仓库发布。远端 CI 结果以 PR 的实际检查状态为准；本机检查不替代原生 Windows/Linux 覆盖。

## 2026-11-13：按 gopls 的职责划分拆开 Go 版本

当前源码为 revision 9，调用模型仍为 v6。以下 revision 8 的测试回执保留原日期和源码身份；本次验证另存于 [版本拆分证据](code-analysis-go-toolchain-evidence.json)。

随后完成 [chi v5.0.12 的真实低版本对照](code-analysis-go-low-version-chi.md)：Go 1.25 下当前产品的 932 个项目内绑定与直接 gopls 查询一致；Go 1.18 下当前产品被版本检查拒绝，隔离副本仅放宽检查后 929 个绑定亦一致。后者是实验结果，尚未调整产品支持下限。

参考 gopls 的 [三种 Go 版本说明](https://go.dev/gopls/#supported-go-versions)、固定 v0.21.1 的 [FetchGoEnv 与视图 SDK 记录](https://github.com/golang/tools/blob/gopls/v0.21.1/gopls/internal/cache/view.go)，以及 [Go 工具链选择机制](https://go.dev/doc/toolchain)。采用其职责划分，没有引入 gopls internal 包或另写工具链下载器。

| 职责 | 当前实现 |
| --- | --- |
| 项目加载 SDK | `ARCHIFY_GO` 或 PATH 的 Go，最低 1.25；固定使用该安装自身的 SDK，项目阶段 `GOTOOLCHAIN=local` |
| helper 编译器 | `ARCHIFY_GO_BUILD`，默认沿用项目 Go 命令作为启动入口；helper go.mod 要求 1.26，允许 Go 自动选择或下载工具链，也遵守显式进程 `GOTOOLCHAIN=local/path/...` |
| 项目语言版本 | 原 go.mod 的 `go` 指令，省略时 1.16；文件 release constraints 由官方类型检查规则处理 |

helper 编译器的语言版本不得落后于项目 SDK，否则明确失败并提示调整 `ARCHIFY_GO_BUILD`。因此可以用 Go 1.25 SDK 分析 `go 1.18` 项目，同时用 1.26 编译 helper；这里没有恢复对 **Go 1.18 SDK** 的支持。gopls 官方支持最近两个 Go 主版本，本项目另外验证了 1.25 SDK 的兼容路径并加入 CI；不能从本次样本推断任意旧 SDK 都受支持。

关键修正是从项目 SDK 的 `go list` context 取得目标平台、release tags 和 tool tags，再交给 `go/build.Context.MatchFile`。仅拆开两个可执行文件而保留 helper 的 `build.Default.ReleaseTags`，会把 SDK 1.25 本应排除的 `go1.26` 文件纳入库存。编译器记录在 `loader.toolchain`，项目 SDK 记录在 `loader.projectToolchain` 及 build/standardLibrary 的 toolchain，均进入比较和捕获指纹。revision 8 的 v6 结果仍可读取。

接入成本仍包括首次 helper 工具链与锁定模块的准备；Go 自己负责查找、下载和缓存工具链，不修改全局 Go 或项目 go.mod。离线用户可分别指定已安装的项目 SDK 和构建 SDK，并预填模块缓存。项目 require、replace、workspace 和 toolchain 指令仍不扩展快照加载范围。具体命令见 [GO.md](../../archify/modules/code-analysis/docs/GO.md)。

本次真实 SDK 验证：1.25.9 / 1.26.2、1.25.9 / 自动选择 1.26.0、1.26.2 / 1.26.2、1.27.0 / 1.27.0（前者为项目 SDK）。每组覆盖两种类型加载模式、Linux/amd64 标签、旧 go.mod 与文件语言版本，以及项目语言过新时禁止自动升级。另验证 `GOTOOLCHAIN=local` 阻止 helper 升级、helper 比项目 SDK 旧时的失败，以及 Go 1.25 下的完整 Go 专项用例。

最终完整模块回归 **610/610，0 跳过**；Go 1.25 专项 **31/31**；四组版本组合及顶层 CLI 路由通过。三个真实项目重新捕获，与 revision 8、已存 gopls 实验及旧基线的调用、函数指标、导入、接口边一致：**4,354 个调用、1,583 个绑定目标**。首轮完整回归为 609/610：并行 SDK 验证期间，未修改的重复检测超时夹具在写入调用标记前已超时，后续读取标记报 ENOENT；该例独立通过，停止并行 SDK 工作并将测试并发限制为 4 后，完整回归通过。未修改该测试或放宽超时，失败与重跑日志均保留。

自动选择通过 PATH 上已安装的官方 1.26.0 SDK 验证。当前机器的模块代理下载失败；测试 SDK 改从官方下载站取得并核对发布 SHA-256。不能将此记录表述为成功验证了在线自动下载。验证只覆盖本机 macOS arm64，Linux/amd64 是分析目标，未运行原生 Linux/Windows 或远端 CI。

上述验证时的 `archify.zip` 仍是旧版本，不含 worker/go.mod；该历史状态保留在版本拆分 JSON 中。PR 准备阶段另行从已纳入版本管理的源码重建归档，并在 PR 验证部分记录包验收结果，不能把后续归档检查算入上述模块回归。

消融保留了两处删减：移除未消费的 helper 顶层 version 字段，以及 worker 已规范化目标后重复的宿主平台兜底。隔离副本删除项目 SDK 标签传递后，回归确实错误纳入未来版本文件，故该传递保留。未新增 helper 常驻服务、二进制缓存格式或版本兼容分发层。

## 2026-11-12：revision 8 落地记录

- 默认使用 `go/packages` 提供包与类型信息，用官方 `typeutil.Callee` 取得调用对象；AST 指标、坐标、源码证据、完整接口方法集和值/指针区别继续保留。
- `stdlib:false` 使用官方包元数据加一次捕获内 `go/types` 检查。默认模式没有第二遍自有类型检查，也没有 gopls 回退。
- 删除 gopls 服务客户端、LSP 查询流程及 `vscode-jsonrpc` 依赖。原实验已保存到独立研究目录，可重跑对照。
- 新结果为 `go-source-direct-v6` / `go-packages@0.52.0` / revision 8。loader 来源、工具模块版本与校验和、SDK 和语言版本进入事实及捕获指纹；旧 go-parser v1–v4 和 gopls v5 结果仍可读取。
- 采用源码与锁定 go.mod/go.sum 交付，需要 Go 1.26+。首次构建可以下载固定 helper 模块；项目分析阶段关闭第三方模块与工具链下载。离线环境可预先准备模块缓存，缺失时明确失败。

入口见 [Go adapter](../../archify/modules/code-analysis/extract/go/index.mjs)、[worker](../../archify/modules/code-analysis/extract/go/worker.mjs)、[Go helper](../../archify/modules/code-analysis/extract/go/extract.go)；使用说明见 [GO.md](../../archify/modules/code-analysis/docs/GO.md)。

## 补齐的缺陷

| 问题 | 修复与保护 |
| --- | --- |
| 正则不能完整解析 module block / Go 字符串转义 | 使用官方 `x/mod/modfile`；保留原 go.mod 内容并验证隔离范围 |
| 声明语言版本只在部分模式生效 | 默认加载和捕获内 checker 都传递版本；省略 go 指令按官方默认 1.16，较新语法报告类型错误而不丢声明库存 |
| 混合 package 名字的目录可能产生不可靠绑定 | 保留语法库存，发现包名不一致后禁止该目录的目标绑定 |
| 测试变体与生产包同路径，但类型对象不同 | 按实际 `*types.Package` 身份找方法声明所属组；外部测试调用内部测试变体的方法不再误判为歧义 |
| 按 `.test` 后缀跳过，会丢真实模块 | 区分有捕获源码的包与生成的 test-main；生成入口的拒绝不再计作项目类型错误或未知外部包 |
| 用路径有无点号猜 SDK 包 | 根据 SDK 源目录分类，避免把 `module app` 的项目导出混进标准库证据 |
| 空包加载或部分错误被误作成功 | 有有效捕获源码却加载不到包时明确失败；其他包错误保留为 partial typing |
| LSP 替换后只测试 server 生命周期 | 改测实际 helper 的超时、子孙进程退出、崩溃、无效 JSON、离线缺依赖及临时目录清理 |

加载来源契约明确变更：v6 的 `standardLibrary.projectCommands:true` 表示在隔离快照执行包加载命令，`loader.projectCodeExecuted:false` 表示没有执行项目程序、测试或生成器。旧模型保留旧字段含义；版本和 producer 不同的结果不能伪装为同口径对比。

## 参考与保留边界

参考固定版本 gopls 的 [包加载](https://github.com/golang/tools/blob/gopls/v0.21.1/gopls/internal/cache/load.go)、[定义查询](https://github.com/golang/tools/blob/gopls/v0.21.1/gopls/internal/golang/definition.go)和[方法集查询](https://github.com/golang/tools/blob/gopls/v0.21.1/gopls/internal/golang/implementation.go)。**VS Code 官方 Go 扩展默认使用 gopls**（[`go.useLanguageServer` 默认 `true`](https://github.com/golang/vscode-go/blob/master/docs/settings.md#go.uselanguageserver)）；这不表示 Go SDK 或 VS Code 本体附带 gopls。Archify 运行时只依赖 Go 公开库，没有复制其 internal 包或引入编辑器 session/cache 体系。[Go 模块规范](https://go.dev/ref/mod#go-mod-file-go)定义了缺省语言版本及语言特性约束。

范围仍是选定根模块的源码快照：第三方依赖、replace、go.work、vendor、嵌套模块、cgo 不加载。未知调用不等于没有调用；接口实现候选不等于运行时目标；类型错误可见不等于提供完整编译诊断。未在本轮增加 roadmap 中的完整引用、持续诊断或重构功能。

## 验证和消融

- 聚焦 Go、比较口径及 extractor revision：**46 / 46**，0 跳过。
- 完整 Code Analysis 模块：**609 / 609**，0 跳过；配置真实 jscpd 5.4.3，包含此前需要外部检测器的用例。
- 顶层 CLI `serve/check/task` 路由冒烟通过；不重复它包装的完整模块套件。
- chi v5.5.0、Cobra v1.10.2、x/mod v0.43.0：共 **4,354 个调用、1,583 个绑定目标**；函数指标、导入、接口边和调用语义与 `197980b7` 及已保存的 gopls 实验分别一致。最终对照与源码哈希见 [验证数据](code-analysis-go-official-implementation-evidence.json)。

删除了手工测试包组装、旧 SDK compiler-importer 装配和 LSP 生命周期后，保留上述契约。消融中没有删除 `stdlib:false` 兼容检查或声明歧义保护：先前删除实验分别触发 SDK 接收者和错误声明负例。实现完成后又在隔离副本移除了类型包身份查找，外部测试方法调用用例失败；生产源码保留该索引，未被消融副本修改。进程监督层保留，因为故障注入验证了它对退出和目录清理的作用。

本机为 macOS arm64 / Go 1.26.2 / Node 20.20.2。CI 已固定 Go 1.26.2；未运行远端 CI、原生 Windows/Linux 或发布 ZIP 验收，不把本地通过表述为发布完成。源码 helper 首次构建的模块下载成本已明确写入使用说明。

原始回执保存在未随仓库分发的研究归档 `go-analysis-research-20261112/implementation/`。仓库 JSON 提供摘要和哈希，不能单凭它们重跑未分发的历史对照脚本；可重复执行的产品回归在模块 `test/` 中。前序成本研究见 [官方库与 gopls 对照](code-analysis-go-official-vs-gopls.md)，其中性能数字属于当时的实验，不作为本轮最终源码的性能保证。
