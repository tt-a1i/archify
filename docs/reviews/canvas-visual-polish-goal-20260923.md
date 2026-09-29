# 画布视觉优化实施记录

状态：**G1–G4 实现、A1–A17 验收、视觉审阅、消融和产物同步完成。** 改动保存在本地独立分支工作区，尚未提交或推送；PR 等待 #531 合并后整理基线。

后续用户试用发现透镜切换意外重置镜头，修复及新的验证结果见[透镜镜头保留记录](lens-preserve-camera-20260923.md)。本文证据清单保留初次实现时的源码与产物身份。

范围和验收定义见 [Goal](../specs/canvas-visual-polish-goal.md)。用户在新任务中要求按原任务最新 Goal 与分支建议继续实施；工作分支为 `codex/canvas-visual-polish`，起点为 PR #531 的 `018378126c5d09085ef79afcd28434d388e8a2bf`。实施开始核实 #531 仍 OPEN，未修改其分支。最终本地源码／模板身份、输入哈希与验证结果记入 [证据清单](canvas-visual-polish-evidence/manifest.json)。本轮未改 schema、发布版本或 live Skill 安装。

## 实现

- 网格在现有 Camera 帧内选取嵌套的世界坐标点阵。基础层间距为 `24 × scale × 2^ceil(log2(1/scale))`，保持 24–48 CSS px；半间距过渡层按倍率淡入，主网格保持五倍间距。四层均校正半格相位至同一世界原点，点半径为 0.8／1px。基础／主层透明度为主题文字色的 8%／13%。平移只更新原点，倍率或模式变化才更新层级，无网格计时器或时间动画。
- 普通固定桌面画布和说明侧栏取消外阴影；常驻浮层使用 `0 3px 12px / 10%`，菜单和搜索／透镜面板使用 `0 8px 24px / 16%`，顶部按钮使用 `0 1px 3px / 4%`。保留预设色调与既有节点效果。
- 导航按钮文字为 11px，图标 14px，点击区域至少 32×32px。倍率框固定 6.4rem，仍提供全图和 100% 重置。采用不透明的现有菜单底色，并用分隔线、留白和底部指示区分功能组／选中态。
- 固定图例从原 SVG 的权威条目读取标签、顺序、色块与线型，统计沿用原 bridge，选择仍由同一个 `selectedKinds` 管理；两种外壳共用预览、激活与方向键处理器。零数量及纯说明条目仍不是按钮。没有第二个 Lens、选择仓库或统计器。
- 图例最多两行，空间不足时显示带条目数的入口；完整列表向内展开，可换行和滚动，最高 320px 且不超过画布高度的一半。Chrome Layout 为左右两端常驻控件共同保留底部空间，展开临时列表不改变镜头。Radar、Passport 与 Lens 沿用各自原有避让算法。
- 仅在固定桌面模式完成投影后用容器作用域的 CSS 隐藏原图例，并取消其 Tab 入口。断点、演示、embed、打印恢复原版；焦点映射到可见的对应条目或入口。没有向原 SVG 添加隐藏样式，也没有改导出克隆／清理路径。

## 自动验收与视觉验收

最终 Node 门禁共 2145 项：2070 通过、0 失败、75 跳过。跳过中，63 项浏览器入口已由独立统一浏览器门禁执行；其余为大小写敏感文件系统 1 项、Windows 专属 7 项、非 Node 22 拒绝分支 1 项、可选 MCO 仓库 1 项，以及本轮未改动的站点集成 2 项。最终统一真实浏览器门禁 **384 项全部通过，0 跳过**，包含同一份本地 Maka 的条件验收。未运行远程 CI。

Node 22 ZIP 包外五类 smoke 通过；84 个打包文件与当前源码一致（`package.json` 按原打包规则去除开发脚本与依赖）。模板 freshness、公共文档链接及 `git diff --check` 通过，源码／测试／产物和公开视觉证据的 SHA-256 已写入清单。

| Goal | 执行证据 |
| --- | --- |
| A1 | 五类公共输入与本地 Maka 输入由独立基线归档和候选分别渲染，规范 SVG 逐字节一致；清单记录公共输入及 SVG 哈希。作者节点／关系／图例和 viewBox 未改。 |
| A2–A3 | 执行真实 Camera 输入回归，覆盖合法小于 1% 的适配、分层边界两侧、平移原点和只更新位置；基线 25% 网格为 6px，新回归先红后绿。浏览器另验超宽输入及 24–26% 连续 21 个倍率样本。 |
| A4 | 五类图浅深主题、四种实际预设的同输入截图审阅；不是仅比较 CSS。最终数值见上文。 |
| A5–A6 | 三语言×四预设×浅深主题在 1024×600 并打开侧栏时测量按钮命中、溢出以及正常／选中态的复合颜色对比度；非禁用按钮文字均 ≥4.5:1。连续倍率改变时邻接按钮位置差 ≤1px。既有 Camera、Focus、Finder、Route、Lens 门禁覆盖原输入合同。 |
| A7–A9 | 五类图固定位置／字号在 20 次平移缩放后差 ≤1px；逐条核对标签、角色和计数；覆盖全部、零数量、单项与无图例。Lens 原生悬停、Enter／Space、方向键、Home／End、关闭返回焦点均运行。 |
| A10–A12 | 1024×600、1366×768、2048×1320 及侧栏开关，左右间距 ≥8px；长标签列表末项、原生滚轮、Esc 和页面无溢出均验证。Camera framing、18 场景章节和 Radar／Passport／Chrome Layout 回归覆盖共享可用矩形及避让。 |
| A13 | 1023×600、1024×599、390×844 回退；断点往返、演示、打印、embed、禁用脚本及真实 Chrome 200% 页面缩放。新增断言按实际 CSS 视口检查只显示适用的一份图例。 |
| A14 | 五类 SVG 导出只有一份原图例，无固定外壳，导出前后活 SVG 与相机保持。既有清理门禁生成真实 PNG／JPEG／WebP，检查导出图片和打印样式截图。共享导出清理未修改，条件性站点 WebM 门禁不触发；统一浏览器套件仍包含原有真实 WebM 解码回归。 |
| A15 | 120 帧稳定视口平移不重写或排版固定图例；Still 静止 600ms 图例 DOM 写入为 0。Camera／Radar 的逐帧扫描计数、布局稳定和模式恢复门禁运行；控制台错误、重复 ID 均为空。 |
| A16 | 五类公共图与同一份 Maka 输入的浅深主题／全图／100% 对照逐张审阅，另审阅全部预设、三语言底栏和长列表。公共证据随文档保存，Maka 原图／JSON／详细证据仅存本地。 |
| A17 | 最终源码生成模板、两套示例、Gallery 11 项／99 checks、Checkout 对比 HTML／receipt、README 54 帧动图和 Node 22 ZIP；最终 Node、统一浏览器与包外 smoke 结果见清单。guide／start 输入未变，不做无关重建。 |

