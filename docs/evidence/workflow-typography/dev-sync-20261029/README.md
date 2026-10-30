# PR #649：2026-10-29 集成验证

## 范围与版本

- 上次审阅的 PR 头：`baf73e81fdb25fd59d3f9c2c1c61215aee86e8a4`。
- 本轮比较基线：`847146aeb93b492592adb78dc220f57e4a8b4636`，当前 `dev`。
- 合并源码、校验器和 ZIP：`93279dda9d9e1b28680da0650a8d8b91000760e0`；后续证据提交不改变运行时文件。
- macOS，官方 Node 22.23.1 / zlib `1.3.1-e00f703`，Chrome 156.0.8078.73。

按维护者 2026-10-28 的复审要求继续已有 Workflow v2 可选 `typography_scale`（1–2）范围。默认与显式 1、作者尺寸和绝对路线、已验证的源码及品牌上下文仍受现有契约保护。

## 自上次审阅以来的相关整合

1. 保留上游受限分叉路由恢复、确定性候选排序和被放弃候选的修复探测预算（`420a446c`、`af30e161`、`81fee743`）。自动合并后，新增端口间距计算有两处 `workflowLabelWidth` 调用缺少字体参数，既有 controlled-order 两例均以 `TypeError: edgeAdvance` 失败；补齐参数后两例及下面的完整受影响组通过，没有另建测试体系。
2. 保留迁移临时删边投影的语义契约处理，以及修复探测携带的来源证据和品牌 Symbol。新分叉恢复直接继承完整编译选项，不会丢失这些上下文。
3. 保留节点说明、`drilldowns`／`href` 单子图链接、角标和当前 Viewer 行为。新增入口通过现有 Passport／drilldown 测试验证。
4. 浏览器清单保留当前上游全部条目并追加字体套件；校验器从合并 schema 生成，ZIP 从完整追踪源码重建。CHANGELOG 中字体条目留在 Unreleased。

独立只读审查检查了上述调用点、克隆与修复路径、默认图例测量和显式几何优先权。除端口间距参数外，未发现新的整合遗漏。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 字体、图例、受限分叉、迁移、自动尺寸和修复组合 | 100 通过，0 失败／跳过 |
| Passport、drilldown、浏览器清单契约 | 31 通过，0 失败／跳过 |
| `npm test` 核心 smoke | 19 通过，0 失败／跳过 |
| 真实 Chrome：字体、维护阅读性、Workflow 边标签对比度 | 10 通过，0 失败／跳过 |
| 十类图、16 个固定输入，对照最新 dev | 16/16 完整 HTML 字节相同 |
| 生成物检查 | 通过 |
| Canonical ZIP | 两次构建字节相同；仓库外完整包 smoke 通过 |
| 解压包字体选项和源码／品牌样例 | 6/6 验证成功且完整 HTML 与源码运行时相同 |

数据及日志：[verification.json](verification.json)、[默认兼容](default-compatibility.json)、[专项](focused.txt)、[整合契约](integration-contracts.txt)、[核心](core.txt)、[Chrome](browser.txt)、[生成物](generated.txt)、[包 smoke](package-smoke.txt)、[包字体对照](package-typography.json)。这些分组选取不同文件；不与历史结果累计成额外覆盖率。

测试及浏览器采集针对待提交的合并源码执行；239 个追踪运行时文件的内容指纹与 `93279dda` 一致，记录于 verification。默认比较另在该确切提交重放。比较 JSON 中的 `svg` hash 沿用历史脚本的首个 SVG 匹配；跨版本默认兼容结论以完整 HTML 字节相同为依据。

ZIP SHA256：`1ab1f34c62601e7d00972e6a2c06596ef6a12c49b7db51bb4ae9ef2dc34eea15`。

## 浏览器与视觉观察

[原始测量](browser-measurements.json)覆盖 ordinary 1.5／2、dense 1.5、CJK 1.5 在 1440×900／1920×1080、light／dark、before／after 的 32 个状态，另有 1440×900 的源码 1.01 light 和源码＋品牌＋tag 2 dark，并验证聚焦、来源访问和 tag 展示。

Codex AI 查看了本轮 1440×900、Classic、100% zoom 的下面五张截图，未观察到文字裁切、图标或标签重叠。其他状态为自动测量证据；不声称已有人类感知验收。

| 输入 | scale 1 | scale 1.5 |
| --- | --- | --- |
| 普通 | [截图](ordinary-scale-1.png) | [截图](ordinary-scale-1.5.png) |
| 密集 | [截图](dense-scale-1.png) | [截图](dense-scale-1.5.png) |

[源码＋品牌＋tag，scale 2 dark](source-brand-tag.png)。放大会增加纵向空间，仍不承诺所有图首屏可见。

## 证据复用与复现

历史三态 zoom 比较、耗时和交互测量保留原修订，只用于已认可的产品方向；本轮不将其重新标为当前提交数据。新的 Viewer 和源码路径影响已由本轮测试与截图重新检查。没有新增五项目实验或其他类型字体功能。

```sh
npm ci
npm --prefix archify ci
npm run test:focus -- test/workflow-typography.test.mjs test/legend-typography.test.mjs test/workflow-controlled-order.test.mjs test/workflow-migration-semantics.test.mjs test/workflow-automatic-width.test.mjs test/workflow-absolute-sizing-diagnostics.test.mjs test/workflow-placement-repair.test.mjs test/workflow-crossing-repair.test.mjs test/workflow-placed-label-evidence.test.mjs test/legend-contract.test.mjs
npm run test:focus -- test/passport-explanation.test.mjs test/drilldown-navigation.test.mjs test/browser-gate.test.mjs
npm test
npm run test:generated
node docs/evidence/workflow-typography/source-capacity-review/compare-defaults.mjs /path/to/checkout-of-847146ae /new/output/default-compatibility.json
ARCHIFY_CHROME="/path/to/chrome" ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR="/new/evidence/browser" npm run test:browser -- test/workflow-typography-browser.test.mjs test/reader-readability-maintained-browser.test.mjs test/workflow-edge-label-contrast-browser.test.mjs
scripts/build-zip.sh /new/output/archify.zip
node scripts/package-smoke.mjs /path/to/extracted/archify
node docs/evidence/workflow-typography/dev-sync-20261029/package-typography.mjs /path/to/candidate /path/to/extracted/archify /new/output/package-typography
```

使用上述官方 Node 22 工具链；输出目录必须是新目录。最终提交的远端 CI 与维护者复审另见 [PR checks](https://github.com/tt-a1i/archify/pull/649/checks)。
