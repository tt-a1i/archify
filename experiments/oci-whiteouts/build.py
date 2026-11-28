"""Fresh-output fixed example. Raw CLI receipts remain local and ignored."""
import datetime
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from fixture import observe, sha256
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def write(folder, name, value):
    data = value if isinstance(value, (str, bytes)) else json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    with (folder / name).open("xb" if isinstance(data, bytes) else "x") as stream:
        stream.write(data)


def native():
    rows = [
        ("opaque", "Opaque 标记", "upper · cache/.wh..wh..opq", "backend", 40, 40),
        ("old", "cache/old.txt", "lower · 推导为不可见", "backend", 430, 40),
        ("new", "cache/new.txt", "upper · tar 中先于 opaque", "backend", 40, 200),
        ("visible-new", "cache/new.txt 保留", "规范推导 · 来源 upper", "frontend", 430, 200),
        ("ordinary", "显式删除标记", "upper · app/.wh.config.txt", "backend", 40, 360),
        ("config", "app/config.txt", "lower · 推导为不可见", "backend", 430, 360),
        ("keep", "app/keep.txt", "lower · 无标记影响", "backend", 40, 520),
        ("visible-keep", "app/keep.txt 保留", "规范推导 · 来源 lower", "frontend", 430, 520)]
    return {"schema_version": 1, "diagram_type": "architecture", "meta": {
        "title": "同层 new 保留；可见性是规范推导", "locale": "zh-CN", "quality_profile": "showcase", "output": "native.html",
        "legend": {"entries": {"backend": {"label": "实测归档成员"}, "frontend": {"label": "规范推导可见路径"}}}},
        "components": [{"id": i, "label": label, "sublabel": sub, "type": kind, "pos": [x, y], "size": [240, 80],
          "explanation": "原创两层固定 tar；app/ 与 app/cache/ 的完整目录记录在解释页 inventory。此图不是容器运行或解压结果。"}
          for i, label, sub, kind, x, y in rows],
        "connections": [{"id": i, "from": a, "to": b, "label": label} for i, a, b, label in [
          ("opaque-lower", "opaque", "old", "隐藏下层子项"), ("same-layer", "new", "visible-new", "同层不受隐藏"),
          ("explicit-lower", "ordinary", "config", "隐藏下层目标"), ("keep-visible", "keep", "visible-keep", "未被遮蔽")]],
        "cards": [{"title": "证据边界", "dot": "cyan", "items": ["归档成员与顺序实测；可见性规范推导", "两个标记本身都不进入可见文件系统", "未运行 Docker、mount 或任何解压程序"]}]}


