#!/usr/bin/env python3
"""Offline partial rescore. Reads only bundled fixtures; writes only results/report."""
import argparse
import hashlib
import json
import platform
import sys
from fractions import Fraction
from pathlib import Path
from statistics import mean

sys.dont_write_bytecode = True
import reference_v1
import reference_v2

ROOT = Path(__file__).resolve().parent
CROSS = [354, 108, 85, 181, 96, 54, 146, 256, 265, 42]
CONTROLS = [346, 348, 138, 216, 109]
PRS = CROSS + CONTROLS
METRICS = ("p_at_3", "recall_at_3", "hit1")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(relative):
    return json.loads((ROOT / relative).read_text())


def direct_score(answer, gold):
    # Compare the original path strings independently of the legacy normalizer.
    # Equality with both historical implementations is asserted for every cell.
    pred = answer["firstThree"]
    assert 0 < len(pred) <= 3 and len(pred) == len(set(pred))
    assert 0 < len(gold) <= 3 and len(gold) == len(set(gold))
    assert all(isinstance(path, str) and path == path.strip() for path in pred + gold)
    hits = len(set(pred) & set(gold))
    return {"p_at_3": Fraction(hits, 3), "recall_at_3": Fraction(hits, len(gold)),
            "hit1": Fraction(int(pred[0] in gold), 1)}


def old_score(module, answer, gold):
    pred = module.as_list(answer.get("firstThree"))
    p3 = module.p_at_3(pred, gold)
    if isinstance(p3, tuple):
        p3 = p3[0]  # v1's extra hit/count return fields do not change the score.
    return {"p_at_3": p3, "recall_at_3": module.recall_at_3(pred, gold),
            "hit1": float(module.hit1(pred, gold))}


def aggregate(rows, prs):
    subset = [row for row in rows if row["pr"] in prs]
    result = {"n": len(subset), "prs": prs}
    for metric in METRICS:
        a = [row["exact"]["A"][metric] for row in subset]
        b = [row["exact"]["B"][metric] for row in subset]
        exact_a, exact_b = sum(a) / len(a), sum(b) / len(b)
        result[metric] = {
            "A": float(exact_a), "B": float(exact_b), "delta": float(exact_b - exact_a),
            "exactA": str(exact_a), "exactB": str(exact_b),
            "legacyRoundedA": round(mean(round(float(v), 4) for v in a), 4),
            "legacyRoundedB": round(mean(round(float(v), 4) for v in b), 4),
            "B_better": sum(y > x for x, y in zip(a, b)),
            "A_better": sum(x > y for x, y in zip(a, b)),
            "tie": sum(x == y for x, y in zip(a, b)),
        }
    result["B_worse_p_at_3_prs"] = [row["pr"] for row in subset
                                         if row["exact"]["B"]["p_at_3"] < row["exact"]["A"]["p_at_3"]]
    return result


