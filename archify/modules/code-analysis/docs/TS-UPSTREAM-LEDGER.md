# TypeScript / VS Code 对照台账

真实仓库验收另见 [ts-pattern 实测](TS-REAL-PROJECT-ACCEPTANCE.md)，其机器摘要与原始证据指纹独立于下面的合成及上游投影计数。

当前实现：提取器 revision **28**，调用模型 `js-ts-lexical-v6`，尚未发布。上游案例固定为 [TypeScript v6.0.3 / `050880ce59e30b356b686bd3144efe24f875ebc8`](https://github.com/microsoft/TypeScript/tree/050880ce59e30b356b686bd3144efe24f875ebc8)。VS Code 来源固定为 [`2c33b50b`](https://github.com/microsoft/vscode/tree/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/extensions/typescript-language-features)。案例来源版本与实际比较的 SDK 分别记录。

上游案例使用 [Apache License 2.0](https://github.com/microsoft/TypeScript/blob/v6.0.3/LICENSE.txt)。本仓只保留最小衍生输入和产品断言，没有复制完整运行器或 emit 基线。以下三层证据分别计数，不能相加称为上游完整测试通过数。

## 官方引擎直接对照：83 个场景

[`ts-official-cases.mjs`](../test/ts-official-cases.mjs) 给出每个场景的唯一 ID、完整输入和投影策略。测试直接启动同版本 `tsserver`，或调用其 Compiler API / Language Service，再与真实 Archify 提取结果比较。

| 层次 | 数量 | 逐项检查 |
| --- | ---: | --- |
| 项目服务 | 25 | 对所有选中源码发送 open/projectInfo，比较默认归属及有效选项；覆盖配置优先级、继承与数组继承、传递导入、exclude/outDir、noResolve、allowJs、推断/重叠项目、具名引用配置、引用循环、UTF-16 配置和工作区边界。 |
| 模块解析 | 26 | Program usage mode 与公开 resolveModuleName；覆盖 Preserve/Bundler、Node10/16/Next/Classic、import/require 条件、动态 import、paths、moduleSuffixes、rootDirs、imports/self exports、自定义条件、声明遮挡及 type-only resolution-mode。 |
| 语法与范围 | 23 | 文件种类、JSX/TSX、函数与调用库存、恢复语法树、重载、装饰器、Unicode 行分隔符、UTF-16 列和 UTF-8/UTF-16 BOM；带 BOM 的源码问题同时验证新鲜度。 |
| 定义候选 | 9 | Language Service 的本地函数、const 箭头、ESM 别名/default/转发、CommonJS 解构与自引用；成员导航、重绑定导出保留未知。 |

2026-11-17，macOS / Node 20.20.2，在真实 SDK **5.6.3、5.9.3、6.0.3 上各 83 项通过**。revision 28 已复跑，并增加每个 caller Program 完整成员与共享函数目标的断言。这不覆盖范围内每个补丁版本。从模块目录执行：

```sh
node --test test/ts-official-*.test.mjs test/ts-upstream-ledger.test.mjs
ARCHIFY_TEST_TYPESCRIPT_SDK=/path/to/typescript node --test test/ts-official-*.test.mjs
```

CI 的 js-ts-platform 在 Linux/macOS/Windows 执行默认 SDK 对照，在 Linux 临时安装 5.6.3、6.0.3 重跑同一组场景。远端结果需在提交后核对；本机不能代替另外两个平台的通过记录。

## 上游源码批量语法投影：915 个案例

[`ts-upstream-syntax-probe.mjs`](../test/ts-upstream-syntax-probe.mjs) 扫描 compiler/conformance 的 **12,445 个输入文件**，重建含可捕获 JS/CJS/MJS/JSX 的 **915 个案例、1,216 份源码**。自带 SDK 5.9.3 上全部匹配，无失败；每个上游路径和结果写入 JSON。

```sh
node test/ts-upstream-syntax-probe.mjs /path/to/TypeScript-v6.0.3 /tmp/upstream-syntax.json
node test/ts-upstream-inventory.mjs /path/to/TypeScript-v6.0.3 /tmp/upstream-inventory.json
```

只比较：捕获文件集合、语法错误覆盖、具名函数实现是否遗漏、函数范围是否对应官方 AST，以及 parse-valid 文件的完整 CallExpression 库存。原始 JS 源码以相同推断选项分别解析；**不解释原用例全部选项，不执行原 harness、emit、类型诊断、JSDoc 语义或引用基线**。node_modules 虚拟源码与越界路径不捕获。

首次 compiler 子集发现 binderBinaryExpressionStressJs.ts 在适配器递归遍历中栈溢出。revision 27 改为显式栈，随后全部投影通过；最小压力输入进入常规回归。原生 TypeScript 自身无法解析/绑定的输入仍不能由适配器保证。

扩展后的发现清单覆盖 compiler、conformance、fourslash、projects、tsserver：扫描 **19,325 个测试文件**，筛出 **3,998 个候选文件**。分类可重叠：JS 源码 1,696、项目 711、模块 1,988、定义/引用 584。候选不是已迁移或已逐条审阅数。

## 人工迁移的上游观察点：6 项

独立台账是 [`ts-upstream-cases.json`](../test/ts-upstream-cases.json)，对应 [`ts-upstream-alignment.test.mjs`](../test/ts-upstream-alignment.test.mjs)。

| ID | 固定上游来源 | 当前结果 |
| --- | --- | --- |
| project/sibling-jsconfig/import-target | [tsserver/configuredProjects.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/testRunner/unittests/tsserver/configuredProjects.ts)，衍生 paths 输入 | 匹配：项目文件与 helper.js 目标。 |
| syntax/jsx-file-kind | [compiler/jsxPreserveWithJsInput.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/tests/cases/compiler/jsxPreserveWithJsInput.ts) | 匹配：文件种类与语法覆盖。 |
| definition/js-member-call | [fourslash/goToDefinitionJsModuleExports.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/tests/cases/fourslash/goToDefinitionJsModuleExports.ts) | 有意保留差异：定义导航有候选；成员调用保持 unsupported-callee。 |
| reference/commonjs-require-function | [fourslash/findAllRefsCommonJsRequire2.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/tests/cases/fourslash/findAllRefsCommonJsRequire2.ts)，另加直接调用 | 匹配：稳定静态导出下指向唯一函数；别名、重绑定、导出写入、缓存及逃逸有反例。 |
| syntax/binary-expression-stress | [compiler/binderBinaryExpressionStressJs.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/tests/cases/compiler/binderBinaryExpressionStressJs.ts)，另加函数和 require | 匹配：长表达式不溢出，指标、导入与目标保留。 |
| module/declaration-only-package | [compiler/nodeNextModuleResolution2.ts](https://github.com/microsoft/TypeScript/blob/v6.0.3/tests/cases/compiler/nodeNextModuleResolution2.ts) | 有意保留差异：外部 .d.ts 不成为捕获内运行时边。 |

CI 输出：**6 项，匹配 4、有意保留差异 2、待修复 0、未判定 0**。这不是完整 fourslash/tsserver 测试迁移。

## 本轮修正与保留边界

| 行为 | revision 27 规则及回归 |
| --- | --- |
| 配置 exclude | 只影响初始根；由 SDK Program 展开捕获内依赖。所有 Archify 选中源码都分析，未归属配置项目者进入推断项目。 |
| 项目选项 | 配置项目采用官方解析结果，不强加 allowJs 或推断默认值；推断项目采用固定 VS Code 来源中的 Preserve/Bundler/ES2022/react-jsx 默认值。 |
| SDK 与子树 | 向祖先查找实际安装版；记录物理 SDK 路径；支持同进程替换及重链接。 |
| TS 5.6 external 标志 | #imports/自身包导出可能被标为 external library。内部边以实际根与选中源码判定，外部及 node_modules 仍不捕获。 |
| CommonJS | 静态 self-require 可通过 schema；可见模块写入、对象逃逸、loader 别名/动态加载/缓存访问使目标保持未知。缓存规则可能降低覆盖，见实仓报告。 |
| 历史比较 | 源码增删可正常比较；SDK 数组重排不改变身份；共享文件的项目/选项/SDK 改变报告上下文变化。 |
| 字符与大输入 | UTF-16 BOM 对齐 TypeScript；UTF-8 源 BOM 保留历史捕获坐标策略；适配器遍历不再依赖 AST 深度递归。 |

revision 28 修正共享成员调用：`files` 只记唯一归属，`members` 保留调用方实际需要的捕获内依赖。ts-pattern 同一源码上的已知目标由 599 增至 1096，497 个新增目标均获官方符号实现体支持，旧目标没有丢失或改指。删除上下文转发检查会生成与已保存归属方导入边不一致的调用路径，消融反例已验证并恢复该检查。

事实范围由分析根与 Archify include/exclude 控制；重叠 Program 的源码只记录一次。外部库及标准库不进入源事实。成员、动态派发、任意别名/工厂、不同 SDK 或缺乏一致保存证据的上下文路径仍保持未知。完整 checkJs/语义诊断、补全、重构、编辑器增量 session、未保存缓冲区和自动类型获取不属于本次实现；不能据此声称等同整个官方扩展。
