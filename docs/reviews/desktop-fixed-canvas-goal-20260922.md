# 固定桌面画布：最终验收记录

状态：**已完成（2026-09-23）。G1–G4 与 A1–A18 全部通过本地验收。** 范围见 [Goal G1–G4 / A1–A18](../specs/desktop-fixed-canvas-goal.md)。

分支 `codex/labs-infinite-canvas`，HEAD `3791eb59840e10cd5766871e21b723fa2358b4ea` 加既有工作区改动。未提交、推送、合并、发布或安装 live Skill。

## 交付行为

- 普通桌面 CSS 视口 ≥1024×600 时固定页面，以真实剩余高度分配画布，不出现页面横／纵向滚动条。相机平移、缩放和“全图”访问全部图形；初始 100% 仍允许显示局部。
- 原说明卡片使用独立“图示说明”侧栏，只保留一份内容树。侧栏有自己的滚动、键盘焦点和关闭入口；没有卡片时不显示空入口。
- 节点标题、副标题、tag 和箭头文字默认完整绘制，不再按 MAP／READ 层级隐藏，也不因悬停改变标题位置。缩小时文字随相机缩小，高亮与补充详情保持。
- 窄屏、短窗口、embed、演示和打印保持各自合同；浏览器页面缩放按实际 CSS 视口切换布局。
- 打印清除相机变换、裁切和背景网格，完整 SVG 等比放在一页，原说明在后续页面连续输出。

权威改动集中在 `viewer/viewer.css`、`reader-layout.js`、`template.source.html`、`viewer-camera.js`、`viewer-chrome-layout.js`；i18n、Skill／Viewer／delivery 合同和原测试按同一边界同步。

验证还发现并修复了三处真实交互回归：章节定位混用不同定位父级的 offsetLeft；详情拖动跨断点取消后的尾随 click 误关闭面板；箭头命中层无条件 stopPropagation 拦截画布抓取。最后一处保留普通主键箭头选择，但允许中键、右键、空格＋主键和直接指针平移传递给相机。

## 最终证据与范围

持久证据根目录：
`/LOCAL_ONLY/evidence/fixed-canvas-verification/`

下列证据路径相对此目录。private-project 私有素材与截图仅在本地，未加入公开 fixtures、Gallery 或 ZIP。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 最终真实浏览器统一门禁 | **329 通过，0 失败，0 跳过**；392 秒 | `candidate-5/test.log`，`status.txt`，`test-exit.txt` |
| 最终源码一致性 | 运行记录的 Viewer、模板、浏览器测试及 private-project HTML 哈希全部匹配当前源码 | `candidate-5/inputs.sha256`，`archify-fixed-canvas-candidate5-hashes.log` |
| README 动图 | 从最终产物重建，54 帧、5.4 秒 | `candidate-5/readme-showcase.log` |
| 完整 Node 测试 | **2057 通过，0 失败，72 条件跳过**，共 2129 项，194.5 秒；命令退出码 0 | `archify-fixed-canvas-complete-node.log` |
| 包外 smoke | Node 22 ZIP 解包到仓库外，五类图及零依赖入口通过 | `archify-endpoints-package.log` |
| private-project 严格交付 | showcase 9/9，0 错误、0 警告，provenance current | private-project 目录 `check-result.json`、`delivery-result.json`、delivery receipt |
| 最终截图与打印审阅 | 当前 private-project 初始／全图、六个原生拖动端点、PDF 四页均实际查看 | `candidate-5/visual-review.md` 与对应 PNG／PDF |

浏览器执行来自用户手动运行 `/tmp/archify-fixed-canvas-verify.sh`，本轮目录 `/tmp/archify-fixed-canvas-verify.353e3k`。此前本地 URL 策略明确禁止绕过，agent 未通过其他浏览器／CDP 启动验证，仅读取用户产生的实际日志和截图。非浏览器 npm test 不设置 `ARCHIFY_CHROME`。72 条件跳过保持单列，包含未设置 Chrome 的路径、Windows／其他 Node 版本／大小写敏感文件系统条件、外部 MCO fixture 和独立站点门禁；不将跳过记作通过。适用浏览器路径已由独立统一门禁实际运行。`git diff --check` 通过。