def page(obs):
    snippet = lambda i, title, data: {"id": i, "type": "snippet", "language": "json", "title": title, "text": json.dumps(data, indent=2)}
    prose = lambda i, text: {"id": i, "type": "prose", "text": text}
    table_rows = [
      ("p-config", "app/config.txt", "lower", "不可见：普通 whiteout"),
      ("p-old", "app/cache/old.txt", "lower", "不可见：opaque 隐藏下层 children"),
      ("p-new", "app/cache/new.txt", "upper", "可见：同层新增，不被同层 opaque 隐藏"),
      ("p-keep", "app/keep.txt", "lower", "可见：无标记影响"),
      ("p-markers", "两份 whiteout 标记", "upper；空 payload", "标记自身不可见")]
    return {"schema_version": 1, "diagram_type": "explainer", "meta": {"id": "oci-whiteouts", "locale": "zh-CN", "title": "删的是下层：同层新增文件为什么还在？"},
      "answer": {"summary": "app/cache/new.txt 保留。归档内容是实测；可见结果是 OCI 规范推导，未运行容器。",
        "reasons": ["普通 whiteout 只隐藏下层指定目标。", "opaque 隐藏目录的下层子项，同层新文件仍保留。", "tar 中 marker 在前或在后，不改变这个范围。"],
        "scope": "原创合成两层 · 仅六个 regular 成员 · 不是完整镜像或运行观测"},
      "panels": [
        {"id": "meaning", "title": "先分清归档成员与可见性", "span": 12, "blocks": [
          {"id": "boundary", "type": "callout", "level": "warning", "title": "实测 inventory ≠ 实测容器文件系统", "text": "这两份小 tar 由本实验原创构造。visible 路径按固定 OCI 规范推导；没有执行 Docker、mount、解压或上游工具。"},
          {"id": "whiteout-map", "type": "diagram", "diagramType": "architecture", "source": "native.json", "nodeBlocks": {"opaque": "rule-opaque", "new": "rule-same-layer", "ordinary": "rule-explicit", "visible-new": "rule-same-layer"}}]},
        {"id": "rules", "title": "标记只作用于下层", "span": 12, "blocks": [
          prose("rule-opaque", "**Opaque：** 仅隐藏 lower 中 cache 目录的子项与后代；此例 old 不可见，标记自身也不显示。[](source:oci-opaque)"),
          prose("rule-same-layer", "**同层 new：** upper 中 new.txt 先于 opaque 记录，仍然可见。六种 upper regular 成员排列的固定模型得到相同投影；这是规范规则的模型演示，不是六次容器运行。[](source:oci-whiteouts)"),
          prose("rule-explicit", "**普通 whiteout：** upper 中的标记只隐藏 lower 中对应的 config 文件；标记自身不可见，lower 归档原始字节保持不变。[](source:oci-whiteouts)")]},
        {"id": "projection", "title": "规范推导：哪些 regular 路径可见？", "span": 12, "blocks": [
          {"id": "projection-table", "type": "comparison", "labelColumn": "路径", "columns": ["原始归档", "规范推导结果"],
           "rows": [{"id": i, "label": name, "cells": [{"text": layer}, {"text": result}]} for i, name, layer, result in table_rows]},
          snippet("projection-json", "SPEC-DERIVED；不是 runtime filesystem", obs["specDerivedVisibleRegularPaths"])]},
        {"id": "inventory", "title": "实际 tar 成员：目录、顺序与 payload 摘要", "span": 12, "blocks": [
          prose("inventory-scope", "下列记录由标准库逐成员读取两份原创 tar；完整包含每层两个目录和三个 regular 成员。读取 payload 不向文件系统提取。归档长度包括 tar metadata/padding，不等于 payload 总和，也不是镜像压缩大小。"),
          snippet("inventory-json", "实际 inventory；顺序保留", obs["inventory"]),
          snippet("order-json", "六种顺序与固定规范模型；不是容器实跑", obs["orderVariants"])]}],
      "sources": [{"id": "oci-whiteouts", "title": "OCI Image Spec · Whiteouts（固定 commit）", "url": "https://github.com/opencontainers/image-spec/blob/4feed4a6674e59d301b9294f187ac46acb2de99f/layer.md#whiteouts"},
                  {"id": "oci-opaque", "title": "OCI Image Spec · Opaque Whiteout（固定 commit）", "url": "https://github.com/opencontainers/image-spec/blob/4feed4a6674e59d301b9294f187ac46acb2de99f/layer.md#opaque-whiteout"}]}


def main():
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "final"
    out.mkdir()  # fail before any write if occupied
    lower, upper, obs = observe()
    for name, data in [("lower.tar", lower), ("upper.tar", upper), ("observation.json", obs), ("native.json", native()), ("explainer.json", page(obs))]:
        write(out, name, data)
    raw = HERE / "raw" / datetime.datetime.now(datetime.timezone.utc).strftime("run-%Y%m%dT%H%M%S%fZ")
    raw.mkdir(parents=True)
    stages = []
    def portable(value):
        if isinstance(value, str): return value.replace(str(REPO), "<checkout>")
        if isinstance(value, list): return [portable(v) for v in value]
        if isinstance(value, dict): return {k: portable(v) for k, v in value.items()}
        return value
    for mode, source, target in [("architecture", "native.json", "native.html"), ("explainer", "explainer.json", "explainer.html")]:
        cmd = [os.environ.get("ARCHIFY_NODE", "node"), str(REPO / "archify/bin/archify.mjs"), "finalize", mode, str(out / source), str(out / target), "--out-dir", str(raw / mode), "--json"]
        run = subprocess.run(cmd, cwd=out, capture_output=True, text=True, timeout=180)
        write(raw, mode + ".stdout", run.stdout); write(raw, mode + ".stderr", run.stderr)
        try: result = json.loads(run.stdout)
        except json.JSONDecodeError: result = {"unparsedStdout": run.stdout, "stderr": run.stderr}
        stages.append({"command": portable(cmd), "exitCode": run.returncode, "result": portable(result)})
        evidence = {"kind": "portable-stage-summary-not-original-receipt", "python": platform.python_version(), "nodeCommand": os.environ.get("ARCHIFY_NODE", "node"), "nodeVersion": subprocess.check_output([os.environ.get("ARCHIFY_NODE", "node"), "--version"], text=True).strip(), "stages": stages,
          "files": {p.name: sha256(p.read_bytes()) for p in out.iterdir() if p.is_file() and not p.name.endswith('.delivery.json') and p.name != 'build-evidence.json'}}
        (out / "build-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        print(mode, run.returncode)
        if run.returncode:
            print(run.stdout)
            raise SystemExit(run.returncode)


if __name__ == "__main__":
    main()
