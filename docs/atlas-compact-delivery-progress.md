# Atlas 无损瘦身验收报告

[实施 goal](atlas-compact-delivery-goal.md) 已实现，AC01–AC12 通过。实际工作区 `/Users/sunhonghao/.codex/worktrees/80ec/archify`，分支 `codex/architecture-atlas-v1`，HEAD `8c3af8a11318d3e0f46bb123149c4863d358f830`。保留原有未提交修改；本轮未提交、推送或发布。

## 结果与交付

使用当前工作区生成器，在全新 `openpi-final-r3/` 目录编译固定六份 JSON 输入，没有复用旧 HTML。输入保持一致用于控制变量，本轮未重新分析或改写 OpenPI 架构内容。

| 指标 | 结果 |
| --- | --- |
| 完整 HTML | 4,475,495 → **1,348,530 字节**，减少 **69.8686%** |
| Payload 最长行 | **7,785 字节**，上限 8,192 字节；外壳最长行 494 字节 |
| 公共资源 | 4 块、759,760 字节；1、5、10 成员受控样本均只存一份 |
| 内容与功能基线 | 5 份完整成员 HTML 与实施前逐字节相同，每份 58 个表单控件一致 |
| 架构内容 | 保留 5 图、三级路径、4 个 detail、4 个 reference |
| 重复生成 | 两次独立编译的完整 HTML 字节及 SHA-256 相同 |

[最终 HTML](/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912/openpi-final-r3/openpi.html) · [PNG 预览](/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912/openpi-final-r3/openpi.visual-check.system.1440x900.light.png) · [交付索引](/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912/openpi-final-r3/handoff.md)

最终 SHA-256：`ce5a002a7c6bc3632424a4f50283fc0eb0b7cabdfc8f4c80049144f22426119e`。

证据根目录为 `/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912`。下文证据文件均相对此目录。`probe/`、`openpi-final/`、`openpi-final-r2/` 为中间产物，不是交付入口。

## 实现及边界

新增 `atlas-bundle.mjs`，按实际内容去重公共脚本、样式及字体，采用 v2 资源表及有界安全 JSON 字符串分块。元数据也分块，避免超长合法标题形成巨型单行。Node 与浏览器共用 reader，兼容 v1。

浏览器仅在访问时还原目标 HTML，保持活动页、单个候选页、就绪提交及失败清理规则，没有增加全成员页面缓存。CLI 继续还原规范成员，执行原有来源、关系、回执和渲染校验。没有因瘦身修改成员内容、字体、图形布局或 Viewer 业务功能。

默认代理交付提供 HTML 链接及最终 PNG，避免自动加载 HTML 文件面板；保留 CLI `--open` 和用户明确指定打开方式的行为。更新交付文档、打包必需文件、示例与 `archify.zip`。

验收发现 `visual-check` 的 Chrome 主进程退出后，后代仍持有继承管道，使调用者不能退出。补充显式销毁自有管道及回归测试，最终浏览器批次正常退出。这是验收工具清理问题，不是 Codex 桌面端冻结原因的诊断。

## AC01–AC12

完整文件映射见 [acceptance.json](/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912/acceptance.json)。

| 验收 | 状态 | 主要证据 |
| --- | --- | --- |
| AC01 体积 | 通过 | `openpi-final-r3/size-and-features.json`：全文件符合体积与降幅预算 |
| AC02 行宽 | 通过 | 同上及 `final-codec-tests.log`：转义、Unicode、长字符串/元数据覆盖 |
| AC03 共享与增长 | 通过 | `growth.json`：1/5/10 成员资源表一致；测试防止同长不同内容误合并 |
| AC04 无损 | 通过 | `baseline.json`、最终体积/功能清单、`delivery.receipt.json`：成员字节、摘要、控件及完整 CLI 校验 |
| AC05 版本与错误 | 通过 | v1/v2 和格式/回执负向测试；`compact-browser-verified.json` 的 6 类损坏包错误与重试 |
| AC06 按需与生命周期 | 通过 | 最终 OpenPI 冷深链只还原 workflow；20 次导航、候选取消/清理回归 |
| AC07 阅读连续 | 通过 | 最终 OpenPI 249 次帧采样及 23 PNG；通用过程 29 场景、5,991 次采样、792 PNG；详情/历史/延迟/失败/竞态/窄屏回归 |
| AC08 离线与导出 | 通过 | 最终 HTML 双协议五图离线；通用真实浏览器导出/卡片/剪贴板/来源/忙时导航；最终 20 视口检查与视觉复核 |
| AC09 生成链路 | 通过 | 完整测试、无 node_modules 的最终 ZIP 交付、独立重复生成一致 |
| AC10 交付入口 | 通过 | 默认 opener 与显式 `--open` 回归；没有自动打开 HTML 文件面板，提供最终 PNG/链接 |
| AC11 消融 | 通过 | 删除冗余转发包装；移除管道清理导致失败后恢复；最终体积/行宽/无损及回归通过 |
| AC12 最终产物 | 通过 | `openpi-final-r3/provenance.json`：命令、69 个当前源码及 6 输入摘要；最终回执、专用浏览器和 PNG 绑定同一 HTML |

