# curl 的 `-I` 和 `-i` 差在哪？ {#curl-headers}

`-I` 发 HEAD 请求，只显示响应头；`-i` 在普通 GET 的输出中加入响应头，响应体仍会下载并显示。[](source:head)[](source:include)[](source:request)

- 看见的输出、实际下载的响应体和请求方法是三件事。
- 只显示响应头也可能来自 GET：响应体可以下载后丢弃。[](source:fixture)

@answer scope="普通 HTTP 请求 · 无其他改方法选项 · 无重定向或代理"
@meta locale=zh-CN style=clean
@source head title="curl 8.7.1: --head" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/head.md
@source include title="curl 8.7.1: --include" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/include.md
@source request title="curl 8.7.1: --request" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/request.md
@source fixture title="本地受控实验：记录结果" url=https://github.com/tt-a1i/archify/blob/e47bde433b9ca12226a9204e5393c45c1cb6e907/docs/experiments/explainer-reading/curl-headers/probe-output.json
@source rfc-head title="RFC 9110: HEAD" url=https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2
@source length title="RFC 9110: Content-Length" url=https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6
@source dump title="curl 8.7.1: --dump-header" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/dump-header.md
@source output title="curl 8.7.1: --output" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/output.md
@source disable title="curl 8.7.1: --disable" url=https://github.com/curl/curl/blob/de7b3e89218467159a7af72d58cea8425946e97d/docs/cmdline-opts/disable.md

## 请求、下载和显示分别发生什么？ {#comparison}

下表是本地 HTTP/1.1 受控服务的实测结果，不代表所有远程服务器。响应体是 `alpha` 加换行，共 6 字节。[](source:fixture)

| 命令选项 | 请求方法 | 下载响应体 | 标准输出显示 |
| --- | --- | --- | --- |
| 无 | GET | 6 字节 | 响应体 |
| `-i` | GET | 6 字节 | 响应头和响应体 |
| `-I` | HEAD | 0 字节 | 响应头 |
| `-D - -o /dev/null` | GET | 6 字节 | 响应头 |

`-D -` 将收到的响应头写到标准输出；`-o /dev/null` 将响应体输出丢弃。它没有把 GET 改成 HEAD。[](source:dump)[](source:output)[](source:request)

## 为什么 HEAD 仍显示长度 6？ {#length}

HEAD 响应不能带内容；服务端可以返回相同请求用 GET 时的内容长度。它也可以不返回这个头。[](source:rfc-head)[](source:length)

@facts
| 响应头 | `Content-Length: 6`：对应 GET 内容的长度 |
| 本次下载 | HEAD 实测响应体 0 字节 |

这个长度不是 HEAD 实际收到的字节数。实验中 GET 的 6 字节是 `alpha` 的 5 字节加 1 字节换行。[](source:fixture)

## 怎样试这几个命令？ {#commands}

把 `URL` 换成目标地址。以下命令假设普通 HTTP 请求、无代理、无重定向，也没有其他改变方法的选项。`-q` 必须放在第一个参数，以禁用默认配置文件。[](source:disable)

```bash title="查看三种输出"
curl -q -I URL
curl -q -i URL
curl -q -D - -o /dev/null URL
```

最后一条只在屏幕显示响应头，但仍下载 GET 响应体。不要仅凭输出推断请求方法或下载量。[](source:fixture)
