# Go 官方库方案：决策与验证

日期：2026-11-13。跟踪 [issue #1346](https://github.com/tt-a1i/archify/issues/1346) 和 [PR #1347](https://github.com/tt-a1i/archify/pull/1347)。本记录合并阶段性研究材料，说明最终方案、验收依据和未解决的边界；运行契约由 [GO.md](../../archify/modules/code-analysis/docs/GO.md) 维护。

## 问题与选择

本轮主要替换包加载实现并完善现有行为。函数调用、接口候选、复杂度、精确源码范围和变更查询已经存在；没有新增完整引用、持续诊断或重构功能。

旧实现手工组织包、测试变体和 SDK 导出类型，模块指令使用正则解析。现改用公开的 `go/packages`、`typeutil.Callee` 和 `x/mod/modfile`；默认模式复用包加载的类型信息。Archify 继续负责 AST 指标、源码证据、声明准入和完整接口关系投影。`stdlib:false` 保留一次捕获内 `go/types` 检查，因为包加载没有禁止 SDK 类型的等价开关。

**VS Code 官方 Go 扩展默认使用 gopls**（[`go.useLanguageServer: true`](https://github.com/golang/vscode-go/blob/master/docs/settings.md#go.uselanguageserver)）。本轮参考其包加载、定义查询、方法集和版本职责划分。最初的混合实验同时运行 gopls 和辅助类型检查；公开 LSP 没有直接提供全部指标和值/指针证据，混合方案增加了重复类型检查与服务生命周期成本，因此没有进入产品运行时。也没有导入 gopls internal 包。

| 变化 | 用户结果与维护责任 |
| --- | --- |
| 官方模块解析与语言版本约束 | 接受合法 block/转义；默认语言版本及文件约束生效，类型错误仍可见 |
| 测试变体、混合包名与 SDK 分类 | 按实际类型包身份绑定方法；错误目录保留库存但不制造可靠目标 |
| 分离项目 SDK 和 helper 编译器 | 以项目 SDK 的平台、release/tool tags 选文件，避免较新 helper 错选未来版本文件 |
| worker 拥有临时目录和子进程 | 超时、崩溃、无效输出、缺失依赖明确失败，并清理进程与快照 |
| v6 / revision 9 来源记录 | 保存工具模块校验和、两种工具链和语言版本；历史结果仍可读取 |

代价是新增 helper 构建、进程监督和版本证据，而非大幅减少总代码量。Go helper 从 1,181 行变为 1,216 行；运行代码与 schema 合计净增 193 行。工具模块锁定为 `x/tools v0.52.0`、`x/mod v0.43.0`、`x/sync v0.24.0`，首次使用可能下载模块和 helper 工具链；离线用户需预先准备。

兼容变化必须单独审阅：原实现声明 Go 1.18+ SDK，新方案支持 **Go 1.25+ 项目 SDK、Go 1.26+ helper 编译器**，后者不能落后于项目 SDK 的语言版本。较旧 go.mod 语言版本仍可分析。这不是任意旧 SDK 的支持承诺。

捕获范围仍为选定根模块；第三方依赖、replace、workspace、vendor、嵌套模块和 cgo 不加载。会在隔离快照执行包加载命令，不执行项目程序、测试或生成器。未知调用与接口候选的含义保持不变。

## 验证身份与结果

语义对照基线为 `197980b7`，PR 基线为 `9202eaf48bafb072ed847982201f95bfdca249b5`。生产实现已固定于 `3a9124c40ade29378c95732c1ffd400d849e0b98`；其后这次整理只改说明、引用和对应 ZIP。下列本机实验在 macOS arm64 上运行，历史结果按原日期、源码哈希和工具链身份复用。

| 证据 | 结果与限度 |
| --- | --- |
| 完整模块，Node 20.20.2、真实 jscpd 5.4.3 | 610/610，0 跳过 |
| Go 1.25 专项 | 31/31 |
| 项目 SDK / helper 实测矩阵 | 1.25.9/1.26.2、1.25.9/自动选中已安装的 1.26.0、1.26.2/1.26.2、1.27.0/1.27.0；均覆盖两种 typing 模式、目标平台、release tags 和语言版本 |
| chi v5.5.0、Cobra v1.10.2、x/mod v0.43.0 | 共 4,354 调用、1,583 绑定；库存、指标、导入、调用及接口证据与基线和已保存实验一致 |
| Node 22.23.2，发布前专项 | Go 调用/加载/版本 32/32，无跳过；顶层 CLI 路由 1/1 |
| 解压包公共 Go CLI | 项目 SDK 1.25.9 / helper 1.26.2；chi v5.0.12 得到 54 文件、298 声明、2,706 调用、932 绑定、73 接口逐方法记录、0 类型错误，与已保存事实逐项一致 |
| 提交 3a9124c4 的远端 CI | [完整运行通过](https://github.com/tt-a1i/archify/actions/runs/43357194921)，包括 Linux 回归、版本组合、Node 兼容性、ZIP 和三平台包检查；部署任务按条件跳过 |

首轮完整模块测试为 609/610：并行 SDK 工作期间，原有重复检测超时夹具在写标记前超时，随后读取标记报 ENOENT。该例独立通过，停止并行 SDK 工作并限制测试并发为 4 后完整通过；没有修改测试或放宽超时。失败和重跑身份保留在历史证据中。

自动工具链选择通过 PATH 上已安装的 SDK 验证；本机在线自动下载未验证成功。CI 的 Windows 包/路径检查不能代替 Go worker 在 Windows 下的完整生命周期专项验证。当前 PR head 的远端状态应单独查看，不能把上述旧提交的绿色结果改称新提交实测。

### 真实低版本项目

样本为 [chi v5.0.12](https://github.com/go-chi/chi/tree/1191921289e82fdc56f298a76ff254742f568ece)，声明 `go 1.14`，根模块无第三方依赖，源码未修改。分析包括生产和测试文件，darwin/arm64、cgo 关闭；gopls v0.21.1 由 Go 1.26.2 构建。

- Go 1.25.9：当前产品的 **932 个项目内目标**与直接 gopls definition 查询一致；8 个接口中相同的 **11 对完整实现关系**，22 个原生值/指针断言通过。73 条逐方法记录没有全部独立验证。
- Go 1.18.10：当前产品被版本检查拒绝；仅放宽检查的隔离副本得到 **929 个匹配目标**。gopls 也警告 SDK 不受支持。此实验没有降低正式支持下限。
- 两个 SDK 的项目自身测试均通过。`mux.go:456` 的 `setPathValue` 在 Go 1.18 选择 fallback，在 Go 1.25 选择新版实现，两边一致。
- 独立标准库 AST 库存枚举文件、声明、调用和 UTF-16 范围；以完整起止范围对齐 gopls 名称锚点，避免连续调用共享起点被覆盖。更改目标、删除调用、删除接口关系的故障注入均被对照器发现。
- 绑定数量不是准确率分母。函数值、类型转换、SDK/内建和无具名 callee 分开处理；零差异不证明运行时图完整，也不能从这个简单模块推断复杂依赖工程兼容。

### 可重复执行的产品检查

从模块目录运行，先准备 npm 依赖、锁定 Go 模块和所需 SDK。真实重复检测用例需要 jscpd 5.4.3。

```sh
node --test --test-concurrency=2 test/go-calls.test.mjs test/go-loading.test.mjs test/go-versions.test.mjs
ARCHIFY_TEST_JSCPD=/path/to/jscpd node --test --test-concurrency=4 test/*.test.mjs
ARCHIFY_GO=/path/to/go1.25/bin/go ARCHIFY_GO_BUILD=/path/to/go1.26/bin/go GOTOOLCHAIN=local ARCHIFY_TEST_GO_BUILD_VERSION=go1.26.2 node --test test/go-versions.test.mjs
```

在仓库根目录，用 canonical Node 22 / bundled zlib `1.3.1-e00f703` 执行 `scripts/build-zip.sh /tmp/archify-review.zip`，与提交归档比较，并对仓库外解压目录运行 `node scripts/package-smoke.mjs /path/to/extracted/archify`。具体 CI 命令由 workflow 维护。

专项测试保护可观察的绑定、范围、历史读取和退出清理。消融已删除未消费的 helper version 和重复目标兜底；移除类型包身份索引、SDK 标签传递、captured-only 检查或歧义保护会破坏各自回归，因此保留。此次文档合并以引用完整、原证据仍可获取、运行源码/测试/workflow 哈希不变验证，没有为说明文字增加测试。

## 后续能力：本 PR 不实现

若后续确定需要完整跨模块引用、持续诊断或交互重构，应重新评估直接使用 gopls 的收益；这些需求会改变目前的成本比较。C6 重复检测、C7 诊断导入框架、集中度及变更查询已有实现。

| 能力 | 现有缺口与建议 |
| --- | --- |
| gopls 诊断来源 | 接到现有 C7 导入契约；先保证来源、完整性、范围、版本和去重 |
| references | 补类型、字段、常量、函数取值等非调用使用，不能并入直接 caller 数 |
| 修改后验证 | 诊断可补充回执；仍需项目测试、lint/typecheck |
| call hierarchy | 阅读路径候选，后于 references；不承诺动态调用完整 |
| hover、document/workspace symbol、typeDefinition | 按需增强阅读与定位，保留来源；无需先做完整编辑器 |
| implementation 双向导航 | 可选扩展，保留完整接口及值/指针区别 |
| rename、extract、inline、quick fixes | 后置到验证回执；先提供可审阅 diff，命令副作用需明确操作 |
| organizeImports、formatting | 低优先级，与已有编辑器入口重叠 |
| completion、signature help、semantic tokens、inlay hints | 当前不接入编辑器功能 |
| 逃逸、内联等优化信息 | 以真实需求和可构建工程为前提，不能替代 profiling |
| 重复、架构规则、图映射、多语言与用户试用 | 沿用现有 roadmap，gopls 不直接解决这些目标 |

参考官方 [导航](https://go.dev/gopls/features/navigation)、[诊断](https://go.dev/gopls/features/diagnostics)、[阅读支持](https://go.dev/gopls/features/passive)、[变换](https://go.dev/gopls/features/transformation)说明。未选能力没有在本轮固定版本上逐项验收。

## 历史证据归档

为避免多份阶段性报告互相充当当前规范，原 9 份文件收拢为本文；原始内容保留在固定提交 `3a9124c4`，不重写其结果或身份：

- [版本矩阵、生产源码/测试哈希、消融与失败记录](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-toolchain-evidence.json)
- [低版本 chi 方法和限制](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-low-version-chi.md)及[机器可读摘要](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-low-version-chi-evidence.json)
- [历史官方库/gopls 成本比较](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-official-vs-gopls.md)及其链接的采样数据
- [revision 8 对照](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-official-implementation-evidence.json)和[早期混合实验](https://github.com/testikun/archify/blob/3a9124c40ade29378c95732c1ffd400d849e0b98/docs/designDoc/code-analysis-go-gopls.md)

一次性研究脚本和原始日志未随仓库分发；上述摘要与哈希不构成一键复现材料。历史性能数字不是当前实现的性能保证。
