# Round 67：Python Tutor 浅拷贝与状态变化

2026-10-30。结论：这次原生观察没有提出新的 Archify 方向。Python Tutor 已在逐步视图中展示浅拷贝、共享内部列表的修改、外层元素替换和变量重新绑定。本次没有读者研究，也没有人类、速度或产品优势的结论。

在 [Python Tutor 原生界面](https://pythontutor.com/visualize.html) 的 Ego space 23 中输入六行[原创合成程序](probe.py)，并非上游示例；1512×762、DPR 2。实验始于 10 月 29 日，跨过午夜于 10 月 30 日完成；原件文件夹以开始日期命名。步骤 4（执行第 3 行后）显示 4 个列表框，步骤 5（第 4 行后）4 个，步骤 6（第 5 行后）5 个，完成步骤 6 最终显示 7 个列表框、3 个变量和 8 条引用。最终 root 为 `[[1, 9], [7]]`、copy 为 `[[1, 9], [2]]`、alias 为 `[[8]]`，root 和 copy 共享第一个内部列表。见[状态审计](state-audit.json)、四份 DOM 状态、[拷贝截图](after-copy.png)、[修改截图](after-mutation.png)和[最终截图](final-rebinding.png)。截图展示 Python Tutor 原生界面，归属 Python Tutor。

第一张截图的粉色箭头看起来位于第 2、3 行之间，尽管记录为步骤 4；原因未知，不能据此修正或推断页面缺陷。UI 标示 Python 3.11，[永久链接](permalink.json)含 `py=311`；这不确定后端实际身份。

browser-02 的 textarea 点击被拦截并以 exit 1 结束；browser-04 最终粘贴成功，browser-05 冗余地重新输入相同源码。保留[恢复记录](input-recovery-note.json)和[结果](input-recovery-outcome.json)，这不是产品失败结论。11 组浏览器脚本、stdout、stderr 和 exit 记录均在本目录；space 23 已关闭，脚本是历史记录，不是可直接复用的自动化。

原始本地执行命令在 [local/command.txt](local/command.txt)，在 `local` 下运行。便携复查可在本目录运行 `python3 local/observe.py`。[首次结果](local/stdout.json)来自 Python 3.15，以四个独立源码前缀和新命名空间运行，不是连续执行轨迹，也不证明与 Python Tutor 后端等价。[protocol](protocol.json)记录问题与实验边界。[远端分支记录](remote-heads.tsv)涵盖 336 heads，[issue/PR 查询](github-searches.json)范围有限，均不能证明所有方向无重叠。

复现原生观察：打开上方原生界面，选择 Python 3.11，将 `probe.py` 的六行粘贴进编辑器，等待可见源码完整出现后点击 Visualize Execution。从 Step 1 连续点击三次 Next 到 Step 4，再依次前进一步查看 Step 5、Step 6 和 Done running。分别核对内层 `[1, 9]` 的共享引用、第二个元素由 `[2]` 替换为 `[7]`、以及 alias 最终独立指向 `[[8]]`。也可从 `permalink.json` 的 URL 打开最终位置；链接可能在当时的线上服务重新执行，不能冻结或证明本轮的后端构建身份。

先前 `codex/lab-copy-identity@18d51b8950a9c3713c72044dd6af8e12c9f33e24` 已有静态 4 变量、7 列表、10 引用的 copy identity 图，但不是 mutation trajectory；Bloaty 在 round 36 已覆盖。收尾时 336 个 head 中仅 `explainer-reading-lab` 从 `62c44717f7473c8917709aa7f71b45759bee1ece` 前进至 `5492057ceb5f4267c11e8c8a3c3ad3450acd4788`。独立静态审阅的三个提交涉及 restore 命令、ripgrep 比较和研究索引，未发现 Python Tutor 或浅拷贝实验；未执行页面，亦不能证明所有语义重叠不存在。见[收尾审阅](close-overlap.json)和[收尾 heads](close-remote-heads.tsv)。

[官方文章](https://pythontutor.com/articles/python-visualizer.html)和文档仓库 `c7b7fee29fe60d74a967ff59437f9e1ecbe38a35` 的许可未确认，未将文章 HTML 或 unsupported-features 正文复制入 Git；仅保留[来源元数据](source-metadata.json)、[文档树](doc-tree.json)和链接。旧文档不等于线上部署源码，不能推断 MIT 许可。

原始 PNG 和 probe 按原字节保存。公开 stderr 将每个以 `[p1 ...` 开始的静态页面快照，包含 root 和缩进的无障碍树，整块省略至下一个未缩进的自有 console 输出；这是有损处理，保留错误、时间、程序状态和工具元数据。部分 .mjs 将精确原始根路径替换为 `ARCHIVED_RAW_ROOT` 占位符。外部原件仍在原采集位置，[copy-map](copy-map.json)逐项列出原件和公开件的 SHA256、字节数及转换。占位符只是来源标记。原始日志未被改写。

[manifest](manifest.json)覆盖包内其他文件并排除自身；[validation](validation.json)记录本次文件、JSON、链接和本地对照检查。这是研究证据归档，不是产品实现或验收。
