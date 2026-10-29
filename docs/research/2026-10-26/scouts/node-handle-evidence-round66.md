# Round 66：Node 异步资源与进程存活的证据边界

结论：暂不提出新产品或可视化。上游示例的原生报告已列出资源类型与分配栈；尚无同一真实案例的比较证据说明额外呈现能帮助用户解决问题。更重要的是，现有数据不能补回缺失的调用上下文。

## 具体问题与原生输出

[上游 issue #17](https://github.com/mafintosh/why-is-node-running/issues/17) 中，用户看到四个 Timer 结果都指向 Promise 库内部，想知道它们从何处产生，希望有更多栈上下文。该 issue 没有可复现输入；它是自然问题证据，不能当作已复现的当前版本缺陷。

固定版本的 [example.js](../audit/round66-node-handles/example.js) 两次调用 `startServer()`，各创建一个 interval 和 TCP server。[README](../audit/round66-node-handles/README.md) 给出的原生输出是两条 Timeout 和两条 TCPSERVERWRAP，每条包含创建位置和对应的调用位置。这个示例适合复核输出和源码的关系；它不是 issue #17 的输入或输出。这里只检查上游文档，**没有运行示例**，实际输出与 Node 版本及运行环境的关系未验证。

[issue #42](https://github.com/mafintosh/why-is-node-running/issues/42) 的用户希望在关闭过程中多次采样，因为存活原因会变化；该报告针对 v2.0.3。当前固定版本 [index.js](../audit/round66-node-handles/index.js) 在输出时调用 `hook.disable()`，此后不再通过该 hook 收集新的 init/destroy；不能把后续报告当成完整的时间序列。

## 源码所能支持的判断

该版本通过 async hook 的 `init` 保存类型、资源弱引用和当时的分配栈，`destroy` 删除对应记录。它忽略 `PROMISE` 等类型；没有保存 `triggerAsyncId`，所以不能从这些记录推导资源之间的因果边或完整调用链。报告时过滤已无法解引用的对象，并以 `resource.hasRef?.() ?? true` 判断：缺少 `hasRef` 时默认保留，因而报告中的条目不能逐一证明是实际阻止退出的原因。`init` 分配栈、尚未观察到 destroy 的记录与当前真正维持事件循环的资源是不同概念。[Node 定时器文档](https://nodejs.org/api/timers.html#timeoutunref) 说明 unref 后活跃定时器不再要求事件循环继续运行，但不等于取消定时器。

先前 [round23 Promise settlement 研究](promise-settlement-reading-round23.md) 关注 Promise resolve 与业务副作用的关系；本次关注诊断工具如何记录分配栈并近似筛选进程存活资源。二者相关但问题不同。对研究目录及历史 `origin/codex/research-lab-20261025` 的候选关键词检索未找到相同项目；这不是所有历史研究的全面覆盖证明。

## 来源和限制

上游 `master` 在核查时指向提交 [`6dff5ee27c0093c8e5a8235bf1bbfbb3c03e18ba`](https://github.com/mafintosh/why-is-node-running/tree/6dff5ee27c0093c8e5a8235bf1bbfbb3c03e18ba)。完整原始文件、来源 URL、Git blob SHA-1、SHA-256 和字节数见 [manifest](../audit/round66-node-handles/manifest.json)；blob 值与 GitHub tree 独立核对。许可证为 [MIT](../audit/round66-node-handles/LICENSE)，完整许可随原文件保存。

本轮沿用研究任务给出的 Archify 远端 336 heads 快照背景，没有重新获取全量清单。结论仅来自固定源码、文档和 issue 的阅读；没有运行代码、安装依赖、浏览器截图或用户对比测试，亦不能推断一般性的图示收益。若未来有真实日志，最小的探索可以是保留原始栈及来源、显式标注未知项的静态证据表，并先比较其与原生报告是否真的改善该具体问题。
