# 作者记录

## sourceaudit

- 已读取冻结版 explainer authoring guide、六份 curl 8.7.1 选项文档、两段 RFC 9110 摘录，以及指定 probe.py 和 probe-output.json。
- `-I` 对应 HEAD；`-i` 把响应头加入输出，默认方法为 GET。文中各自链接固定版本选项文档。
- `-D -` 和 `-o /dev/null` 分别处理响应头与输出位置；本地记录证明该案例使用 GET 且下载 6 字节。
- RFC 9110 指出 HEAD 响应不得发送内容；HEAD 的 Content-Length 若存在，等于相同请求使用 GET 时的内容长度。实测 6 与 HEAD 下载 0 并不矛盾。
- 表中四行均来自受控 loopback fixture，使用 Apple /usr/bin/curl 8.7.1；不是所有远程服务器的测量，也不是上游二进制构建复现。
- 示例限定普通 HTTP、无其他方法更改选项、无代理或重定向；`-q` 首参禁用默认配置。未使用新版重命名选项。

## naturalfriction

- 指南与固定来源足以完成草稿；未发起网络请求、浏览器检查、安装或重新运行实验。
- 首次 strict finalize 通过，无诊断，无修复；原始输出与收据均保留。收据明确 browser-check 未运行，390px 与桌面像素效果尚未检查，交由父任务检查。
- 样例 URL 是占位符，实际行为仍取决于目标服务；页面明确实测仅适用于受控服务。
