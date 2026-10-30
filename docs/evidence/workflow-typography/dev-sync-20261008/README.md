# PR #649：2026-10-08 同步 dev 的验证记录

本轮将已确认的 Workflow v2 字体缩放及源码／品牌容量修复同步到当前 dev，保留上游路由诊断、宽度优先阅读及测试分片行为。产品范围和公开配置保持原议定内容。

## 版本和环境

- 比较基线：`603bbb41ce69015797c2d4045a143c3fabc39230`。
- 同步前 PR：`0d168fe8f65c21893a1dc433fb5c629d59e971dc`。
- 合并及新增回归提交：`853dbb21e75195ac2f32aa1c3010d9cd6251af15`。
- macOS；官方 Node 22.23.1，zlib `1.3.1-e00f703`；Chrome 154.0.8037.98；Apple Git 2.39.5。
- 本地测试及截图采集针对提交前相同的合并运行时代码。随后只增加了两项标签诊断回归；该文件在提交后单独验证。默认输出比较在上述提交后执行，记录中包含确切版本。
- 远端 CI 与维护者复审是独立结果；最终提交的状态见 [PR checks](https://github.com/tt-a1i/archify/pull/649/checks)。

## 合并和维护边界

冲突涉及生成校验器、ZIP 和浏览器测试清单。十类 schema 校验器与 ZIP 从合并后的源文件重新生成。浏览器测试清单沿用 dev 的原有次序，将字体套件追加到末尾，保留已有 CI 分片分配；未恢复上游已经删除的旧 Lifecycle 套件。

源码自动合并后，独立检查确认来源信息仍传入自动尺寸、规划、修复探测和迁移重编译，品牌 Symbol 恢复逻辑保留。上游新增的路由拒绝诊断继续使用缩放后的标签矩形；新的宽度优先阅读标记保留。

新增的两项回归覆盖 scale 1.5、standard/showcase：验证实际冲突矩形、原始作者边索引，并逐条重放 supportedFixes。

既有截图、HTML 和历史测量保留原版本归属。此目录是本轮新证据，不覆盖或重新标注旧证据。README、接口、安装、环境配置及发布身份没有新增变化；字体字段的使用说明与 CHANGELOG 已包含在现有 PR 中。

## 本地验证结果

| 检查 | 实际结果 |
| --- | --- |
| 字体、图例、证据保护、编译器、路由和浏览器门禁专项 | 199 通过，0 失败，0 跳过 |
| 新增回归所在的 placed-label 文件 | 9 通过，0 失败，0 跳过，包含新增 2 项 |
| 字体与 maintained-reader 真实 Chrome 检查 | 7 通过，0 失败，0 跳过 |
| 默认配置与最新 dev 的比较 | 16/16 输入，覆盖十类图；公开 validate/render 通过，完整 HTML 与 SVG 均逐字节一致 |
| 完整 npm test | 2789 通过，1 失败，100 跳过；不是完整通过 |
| 两次 canonical ZIP 构建 | 150 个文件，字节完全一致 |
| 仓库外解包 smoke | macOS 通过，无安装包依赖 |
| 本轮源代码、测试及文档 whitespace 检查 | 通过；保留的历史生成 HTML 不作格式改写 |

完整套件在新增两项回归被工作进程加载前已开始，因此新增项以随后该文件的 9 项检查为证据，不把它们计入完整运行的 2789 项。

完整运行唯一失败是 `test/ci-scope.test.mjs:110`：浅克隆测试期望 `git branch -r` 只输出 `origin/pr`，Apple Git 同时输出 `origin/HEAD -> origin/pr`。在未修改的基线 `603bbb41` 上运行相同测试得到完全相同的失败。没有放宽断言、跳过此项或将失败记为通过；该测试未被本 PR 修改。

默认兼容结果见 [default-compatibility.json](default-compatibility.json)。浏览器原始测量见 [browser-measurements.json](browser-measurements.json)，测试摘要和包摘要见 [verification.json](verification.json)。

## 本轮视觉观察

1440×900、Classic、100% zoom、字体和布局稳定后，对以下五张截图作了实际目视检查。节点文字、标题、边标签及品牌图标未见裁切或相互遮挡。其余浏览器场景依据自动测量，不扩大人工观察范围。

| 输入 | 默认比例 | 1.5 倍比例 |
| --- | --- | --- |
| 普通流程 | [截图](ordinary-scale-1.png) | [截图](ordinary-scale-1.5.png) |
| 较密集流程 | [截图](dense-scale-1.png) | [截图](dense-scale-1.5.png) |

[源码＋品牌、scale 2、dark](source-brand-tag.png) 的来源仍能通过 Focus 访问；READ 模式隐藏的 tag 通过真实点击检查可见性，未恢复已移除的 SRC 徽章。

在较密集样例中，本轮默认可见副标题最小字号已经是 9.72 CSS px，scale 1.5 为 15.98 CSS px。旧基线的“低于 9px”观察不能当作当前 dev 的现状。放大后的内容占用更多纵向空间，下方 Node index 可能需要滚动；字体控制的收益是文字与布局比例可调，不是任意图的首屏或字号保证。

## 重放

在候选提交的仓库根目录，使用上述 Node 22 工具链：

```sh
npm ci
npm --prefix archify ci
npm run test:focus -- test/workflow-typography.test.mjs test/legend-typography.test.mjs test/typography-evidence-output.test.mjs test/workflow-compiler.test.mjs test/workflow-compiler-hard-contract.test.mjs test/workflow-compiler-call-contract.test.mjs test/workflow-routing-clarity.test.mjs test/browser-gate.test.mjs
npm run test:focus -- test/workflow-placed-label-evidence.test.mjs
ARCHIFY_CHROME="/path/to/chrome" ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR="/new/evidence/directory" npm run test:browser -- test/workflow-typography-browser.test.mjs test/reader-readability-maintained-browser.test.mjs
npm test
node docs/evidence/workflow-typography/source-capacity-review/compare-defaults.mjs /path/to/checkout-of-603bbb41 /new/output/default-compatibility.json
scripts/build-zip.sh /new/output/archify.zip
node scripts/package-smoke.mjs /path/to/extracted/archify
```

在干净基线 checkout 验证本机已存在的失败：

```sh
node --test --test-name-pattern='scope workflow fetches only' test/ci-scope.test.mjs
```

ZIP SHA-256：`2bc54c4879f6a3940ac8f55fc7700e96862a324e61874c08de72cf78e5a353cd`。
