# 稳定尺寸与首屏取景：实施与验收记录

状态：**已完成：G1–G4 与 C1–C16 均有最终证据。** 对应 [G1–G4 / C1–C16](../specs/canvas-framing-goal.md)。本轮保留已有 worktree 改动，未提交、推送、发布或安装。

## 当前实现和范围

固定桌面画布的 100% 使用原 SVG 单位/CSS px 基准；首次和全图完整居中，自动倍率不超过 100%。手动缩放／平移后，侧栏和窗口变化保持实际比例与画布中心对应的图内位置；断点往返以最近用户意图为准。显式节点／章节／分享定位优先；百分比、0、reset 和旧 fit 保留原点 100% 重置合同。

本 Goal 相对冻结工作区实际调整 Camera、Reader、Chrome Layout、Focus／Guided Views 初始化、固定 SVG 尺寸和重置提示。原 SVG 几何、布局、字号、配色与文本保持；没有增加模式、相机历史、跨刷新存储或另一套相机。此前分支已有的拖动／侧栏等改动未当成本轮新增。

第三版补充：忽略 SVG DOMRect 小于 0.01 CSS px 的舍入噪声，避免重置坐标被假布局变化改写；自动 fit 退出固定画布后允许工具栏留白重新探测，仍保护手动模式。

## 内容和产物来源

持久证据根目录：`/LOCAL_ONLY/evidence/canvas-framing-verification`。

- `baseline/`：实施前 Viewer、模板、worktree diff、五类代表图和完整 private-project 的同输入 HTML／JSON／哈希。
- `candidate-1/`、`candidate-2/`、`candidate-3/`：各版源文件、六组输入与 HTML、来源哈希和历史记录。不得把旧截图改称第三版截图。
- `user-run-1/`、`user-run-2/`、`user-run-3/`、`user-run-4/`：用户真实执行日志、输入哈希及该轮产物。第三次运行记录的两个测试源在 `test-source/`，便于与后续修正对照。

完整 private-project 输入哈希 `LOCAL_ONLY_REDACTED_HASH`，11 节点、11 连线、2 分组、3 章节、3 卡片。保留规格声明的仓库版本 `LOCAL_ONLY_REDACTED_HASH`，未重新分析业务，未用简化数据替换。

当前 HTML：`/LOCAL_ONLY/private-project/docs/architecture/diagrams/canvas-framing-20260923/private-project-system.architecture.html`。

当前 HTML 哈希 `LOCAL_ONLY_REDACTED_HASH`，严格 deliver：9/9 showcase，0 错误、0 警告，31 条源码证据已按规格版本核验。JSON、delivery receipt 与结果保存在同目录。

第三版已同步模板、五类示例（仓库与包内双目录）、保留原 SVG／卡片的 web-app.html、Gallery 11 项和清单／入口、Checkout 比较 HTML／receipt、Node 22 ZIP。guide/start 没有依赖输入变化，不做无关重建。README GIF 已在第四次用户运行按第三版源码重建：54 帧、5.4 秒；来源一致性已由最终 Node 门禁验证。

## 最终验收证据

以下浏览器证据均来自第三版源码的 `user-run-4/`（原始目录 `/tmp/archify-framing-verify.XwneAD`），164 个运行输入哈希与当前文件逐一一致。用户执行统一门禁，agent 读取日志、测量记录和实际截图。

| 验收 | 最终证据 | 结论 |
| --- | --- | --- |
| C1 同输入与内容 | `candidate-3/content-identity.json`：6/6 JSON 字节及规范作者 SVG 完全一致；private-project 11/11/2/3/3 和来源核验 | 通过 |
| C2 完整首屏 | `framing/observations.json`，36 组矩阵最小留白 16px，最大中心误差 0.000336px，页面滚动为零 | 通过 |
| C3 小图与实际尺寸 | 小图自动倍率 1；50/100/200% 实际 CTM 和节点尺寸检查；最大自动倍率 1 | 通过 |
| C4 长／宽图 | 300 节点约 9%、极宽约 6%，连续放大；`endpoints/` 原生拖动抵达长图、宽图及 private-project 两端 | 通过 |
| C5 首帧／延迟初始化 | 36 组连续首帧保持全图；延迟字体的手动、节点、章节意图均不被覆盖 | 通过 |
| C6 侧栏保持 | 低倍率、50/100/200%，20 次开关侧栏，实际比例、节点尺寸与中心锚点断言 | 通过 |
| C7 resize／断点 | 三轮 resize、断点往返、回退新操作接管；自动 fit 回退留白及严格 reset 噪声回归 | 通过 |
| C8 全图重复操作 | 完整适配、重复 fit、resize 跟随及用户输入接管；真实 Camera 与浏览器测试 | 通过 |
| C9 导航优先级 | 节点／章节／分享深链、无效回退、搜索和 Radar，原生输入坐标与导航合同 | 通过 |
| C10 重置 | 严格 scale=1、x=0、y=0；百分比、0、reset 和旧 fit；取消手势与键盘归属 | 通过 |
| C11 全部文字／观感 | 实际查看 36 对首屏联系表、private-project 原图、12 张浅／深 100% 原图、小图／长宽图和侧栏前后；`framing/qa/review.json` | 通过 |
| C12 说明／面板 | 固定画布 71 子项，80 条说明、焦点、输入归属、四 preset 与现有面板；原生拖动尾随点击合同 | 通过 |
| C13 模式／页面缩放 | 真实浏览器 100/200% 页面缩放、DPR 和 CSS 视口记录；窄屏、短窗口、演示、embed、主题及减少动态效果 | 通过 |
| C14 打印／导出 | `fixed-canvas/complete-diagram-and-notes.pdf` 四页逐页转图审阅：完整纵向图和 1–80 条说明；规范导出组通过 | 通过 |
| C15 性能／稳定性 | Radar 60 次平移 + 60 次缩放，无全节点扫描／面板排版增长；事务完成、替换与取消；矩阵无控制台错误 | 通过 |
| C16 最终门禁／包 | 浏览器 374/374，0 跳过；Node 22 ZIP 84 文件，包外 macOS 五类 smoke；private-project strict；消融与 GIF 重建完成 | 通过；Node 2066 通过、0 失败、73 条件跳过 |

