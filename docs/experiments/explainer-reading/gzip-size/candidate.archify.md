# 为什么 gzip 压缩后反而更大？ {#gzip-size}

gzip 输出包含压缩后的 DEFLATE 数据和包装信息。**当压缩节省的字节不足以抵消包装，输出就会变大。** DEFLATE 数据本身也可能比输入更大。[](source:measure)

- 小输入可节省的字节少，包装开销容易超过节省量。
- 数据内容不同，DEFLATE 的结果也不同；要测量实际输入。

@answer scope="四个合成输入 · level 9 · mtime 0 · 字节数"
@meta locale=zh-CN
@source measure title="四个 gzip 输入的实测结果" url=https://github.com/tt-a1i/archify/blob/9320ccd5c69748678981fc8b47c28489853fa75c/docs/experiments/explainer-reading/gzip-size/probe-output.json
@source rfc title="RFC 1952：gzip 成员格式" url=https://www.rfc-editor.org/rfc/rfc1952.html#section-2.3
@source zlib title="zlib：raw DEFLATE 与 gzip 包装" url=https://github.com/madler/zlib/blob/21767c654d31d2dccdde4330529775c6c5fd5389/zlib.h#L565-L575
@source python title="CPython gzip.compress 实现" url=https://github.com/python/cpython/blob/d220409a13b77de7a6c30abe16ea90db01528edc/Lib/gzip.py#L660-L676

## 多出的字节在哪里？ {#parts}

这些实测输入各产生一个 gzip 成员，且没有可选头字段。每个结果的包装是 **18 B：10 B 头部 + 8 B 尾部**。尾部包含 CRC32 和输入长度字段，各 4 B。[](source:rfc)

所以在这些样本中：gzip 大小 = raw DEFLATE 大小 + 18 B。raw DEFLATE 是压缩数据，不包含 gzip 头部和尾部。[](source:zlib)

@callout level=note title="18 B 的范围"
| gzip 格式允许可选头字段，也允许多个成员；其他 gzip 文件的总包装大小不一定是 18 B。[](source:rfc) |

## 四个输入的实测结果 {#examples}

下表单位均为 B。采用 Python 3.15.0、zlib 1.2.12，显式设置压缩级别 9 和 mtime 0。[](source:measure) [](source:python)

原始输入 → gzip 输出放在同一格，括号里是变化量。“压缩数据”指 raw DEFLATE，不含前述 18 B 头尾字段。

| 输入 | 原始 → gzip | 压缩数据 |
| --- | --- | --- |
| 一个 ASCII A | 1 → **21**（+20） | 3 |
| 1024 个 ASCII A | 1024 → **29**（-995） | 11 |
| 固定派生字节 | 1024 → **1047**（+23） | 1029 |
| 29 B gzip 再压缩 | 29 → **47**（+18） | 29 |

固定派生字节由 SHAKE-256 和固定种子生成，用于复现这一输入。第四行的输入是第二行产生的 29 B gzip 结果。结果只描述这四个输入，不能推断随机数据或已压缩数据总会变大。[](source:measure)

## 遇到变大时怎么判断？ {#check}

- [ ] 比较原始输入和最终 gzip 输出的字节数。
- [ ] 如需定位原因，分别测 raw DEFLATE 与 gzip 包装的大小，并确认使用的格式和设置。
- [ ] 用实际数据复测；不要把这里的结果当作其他文件的压缩率。