## A1–A18 逐项验收

下表的浏览器证据均来自最终 `candidate-5`。自动检查与感知审阅分别列出；不是仅凭页面不滚动判定内容可达。

| 项目 | 结果与直接证据 |
| --- | --- |
| A1 | 通过。五类图、纵向图、80 条长说明、private-project 共 8 类 × 4 桌面尺寸 × 2 主题，64 组 root/body 溢出和主动页面滚动检查；工具及画布在视口内。`fixed-canvas/observations.json`。 |
| A2 | 通过。画布内滚轮平移、修饰键滚轮缩放、方向键及原生拖动；标题／工具栏外部滚轮不改变相机或页面。完整门禁中的 fixed-canvas 与 camera 原生输入用例。 |
| A3 | 通过。长图、极宽图、private-project 均以实际原生中键连续抓取到达两端，未调用程序化 panBy／reveal／centerAt 或 Fit all 替代。末端分别需 21、52、4 次拖动，scale 始终 1、页面位置与滚动范围均 [0,0]。六张端点截图已查看；五类／长宽图 Fit all 14 组及侧栏投影安全边距检查通过。`endpoints/endpoints.json`、`camera/`。 |
| A4 | 通过。48 组侧栏布局／文字一致性检查；原内容单一副本、最后第 80 条、完整标题和链接可达，private-project 无卡片时没有空面板。 |
| A5 | 通过。侧栏顶部／底部继续滚动不传给页面或相机；原生文本选择、编辑输入、空格／方向键及浮动面板归属检查通过。 |
| A6 | 通过。原生 Enter 打开、Tab 遍历链接与编辑区、命名区域、展开状态、Escape 关闭及返回入口焦点；无隐藏焦点残留。 |
| A7 | 通过。20 次侧栏开关、fit-all 四角安全边距、窗口 resize 与手动镜头 scale 保留；旧 reset／fit／0／百分比入口默认状态兼容。 |
| A8 | 通过。侧栏与 Radar／Passport／Finder／导出菜单并用命中检查；菜单用 Escape 关闭后再操作被菜单暂时遮住的侧栏关闭入口。Radar 两帧内同步；详情断点取消与箭头命中层回归通过。 |
| A9 | 通过。1023↔1024、599↔600 及窄屏三轮切换；真实浏览器页面 200% 缩放分别得到 CSS 720×406 文档流与 1440×856 固定画布。DPR=2、pinch=1、图内 scale=1，未混同页面缩放与相机倍率。`fixed-canvas/browser-page-zoom.json`。 |
| A10 | 通过。Reader 长标题、动态内容、字体就绪、可选 observer 与排版稳定检查；章节严格居中、四 preset × 双主题文字检查通过。 |
| A11 | 通过。普通／演示／embed、390px 窄屏宽图、主题和减少动态效果的原有浏览器回归通过；退出与回到桌面不残留固定限制。 |
| A12 | 通过。开启侧栏并缩放／平移后的 PDF 共 4 页，第一页完整图，后续含说明 1–80；逐页审阅无空白网格页或图形截断。规范 SVG／图片导出与相机恢复检查通过。未改导出录制或站点集成，无需追加独立 WebM 解码／站点门禁。 |
| A13 | 通过。120 帧 Radar／Camera 路径无逐帧节点测量或完整排版增长，20 次面板开关和尺寸切换稳定；拖动释放、无运行时错误与空闲收敛检查通过。 |
| A14 | 通过。完整 Node 测试 2057 通过／0 失败／72 条件跳过；真实浏览器门禁 329/329。包外 smoke、private-project receipt、最终源码哈希与当前截图通过。模板、双份五类示例、Gallery、对比图／receipt、README 动图、Node 22 ZIP 均已同步，一致性检查通过。 |
| A15 | 通过。7 类输入 × 100%、50%、200%、10%、Fit all 共 35 组原文本与祖先可见性检查；指针不悬停，保留标题、副标题／context／fine 和连线文字。 |
| A16 | 通过。四 preset × 双主题原生 hover／focus／移出和清除操作不改变原文本集合或标题位置；语义聚焦、高亮与补充详情的原回归保留。 |
| A17 | 通过。正常阅读倍率的五类端点视口与明暗主题、长宽图、private-project 截图审阅，保持作者几何与字号；标签结构检查独立通过。低倍率随相机缩小不代表自动隐藏。 |
| A18 | 通过。普通／窄屏／演示／embed 文本集合，以及打印和规范导出检查通过；旧 Reading Depth 测试迁移为完整文字与真实提示检查，没有删除覆盖。 |

