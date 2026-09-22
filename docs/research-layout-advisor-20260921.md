# 阶段 2：离线 grid layout advice 窄原型

基线：`104b92b`。本文件记录一个未接入产品、未改动 Skill/schema/renderer/ZIP 的本地研究原型。

## 范围和机制

`benchmarks/source-tools-20260921/layout-advisor/layout-advisor.mjs` 只接受已经完整的 Architecture JSON，且每个组件均由作者明确填写不重复的非负整数 `row` 和 `col`。它不选择层次、不会从关系推断位置，也不删改连接、标签、边界、cards、来源证据或其他非几何字段。

建议器仅替换 `layout`、组件 `pos`/`size` 和 `meta.viewBox`。它会拒绝空/重复组件 ID、非对象组件，以及任何带有绝对 connection 坐标控制（如 `via`、`labelAt`、`channelX`）的输入；不会删除或重映射这些作者控制：

- 以现有 `textUnits`、`minimumNodeTextWidth` 计算每个节点的必要宽度；`label` 使用 Architecture 验证器当前的 `6.6px/unit` 估算，`sublabel` 与 `tag` 使用共享的最小可读文字宽度。
- 以最大节点宽高形成单一 `cellW`/`cellH`，并给出保守、固定的 `gapX: 48`、`gapY: 72`。这不是新的布局或路由模型。
- 调用现有 `gridLayout` 解析候选；再调用 `archify validate architecture ... --layout-json`，因而使用生产 renderer 的自动 router 与自动标签放置；最后调用 showcase `validate --json`。source-backed 输入必须显式传入 `--repo-root <matching checkout>`，并透传至两次验证。成功必须有可解析的 layout 报告和 `ok: true` 的 showcase receipt，且 receipt 的候选 SHA-256、profile 和全部 checks 都匹配。两者都成功前，不写 `--out` 候选。任何输入缺字段、重复 cell、schema/渲染/路由/质量失败都返回 `status: "declined"` 和诊断，而不是猜测性输出。

该工具仍不能处理需要不同层级、可读性受全局 cellW 限制、边界彼此冲突或密集 hub 走线的输入；带旧的显式 route 坐标会在建议前直接拒绝。它也没有浏览器验收，因此不构成可交付图或性能结论；作者仍须对采用的候选走正常 `finalize` 和浏览器 gate。

## 已观察到的本地检查点

在原型的 author-grid 归一化输入上，以下三个既有样例均已实际调用建议器并返回 `advised`，其 `--layout-json` 和 showcase `validate --json` 子命令都是 exit 0：

| 样例 | 状态 | 说明 |
| --- | --- | --- |
| `starter.architecture.json` | advised | 4 个短标签；生产 router/验证均通过。 |
| `web-app.architecture.json` | advised | 10 组件、自动关系路由输入；生产 router/验证均通过。 |
| `production-deployment.architecture.json` | advised | 12 组件和嵌套部署边界；生产 router/验证均通过。 |

观察命令使用的是：

```sh
node archify/bin/archify.mjs validate architecture archify/examples/starter.architecture.json --quality showcase --json
node benchmarks/source-tools-20260921/layout-advisor/test-layout-advisor.mjs
```

第一个基线检查 exit 0（9 个 artifact checks）。第二个自动测试最初在长 CJK fixture 的 schema locale 写为无效 `zh` 时中止；fixture 已改为 `zh-CN`，协调者随后在两位计时作者之间重跑了完整脚本：退出码 0，三个既有样例与长 CJK 均 advised，默认部署网格与默认 CJK 网格的失败仍被保留。

长 CJK fixture 使用研究中同一反例标签“跨租户审计日志导出入口”。它的现有 label 估算约为 145px，默认 120px grid 节点理应触发现有 label-width 失败；建议器会给该节点至少 145px 的大小。修正后的实际验证已通过，建议宽度为 146px；这只证明该局部反例被解决，未证明浏览器质量或作者提速。

## 结论

这证明了一个可实现的窄接口：在作者已经做完语义与 row/col 决定后，本地工具可以承担可复现的文本尺寸算术，并把实际路由和质量判断继续交给 Archify。它没有证明能替代模型的尺寸算术：全局 cell 尺寸、边界关系和密集走线仍会使候选被拒绝；即使通过，也没有测量作者时间、模型回合或浏览器质量。下一步仍需实际浏览器检查，并用同模型同条件任务测量是否减少尺寸规划或修复成本。


## 完整作者实验与后续反例

首次完整 Polka 作者实验使用冻结版 `d7b929b257b6bb271b2574079a89ee438f6f8d312d7ede30a0193636c1697a05`。辅助因 middleware-error 自动路由的 14/15px 内部折线拒绝；作者普通回退在三次修复后仍未通过桌面可读性，完整任务没有成功交付。不能由 fixture 通过宣称首稿收益。详见配对实验报告。

冻结作者结果后，研究原型增加了两个非产品修改：非数组 components/connections 安全拒绝；可选 `--search-gaps` 在预先声明的七组间距中寻找首个验证通过的候选（默认仍只试 [48,72]）。每次最多两次 validate，每个子进程 15 秒超时；这是次数边界，不是整个工具 15 秒保证。此入口只用于复跑离线假设，不推荐加入正常作者路径。

在同一份 Polka 原始初稿上，七组间距全部因相同的内部短折线失败，正确 root 下共 3.071 秒，无输出候选；无节点、关系、文字、来源或行列变化。前一次协调调用误用了 origin 为本机路径的源码 clone，2.467 秒因 origin-mismatch 拒绝，记录单独保留；之后仅纠正 repo-root，不属于新作者或替换完整任务。扩大间距并不充分，需要研究路由策略或可表达语义约束的布局。
