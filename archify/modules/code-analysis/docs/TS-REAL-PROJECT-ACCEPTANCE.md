# 真实 TypeScript 项目验收：ts-pattern

2026-11-17，macOS arm64，最近实跑使用 Node 24.20.0，提取器 revision 28。样本为 [ts-pattern v5.9.2](https://github.com/gvergnaud/ts-pattern/tree/v5.9.2)，源码提交 **f11be73acb18e1d653d4f252e7d75981d873a2e6**；v5.9.2 是注解标签，标签对象 22cc83a7 不是源码提交。项目采用 MIT 许可，包含泛型、重载、ESM 转发、TSX 和多份配置。

**结论：项目/模块/范围/调用库存及现有已归属目标的验收通过；完整语言服务导航覆盖仍有差距，不能据此宣称与官方全部对齐。**

2026-11-17 16:02（Asia/Tokyo）再次实跑同一样本及项目 TypeScript 5.9.2，使用 Node 24.20.0。结果仍为 88 个文件、214 条导入、475 个函数、5618 个调用位置全部一致，1096 个已知目标全部匹配，其中共享成员目标 497 个；与上次 revision 28 的完整原始事实摘要相同，目标新增、丢失、改指均为 0。本次官方对照 83 项及共享成员等项目回归 15 项，共 98/98 通过、无跳过。新证据保存在原验收目录的 `rerun-20261117-160132/`，未覆盖上一轮产物。

提交准备以最新 Labs `772b2dea12381ed87916dc811b3767f1d8bc3eb5` 为基线，关联 [议题 #1394](https://github.com/tt-a1i/archify/issues/1394)。删除了没有调用方的 bundled SDK helper 导出，保留历史读取所需的 measureFunctions 入口；67 项相关回归通过，随后真实仓库重跑的完整原始事实摘要与整理前相同。机器摘要使用整理后的源码指纹，并分别保留旧运行身份。TypeScript 5.6.3 / 6.0.3 的 83 项官方对照已在 Node 22.23.2 上重新通过；默认 5.9.3 的官方对照随完整模块套件通过。提交准备的原始证据在 `pr-final/`。

## 输入与对照

保持原仓库源码和配置不变，按原 package-lock.json 执行 npm ci --ignore-scripts，实际安装 SDK **TypeScript 5.9.2**。Archify 采用 auto + requireProjectSdk，官方 tsserver、Compiler API 和 Language Service 使用同一个安装包。锁文件 SHA-256 为 44e8aa7ffe9dd6c9f6ac1b9eea8a05d1179ffc691649bc7cbaa8942e7279b3aa。

选择整个仓库的默认 JS/TS 范围，不只选能通过的 src 子树；node_modules、构建输出与声明文件沿用 Archify 默认排除。88 个文件包括源码、测试、示例、基准和脚本。原生源码及 tests 两份 tsc --noEmit 检查退出码均为 0；这不代表所有示例/基准依赖已安装或所有项目语义诊断都通过。没有执行目标项目的测试、构建或应用源码。

## 验收结果

| 检查 | 结果 | 实际比较方法 |
| --- | --- | --- |
| SDK | 项目安装版 5.9.2，一致 | 实际包路径、版本和 Archify 来源记录。 |
| 文件与归属 | 88/88，6 个项目一致 | 独立 Git 文件清单；真实 tsserver 打开全部文件，逐个核对默认 owner、完整 Program 成员及有效配置选项。 |
| 语法 | 88/88，无语法错误 | 官方 Program 的源文本与 getSyntacticDiagnostics。 |
| 导入 | 214/214，一致 | 官方 preProcessFile 独立提供库存，Program usage mode 与 resolveModuleName 提供目标。197 条捕获内边、17 条无捕获目标均一致。 |
| 函数 | 475/475 范围及源切片哈希一致 | 与官方 AST 实现体对照，并检查应独立测量的函数体是否遗漏。 |
| 调用库存 | 5618/5618，一致 | 完整 CallExpression 的 UTF-16 起止；不包含 new/tagged template。 |
| 已归属调用 | 1096/1096，一致 | 真实 Language Service 定义候选，经官方符号归一到唯一实现体，精确匹配文件和声明起点。 |
| 证据灵敏度 | 通过 | 把一个调用改指同文件另一函数，校验器成功拒绝。 |
| 可复现性 | 通过 | 源码哈希与 Git 清洁状态不变；第二次提取的完整原始事实摘要相同。 |

1096 个目标包括同文件初始化器 438、同文件函数 128、导入函数 530。相同源码在 revision 27 为 599 个目标；此次新增 497 个共享成员目标，旧目标没有丢失或改指。文件、导入、函数记录及调用库存不变。它们是源候选，不证明运行时执行或完整影响范围。

| 默认配置 | 唯一归属文件 | 官方 Program 中选中成员 | 调用 / 已归属 |
| --- | ---: | ---: | ---: |
| tsconfig.json（src） | 20 | 20 | 297 / 210 |
| tests/tsconfig.json | 52 | 71 | 4589 / 827 |
| benchmarks/compile-time/tsconfig.json | 5 | 24 | 429 / 4 |
| examples/gif-fetcher/tsconfig.json | 4 | 4 | 38 / 2 |
| examples/one-file-demo/tsconfig.json | 1 | 1 | 45 / 0 |
| 推断项目 | 6 | 25 | 220 / 53 |

Program 可以重叠；Archify 按默认 owner 只记录一份源事实。tests 的配置虽然 exclude ../src，导入仍把 19 个 src 文件加入其 Program，实际原始 projectInfo 证据保留了这一点。

## 尚未对齐的覆盖

4522 个调用仍未知：成员/其他不支持 callee 3389、无本地函数绑定 1130、可选调用 3。有目标的比例由 10.7% 增至 19.5%；这不是准确率，也不能由已知目标全部匹配推导完整召回率。

对这些未知调用额外查询官方导航：跨默认项目的仓内定义候选 2617、同默认项目仓内候选 62、外部候选 1738、没有定义 94、计算表达式/工厂结果未作单一名字查询 11。候选可能是接口、属性、参数或未解析导入的别名，**2679 个仓内候选不等于 2679 个确定函数实现**。验收器现用完整起止范围区分同起点的链式调用；旧版候选分类保留其原始证据身份。

已修复的具体反例：[tests/is-matching.test.ts:11](https://github.com/gvergnaud/ts-pattern/blob/f11be73acb18e1d653d4f252e7d75981d873a2e6/tests/is-matching.test.ts#L11) 调用 isMatching，官方导航到 [src/is-matching.ts:32](https://github.com/gvergnaud/ts-pattern/blob/f11be73acb18e1d653d4f252e7d75981d873a2e6/src/is-matching.ts#L32) 的重载声明，唯一实现体从第 53 行开始。revision 28 通过 src/index.ts 的显式转发，正确记录 imported-function → src/is-matching.ts:53:1。

根因是把唯一统计归属误作调用分析范围。现在 `projects[].files` 仍只记录归属的 52 个测试文件，`projects[].members` 则保留测试 Program 的 71 个捕获内成员。转发查找可使用其中的 19 个 src 依赖；只向原始事实输出拥有者的记录。不同 SDK 的源码不交换 AST，调用方范围/哈希和归属方事实必须一致，转发选择也必须得到已保存导入边支持；不一致的上下文路径继续未知。

17 条无捕获目标中，16 条是外部包、内置模块或尚未构建的自身包入口，1 条是 CSS；清单逐条记录官方结果。没有为得到绿色结果改写项目配置、构建 dist 或把这些边猜接到 src。

## 重跑与证据

从仓库根目录执行；证据目录须在样本源码目录外：

```sh
git clone --depth 1 --branch v5.9.2 https://github.com/gvergnaud/ts-pattern.git /tmp/ts-pattern-acceptance
git -C /tmp/ts-pattern-acceptance rev-parse HEAD
npm ci --prefix /tmp/ts-pattern-acceptance --ignore-scripts --no-audit --no-fund
node /tmp/ts-pattern-acceptance/node_modules/typescript/lib/tsc.js --project /tmp/ts-pattern-acceptance/tsconfig.json --strict --noEmit
node /tmp/ts-pattern-acceptance/node_modules/typescript/lib/tsc.js --project /tmp/ts-pattern-acceptance/tests/tsconfig.json --noEmit
node archify/modules/code-analysis/test/ts-real-project-acceptance.mjs /tmp/ts-pattern-acceptance /tmp/ts-pattern-evidence
```

验收器为 [ts-real-project-acceptance.mjs](../test/ts-real-project-acceptance.mjs)，输出 acceptance.json、archify-raw-facts.json、tsserver-projects.json。[本次机器摘要](TS-REAL-PROJECT-ACCEPTANCE.json)保存实际运行身份、检查结果、源码/运行器哈希及原始证据文件的字节数和 SHA-256。完整 JSON 保存逐项结果、所有未知调用的官方候选和重复提取摘要。status passed 仅适用于声明的 acceptanceScope；coverageGates.completeDefinitionNavigation 为 gap-observed。

本轮已修正生产分析器，保持 js-ts-lexical-v6 的保守调用语义，以 adapterRevision 28 标记覆盖变化。相关回归 112/112；真实 5.6.3、5.9.3、6.0.3 的官方对照各 83/83，新增了完整成员与共享函数目标断言。消融删除转发一致性检查，会生成与已保存归属方导入边不一致的调用路径，因此已恢复该检查。

整理前静止工作树的 `npm run test:full` 通过：根层 3693 项，3540 通过、153 跳过、0 失败，包含 Code Analysis 完整模块套件，使用 Node 24.20.0。这是保留的运行身份，不重标为整理后的最终提交结果。首次全量发现旧嵌套源码夹具裁剪 `files` 时未同步裁剪新增的 `members`；已修正夹具，相关范围及修订摘要测试 5/5，随后完整重跑通过。修订摘要还剔除了机器相关的 SDK 绝对路径，保留 SDK 版本等语义身份，并验证换路径不影响摘要、换版本仍影响摘要。运行日志保存在验收证据目录的 `root-full-r28-final.log`，首次失败及修正、消融日志一并保留。

整理后在最新 Labs 基线上的 canonical Node 22.23.2 全量运行，3544 项通过、148 项跳过、1 项失败：Code Analysis 完整模块套件通过，唯一失败是提交中的 ZIP 尚未包含新源码。原始日志为 `pr-final/root-full-before-zip.log`。随后使用 canonical Node/zlib 重建 ZIP，`test/release-package-gates.test.mjs` 定向复查 36 通过、2 跳过、0 失败，包括跨时区的逐字节归档一致性检查；日志为 `pr-final/package-recheck.log`。这项失败已修复，不将首次全量运行改写为全绿。机器摘要区分该运行、整理前全量和新鲜官方对照的身份。远端 CI 仍需按最终提交核对。
