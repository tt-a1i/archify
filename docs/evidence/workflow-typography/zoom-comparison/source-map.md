# 对照输入的公开来源与生成方式

这两张图概括 Archify 自己的发布配置，来源固定为 `dev` 提交
[`98c839a43eedb95f38700aa5243ea778c0482777`](https://github.com/tt-a1i/archify/commit/98c839a43eedb95f38700aa5243ea778c0482777)
中的 [`.github/workflows/release.yml`](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml)。
它们是依据实际配置编写的流程摘要，不是一次发布成功的运行记录。

选择这个来源，是因为维护者可以公开检查节点及先后关系。图不是 #631 中 n14 或
WMS 的私有输入，也不用于推断那两个项目的全部图都能获益。#631 的公开讨论包含
[n14 的汇总测量](https://github.com/tt-a1i/archify/issues/631)及
[WMS 作者的使用描述](https://github.com/tt-a1i/archify/issues/631#issuecomment-5903807336)，
但没有相应的完整可重放输入。

## 概览图

输入：[release-overview.workflow.json](release-overview.workflow.json)。
范围是从 Windows 前置门禁到 GitHub Release 创建，6 个节点、5 条边。

| 节点 | 实际配置来源 | 概括内容 |
| --- | --- | --- |
| `windows` | [11–40 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L11-L40) | Node 22/24 Windows 矩阵、受控路径夹具及清理；后续作业通过 `needs` 依赖整个矩阵。 |
| `checks` | [43–76 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L43-L76) | 检出和准确 tag 抓取、运行时准备、`npm test`、`test:webm`、`test:browser`。 |
| `identity` | [77–118 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L77-L118) | tag/package 版本匹配、发布通道分类；稳定版额外检查附注 tag 和前一版通知清单。 |
| `build` | [119–120 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L119-L120) | 构建发布 ZIP。 |
| `verify` | [121–129 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L121-L129) | 解压准确归档执行 package smoke，再将构建字节与已提交 ZIP 比对。 |
| `publish` | [130–136 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L130-L136) | 创建 GitHub Release，附上 `archify.zip`，按通道设置 prerelease/latest。 |

`windows-checks` 对应作业级 `needs`；后四条边对应同一 release job 中正常步骤的
源码顺序。原始文件中的检出、安装和运行时准备被合入其所属门禁，并在图下方卡片中
说明。图的终点是发布；[137–140 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L137-L140)
只是稳定版发布后的后续提醒，不在该图的节点范围内。

## 稳定版门禁图

输入：[stable-release-gates.workflow.json](stable-release-gates.workflow.json)。
这张图展开稳定版身份检查和归档验证，保留 10 个节点、9 条边。

| 节点 | 实际配置来源 | 节点副标题表达的约束 |
| --- | --- | --- |
| `windows` | [11–40 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L11-L40) | `Node 22 + 24`，两项矩阵结果共同控制下一作业。 |
| `checks` | [43–76 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L43-L76) | `unit, WebM, browser`，三类回归门禁。 |
| `version` | [77–84 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L77-L84) | `tag = package.json`，比较去掉 `v` 前缀后的版本。 |
| `channel` | [85–97 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L85-L97) | `skill-release.json`，校验发布标识并选择通道。 |
| `tag` | [98–105 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L98-L105) | `annotated Git tag`，稳定版要求附注 tag。 |
| `manifest` | [106–118 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L106-L118) | `stable.json < tag`，比较清单版本和发布版本，不是比较文件名。 |
| `build` | [119–120 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L119-L120) | `build-zip.sh`，构建发布归档。 |
| `smoke` | [121–127 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L121-L127) | `package-smoke.mjs`，针对准确解压归档执行。 |
| `bytes` | [128–129 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L128-L129) | `built = committed`，构建 ZIP 必须与已提交归档逐字节一致。 |
| `publish` | [130–136 行](https://github.com/tt-a1i/archify/blob/98c839a43eedb95f38700aa5243ea778c0482777/.github/workflows/release.yml#L130-L136) | `archify.zip asset`，发布所附归档。 |

`channel-tag` 明示选择 stable 分支，其他边沿配置的依赖与步骤顺序前进。
开发版会跳过两项稳定版专有检查，不在这张稳定版路径图的范围内。失败会阻止后续
正常步骤，本图没有虚构自动重试、审批人、灰度或回滚操作。

图中后三条 Ubuntu 泳道是同一 job 的阶段分组，不表示并行作业。
同列的两个顺序步骤使用相同的 `yOffset: -60 / 60` 来声明上下位置；这是
[Workflow v2 的垂直堆叠用法](../../../../archify/renderers/workflow/README.md#readable-v2)，
并非按版本调整的几何。两组输入均不指定 `meta.viewBox`、节点宽高或绝对连线路径，
画布和节点尺寸由各版本的编译器计算。

## 可重复生成

`generate.mjs` 默认新建独立的临时证据目录，打印路径后在其中生成 HTML 和
`generation.json`，不运行性能循环或浏览器。每次默认调用使用不同目录。
它要求官方 Node **22.23.1 / zlib 1.3.1-e00f703**，并通过 `process.execPath` 为每个
CLI 子进程固定同一运行时。运行前将以下两个路径替换为本机真实位置；候选仓库是当前
命令执行的仓库，基线仓库必须检出上面的完整 SHA。

```sh
NODE22="/absolute/path/to/node-v22.23.1/bin/node"
BASE_REPO="/absolute/path/to/archify-base"
"$NODE22" docs/evidence/workflow-typography/zoom-comparison/generate.mjs \
  --base-repo "$BASE_REPO" \
  --candidate-repo "$PWD"
```

无需给基线安装 npm 依赖；脚本调用仓库自带的公开 `validate workflow ... --json`
和 `render workflow ...` 命令。`--out-dir /absolute/path/to/output` 只接受新目录或空目录；
非空目录及普通文件路径会在写入任何产物前被拒绝，已有证据的字节保持不变。
新 HTML 的截图和浏览器测量应重新采集到同一个新目录。

本目录保留的 HTML、截图、测量及生成记录是 `3ceffd65` 归档的历史证据。
其中 `generatorSha256` 继续指向当时的生成脚本；当前输出目录策略的修改不改写这些
历史产物或摘要。命令不改变输入或任何安装中的 Skill。

每个输入执行三个变体：

1. `before.html`：基线代码，原始 JSON，不设置字体倍率。
2. `after.html`：候选代码，只增加 `meta.typography_scale: 1.5`。
3. 候选代码的默认倍率：临时生成，与 `before.html` 做完整字节比较。

第三份 HTML 完全相同时不重复保存；不相同时保留 `candidate-default.html` 并使脚本
失败。记录包含基线/候选 Git SHA、运行时源码摘要、输入及 HTML/SVG 摘要、验证结果、
节点和边数量、作者拓扑摘要、渲染文字保持情况。脚本检查输出保留每个作者节点与边 ID；
它不将拓扑保持或 CLI 通过冒充浏览器可见性、视觉质量或性能结论。

浏览器的三态比较应打开同一组 before/after HTML：默认 100%、原版通过实际 Viewer
控件放大、候选 100%。现有缩放控件以 25% 为一步；到 175% 会自动显示更多细节，
因此匹配字号时应跟踪相同副标题，并单独说明新增 tag 的显示状态。屏幕可见数量须把
浏览器 viewport、图面板和镜头裁切一起计算；仅 CSS 可见不表示处于当前屏幕内。

## 可选生成耗时采样

在其他测试与渲染结束后，显式追加采样参数：

```sh
"$NODE22" docs/evidence/workflow-typography/zoom-comparison/generate.mjs \
  --base-repo "$BASE_REPO" \
  --candidate-repo "$PWD" \
  --benchmark-runs 15 \
  --benchmark-warmups 3
```

脚本串行运行三个变体，每个变体预热 3 次，保留 15 个样本，并轮换每轮起点。
`generation-benchmark.json` 保存原始毫秒样本、中位数、p95 和极值。时间包括新的 Node
进程、输入解析、渲染命令内部校验、HTML 生成和文件写入；不包含单独的 validate 调用
或浏览器响应。脚本无法保证系统没有其他负载，报告中应说明执行条件，保留样本波动，
不把这组小型本地测量当作通用性能基准。