def calculate():
    provenance = read_json("fixtures/provenance.json")
    for record in provenance["sources"]:
        expected = record.get("bundledSha256", record["sha256"])
        assert sha((ROOT / record["bundledFile"]).read_bytes()) == expected
    # Verify extracted reference function bodies against the inert source text.
    import ast
    names = {"norm_path", "as_list", "p_at_3", "recall_at_3", "hit1"}
    for version in ["v1", "v2"]:
        body = "\n".join((ROOT / f"sources/scoring-{version}.txt").read_text().splitlines()[1:-1])
        expected = {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(body).body
                    if isinstance(n, ast.FunctionDef) and n.name in names}
        actual = {n.name: ast.dump(n, include_attributes=False)
                  for n in ast.parse((ROOT / f"reference_{version}.py").read_text()).body
                  if isinstance(n, ast.FunctionDef)}
        assert expected == actual

    answers = read_json("fixtures/answers.json")
    truth = read_json("fixtures/ground-truth.json")
    assert len(answers) == 30 and len(truth) == 15
    assert {record["pr"] for record in truth} == set(PRS)
    assert sum(record["noise"] is None for record in truth) == 10
    index = {}
    for record in answers:
        assert sha(record["writeJson"].encode()) == record["writeSha256"]
        assert sha(record["finalJson"].encode()) == record["finalSha256"]
        value = json.loads(record["writeJson"])
        assert value == json.loads(record["finalJson"])
        assert {"firstThree", "seam", "ignore", "confidence", "rationale"} <= value.keys()
        key = (record["pr"], record["condition"])
        assert key not in index
        index[key] = value
    assert set(index) == {(pr, condition) for pr in PRS for condition in ["A", "B"]}
    gt = {record["pr"]: record for record in truth}
    rows = []
    checks = 0
    for pr in PRS:
        row = {"pr": pr, "cohort": "main10" if pr in CROSS else "controls5",
               "gtFirstThree": gt[pr]["firstThree"], "answers": {}, "exact": {}}
        for condition in ["A", "B"]:
            answer = index[(pr, condition)]
            score = direct_score(answer, gt[pr]["firstThree"])
            for reference in [reference_v1, reference_v2]:
                historical = old_score(reference, answer, gt[pr]["firstThree"])
                for metric in METRICS:
                    assert float(score[metric]) == historical[metric], (pr, condition, metric)
                    checks += 1
            row["answers"][condition] = answer["firstThree"]
            row["exact"][condition] = score
        rows.append(row)
    aggregates = {key: aggregate(rows, prs) for key, prs in [
        ("main10", CROSS), ("controls5", CONTROLS), ("all15", PRS)]}
    # Values transcribed from the bundled historical REPORT excerpt, lines 104-131.
    reported = {
        "main10": {"p_at_3": [0.767, 0.700], "recall_at_3": [0.767, 0.700], "hit1": [0.90, 0.90]},
        "controls5": {"p_at_3": [0.600, 0.533], "recall_at_3": [1.00, 0.90], "hit1": [1.00, 1.00]},
        "all15": {"p_at_3": [0.711, 0.644], "hit1": [0.933, 0.933]},
    }
    comparisons = []
    for cohort, values in reported.items():
        for metric, pair in values.items():
            decimals = 3 if metric == "p_at_3" or (cohort == "main10" and metric == "recall_at_3") or cohort == "all15" else 2
            actual = [aggregates[cohort][metric][condition] for condition in ["A", "B"]]
            comparisons.append({"cohort": cohort, "metric": metric, "reported": pair,
                                "recomputed": actual, "decimalsInReport": decimals,
                                "matchesAtReportedPrecision": [round(x, decimals) == y for x, y in zip(actual, pair)]})
    for row in rows:
        row["scores"] = {condition: {metric: float(value) for metric, value in score.items()}
                         for condition, score in row.pop("exact").items()}
    inputs = [*sorted((ROOT / "fixtures").glob("*.json")), *sorted((ROOT / "sources").glob("*")),
              ROOT / "reference_v1.py", ROOT / "reference_v2.py", ROOT / "run.py"]
    result = {
        "schemaVersion": 1, "purpose": "Partial rescore of original model answers; no new model trial or historical prompt replay.",
        "runtime": {"python": platform.python_version()},
        "inputs": {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in inputs},
        "verification": {"recoveredAnswers": 30, "writeFinalEqual": 30, "groundTruthRecords": 15,
                         "metricCrossChecks": checks, "referenceVersions": ["v1", "v2"],
                         "groundTruthCallsExecuted": 0, "originalScriptsExecuted": 0},
        "aggregates": aggregates, "perPr": rows, "historicalComparison": comparisons,
        "notRecomputed": ["noise-avoidance", "wrong-start", "seam heuristics", "full original prompts/receipt context", "timing or reviewer benefit"],
        "limitations": ["One model (cursor-grok-4.6-xhigh-fast), one trial per cell, 10 main PRs plus 5 controls.",
                        "Experimenter-authored, non-blind ground truth; selected historical PRs and a future map.",
                        "This recovers recorded answer content, not proof that the original prompt isolation protocol was obeyed.",
                        "Full B prompt bodies and 10 receipt-derived noise lists were not reconstructed.",
                        "Hit@1 means first predicted path belongs to the GT set, not that it equals GT's first path.",
                        "P@3 always divides by 3; perfect one-file controls therefore score 1/3. Recall@3 removes that denominator effect."]
    }
    return result


