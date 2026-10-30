# PR #649：2026-10-15 dev 同步验证

## 范围与版本

- 比较基线：`0bd659b89dc836144c92ddcfef747a0ee8490b8d`。
- 之前的 PR 头：`b95463d1b0cf66c7594dc8dd224b85e7476e76c6`。
- 合并运行时、回归和 ZIP：`5876e8259e05ba1a0f30c69114616565184eb00b`。
- 当前 dev 的 Workflow schema 尚无 `typography_scale`；此 PR 的可选比例控制未被上游覆盖。
- macOS，官方 Node 22.23.1 / zlib `1.3.1-e00f703`，Chrome 155.0.8059.79。

仍使用 #631 已确认的 Workflow v2 1–2 倍比例范围；v1 不接受该字段，省略或显式 1 保留当前 dev 输出，作者尺寸与绝对路线仍有优先权。没有改变版本、发布身份、安装或环境配置。

## 本轮合并处理

保留上游自动宽度及最终画布可读性反馈、phase chip 样式、默认边标签对比度、已测量失败回执、路由与位置修复；缩放测量继续参与节点、泳道、分组、标签、图例及修复验证。修复探测的来源信息和已解析品牌 Symbol 均继续保留，包括上游新增加的宽度反馈、交叉和位置探测路径。

共享图例采用上游实际渲染字号进行宽度测量，显式缩放只应用一次。浏览器清单已迁到上游 `scripts/browser-test-inventory.mjs` 并追加字体套件，不恢复旧清单。字体相关 CHANGELOG 项移到 Unreleased，避免将尚未合并的功能写入已发布的 3.1.0。

集成初测发现并修正了跨 v2→v1 重用节点对象时的自动宽度缓存问题；上游原回归现已通过。图例及 SVG 冻结值以当前 dev 实际输出刷新，依据下方独立基线／候选公开 CLI 比较，不将更新期望值本身当作兼容性证据。

新增两项组合覆盖：缩放与上游 phase/边标签样式、反复编辑同一输入的一致性；来源及品牌上下文下，新位置修复建议通过实际 CLI 重放并保留来源与品牌。之前针对维护者两个发现的 source/brand 自动高度及逐条容量修复重放继续通过。

## 验证

| 检查 | 结果 |
| --- | --- |
| 字体、图例、编译器、路由、证据保护及浏览器清单专项 | 235 通过，0 失败，0 跳过 |
| 上游自动宽度、绝对尺寸、位置修复、交叉修复、图例兼容 | 35 通过，0 失败，0 跳过 |
| 最终品牌探测调整和新增回归后的组合专项 | 54 通过，0 失败，0 跳过（包含前面部分覆盖，不相加） |
| 真实 Chrome 字体、阅读性及默认边标签对比度 | 10 通过，0 失败，0 跳过 |
| `npm test`（当前命令仅为 core smoke） | 18 通过，0 失败，0 跳过 |
| `npm run test:full` | 3100 通过，0 失败，115 跳过（可选浏览器／平台条件项，非已通过） |
| 默认输出，当前 dev 对比合并运行时 | 16/16 固定输入，十类图 validate/render 成功，完整 HTML 和 SVG 字节相同 |
| Canonical ZIP | 两次构建字节相同；仓库外 macOS 解包 smoke 通过 |

默认兼容记录：[default-compatibility.json](default-compatibility.json)。浏览器原始数据：[browser-measurements.json](browser-measurements.json)。浏览器采集与两个新增品牌探测路径的最终调整之间没有改动成功绘制的路径；受影响修复通过最后的 54 项组合覆盖与完整回归单独核验。

本地检查与远端 CI、维护者复审独立；最终 CI 与复审状态见 [PR checks](https://github.com/tt-a1i/archify/pull/649/checks)。历史证据保持原始版本，不替换旧 HTML、截图或测量记录。

## 视觉观察

实际检查 1440×900、Classic、100% zoom 的普通／密集 scale 1 与 1.5 四张截图，以及来源＋品牌 scale 2 dark 一张截图；本子集未见文本裁切、图标或标签重叠。其他 viewport/theme 情况以自动测量为证据，不声称全部目视验收。

| 输入 | scale 1 | scale 1.5 |
| --- | --- | --- |
| 普通 | [截图](ordinary-scale-1.png) | [截图](ordinary-scale-1.5.png) |
| 密集 | [截图](dense-scale-1.png) | [截图](dense-scale-1.5.png) |

[来源＋品牌 scale 2 dark](source-brand-tag.png) 保留品牌和 Focus 下的来源访问；隐藏的 tag 通过点击揭示验证。密集样例的可见副标题最小字号从 9.72 CSS px 增至 15.98 CSS px。放大增加纵向空间；不是任意图的首屏或统一字号保证。

## 重放

在候选仓库根目录，使用上述 canonical Node 22 工具链：

```sh
npm ci
npm --prefix archify ci
npm run test:focus -- test/workflow-typography.test.mjs test/legend-typography.test.mjs test/typography-evidence-output.test.mjs test/workflow-compiler.test.mjs test/workflow-compiler-hard-contract.test.mjs test/workflow-compiler-call-contract.test.mjs test/workflow-routing-clarity.test.mjs test/browser-gate.test.mjs test/workflow-placed-label-evidence.test.mjs
npm run test:focus -- test/workflow-automatic-width.test.mjs test/workflow-absolute-sizing-diagnostics.test.mjs test/workflow-placement-repair.test.mjs test/workflow-crossing-repair.test.mjs test/legend-contract.test.mjs
ARCHIFY_CHROME="/path/to/chrome" ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR="/new/evidence/directory" npm run test:browser -- test/workflow-typography-browser.test.mjs test/reader-readability-maintained-browser.test.mjs test/workflow-edge-label-contrast-browser.test.mjs
npm run test:full
node docs/evidence/workflow-typography/source-capacity-review/compare-defaults.mjs /path/to/checkout-of-0bd659b8 /new/output/default-compatibility.json
scripts/build-zip.sh /new/output/archify.zip
node scripts/package-smoke.mjs /path/to/extracted/archify
```

ZIP SHA-256：`98cc2f8929746c33e638d367363b9d1c564f4adf9458acc56531f489aa0adb73`。十类校验器和 ZIP 从合并源码重建；默认图的 Gallery 输入及输出未因本功能改变，不重建无关 Gallery。证据存放在 Skill 包之外。
