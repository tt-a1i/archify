# Architecture Atlas 无闪烁切层：最终实施与验收记录

2026-09-12。目标依据 `docs/atlas-seamless-navigation-goal.md`。分支 `codex/architecture-atlas-v1`，HEAD `8c3af8a11318d3e0f46bb123149c4863d358f830`；实际交付包含工作区最新源码和未提交改动。

**实现、AC01–AC14验收、消融和最终样例交付已完成。** 保留已有工作区改动，未提交、推送、合并或发布。本记录替代此前“浏览器未执行、README动图失配”的中间状态。

## 实现与用户可见行为

目录、搜索及全局工具栏成为常驻工作台。切层时旧图继续显示并允许阅读；唯一候选在不可见但能真实测量的区域完成主题、字体、布局、镜头和阅读状态恢复。确认仍对应最新意图后，一次提交画布、标题、面包屑、目录当前项、检查器、地址和导出目标。默认没有整页过渡动画。

- `archify/renderers/shared/atlas-shell.mjs`：准备/提交/取消/失败、300ms局部反馈、导出等待与历史协调。显式成功才增加历史；原生历史立即撤销旧图权限，失败保留目标地址。历史失败后另选目标时，错误内容保留至新图就绪，避免再次清空工作区。
- `atlas-workbench.mjs`、`atlas-navigation.mjs`：常驻目录及共享搜索、选区、滚动和焦点；成员继续提供完整概览、详情、关系与源码。访问快照恢复镜头、选择、章节、页签以及概览/源码/父层关系滚动。删除目录高度与成员占位互相测量的反馈，消除了每次重排约3px的累积漂移。
- `atlas-toolbar.mjs`：沿用完整原工具栏和菜单，保留DOM身份，命令交给当前已提交成员，没有另造仅支持少数格式的导出菜单。
- `viewer/viewer-address.js`、`motion-governor.js`：候选初始化与活动资格分离；等待稳定布局，处理最新偏好与尺寸，撤销时清理监听和RAF。候选不能操作、回写地址、自动播放或导出。
- `viewer/export.js`：外层工具栏复制图片使用实际接收手势的文档写剪贴板，避免子文档没有焦点而误退为下载；能力检测与操作准入分离，避免候选阶段永久禁用复制按钮。已开始的导出可正常结束，新导出受准备门禁限制；历史离开停止录制并释放tracks。

宽图沿用280px左栏及工作区居中规则。非宽图、紧凑、嵌入、演示和打印沿用原有布局；非宽图/紧凑模式打开目录时预留固定300px阅读空间，图在下方流式展示。不同模式间的位置改变属于既有响应式行为；同模式边界稳定、目标显示后不再跳位是本轮验收对象。

## 最终交付与来源

交付根目录：`/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/atlas-seamless-final/`。

| 文件 | 用途 |
| --- | --- |
| `seamless.html` | 最终可直接打开的离线交互样例 |
| `seamless.atlas.json`、四份 `*.architecture.json` | 实际输入：四图、三层、两处共享引用；不同宽高比、3/2/0/1章节、3/2/1/3概览卡 |
| `delivery.receipt.json` | 四成员各9项检查及整包校验通过，0 errors、0 warnings |
| `provenance.json` | 实际绝对路径CLI命令、分支、HEAD、输入/源码/输出/回执SHA256 |
| `verification.json`、`final-integrity.json` | 独立整包校验、21项来源哈希复算，以及浏览器所测与交付HTML一致性 |
| `process-final/process-evidence.json` | 最终字节的29场景、浏览器版本、网络及感知检查索引 |
| `process-final/*/` | 每场景连续PNG、rAF状态、提交事件、几何、资源记录及 `review.html` |
| `process-final/videos.json` | 四段真实截图序列编码的MP4、命令和哈希 |
| `process-final/perceptual-review.md`、`.json` | 实际查看20张代表原始帧的观察、路径与哈希 |
| `logs/`、`logs.manifest.json` | 最终测试、红基线、消融与历史批次日志，区分最终结果和中间记录 |

最终HTML SHA256：`740c604f1fc7c7782f48a3fb9129e6f515ce68777c015143635d8976e80a7cde`。

根目录的交付与 `process-final/artifact/seamless.html` 字节完全相同。此次使用仓库通用四图样例重新生成，符合goal中无需重新分析OpenPI的范围；没有把此前被浏览器策略拒绝的OpenPI页面换入口访问。内置浏览器实际允许并操作了独立通用样例；自动Chrome验收均经正常审批在沙箱外启动。

