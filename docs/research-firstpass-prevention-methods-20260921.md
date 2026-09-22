# 首稿前减少语义遗漏和几何返工：最小可观察预检研究

2026-09-21。本笔记回答一个窄问题：对已有源码证据的 Architecture 首稿，怎样在**不再加一轮大模型生成或全图求解器**的前提下，把「必要事实没有写进图」和「写完才发现宽度不足」提前暴露。它不为任何既有实验输入给出事实、节点、文案或布局答案。

## 结论

最小值得试验的增量是一个确定性的、可选的首稿 helper，输入仍由作者提供：

1. 一个小的事实账本（每项有稳定 ID、已核验来源位置和作者写定的可见锚点）；
2. 真实的候选 JSON；
3. 作者选择的逻辑 `row` / `column`，不是工具推断的拓扑或主路径。

它只做两件事：

- **事实→可见字段锚定。** 对每项事实，确认至少一个作者声明的精确短语确实出现在 JSON 的可见字段，并回报 JSON Pointer、字段和值；没有锚点或锚点未命中即拒绝首稿进入后续 `finalize`。可见字段白名单应限于读者实际会看到的 title、component label/sublabel、connection label/sublabel、boundary label、guided-view title/note 和 conclusion-card 文本；`id`、`sources` 路径、隐藏元数据和仅有 URL 不算可见事实。
- **先尺寸、后坐标。** 对同一份候选，沿用当前 Architecture 的 preferred-font 文本单位规则计算每个节点的最小宽高；按作者给定的列取最大宽度，加既有清晰间隙和该列主路径标签的最小间隙，输出列宽、累计 x、行高和建议的 `pos`/`size`。它不选择节点、边、文案、row/column、端口、route 或 label control，也不改写输入；作者可把建议显式写入 JSON，之后仍由现有闸门决定。

这个候选比新写 prose、小型 LLM 审稿回路、ELK/Graphviz 接入或自动拓扑生成窄得多：一次本地字符串/尺寸计算，复杂度随作者已有的事实、组件和边线性增长。它只能证明「指定事实有可读字段锚点」和「首稿使用的最小尺寸预算已计算」，不能证明文字解释正确、来源蕴含该事实、读者理解正确，或最终布局可读。

## 已观察到的本仓库基线

以下是当前 checkout 的直接读取结果，不是实验效果。

| 已有能力 | 已覆盖的风险 | 为什么不足以替代候选 helper |
| --- | --- | --- |
| `references/authoring-defaults.md` 要求在源码检查时补全 source 形状、审计责任/边界，且不得为排版删除事实。 | 告诉作者应覆盖什么，也保护后续修复不删语义。 | 没有机器可读的「该事实必须在哪个可见字段出现」清单；首稿漏写一项后，schema 和 geometry gate 可都通过。 |
| 同一文件已经规定 Architecture 9px preferred sublabel、按文本单位估算 component 宽度、主路径 label 的最小 clear gap，并在首稿前估计内容宽度。 | 已有正确的度量和避免可预测 label collision 的规则。 | 这是自然语言工作流，未把作者选定的 row/column 变成可检查的 per-column 最大宽度及一次性坐标建议；重复这些文字不会新捕获遗漏。 |
| `validate` / `finalize` 的 composition、artifact、provenance、browser gates。 | 捕获 schema、既有几何、输出和浏览器边界问题。 | 它们在候选已写成后运行，且不能从代码或字符串反推出缺失的业务说明。 |
| Workflow `semanticChecks`。 | 已可检验 allowed roots/terminals、必需直接边和有向可达性。 | 它只适用于 workflow 的图结构；其 README 明说 layout validation 不能从 labels/cards 推断 domain truth。它不是 repository-backed Architecture 的事实→可见文本账本。 |

前一轮固定研究也观察到「原字符串未丢失」不等于「必要语义已经写全」，并且后来补文字会改变节点尺寸和路由空间。因此把账本检查和尺寸建议放在作者选择坐标之前，是可检验的因果顺序；本笔记没有测得它会降低修复次数或耗时。

## 为什么这两个检查有一手依据

