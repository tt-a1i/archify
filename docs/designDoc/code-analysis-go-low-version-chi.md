# chi 低版本 Go：gopls 与 Archify 正确性对照

日期：2026-11-13。测试 Go adapter revision 9，不修改产品支持下限。机器为 macOS arm64。摘要和源码哈希见 [验证数据](code-analysis-go-low-version-chi-evidence.json)。完整回执及一次性研究脚本位于未随仓库分发的研究归档 `go-analysis-research-20261112/low-version-chi/`；本报告描述方法和结果，不声称仓库已提供一键复现实验。

## 结论

在本次真实项目中，当前产品使用 Go 1.25.9 SDK 得到的项目内函数/方法目标，与直接查询 gopls 的结果一致，没有发现漏绑、错绑或多绑。文件选择、函数/接口方法声明库存、调用完整坐标，以及完整接口实现关系也一致。

实际 Go 1.18.10 SDK 暴露的是接入策略差异：当前 Archify 会在 Go 1.25 最低版本检查处拒绝；gopls v0.21.1 发出“不支持该 SDK”的消息，但仍返回查询结果。在隔离副本中，仅把 Archify 的版本检查从 1.25 放宽到 1.18，仍使用 Go 1.26.2 构建原 helper，分析成功且目标对照一致。**因此，Go 1.25 下限不是分析这个项目所必需的技术条件；这不等于已经证明所有 Go 1.18 项目均可支持。** 产品源码和支持承诺没有因本实验下调。

## 项目与版本