五类对照：[架构](canvas-visual-polish-evidence/architecture.jpg)、[工作流](canvas-visual-polish-evidence/workflow.jpg)、[时序](canvas-visual-polish-evidence/sequence.jpg)、[数据流](canvas-visual-polish-evidence/dataflow.jpg)、[生命周期](canvas-visual-polish-evidence/lifecycle.jpg)。每张按浅／深主题、全图／100% 分行，左为固定基线、右为候选。[预设](canvas-visual-polish-evidence/presets.jpg)（[浅色前后](canvas-visual-polish-evidence/preset-pairs-light.jpg)、[深色前后](canvas-visual-polish-evidence/preset-pairs-dark.jpg)）和[语言底栏](canvas-visual-polish-evidence/languages.jpg)使用实际切换后的页面。[浅色网格连续帧](canvas-visual-polish-evidence/grid-light.gif)、[深色网格连续帧](canvas-visual-polish-evidence/grid-dark.gif)展示分级边界；顺序播放后反向回放。

[导出浅色 PNG](canvas-visual-polish-evidence/export-light.png)、[导出深色 PNG](canvas-visual-polish-evidence/export-dark.png)、[打印样式](canvas-visual-polish-evidence/print-preview.png)、[长列表](canvas-visual-polish-evidence/overflow-open.png)已实际查看。对照截图固定为 Still，避免原有动画相位干扰。

视觉观察：低倍率点阵不再形成密集灰纹；浅色画布边缘的灰晕减轻，深色仍有清晰边框；底栏文字和图例在小倍率下保持屏幕字号。时序／数据流的线型说明保留，未变成节点计数按钮。长列表折叠后两个入口均可达，打开时完整名称可换行。原图例留白仍在，属于有意保留的作者几何；没有为了视觉紧凑裁剪 viewBox。100% 手动阅读允许图形位于工具后方，符合原合同。

## 实施消融

| 隔离删除的候选 | 原验收结果 | 决定 |
| --- | --- | --- |
| `interactionChangesScale`、`gridPositionOnly` 与跨调用层参数 | 原 Camera 输入 23 项仍全部通过，包括平移只写网格原点；网格自身已按倍率／模式检测变化 | 永久删除这套冗余标记和参数 |
| 图例布局尺寸／字体缓存 | 同一 120 帧平移验收，删除后 1725 次额外 DOM 写入；保留时 0 次；基线无固定图例 | 保留缓存，删除方案不满足 A15 |

实验在独立临时副本中进行，未把消融源码混入最终门禁。没有新增全局布局求解器、偏好持久化、图例拖拽、设置面板或第二套选择状态。

## 发现与修正

1. 全局 SVG 最小宽度影响投影色块并导致过早折叠；为色块设置 `min-width: 0`，实际布局验收通过。
2. 原有部分测试通过原 SVG 选择器操作现已隐藏的图例；改为用户看到的固定入口，并保留回退原图例测试。
3. 自动布局旧用例把导航移出画布后要求底部占位清零；固定图例仍常驻，因此更新为保留图例所需空间，未放宽取景／交叠门禁。
4. 无 `matchMedia` 的可选平台回退暴露未保护调用，已修正并重跑 Motion Governor 场景。
5. 视觉审阅发现 `?preset=` 不会切换实际预设；改用 `Archify.preset.apply`，断言实际值，再重做四预设对照与对比度检查。旧的伪预设覆盖未作为最终证据。
6. 选中态补测发现原路径按钮强调色仅 3.77:1，固定桌面改用高对比文字色，保留底色／下划线提示；复合背景断言覆盖所有预设和语言。
7. 保留 Lens 自定义 opener 的返回行为，并补充了回归；字体加载完成后显式失效图例布局。

## 复现

```sh
cd archify
npm test
npm run test:browser
# 可选保存新用例的浏览器截图和 DOM 观测
ARCHIFY_CHROME="/path/to/chrome" ARCHIFY_POLISH_EVIDENCE="/tmp/polish-evidence" \
  node --test test/canvas-polish-browser.test.mjs
```

macOS GUI／Chrome 测试通过正式沙箱外执行路径完成。最初沙箱内 Node suite 的本地监听被 `EPERM` 拒绝，后续正式 Node 门禁改在沙箱外运行；没有把受限运行当成通过。

当前修改保存在本地独立分支的工作区，尚未提交或推送。

PR 策略继续按原建议：#531 未合并时保留独立开发分支；待 #531 合并后核对基线，再向 `labs/infinite-canvas` 准备只包含本轮改动的独立 PR。本轮不合并 #531、不发布、不安装 live Skill。
