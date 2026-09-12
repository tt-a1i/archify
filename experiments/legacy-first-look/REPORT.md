# 原始 first-look A/B 回答的局部复算

已恢复 30 份原始模型回答和 15 份静态首选文件标准答案。P@3、Recall@3、Hit@1 与旧报告的已列数值在原显示精度上全部一致。**这次没有重跑模型，也没有重建完整的原 A/B 提示。**

| 样本 | P@3 A / B | Recall@3 A / B | Hit@1 A / B |
|---|---|---|---|
| 主样本 10 PR | 0.7667 / 0.7000 | 0.7667 / 0.7000 | 0.9000 / 0.9000 |
| 对照 5 PR | 0.6000 / 0.5333 | 1.0000 / 0.9000 | 1.0000 / 1.0000 |
| 合计 15 PR | 0.7111 / 0.6444 | 0.8444 / 0.7667 | 0.9333 / 0.9333 |

主样本中，B 的 P@3 在 1 个 PR 上更高，3 个更低，6 个相同。B 较低的 PR 为 #85、#146、#256；对照中还包括 #348。原报告的主结论保持不变：这个单次模型实验没有显示 locate 提升首选文件重合率。

## 复算和旧报告的区别

- 从原 archive 的 Write 输入恢复 JSON，并逐份核对原 final JSON；30/30 相等。输入保留原始 JSON 文本、原 transcript SHA、session ID 和相对 archive 路径，没有机器的 home 路径。
- GT 版本为恢复的 shell input 13；只用 AST 和 literal_eval 读取静态字段。10 个主样本的 noise_from 表达式保留为文本，noise 值为 null；5 个对照的原始空列表保留。没有执行这些表达式。
- 评分版本保留 input 21（v1）和 input 22（v2）的原文与 SHA。仅抽出 norm_path/as_list/P@3/Recall@3/Hit@1 五个纯函数，并与独立的集合/分数实现做 180 次指标交叉核对。v1 的 P@3 返回三元组，v2 返回标量；这三个指标的数值一致。
- 旧 scorer 先将逐 PR 值四舍五入到 4 位，再平均。结果同时保留精确分数均值与 legacyRoundedA/B，避免把舍入差异当结论变化。
- 旧报告主样本、对照和合计已显示的 16 个 A/B 数值全部对齐。合计 Recall@3 是本次从原回答复算的 0.8444 / 0.7667，旧报告该段未显示这项。
- noise-avoidance、wrong-start、seam 启发式评分没有复算。noise_from 依赖缺失的原 receipt 文件列表；完整原 B 提示和 locate receipt 也没有重建。现有静态 seam 字段和原回答仍保留，供独立后续检查。

## 证据边界

15 PR 是 10 个主样本加 5 个对照；模型为 cursor-grok-4.6-xhigh-fast，每格仅一次。GT 由同一实验者非盲制定，PR 是选定的历史样本，地图来自较晚时点。这不是人类评审实验，没有实际理解、缺陷发现率、耗时或因果收益证据。原提示未完整找回，因此恢复回答也不等于再次验证了最初的盲测隔离。

P@3 固定除以 3，只有 1 个必读文件的对照即使全中也最多为 1/3；应同时看 Recall@3。Hit@1 的含义是首选文件属于 GT 集合，并不要求等于 GT 列表第一项。

## 复现

```sh
python3 run.py --check
```

只需 Python 标准库和本目录；无需 Cursor 原 archive、仓库 checkout、网络、模型或任何外部服务。`--check` 重新计算并与 results.json/REPORT.md 比较，不改文件；不带参数会更新本目录的两个输出。

输入：[answers](fixtures/answers.json)、[static GT](fixtures/ground-truth.json)、[provenance](fixtures/provenance.json)。
结果：[results.json](results.json)。旧报告指标原文：[historical-report-metrics.md](sources/historical-report-metrics.md)。

`recover.py` 仅用于再次从原 archive 提取；运行参数中的本机路径不会写入 fixture。sources/*.txt 是不执行的历史证据，不能作为脚本运行。
