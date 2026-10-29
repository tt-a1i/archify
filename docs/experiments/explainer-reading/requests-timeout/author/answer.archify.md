# `timeout=0.4` 要求 0.4 秒内下载完吗？ {#timeout-answer}

不要求。`0.4` 秒限制连接和读取等待，并不是整个响应下载的截止时间。只要读取过程中持续收到数据，完整下载可以超过 0.4 秒。[](source:quickstart)[](source:advanced)

@answer scope="Requests 2.34.2 · 本地 HTTP 探针"
@meta locale=zh-CN style=editorial
@source quickstart title="Requests 文档：Timeouts" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/quickstart.rst#L543-L550
@source advanced title="Requests 文档：连接和读取超时" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/docs/user/advanced.rst#L1094-L1133
@source adapter title="Requests：超时配置与异常映射" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/adapters.py#L681-L693
@source body title="Requests：响应体读取异常映射" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L933-L943
@source headers title="Requests：Response.elapsed" url=https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/models.py#L797-L804
@source probe title="完整本地探针" path=probe.py
@source run1 title="本地探针第 1 次结果" path=probe-1.json
@source run2 title="本地探针第 2 次结果" path=probe-2.json

## 这 0.4 秒管什么？ {#waits}

单个数值会分别用于连接超时和读取超时。也可传入 `(连接超时, 读取超时)`，分别设置两者。读取超时关注等待服务器数据的间隔，而不是给整个下载计时。[](source:advanced)[](source:adapter)

@sequence id=read-flow title="读取等待与完整下载"
| actor client | 客户端 | frontend |
| actor server | 服务器 | backend |
| client | server | 建立连接并请求 |
| server | client | 响应头 | return |
| server | client | 数据到达，继续读取 | return |
| server | client | 更多数据到达 | return |
| server | client | 响应体完成 | emphasis |

## 两种发送节奏，结果不同 {#cases}

下表是同一个本地探针的两次实测。服务器延迟是请求的休眠时间，不是客户端收到字节的精确时间。[](source:probe)[](source:run1)[](source:run2)

| 情况 | 服务器设置 | 第 1 次结果 | 第 2 次结果 |
| --- | --- | --- | --- |
| 持续发送 | 每个字节前请求等待 0.15 秒，共 5 字节 | 完成，783.884 毫秒 | 完成，787.644 毫秒 |
| 响应体长时间空闲 | 首字节前等待 0.05 秒，随后等待 0.7 秒 | `ConnectionError`，460.036 毫秒 | `ConnectionError`，456.114 毫秒 |
| 响应头延迟 | 响应头前等待 0.7 秒 | `ReadTimeout`，401.456 毫秒 | `ReadTimeout`，403.210 毫秒 |

持续发送的完整下载都超过 400 毫秒，仍然成功。响应体长时间空闲的结果是异常，不是成功下载了空响应体。

## 计时与异常如何理解？ {#measure}

探针用 `perf_counter` 测量 `Session.get` 到完整响应体消费结束或抛出异常的时间。默认 `stream=False`。`Response.elapsed` 只计到响应头，不是完整下载时间。[](source:headers)[](source:probe)

本次响应体读取路径将底层读取超时转为 `ConnectionError`，它不是 `Timeout` 子类。响应头等待的对照则抛出 `ReadTimeout`，它是 `Timeout` 子类。因此不能假设所有读取超时都只需捕获 `Timeout`。[](source:body)[](source:run1)

这些耗时是本机回环测试结果，不是性能承诺。连接和读取超时也不是严格的墙钟总时限；DNS、TLS、代理、重定向和重试等不在这次探针范围内。[](source:advanced)