## 验证记录

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 完整测试 | 1,448 通过、0 失败、55 个显式浏览器门禁跳过 | `full-tests-verified.log` |
| 包格式、交付、状态及离线专项 | 52/52 通过 | `final-codec-tests.log` |
| 浏览器导航、导出、剪贴板、生命周期 | 5/5 通过，正常退出 | `browser-functions-verified.log` |
| 浏览器切层过程与工作台 | 23/23 通过，正常退出 | `browser-process-verified.log` |
| 最终 OpenPI 按需还原及损坏包 | 1/1 通过，正常退出 | `browser-compact-verified.log` |
| 最终 OpenPI file / HTTP 离线 | 两种协议分别访问全部 5 图，无自主 HTTP 请求 | `final-offline-protocols.json` |
| 最终 OpenPI visual-check | 5 图 × 4 桌面视口，20 组几何检查通过 | `openpi-final-r3/openpi.visual-check.json` |
| 最终发布包 | 源码匹配、无 node_modules 实际交付、输出匹配仓库示例 | `package-verification.json` |

29 项相关真实浏览器测试独立运行，不把完整套件中 55 个跳过计作通过。完整命令为 `env -u ARCHIFY_CHROME npm test`。实际浏览器使用 `ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test`，分批运行 `archify/test/` 中的 `atlas-browser.test.mjs`、`atlas-export-browser.test.mjs`、`atlas-lifecycle-browser.test.mjs`、`atlas-seamless-browser.test.mjs`、`atlas-workbench-browser.test.mjs`、`atlas-compact-browser.test.mjs`。最终专用测试以 `ARCHIFY_COMPACT_ARTIFACT` 指向交付 HTML。Chrome 均按 macOS GUI 规则经批准在沙箱外启动。

`finalize-openpi-compact.mjs` 保留固定输入复制、当前工作区 CLI 交付、重复生成、摘要、功能基线及消融的复现入口。`final-offline-protocols.mjs` 保留双协议检查脚本。

自动回执的 `visualReview` / `perceptualReview` 不冒充实际视觉观察。另用 `openpi-final-r3/visual-review.json` 和 `process-visual-review.json` 记录图像检查：最终五图浅/深色代表截图、全部 23 张 OpenPI 切层截图，以及通用延迟、失败、竞态、窄屏场景的代表帧。未发现新增缺失样式、裁切或正常切层的空白截图。原生历史失败出现预期错误状态，不把旧图冒充目标。

早期沙箱测试出现端口 EPERM 和未重建 ZIP，随后修正环境、重建并完整重跑。一批浏览器检查因管道问题中断，未计作整批通过；以上 `verified` 日志均来自修复后正常退出的命令。

## 消融

1. **永久删除 `serializeAtlasBundle` 转发包装。** 直接使用既有安全 JSON 序列化器。隔离原型恢复包装后，输出与最终 HTML 逐字节一致；52 项专项、功能基线和最终预算通过。证据：`ablation-final.json`、`ablation-restored-facade.prototype.mjs`、`final-codec-tests.log`。
2. **恢复并保留浏览器自有管道清理。** 临时删除后原测试失败，错误为 `Browser-owned pipes must not keep the caller alive`；恢复后专项 13 项和真实浏览器批次通过并正常退出。证据：`ablation-pipe-cleanup.json`、`browser-pipe-tests.log`。没有删除用户功能以换取瘦身或通过测试。

## Codex 宿主观察

**宿主响应未测，不宣称 Codex 卡顿已修复。** 已检查工具能力：打开工具只报告打开/排队，不提供桌面端主线程或可交互时刻；屏幕上下文工具仅限语音，本次未调用。没有取得同设备五轮打开对照或宿主 profiler 记录，也没有再次自动打开 HTML 文件面板。见 `host-observation.json`。

体积、浏览器帧和 Node 测试不能替代宿主性能测量。PNG 和 requestAnimationFrame 也不能覆盖所有合成帧或设备。本轮完成范围是 Archify 无损瘦身、交付默认行为及规定回归。