模板、开发和Skill示例、Gallery、Checkout compare示例与回执、`archify.zip`已同步生成。ZIP有96项，仓库外解包package smoke通过。README动图已按更新后的Viewer/Gallery真实重录：54帧、5.4秒、1,631,989字节，完整回归确认来源摘要匹配。旧 `process/` 是先前字节的历史证据，最终效果以 `process-final/` 为准。

## 最终验证结果

| 验证 | 结果与日志 |
| --- | --- |
| 完整 `npm --prefix archify test` | 1496项：1442通过、0失败、54按环境/平台门控跳过；`logs/archify-seamless-complete-node.log` |
| 真实过程 + 导出生命周期 | 15通过、0失败、0跳过；`logs/archify-seamless-complete-process.log` |
| 原有Atlas导航 + 常驻工作台 | 12通过、0失败、0跳过；`logs/archify-seamless-complete-navigation.log` |
| 当前成员导出 + 桌面 + Reader布局 | 11通过、0失败、0跳过；`logs/archify-seamless-complete-viewer.log` |
| 最终过程采样 | Chrome/151.0.7922.174；29场景、789张PNG、5942次rAF采样，场景断言errors全部为空 |
| 离线与网络 | 同一最终HTML在file和本地HTTP启动；无自主HTTP请求，仅显式打开的HTTP文档请求，其余为本地/内联资源 |
| 包与生成物 | 仓库外package smoke、模板freshness、`git diff --check`通过 |
| 感知检查 | 实际查看8个场景中的20张代表原始帧，包括相邻提交帧，观察见 `perceptual-review.md` |

真实浏览器三批合计38项通过，与完整Node回归分别报告；门控跳过没有冒充浏览器通过。前期并行批次及等待测试worker退出的中间批次未计为完成。process和navigation最终批次自然退出0；viewer最终批次使用本机Node支持的 `--test-force-exit`，所有已注册测试和清理hook完成后输出TAP并退出0，没有跳过测试、缩短产品启动超时或削弱资源断言。

## AC01–AC14

| 标准 | 结果与证据 |
| --- | --- |
| AC01 画面连续 | 通过。浅/深色三层路径、禁用动效、正常动效偏好、慢加载和返回的逐帧身份/几何检查无错误；代表相邻截图未见中途清空、错误主题或目标显示后再次取景。 |
| AC02 工作台稳定 | 通过。常驻DOM身份、搜索/选区/滚动/焦点及相同模式外壳边界≤1 CSS px；实际30条目录滚动经过切层及Back/Forward保持。 |
| AC03 阅读恢复 | 通过。真实镜头、节点/关系、章节、源码页签及滚动、历史和焦点恢复；补充目录遮住检查器时保存滚动、父层关系重新展开恢复的3项回归。 |
| AC04 延迟反馈 | 通过。可控时钟验证300ms规则；实际约1s延迟保留旧图阅读、搜索焦点和最后镜头。成功、取消、失败清理局部提示。 |
| AC05 竞争与取消 | 通过。重复合并、取消、最后意图、迟到ready、准备中resize/主题改变、原生Back期间点击旧预览覆盖；旧实例不能恢复活动权限。 |
| AC06 历史一致 | 通过。三层Back/Forward、成功才push、失败/取消无新增、当前图no-op、冷深链、无效目标、刷新、hash访问身份及pop/hash去重。 |
| AC07 失败恢复 | 通过。初始化异常、真实启动超时、显式/原生历史失败、重试和另选；错误保留目标地址，另选准备期间保留可操作错误界面。 |
| AC08 主题与尺寸 | 通过。浅/深色1440×900、1600×1000、1920×1080、2048×1320，断点两侧1275×900、1293×900及760×1000窄屏。冷启动、准备期主题/预设/resize和既有嵌入/演示/打印回归通过。 |
| AC09 焦点与无障碍 | 通过本轮范围。真实Tab、搜索焦点、浏览器IME中文组合输入、候选从AX树排除、inert/aria-hidden及局部状态语义、减少动效覆盖。未声称VoiceOver实听或完整无障碍认证。 |
| AC10 单活动与清理 | 通过。最多两个实例/一个活动成员；20次切层后实例与被监测监听/计时器回到基线。实际录制结束/历史撤销后tracks、一次性监听、迟到下载及导出忙状态通过。 |
| AC11 原有能力 | 通过。完整菜单、详情/关系/源码、章节、route/reach/lens、图内搜索、演示和单图回归。真实复制PNG1200×630、剪贴板拒绝回退、当前成员图片/WebM、忙时取最后目标、准备禁新导出及历史取消录制通过。 |
| AC12 交付真实性 | 通过。当前工作区绝对路径CLI重建四图三层样例；逐成员/整包、来源哈希、ZIP smoke及相同最终字节file/HTTP结果一致。 |
| AC13 实际过程证据 | 通过。29场景连续截图、rAF状态、提交时序与几何测量；实际查看代表相邻帧并生成四段回放。自动与感知结果独立记录，未声称每张截图人工检查。 |
| AC14 消融 | 通过。逐项移除/恢复见下表；最终代码禁用动效后完成AC01–09相关真实场景。没有将每个消融变体都描述为跑过完整浏览器矩阵。 |

