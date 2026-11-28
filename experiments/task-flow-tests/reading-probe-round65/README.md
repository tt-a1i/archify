# Round 65：阅读边界问题的对照观察

两位独立的 `gpt-6.1-terra` medium 读者分别在全新上下文中阅读 native 和 Archify 页面，均正确回答了三个明确提示的证据边界问题：[native 回答](native/answer.json)、[Archify 回答](archify/answer.json)。本次观察表明 native 的注释和代码访问足以回答这些问题，没有证据表明 Archify 在此任务上更优。问题、顺序和预期见 [protocol](protocol.json)，事前审查见 [protocol audit](protocol-audit.json)。

每组只有一位读者、一个 fixture，顺序固定为 native 后 Archify；问题主动提示了边界，并非观察未经提示的错误。完整页面 DOM 快照会暴露屏幕外文字，源码提取也能读取横向裁切的渲染代码。两份页面的现有文案与 native notes 不同，因此这不是只改变像素或布局的受控因果实验。不能据此推断人类表现、速度、等效性或一般效果。

两组视口均为 1512×762、DPR 2。[native 截图](native/report.png)保留了 tooltip 和裁切代码；[Archify 路径](archify/paths.png)及[其他路径](archify/other-paths.png)截图原样保留。原始文本、提示、脚本、stdout/stderr（包括空文件）、远端快照与 PR 元数据、清理和服务器日志均在本目录。路径替换规则及每份原始与公开文件的长度和 SHA-256 见 [archive-map.json](archive-map.json)；[manifest.json](manifest.json)记录本目录每个文件（自身除外）。原始数据未改动，截图字节未变。

独立 Sol medium [结果复核](result-audit.json)核对六项回答与实际 DOM／源码记录，均正确。十段浏览器脚本未见越界读取或工具异常；这不证明不存在未归档的文件访问。每段独立进程的 exit code 没有另存，不能仅以 stderr 非空判断失败：本工具把快照和日志写到 stderr。时间戳只作会话记录，不比较速度。

历史最终 visual-check 的 16 条页尾键盘诊断仍为历史记录，本轮没有重跑，也不能视作通过。页面和服务器已关闭；[server session](server-session.json) 与 [cleanup stderr](cleanup.stderr)保留结束记录。

归档校验覆盖 45 份原始／公开文件映射、5 份冻结输入、JSON、文档相对链接与 staged Git 字节。[11 条 whitespace 诊断](whitespace.json)均为原始 stderr 的末尾空行，原样保留；其余 staged 文件检查通过。本轮没有产品改动，没有重跑 renderer、历史测试、完整测试或 CI。

## 复现边界

先用 [frozen-inputs.json](frozen-inputs.json) 核对现有输入长度和哈希。从本目录的父目录启动 `python3 -m http.server 8882 --bind 127.0.0.1`，分别在本机浏览器打开 `http://127.0.0.1:8882/upstream-cli/native/final.html` 和 `http://127.0.0.1:8882/final/review.html`；对应文件为 [native 页面](../upstream-cli/native/final.html)和 [Archify 页面](../final/review.html)。用各自的全新读者上下文提出 [protocol](protocol.json) 中相同的三个问题。脚本是当时的观察记录，包含已结束的空间 17 和动态引用，不能当作可移植自动化；公开脚本中的 `ARCHIVED_RUNTIME` 也是归档占位符。重做观察不会自动复现同一回答。

来源与许可沿用 [NOTICE](../NOTICE.md)、[上游许可证](../upstream-cli/sources/LICENSE)和[第三方许可](../upstream-cli/evidence/THIRD_PARTY_LICENSES.txt)；这里不复制 HTML。