感知审阅复用边界：`candidate-3/visual-review.md` 已实际审阅五类图最小／最大视口 × 双主题共 20 张初始截图、5 张侧栏及面板并用。之后仅修改打印样式及箭头 pointerdown 归属，没有改变这些屏幕几何、主题或文字。最终完整矩阵已重跑并保存新图；当前 private-project、打印与拖动截图独立重新查看，不以旧证据替代最后改动的效果。

## 消融结果

逐个候选尝试移除，未因减少代码而牺牲验收条件：

1. **保留删除**：无调用者的 Reading Depth MAP／READ 提示及 MAP／READ／FULL 名称，共 5 个本地化 key。调用搜索为空；删除后的相关 28 项检查与最终 329 项浏览器门禁通过。仍使用的完整文字／自动提示保留。
2. **恢复保留**：Passport 拖动取消后的 pointer ID 尾随 click 防护。隔离副本移除后原行为检查 1 通过／1 失败，保留后 2/2，通过最终浏览器断点拖动回归。`archify-passport-ablation.log`、`archify-passport-drag-click.log`。
3. **恢复保留**：箭头命中层的平移手势放行条件。隔离副本退回无条件阻止传播，原检查 0/1；保留后连同 Passport 检查 3/3。实际原生长图／private-project 端点先失败、修复后全部通过。`archify-rail-ablation.log`、`archify-rail-restored.log`、`endpoints-red/`、`candidate-5/endpoints/`。
4. 设计期删除手动“画布／阅读”模式及说明开关持久化，自动断点与默认关闭已覆盖需求，不新增偏好系统。

## 生成产物与 private-project

已同步生成模板、`archify/examples/` 和 `examples/` 五类 HTML、保留原 SVG／卡片的 web-app.html、Gallery HTML／manifest／artifacts、checkout 比较图与 receipt、README GIF／元数据及 `archify.zip`。guide/start 的作者输入未变，不引入无关重建差异。

private-project 交付目录：`/LOCAL_ONLY/private-project/docs/architecture/diagrams/fixed-canvas-20260922/`。含 HTML、JSON、严格 receipt、检查结果、四张最终截图及 README。按本 Goal 冻结输入作 Viewer 前后对比，没有重新推断 private-project 拓扑。

- JSON SHA-256：`LOCAL_ONLY_REDACTED_HASH`。
- HTML SHA-256：`LOCAL_ONLY_REDACTED_HASH`。

## 历史与边界

历史失败如实保存在 `implementation-history.md` 和各轮日志：基线 6 个样本中 5 个页面溢出；前三轮分别 98/102、307/321、319/324；第四轮 325/325，但补充端点检查发现箭头拦截拖动，因此没有提前关闭 Goal。最终修复后完整统一门禁为 329/329。父套件失败包含在对应总数内。

本地验收不代表远程 CI、PR 合并或发布。低倍率网格稀疏化、编辑器能力、多指手势和拓扑重新布局仍在既定非目标内。


公开 PR 注：本记录保留原验收时点；`LOCAL_ONLY` 是脱敏占位，不是仓库路径。私有项目输入与截图未发布。公开提交与证据说明见 [PR 汇总](infinite-canvas-pr.md)。