## 消融与取舍

| 候选 | 操作、结果和证据 |
| --- | --- |
| 重复工作台pending状态/接口 | 删除无样式或读屏消费者的 `data-pending/preparing`，仅保留一个局部状态出口；当时工作台/工作区14项通过，保留删除。`logs/workbench-after-ablation.tap` |
| 工具栏成员到源元素Map | 移除未使用的映射值，改为Set；完整菜单测试及最终真实导出通过，保留简化。 |
| 桥内重复暂停分支 | 删除，沿用撤销事件与播放权限；相关测试通过，保留删除。`logs/bridge-ablation-retained.log` |
| 目录高度测量反馈 | 删除scrollHeight与成员占位的循环测量，使用稳定预算；红基线复现累积漂移，15项专项及最终不同尺寸真实过程通过，保留删除。`logs/workbench-directory-feedback-{red,green}.tap` |
| 撤销时RAF清理 | 尝试删除后仍继续排帧，恢复。`logs/bridge-ablation-remove-paint-cleanup.log` |
| 最终稳定/激活门禁 | 删除导致未就绪激活测试失败，恢复。`logs/bridge-ablation-activation-gate.log` |
| 壳内布局重新确认 | 删除后4项外观、尺寸、目录占位及过期准备测试失败；恢复后当时26项通过。`logs/shell-ablation-{without-revalidation,restored}.tap` |
| 剪贴板活动成员资格 | 删除owner资格检查导致测试失败，恢复；真实外层复制与录制最终通过。`logs/archify-clipboard-ablation{,-restored}.log` |

旧图提前移除的原始红基线、剪贴板真实回退下载的失败、历史失败后另选空白的红/绿记录一并保留。最终代码通过完整回归及真实浏览器验收；没有引入整页动效、多成员缓存或全屏骨架。

## 可复现命令

浏览器命令在macOS上须按AGENTS要求经正常审批在沙箱外运行。测试只生成仓库通用样例。

```sh
cd /Users/sunhonghao/.codex/worktrees/80ec/archify
env -u ARCHIFY_CHROME npm --prefix archify test

env ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  ARCHIFY_ATLAS_EVIDENCE_DIR='/private/tmp/archify-seamless-repeat' \
  node --test --test-concurrency=1 \
  archify/test/atlas-seamless-browser.test.mjs \
  archify/test/atlas-lifecycle-browser.test.mjs

env ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node --test --test-concurrency=1 \
  archify/test/atlas-browser.test.mjs \
  archify/test/atlas-workbench-browser.test.mjs

env ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node --test --test-force-exit --test-concurrency=1 \
  archify/test/atlas-export-browser.test.mjs \
  archify/test/reader-layout-browser.test.mjs \
  archify/test/desktop-reader-browser.test.mjs

node scripts/generate-viewer.mjs --check
node scripts/package-smoke.mjs /private/tmp/archify-complete-package-zvemyw86/archify
git diff --check
```

实际最终样例的绝对路径生成命令由 `provenance.json.command` 原样记录。测试生成路径与交付根目录不同，但已确认HTML字节相同。重跑会产生新的证据，不能覆盖结果后继续引用旧截图或旧回执。

## 证据限制

结论限于本次Chrome版本、样例、尺寸和场景。PNG/rAF可能漏掉未采到的合成器帧，因此结合连续截图、提交、几何和实际观察判断，没有承诺所有设备永不闪烁。MP4按实际截图时间间隔编码，没有插帧或合成过渡；感知检查直接查看原始PNG，没有声称逐帧播放审阅全部视频。

首次无旧图时先显示正确主题的壳和必要提示；300ms是反馈阈值，不是完成耗时承诺。不同布局模式允许原有流式/侧栏调整。资源结论限于被监测实例、监听、计时器、权限和录制tracks，不是任意规模的堆内存泄漏证明。VoiceOver没有单独实听，证据为真实浏览器AX树和交互语义检查。
