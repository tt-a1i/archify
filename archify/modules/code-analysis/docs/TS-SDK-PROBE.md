# JS/TS SDK 与实仓探针

另见 2026-11-17 的 [ts-pattern 真实项目验收](TS-REAL-PROJECT-ACCEPTANCE.md)：使用原锁文件安装的 TypeScript 5.9.2，逐文件/导入/范围/调用检查，并单独记录完整导航覆盖差距。

以下性能表保留提取器 revision **27** 的测量身份；当前实现为 revision **28**，共享成员修正与同输入前后对照见上方 ts-pattern 验收。三个 SDK 的 83 项官方对照已在 revision 28 复跑通过。探针只分析目标源码，不执行目标模块、构建脚本或安装目标项目依赖。所选 SDK 是唯一明确加载的分析器包。

## 版本与官方对照

从模块目录执行：

```sh
node test/ts-version-probe.mjs /path/to/typescript-5.6.3 /path/to/typescript-5.9.3 /path/to/typescript-6.0.3
ARCHIFY_TEST_TYPESCRIPT_SDK=/path/to/typescript node --test test/ts-official-*.test.mjs
```

| 真实 SDK | 最小 paths / 导入函数探针 | 官方引擎场景 |
| --- | --- | --- |
| 5.6.3，独立临时安装 | 2 文件、lib/run.js、imported-function，通过 | 83/83 |
| 5.9.3，模块锁定依赖 | 同上 | 83/83 |
| 6.0.3，本机 VS Code 内置包 | 同上 | 83/83 |

官方对照覆盖 25 个项目、26 个模块、23 个语法和 9 个定义候选场景，明细及差异政策见 [台账](TS-UPSTREAM-LEDGER.md)。首次跨版本复跑在 5.6.3 发现 8 个模块场景漏边：其 isExternalLibraryImport 标志也可用于仓内 #imports 和自身包导出。改为先核对实际捕获根和源码，三个 SDK 随后全部通过。最初失败输出属于修正前证据；SDK 范围仍只按这三个离散版本验证。

同进程版本替换、SDK 链接从 5.6.3 改到 6.0.3、从 src/ 查找祖先 SDK，以及严格回退策略，由 ts-sdk.test.mjs 另行验证。配置排除的选中源码进入推断项目，也必须使用支持的 SDK；显式 Archify 排除才会移除该源码。

## 固定实源样本

[`ts-real-repo-probe.mjs`](../test/ts-real-repo-probe.mjs) 每个样本运行 5 个冷进程。时间只量提取，内存为 maxRSS；五次不足以承诺稳定性能。Fastify 固定为 [v4.29.1 / 2d85fee1](https://github.com/fastify/fastify/tree/2d85fee1d317208e0f9c7c9103c4ebb30d7c35e6)，Vue core 固定为 [cbd95955](https://github.com/vuejs/core/tree/cbd95955a5362b44060908f6e28ad447c3031b8a)。仅分析所列子树。

| 输入 | SDK | 文件 / 已解析导入 / 已归属调用 | 提取 ms p50 / p95 | RSS MiB p50 / p95 |
| --- | --- | --- | --- | --- |
| Archify 当前 extract/、lib/ | 项目 5.9.3 | 39 / 63 / 953 | 496 / 545 | 219 / 221 |
| Fastify lib/、fastify.js | 显式 5.9.3 | 29 / 97 / 182 | 406 / 428 | 204 / 221 |
| Vue reactivity/shared/runtime-core 的 src/ | 显式 6.0.3 | 94 / 656 / 1640 | 768 / 1656 | 245 / 247 |
| 小型 JSX 夹具 | 从祖先项目解析 5.9.3 | 3 / 2 / 1 | 135 / 162 | 182 / 185 |

这些样本均无语法错误，同一输入的五次事实摘要一致。Vue 的 p95 有一次较高的冷进程耗时，不将其描述为提速。Archify 行已在最终生产实现固定后复跑，其源事实摘要为 21481579dd76dcab55ed20d02b9d11cd52dfe3b10ca3ae4548231155b9796247。

Fastify 在 revision 25/26 为 217 个已归属调用，其中 35 个来自新 CommonJS 模型。revision 27 的缓存/逃逸保护将这 35 个保持为未知，回到 182；原因是 lib/pluginUtils.js 将 require.cache 交给局部别名。当前没有跨过程证明缓存只读，因此对该捕获项目的 CommonJS 归属采取保守策略。它降低已知目标覆盖，却避免把可能被修改的导出写成确定函数。类型服务仍能提供定义候选，不能将候选直接当成调用事实。

历史 revision 25 的基线对照固定在 457d71b901b64679320811cfc04555fc5013080f，Fastify 基线也为 182 个目标；旧“182 → 217”的收益仅属于当时实现。Vue 的源事实摘要仍为 b23c28b985e7e555584eeb1b12db9492f131696d2ec2245d81a08a7899f9881a。Archify 自身新增了解码与遍历等实现，不能把两个不同源树的耗时当作同输入性能对照。

复跑示例：

```sh
node test/ts-real-repo-probe.mjs /path/to/fastify /path/to/typescript 'lib/**' 'fastify.js'
node test/ts-real-repo-probe.mjs /path/to/vue /path/to/typescript 'packages/reactivity/src/**' 'packages/shared/src/**' 'packages/runtime-core/src/**'
node test/ts-multi-repo-probe.mjs /path/to/vue /path/to/typescript-5.6.3 /path/to/typescript-6.0.3
```

多版本构造将 Vue 的 reactivity/src 与 shared/src 复制到临时双包，分别接入真实 SDK 5.6.3 和 6.0.3。结果为 typescript@multi、两个 SDK 项目、29 文件、88 导入、734 调用、334 已归属调用、0 语法错误，schema/语义检查通过。它验证同仓多版本适配，不代表 Vue 原仓实际使用两个版本。

Linux/macOS/Windows 的定向 CI 和 Linux 边界 SDK 对照已接入工作流。本机只验证 macOS，远端 CI 尚待提交后执行。未运行完整 TypeScript harness，也未验证补全、重构、完整类型检查或运行时派发。
