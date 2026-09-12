#!/usr/bin/env python3
"""Recover inert fixtures from archive files; never execute archived scripts."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

SESSION = "3c4879a4-a02b-4382-8667-0f1f670c421c"
ROOT = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(relative, value):
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def static_ground_truth(shell):
    """Only literal fields are evaluated. noise_from calls remain inert text."""
    source = "\n".join(shell.splitlines()[1:-1])
    records = []
    for node in ast.parse(source).body:
        if not isinstance(node, ast.Assign):
            continue
        target = node.targets[0]
        if not (isinstance(target, ast.Subscript)
                and isinstance(target.value, ast.Name) and target.value.id == "GTS"):
            continue
        record = {}
        for key, value in zip(node.value.keys, node.value.values):
            name = ast.literal_eval(key)
            if name == "noise" and any(isinstance(child, ast.Call) for child in ast.walk(value)):
                record["noise"] = None
                record["noiseStatus"] = "unavailable: depends on original receipt file list"
                record["noiseExpression"] = ast.get_source_segment(source, value)
            else:
                record[name] = ast.literal_eval(value)
        if record["noise"] is not None:
            record["noiseStatus"] = "literal recovered; not scored in this partial replay"
        record["sourceLines"] = [node.lineno + 1, node.end_lineno + 1]
        records.append(record)
    assert len(records) == 15
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recovery-root", type=Path, required=True)
    parser.add_argument("--transcript-root", type=Path, required=True,
                        help="Cursor agent-transcripts directory, containing SESSION/subagents")
    args = parser.parse_args()
    historical = f"recovered/{SESSION}/archify-burn/firstlook"
    agents_path = args.recovery_root / historical / "scores/agents.json"
    agents_bytes = agents_path.read_bytes()
    agents = json.loads(agents_bytes)
    answers = []
    for condition, label in [("conditionA", "A"), ("conditionB", "B")]:
        for pr, agent in agents[condition].items():
            relative = f"{SESSION}/subagents/{agent}.jsonl"
            raw = (args.transcript_root / relative).read_bytes()
            writes, finals = [], []
            for line, text in enumerate(raw.decode().splitlines(), 1):
                record = json.loads(text)
                for block in record.get("message", {}).get("content", []):
                    if block.get("type") == "tool_use" and block.get("name") == "Write":
                        inp = block["input"]
                        value = inp.get("contents", inp.get("content", ""))
                        writes.append((line, value, inp["path"]))
                    if record.get("role") == "assistant" and block.get("type") == "text":
                        try:
                            json.loads(block["text"])
                            finals.append((line, block["text"]))
                        except (ValueError, KeyError):
                            pass
            assert len(writes) == 1 and len(finals) == 1, (condition, pr)
            line, value, target = writes[0]
            assert target.endswith(f"condition-{label.lower()}/pr-{pr}.json")
            assert json.loads(value) == json.loads(finals[0][1])
            answers.append({
                "pr": int(pr), "condition": label, "sourceSession": agent,
                "archivePath": f"cursor-agent-transcripts/{relative}",
                "transcriptSha256": digest(raw), "writeLine": line,
                "finalLine": finals[0][0], "writeJson": value,
                "finalJson": finals[0][1], "writeSha256": digest(value.encode()),
                "finalSha256": digest(finals[0][1].encode()),
            })
    assert len(answers) == 30
    sources = []
    for tail, label in [("13", "ground-truth-v1"), ("21", "scoring-v1"), ("22", "scoring-v2")]:
        relative = f"shell-sources/{SESSION}-{tail}.txt"
        raw = (args.recovery_root / relative).read_bytes()
        destination = ROOT / "sources" / f"{label}.txt"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        sources.append({"id": label, "archivePath": relative, "sha256": digest(raw),
                        "bundledFile": f"sources/{label}.txt", "sourceSession": SESSION})
        if label.startswith("scoring-"):
            shell = raw.decode().splitlines()
            body = "\n".join(shell[1:-1])
            tree = ast.parse(body)
            names = {"norm_path", "as_list", "p_at_3", "recall_at_3", "hit1"}
            functions = [node for node in tree.body
                         if isinstance(node, ast.FunctionDef) and node.name in names]
            assert {node.name for node in functions} == names
            extracted = "\n\n".join(ast.get_source_segment(body, node) for node in functions) + "\n"
            header = (f'"""Pure function extraction from {relative}.\n'
                      f'Original SHA-256: {digest(raw)}\n'
                      'Only path normalization and three file-selection metrics are included.\n"""\n')
            (ROOT / f"reference_{label[-2:]}.py").write_text(header + extracted)
    gt_text = (ROOT / "sources/ground-truth-v1.txt").read_text()
    write_json("fixtures/ground-truth.json", static_ground_truth(gt_text))
    write_json("fixtures/answers.json", answers)
    write_json("fixtures/agents.json", agents)
    report = (args.recovery_root / historical / "REPORT.md").read_bytes()
    excerpt = "\n".join(report.decode().splitlines()[103:131]) + "\n"
    (ROOT / "sources/historical-report-metrics.md").write_text(excerpt)
    sources.append({"id": "historical-report", "archivePath": f"{historical}/REPORT.md",
                    "sha256": digest(report), "bundledFile": "sources/historical-report-metrics.md",
                    "bundledSha256": digest(excerpt.encode()), "sourceLines": [104, 131]})
    write_json("fixtures/provenance.json", {
        "schemaVersion": 1, "sourceSession": SESSION,
        "agentsArchivePath": f"{historical}/scores/agents.json",
        "agentsOriginalSha256": digest(agents_bytes), "sources": sources,
        "recoveryMethod": "Read transcript Write input and final JSON; parse GTS assignments with ast.literal_eval. No archived code executed.",
        "groundTruthVersion": "ground-truth-v1: recovered shell input 13",
        "scoringVersion": "scoring-v2: recovered shell input 22; v1 retained for comparison",
        "missing": ["Complete original receipt-derived noise ground truth", "Complete original A/B prompt bodies, including original B locate receipts"],
    })
    # No machine-specific archive paths are copied into this bundle.
    for file in [*(ROOT / "fixtures").glob("*"), *(ROOT / "sources").glob("*")]:
        text = file.read_text()
        assert "/Users/" not in text and "/home/" not in text, file.name
    print("Recovered 30 answers and 15 static ground-truth records; no archived script executed.")


if __name__ == "__main__":
    main()
