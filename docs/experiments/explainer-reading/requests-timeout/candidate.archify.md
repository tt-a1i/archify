# `timeout=0.4`，下载就必须在 0.4 秒内结束吗？ {#timeout-answer}

不会。这个值限制连接和读取时的等待，**不是整个下载的总时限**。下面的本地实验中，服务器持续分批发送数据，两次完整下载都用了约 0.8 秒。[](source:quickstart)[](source:advanced)[](source:run1)[](source:run2)

@answer span=12 scope="Requests 2.34.2 · 本地 HTTP 实验"
@meta locale=zh-CN style=editorial
@source quickstart title="Requests 文档：Timeouts" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/quickstart.rst#L543-L550
@source advanced title="Requests 文档：连接和读取超时" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/advanced.rst#L1094-L1133
@source adapter title="Requests：超时配置" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/adapters.py#L681-L693
@source body title="Requests：响应体读取异常映射" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L933-L943
@source headers title="Requests：Response.elapsed" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L797-L804
@source probe title="运行这个完整本地实验" path=source/probe.py
@source run1 title="本地实验第 1 次结果" path=source/probe-1.json
@source run2 title="本地实验第 2 次结果" path=source/probe-2.json

## 持续发送：五个字节都读完 {#steady span=6}

服务器立即发送响应头，再逐个发送 `ABCDE`。每发一个字节前，设置等待 0.15 秒；一共发送 5 个字节。[](source:probe)

**结果：完整收到 `ABCDE`，耗时约 0.8 秒。** 总耗时超过了 0.4 秒，请求仍然成功。第 1 次和第 2 次都得到这个结果。[](source:run1)[](source:run2)

## 中途停顿：读取等待超时 {#idle span=6}

服务器同样立即发送响应头，等待 0.05 秒后发送第一个字节，随后设置等待 0.7 秒，再发送后续字节。[](source:probe)

**结果：等待后续数据时抛出异常。** 这次路径抛出的是 `ConnectionError`；不能把它当成成功读到了一个空响应。[](source:body)[](source:run1)[](source:run2)

## 两次实测，耗时列在这里 {#results span=6}

三个场景都设置 `timeout=0.4`。表中单位为毫秒；它们是本机测量值，不是性能承诺。[](source:probe)[](source:run1)[](source:run2)

| 场景 | 第 1 次 | 第 2 次 |
| --- | --- | --- |
| 持续发送，完成 | 783.884 | 787.644 |
| 中途停顿，异常 | 460.036 | 456.114 |
| 等响应头，异常 | 401.456 | 403.210 |

第三个场景在发送响应头前设置等待 0.7 秒，抛出 `ReadTimeout`。这些数值是服务器程序设置的等待时长；字节实际到达客户端的时间会有差别。

## 所以，这 0.4 秒管什么？ {#waits span=6}

单个数值会分别用于**连接超时**和**读取超时**。也可传入 `(连接超时, 读取超时)`，分别设置两者。读取超时约束等待服务器数据的间隔，完整下载可能跨过多个这样的间隔。[](source:advanced)[](source:adapter)

这也解释了前两个场景的差别：下载用了多久，和中途等数据等了多久，是两件需要分别观察的事。连接和读取超时都不能当成严格的总耗时上限。[](source:advanced)

## 复现和处理异常时，留意这两点 {#measure span=12}

**计时要包含响应体。** 这个实验用 `perf_counter` 记录 `Session.get` 开始到响应体读完或抛出异常的时间，使用默认的 `stream=False`。`Response.elapsed` 只计到响应头，不包含响应体读取时间。完整脚本会在本机启动临时服务器，可以从来源中打开。[](source:headers)[](source:probe)

**异常类型取决于发生的路径。** 本次响应体读取超时被转成 `ConnectionError`，它不是 `Timeout` 子类；响应头等待的对照抛出 `ReadTimeout`，它是 `Timeout` 子类。因此，不能假设捕获 `Timeout` 就涵盖了所有读取超时路径。[](source:body)[](source:run1)

这里没有测试 DNS、TLS、代理、重定向或重试，也没有实现整个请求的总时限。