视觉结论：首屏完整包含底部链路、分组边界和图例。private-project 在 1366×768 为约 65%，1440×900 为约 83%，2048×1320 为 100%；宽窗口保留自然留白，不继续撑大节点。100% 下原文字直接绘制；private-project 底部可能超出当前可见画布，但原生拖动可达，初始全图完整包含。极低倍率总览用于定位结构，不承诺每个词一屏可读；现有密集网格的观感按约定留待独立美化。

## 实际运行记录

- 最初受控 Camera 回归 0/3：首屏局部、小图 342%、resize 中心漂移，见 `baseline/camera-red.log`。这是执行真实 Camera 的受控几何，不能冒充 CSS／浏览器验证。
- 第二版定向检查：89 通过、25 浏览器条件跳过；`archify-framing-focused-followup.log`。
- 用户第一轮：小图遗漏必填 `meta.output`，在浏览器开始前失败；补齐并添加无浏览器也执行的 fixture 生成预检，9 张图实际生成成功。
- 用户第二轮：42 通过、3 失败（含父项）。首屏与镜头保持通过；同文件只改变 hash 却等待 load 事件导致两个超时，已改为各例独立加载。
- 用户第三轮完整门禁：374 项，355 通过、19 失败（含 4 个父项），0 跳过。发现重置噪声和自动 fit 回退留白两处实现问题，并暴露旧首屏假设与精度断言，均已在第三版处理，第四轮复验全部通过。
- 第二版完整 Node：2138 项，2064 通过、1 失败、73 跳过。唯一失败是 README GIF 来源哈希过期，见 `archify-framing-full-node.log`。
- 第三版定向合同：59 通过、0 失败、24 浏览器条件跳过，见 `archify-framing-candidate3-contracts.log`；相机输入子集 20/20，不把子集重复计数。第三版完整 Node 实际结果：2139 项，2065 通过、1 失败、73 跳过；唯一失败仍是 README GIF 来源哈希过期，见 `archify-framing-candidate3-full-node.log`。
- 用户第四轮：第三版完整浏览器 374 项通过，0 失败、0 跳过，耗时约 428 秒；README GIF 重建成功。`user-run-4/test.log`、`readme-showcase.log` 和 `artifact-hashes.json` 留存完整来源。
- 第三版最终完整 Node：2139 项，2066 通过、0 失败、73 条件跳过；`archify-framing-final-node.log`，退出码 0；模板、示例、Gallery、ZIP 和 README 来源一致性均通过。
- 第三版 ZIP／包外 smoke：通过，见 `archify-framing-candidate3-{zip,package-smoke}.log`。

测试调整保留原行为：拖动比较相对起点距离；原有 100% 字号要求在独立 reset 后核验；页面缩放每个窗口在布局就绪后显式设置图内 100%；延迟语义定位仍检查模式、实际比例、节点尺寸和阅读点，scale 差 ≤1e-6、translate 差 ≤0.5px；滚轮仅允许 CSS matrix 序列化造成的相对比例差 <1e-5。严格 reset 零坐标断言没有放宽。

## 消融

设计消融见 Goal：保留删除自动猜重点、新模式、镜头持久化、首页镜头按钮和本轮视觉美化。

代码均在隔离副本逐项删除后重跑原回归：

| 删除候选 | 删除后的证据 | 处理 |
| --- | --- | --- |
| 首次适配条件 | 初始全图回归失败 | 恢复 |
| 小图倍率上限 | 小图被自动放大 | 恢复 |
| 阅读锚点转换 | resize 中心漂移 | 恢复 |
| 跨断点暂存 | 无新操作的断点往返失败 | 恢复 |
| 可见画布缩放锚点 | 极宽 SVG 缩放按钮偏离视野 | 恢复 |
| 回退后最新阅读换算 | 回退期间新操作的有效比例丢失 | 恢复 |
| DOMRect 噪声容差 | reset 后 x≈−0.0006、y≈0.0004 | 恢复，20/20 通过 |
| 自动 fit 允许留白重探测 | 第四轮隔离删除该行，原阈值子项失败：stageGap≈0.219px；另 4 子项通过 | 恢复；生产源码同项及完整 374 项通过 |

日志在 `archify-framing-ablation-*.log`，红／绿回归分别存档。没有为通过消融删除用户要求。

## 交付状态

浏览器、视觉、包外、private-project 和代码消融证据已归档。最终完整 Node 门禁通过：2139 项，2066 通过、0 失败、73 条件跳过。跳过项单列，不计通过；本轮真实统一浏览器门禁另有 374/374、0 跳过的结果。README 动图来源检查已通过。无本轮代码候选能在删除后保持相关原验收全部通过，因此均恢复必要分支；设计阶段排除的额外模式、持久化、猜测重点和美化仍未引入。

此前本地浏览器访问被明确拒绝且禁止绕过，agent 没有启动其他浏览器、CDP 或本地服务器替代。用户手动脚本是实际浏览器执行来源；未运行项或条件跳过不计为通过。


公开 PR 注：本记录保留原验收时点；`LOCAL_ONLY` 是脱敏占位，不是仓库路径。私有项目输入与截图未发布。公开提交与证据说明见 [PR 汇总](infinite-canvas-pr.md)。