NASA 的 *Systems Engineering Handbook* 要求 requirements matrix 用唯一标识符和明确来源，并把要求双向可追踪到更高层的需求、目标或约束；这支持使用小而可审计的事实账本，不能支持让工具从源码自动「发现全部需求」。[NASA handbook PDF](https://www.nasa.gov/wp-content/uploads/2018/09/nasa_systems_engineering_handbook_0.pdf)

ELK 的官方数据模型把 node、port 和 label 都定义成有二维位置和尺寸的对象；Layered 文档也列出 edge labels、ports 和 compound edges。它的 node-size constraints 可以将 node labels、ports、port labels 和 minimum size 纳入节点尺寸。这支持「文字及端口空间必须在布局输入时存在」，而非路由完成后再塞入；不要求本试验引入 ELK。[ELK text-format reference](https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/elktextformat.html)；[ELK node-size constraints](https://eclipse.dev/elk/reference/options/org-eclipse-elk-nodeSize-constraints.html)；[ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)

Archify 已有的 preferred-font 和 label-gap 估算是本候选应复用的本地度量真相来源。ELK 说明的是一般布局系统为何需要先有尺寸，不是对 Archify 的实现或效果保证。

## 最小协议（建议作为实验 helper 的输入/回执，不是新产品 schema）

事实账本可放在 benchmark fixture 旁的独立 JSON，避免污染 artifact schema：

```json
{
  "facts": [
    {
      "id": "F-01",
      "source": [{ "path": "relative/file", "line": 1, "end_line": 3 }],
      "anchors": ["author-written visible phrase"],
      "required": true
    }
  ],
  "placement": {
    "component-id": { "row": 0, "column": 1 }
  }
}
```

`source` 是作者已检查的证据定位，helper 只验证路径/行号形状或在给定 revision 中的存在性；它**不**解释代码，也不把 source 引用本身当作 visible anchor。`anchors` 是作者为事实选择的最短可读表达，可匹配多个可见字段。严格精确匹配（可统一 Unicode/空白）优先于语义相似度，故没有额外模型调用，也不会把近义但不完整的句子误判为覆盖。

回执至少应逐项给出 `factId`、`status: covered|uncovered|invalid-anchor`、每个命中的 `jsonPointer`、`field` 和实际字符串；布局部分给出每个组件的测量输入、最小 `size`、每列最大宽、每行最大高、保留 gap 和建议坐标。输入 hash、helper 版本和原 JSON hash 使一次失败可复现。若某一必需事实无命中、锚点为空、placement 缺少 component/重复位置，或给定标签间隙在该列放不下，helper 非零退出且不写候选。

## 不做什么，以及为何不重复现有机制

- 不由 source 自动抽取事实、不做 NLI/embedding 相似度、不评判可见句子是否等价于代码。那些能力才需要额外模型/人工审查，且会制造「通过即语义真」的错误信号。
- 不取代 `components[].sources`、现有 `semanticChecks`，也不把账本写入交付 artifact；前者证明固定 revision 的定位，后者检验 workflow 结构，账本只检查指定可见表述。
- 不自动排图、不添加 ELK/Graphviz 依赖、不选择 edge ports/vias。当前 defaults 已有自动路由优先、测量间隙、诊断后最小控制和最终 browser gate；完整布局器会扩大实验变量，无法归因于「首稿前尺寸化」。
- 不把 helper 成功当作 `validate`、`deliver`、`check`、`browser-check` 或感知审查的替代。它在它们之前只阻止明显不完整的输入；所有现有最终门槛不变。

## 可证伪的试验和停止条件

在计时作者之前冻结 helper、账本格式、可见字段白名单、Unicode 规则、文本度量、间隙常数、输出格式和样本。对相同源码快照及相同任务，比较普通首稿与「账本+尺寸建议」首稿；两组都必须走相同的现有 `finalize` 与独立语义审查。记录：首稿的账本未覆盖数、首稿所用几何修复轮数、首次全门通过率、完整交付时间、最终语义审查结论，以及 helper 自身毫秒数。不要把 helper 时间或字符串命中数当作端到端收益。

该方法的最低成功证据是：预先声明的必需事实不会出现「账本通过但无任何可见字段锚点」，且尺寸建议输入能被确定性复现。要声称减少语义遗漏或几何重工，需要留出任务上同时看到首稿完整质量和总修复/时间改善；若账本锚点常被认为虽命中但表意不足，或 per-column 建议仍频繁触发现有几何失败，应停止，把失败样本用于调整**显式协议**，而不是增加隐藏模型循环。

## 判断

建议只实现并评估上述可选 helper。它填补的恰好是当前规范的两处可观察缺口：把作者已确认的必要事实落到具体可读字段，以及把已有的 preferred-font 度量变成作者选定行列上的实际首稿空间输入。它保留语义判断给作者/独立审查，保留几何真相给现有验证和浏览器门槛。尚无测量结果证明它能改善首稿质量或速度。