def report(result):
    lines = ["# 原始 first-look A/B 回答的局部复算", "",
             "已恢复 30 份原始模型回答和 15 份静态首选文件标准答案。P@3、Recall@3、Hit@1 与旧报告的已列数值在原显示精度上全部一致。**这次没有重跑模型，也没有重建完整的原 A/B 提示。**", "",
             "| 样本 | P@3 A / B | Recall@3 A / B | Hit@1 A / B |",
             "|---|---|---|---|"]
    labels = {"main10": "主样本 10 PR", "controls5": "对照 5 PR", "all15": "合计 15 PR"}
    for cohort, item in result["aggregates"].items():
        cells = [f"{item[metric]['A']:.4f} / {item[metric]['B']:.4f}" for metric in METRICS]
        lines.append(f"| {labels[cohort]} | {' | '.join(cells)} |")
    lines += ["", "主样本中，B 的 P@3 在 1 个 PR 上更高，3 个更低，6 个相同。B 较低的 PR 为 #85、#146、#256；对照中还包括 #348。原报告的主结论保持不变：这个单次模型实验没有显示 locate 提升首选文件重合率。", "",
              "## 复算和旧报告的区别", "",
              "- 从原 archive 的 Write 输入恢复 JSON，并逐份核对原 final JSON；30/30 相等。输入保留原始 JSON 文本、原 transcript SHA、session ID 和相对 archive 路径，没有机器的 home 路径。",
              "- GT 版本为恢复的 shell input 13；只用 AST 和 literal_eval 读取静态字段。10 个主样本的 noise_from 表达式保留为文本，noise 值为 null；5 个对照的原始空列表保留。没有执行这些表达式。",
              "- 评分版本保留 input 21（v1）和 input 22（v2）的原文与 SHA。仅抽出 norm_path/as_list/P@3/Recall@3/Hit@1 五个纯函数，并与独立的集合/分数实现做 180 次指标交叉核对。v1 的 P@3 返回三元组，v2 返回标量；这三个指标的数值一致。",
              "- 旧 scorer 先将逐 PR 值四舍五入到 4 位，再平均。结果同时保留精确分数均值与 legacyRoundedA/B，避免把舍入差异当结论变化。",
              "- 旧报告主样本、对照和合计已显示的 16 个 A/B 数值全部对齐。合计 Recall@3 是本次从原回答复算的 0.8444 / 0.7667，旧报告该段未显示这项。",
              "- noise-avoidance、wrong-start、seam 启发式评分没有复算。noise_from 依赖缺失的原 receipt 文件列表；完整原 B 提示和 locate receipt 也没有重建。现有静态 seam 字段和原回答仍保留，供独立后续检查。", "",
              "## 证据边界", "",
              "15 PR 是 10 个主样本加 5 个对照；模型为 cursor-grok-4.6-xhigh-fast，每格仅一次。GT 由同一实验者非盲制定，PR 是选定的历史样本，地图来自较晚时点。这不是人类评审实验，没有实际理解、缺陷发现率、耗时或因果收益证据。原提示未完整找回，因此恢复回答也不等于再次验证了最初的盲测隔离。", "",
              "P@3 固定除以 3，只有 1 个必读文件的对照即使全中也最多为 1/3；应同时看 Recall@3。Hit@1 的含义是首选文件属于 GT 集合，并不要求等于 GT 列表第一项。", "",
              "## 复现", "", "```sh", "python3 run.py --check", "```", "",
              "只需 Python 标准库和本目录；无需 Cursor 原 archive、仓库 checkout、网络、模型或任何外部服务。`--check` 重新计算并与 results.json/REPORT.md 比较，不改文件；不带参数会更新本目录的两个输出。", "",
              "输入：[answers](fixtures/answers.json)、[static GT](fixtures/ground-truth.json)、[provenance](fixtures/provenance.json)。",
              "结果：[results.json](results.json)。旧报告指标原文：[historical-report-metrics.md](sources/historical-report-metrics.md)。", "",
              "`recover.py` 仅用于再次从原 archive 提取；运行参数中的本机路径不会写入 fixture。sources/*.txt 是不执行的历史证据，不能作为脚本运行。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare with saved results/report without writing")
    args = parser.parse_args()
    result = calculate()
    assert all(all(row["matchesAtReportedPrecision"]) for row in result["historicalComparison"])
    outputs = {"results.json": json.dumps(result, ensure_ascii=False, indent=2) + "\n", "REPORT.md": report(result)}
    for relative, text in outputs.items():
        if args.check:
            assert (ROOT / relative).read_text() == text, f"Saved output differs: {relative}"
        else:
            (ROOT / relative).write_text(text)
    print("PASS: 30 answers; 15 static GTs; 180 reference metric checks; historical reported values match.")


if __name__ == "__main__":
    main()