- 项目：[go-chi/chi v5.0.12](https://github.com/go-chi/chi/tree/v5.0.12)，tag 对应提交 `1191921289e82fdc56f298a76ff254742f568ece`。
- 原始 [go.mod](https://github.com/go-chi/chi/blob/v5.0.12/go.mod) 声明 **Go 1.14**，根模块无第三方 require。项目源码和 go.mod 未修改，逐文件与下载归档核对一致。
- 分析范围：根模块的 `chi` 和 `middleware` 两个包，包含生产代码和测试代码；排除 `_examples`、嵌套模块和不满足 SDK 构建条件的文件。两边均使用 darwin/arm64、cgo 关闭、无自定义 tags、离线包加载。
- 实际项目 SDK：官方 Go **1.18.10** 与 **1.25.9**。Go 1.18.10 下载归档 SHA-256 与官方发布清单一致。
- gopls：**v0.21.1**，由 Go **1.26.2** 构建，项目环境分别固定到上述 SDK。
- Archify：`go-source-direct-v6`，revision **9**，helper 编译器 Go **1.26.2**，锁定 `x/tools v0.52.0`。Go 1.18 实验副本只改 worker 中最低版本比较，未替换依赖或改 AST/类型实现。

## 验证结果

| 项目 SDK / 分析方案 | 文件 | 函数及接口方法声明 | AST 调用 | 项目内绑定 | 对照差异 |
| --- | ---: | ---: | ---: | ---: | --- |
| Go 1.25.9，当前 Archify | 54 | 298 | 2,706 | 932 | 0 |
| Go 1.18.10，当前 Archify | — | — | — | — | `extract/go-unavailable`，被最低版本检查拒绝 |
| Go 1.18.10，隔离副本仅放宽最低版本检查 | 53 | 297 | 2,692 | 929 | 0 |

gopls 在两个 SDK 下均无 definition 查询错误；Go 1.18 下保留了 SDK 不受支持的消息，不能把“能返回结果”表述为其正式支持该版本。该消息建议旧 SDK 使用 gopls v0.14.2；本轮没有改用旧版 gopls。Archify 两个成功分析结果的类型错误均为 **0**。

932 / 929 是项目内可绑定声明数，不是“准确率”的分母。Go 1.25 下另外 1,585 个调用对应 SDK/内建声明，32 个对应变量或类型等非函数声明，157 个没有可查询的具名被调对象；它们按现有捕获边界保持 unresolved。Go 1.18 的对应数量为 1,575、32、156。gopls 的导航结果也可能指向函数变量或类型，不能把每个 definition 结果都转换成静态调用边。

接口方面，两边在 **8 个项目接口**中识别出相同的 **11 对完整接口实现关系**，没有缺失或额外的项目具体类型。Archify 为这些关系记录 73 条逐方法证据；本轮单独用 Go 1.18 和 Go 1.25 编译运行 **22 个值/指针断言**，全部通过。这独立确认了 11 对关系的 `valueSatisfies` / `pointerSatisfies`，并未将 73 条逐方法元数据全部表述为独立验证。

项目自身 `go test -count=1 -timeout=90s ./...` 在 Go 1.18 和 Go 1.25 下的两个包均通过。它证明测试项目本身在这两个 SDK 上可运行，不代替分析器语义核对。原始 Go 1.25 单元测试使用该 SDK 默认 cgo 配置；分析器对照及专门的接口断言均明确关闭 cgo。

## 具体源码核对

1. **真实版本分支。** [mux.go:456](https://github.com/go-chi/chi/blob/v5.0.12/mux.go#L456) 的 `setPathValue(rctx, r)`，在 Go 1.18 下指向 [path_value_fallback.go:18](https://github.com/go-chi/chi/blob/v5.0.12/path_value_fallback.go#L18)，在 Go 1.25 下指向 [path_value.go:15](https://github.com/go-chi/chi/blob/v5.0.12/path_value.go#L15)。后者调用 Go 1.22 才有的 Request.SetPathValue；前者为空实现。两个分析器的选择均与项目 SDK 一致。
2. **完整接口及指针区别。** `*Mux` 满足 Router 和 Routes，`Mux` 值不满足；gopls 实现查询、Archify 关系及独立编译断言一致。WrapResponseWriter 的六个具体包装类型也保留了正确的指针方法集关系。
3. **连续两次调用不能合并。** `maintainDefaultRequestID()()` 的内层调用绑定工厂函数，外层调用返回的函数值保持 unresolved；`mx.NotFoundHandler().ServeHTTP(w,r)` 的内层能绑定项目方法，外层 SDK 方法不能伪造成项目目标。对照器采用起点和终点组成的完整 source range，避免嵌套调用共享起点时相互覆盖。

## 方法与独立性

- 用各 SDK 的 `go list` 获取实际选择文件，再由独立、只依赖标准库的 `inventory.go` 枚举声明、调用与 UTF-16 坐标；不调用 Archify 的 AST 投影代码。
- 通过 LSP 直接向 gopls 查询每个具名 callee 的 `textDocument/definition`，查询项目接口的 `textDocument/implementation`。仅复用历史实验的 JSON-RPC 传输/进程监督部分，不复用旧混合适配器的绑定筛选或声明索引。
- gopls 返回名称坐标，Archify 使用函数声明起点；对照器通过独立 AST 的声明映射规范化坐标后逐个比较。所有调用必须具有唯一完整 source range。函数值、类型转换、内建和 SDK 目标单独归类，避免混淆导航与静态调用。
- 运行比较器的故障注入：更改一个目标、删除一个调用、删除一组接口关系，均能被比较器识别；原结果无差异。实验中发现并修复了“只按起点对齐嵌套调用”的测试脚本错误，产品没有因此修改。
- 完整接口关系之外，值/指针事实由独立项目副本里的 Go 原生类型断言检查，使用原项目类型，不调用任何分析器 API。

## 限制与后续依据

这个项目没有根模块第三方依赖、cgo 或复杂 workspace，且函数语法主要来自较旧 Go。结果不能推出任意旧 SDK、复杂依赖工程或未来 Go 语法都兼容；也不证明运行时调用图完整。gopls 与我们均依赖 Go 类型系统，零差异不排除共同的上游问题，所以同时保留了项目测试、源码核对和原生接口断言。

若希望正式支持 Go 1.18 SDK，下一步应明确维护版本窗口，并在包含更多语言/SDK 边界的回归矩阵中验证后再调整产品检查。本次仅交付测试证据；没有安装/升级 live Archify、修改全局 Go 或新增 gopls 产品依赖。
