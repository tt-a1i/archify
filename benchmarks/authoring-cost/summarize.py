#!/usr/bin/env python3
"""Build truthful all-attempt reports from the frozen authoring manifest."""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import statistics
from datetime import datetime
from typing import Any, Iterable, Mapping


def read(path: pathlib.Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return default


def number(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def first_number(*values: Any) -> float | int | None:
    for value in values:
        found = number(value)
        if found is not None:
            return found
    return None


def status_value(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.lower()
        if text in {"passed", "pass", "accepted", "complete", "completed", "ok", "true"}:
            return True
        if text in {"failed", "fail", "rejected", "false"}:
            return False
        if text in {"pending", "not_evaluated", "unknown"}:
            return None
    return None


def duration_from(data: Mapping[str, Any], *keys: str) -> float | int | None:
    for key in keys:
        value = first_number(data.get(key))
        if value is not None:
            return value
    return None


def setup_duration(setup: Any) -> float | int | None:
    return duration_from(setup, "duration_ms", "durationMs", "setup_duration_ms") if isinstance(setup, Mapping) else None


def quality_machine_duration(quality: Mapping[str, Any]) -> float | int | None:
    return duration_from(quality, "final_machine_duration_ms", "machine_final_duration_ms", "machine_review_final_duration_ms", "machine_review_duration_ms")


def quality_independent_duration(quality: Mapping[str, Any]) -> float | int | None:
    return duration_from(quality, "independent_review_duration_ms", "semantic_visual_review_duration_ms", "review_duration_ms")


def quality_first_snapshot_audit(quality: Mapping[str, Any]) -> float | int | None:
    return duration_from(quality, "first_snapshot_audit_ms", "diagnostic_first_snapshot_render_ms", "first_snapshot_render_ms", "diagnostic_render_duration_ms")


def quality_reviewer_idle(quality: Mapping[str, Any]) -> float | int | None:
    return duration_from(quality, "reviewer_idle_queue_ms", "idle_reviewer_queue_ms", "review_queue_wait_ms")


def independent_review(run_dir: pathlib.Path) -> Mapping[str, Any]:
    """Read the review receipt without treating a missing receipt as zero work."""
    for path in (
        run_dir / "independent-review" / "adjudicated-review.json",
        run_dir / "independent-review" / "review.json",
        run_dir / "review.json",
    ):
        value = read(path)
        if isinstance(value, Mapping):
            return value
    return {}


def parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def elapsed_ms(start: Any, end: Any) -> float | None:
    started = parse_utc(start)
    finished = parse_utc(end)
    if started is None or finished is None:
        return None
    value = (finished - started).total_seconds() * 1000
    return round(value, 3) if value >= 0 else None


def quality_acceptance(quality: Mapping[str, Any]) -> tuple[bool | None, str]:
    """Require explicit machine and independent-review evidence for accepted."""
    quality_status = quality.get("status")
    if status_value(quality_status) is False:
        return False, "quality status is failed"
    # Preferred quality schema: both native/common acceptance and both
    # independent semantic/visual review gates must be explicitly passed.
    semantic = quality.get("semantic") if isinstance(quality.get("semantic"), Mapping) else {}
    visual = quality.get("visual") if isinstance(quality.get("visual"), Mapping) else {}
    gates = [
        status_value(quality.get("native_acceptance")),
        status_value(quality.get("common_acceptance")),
        status_value(semantic.get("status")),
        status_value(visual.get("status")),
    ]
    if quality_status == "passed" and all(gate is True for gate in gates):
        return True, "native/common acceptance and semantic/visual review passed"
    # Standardized compact schema is accepted as an alternative.
    machine = status_value(quality.get("final_machine_status"))
    review = status_value(quality.get("independent_review_status"))
    if quality_status == "passed" and machine is True and review is True:
        return True, "final machine checks and independent review passed"
    if any(gate is False for gate in gates) or machine is False or review is False:
        return False, "an explicit acceptance or review gate failed"
    return None, "quality acceptance is unknown without explicit passing machine and independent-review gates"


def candidate_stats(summary: Mapping[str, Any]) -> tuple[int | None, int | None]:
    records = summary.get("candidate_snapshots")
    if not isinstance(records, list):
        return number(summary.get("candidate_count")), None
    return len(records), sum(1 for item in records if isinstance(item, Mapping) and item.get("complete") is True)


def receipt_stages(run_dir: pathlib.Path) -> list[dict[str, Any]]:
    index = read(run_dir / "artifact-index.json", {})
    if not isinstance(index, Mapping):
        return []
    return [dict(stage) for receipt in index.get("receipts", []) if isinstance(receipt, Mapping) for stage in receipt.get("stages", []) if isinstance(stage, Mapping)]


def stats(values: Iterable[Any]) -> dict[str, Any]:
    clean = [float(value) for value in values if number(value) is not None]
    return {"count": len(clean), "median_ms": statistics.median(clean) if clean else None, "range_ms": [min(clean), max(clean)] if clean else None}


def count_stats(values: Iterable[Any]) -> dict[str, Any]:
    """Summarize a count-valued measure without attaching millisecond units."""
    clean = [value for value in values if number(value) is not None]
    return {
        "sample_count": len(clean),
        "median_edits": statistics.median(clean) if clean else None,
        "range_edits": [min(clean), max(clean)] if clean else None,
    }


def make_row(spec: Mapping[str, Any], case: Mapping[str, Any], run_dir: pathlib.Path) -> dict[str, Any]:
    summary = read(run_dir / "summary.json")
    quality = read(run_dir / "quality.json", {})
    setup = read(run_dir / "run-setup.json")
    review = independent_review(run_dir)
    observed = isinstance(summary, Mapping)
    summary = summary if observed else {}
    quality = quality if isinstance(quality, Mapping) else {}
    setup_ms = setup_duration(setup)
    author_ms = first_number(summary.get("execution_wall_ms"), summary.get("total_wall_ms"))
    machine_ms = quality_machine_duration(quality)
    # The selected receipt is authoritative for both its duration and end
    # timestamp; quality.json remains a fallback for older assembled rows.
    independent_ms = duration_from(review, "duration_ms", "independent_review_duration_ms", "semantic_visual_review_duration_ms")
    if independent_ms is None:
        independent_ms = quality_independent_duration(quality)
    diagnostic_ms = quality_first_snapshot_audit(quality)
    idle_ms = quality_reviewer_idle(quality)
    accepted, acceptance_reason = quality_acceptance(quality) if quality else (None, "quality evidence pending")
    reviewed_at_utc = review.get("reviewed_at_utc")
    dispatch_to_review_wall_ms = elapsed_ms(summary.get("process_started_observed_utc"), reviewed_at_utc)
    components = {"setup_ms": setup_ms, "author_process_execution_ms": author_ms, "final_machine_verification_ms": machine_ms, "independent_review_ms": independent_ms}
    missing = [key for key, value in components.items() if value is None]
    observed_subtotal = sum(value for key, value in components.items() if key != "setup_ms" and value is not None) if any(value is not None for key, value in components.items() if key != "setup_ms") else None
    accepted_total = sum(components.values()) if not missing and accepted is True else None
    if accepted_total is not None:
        timing_status = "accepted_complete"
    elif not observed:
        timing_status = "pending"
    elif accepted is not True:
        timing_status = "not_accepted"
    else:
        timing_status = "incomplete_missing_" + ",".join(missing)
    candidate_count, complete_count = candidate_stats(summary)
    usage = summary.get("usage") if isinstance(summary.get("usage"), Mapping) else {}
    return {
        "run_id": spec.get("run_id"), "case_id": spec.get("case_id"), "cohort": case.get("cohort"), "variant": spec.get("variant"), "repeat": spec.get("repeat"),
        "registered_status": "observed" if observed else "pending", "execution_status": summary.get("status") if observed else "pending", "quality_status": quality.get("status") if quality else "pending",
        "first_quality_status": (quality.get("first_candidate") or {}).get("status", "pending") if isinstance(quality.get("first_candidate"), Mapping) else "pending",
        "process_completed": bool(observed and summary.get("status") == "completed" and summary.get("returncode", 0) == 0 and not summary.get("timed_out")),
        "process_execution_ms": author_ms, "process_completed_ms": author_ms if observed and summary.get("status") == "completed" and summary.get("returncode", 0) == 0 and not summary.get("timed_out") else None,
        "accepted_author_execution_ms": author_ms if accepted is True else None,
        "first_complete_ms": first_number(summary.get("pre_first_complete_ms")),
        "post_json_ms": author_ms - summary.get("pre_first_complete_ms") if author_ms is not None and number(summary.get("pre_first_complete_ms")) is not None else None,
        "setup_duration_ms": setup_ms, "final_machine_verification_ms": machine_ms, "independent_review_ms": independent_ms,
        "final_review_ms": independent_ms,
        "diagnostic_first_snapshot_ms": diagnostic_ms, "reviewer_idle_queue_ms": idle_ms,
        # Keep the old name for compatibility, but this is not evidence that
        # the run was accepted; it is the observed non-setup work subtotal.
        "observed_accepted_subtotal_ms": observed_subtotal, "observed_non_setup_work_ms": observed_subtotal,
        # accepted_total_ms is retained for report compatibility. It is the
        # active-work sum, not dispatch-to-review wall time.
        "accepted_total_ms": accepted_total, "accepted_active_work_ms": accepted_total, "accepted_timing_basis": "active_work_sum",
        "accepted_timing_status": timing_status, "accepted_status": "accepted" if accepted is True else "rejected" if accepted is False else "unknown",
        "accepted_reason": acceptance_reason, "accepted_missing_components": missing, "candidate_versions": candidate_count, "complete_candidate_versions": complete_count,
        "reviewed_at_utc": reviewed_at_utc, "dispatch_to_independent_review_wall_ms": dispatch_to_review_wall_ms,
        "dispatch_to_accepted_wall_ms": dispatch_to_review_wall_ms if accepted is True else None,
        "repair_edits": number(quality.get("repair_edits")), "command_count": number(summary.get("command_interval_count")), "tool_union_ms": number(summary.get("command_union_ms")),
        "tool_accumulated_ms": number(summary.get("command_accumulated_ms")), "tool_overlap_ms": number(summary.get("command_overlap_ms")), "model_rounds": None,
        "same_file_reads": quality.get("same_file_reads"), "same_range_reads": quality.get("same_range_reads"), "git_calls": quality.get("git_calls"), "browser_ms": quality.get("browser_ms"),
        "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"), "cached_input_tokens": usage.get("cached_input_tokens"), "reasoning_output_tokens": usage.get("reasoning_output_tokens"), "cost": None,
        "native_receipt_stages": receipt_stages(run_dir), "native_receipt_timings_separate": True, "observer_start_utc": summary.get("observer_start_utc"), "process_started_observed_utc": summary.get("process_started_observed_utc"), "process_exit_observed_utc": summary.get("process_exit_observed_utc"),
    }


def group_report(rows: list[dict[str, Any]], case: Mapping[str, Any], variant: str) -> dict[str, Any]:
    group = [row for row in rows if row["case_id"] == case.get("id") and row["variant"] == variant]
    process_completed = [row["process_completed_ms"] for row in group if row["process_completed"]]
    accepted_author = [row["accepted_author_execution_ms"] for row in group if row["accepted_author_execution_ms"] is not None]
    accepted = [row["accepted_total_ms"] for row in group if row["accepted_total_ms"] is not None]
    reviewed_wall = [row.get("dispatch_to_independent_review_wall_ms") for row in group if row.get("dispatch_to_independent_review_wall_ms") is not None]
    accepted_wall = [row.get("dispatch_to_accepted_wall_ms") for row in group if row.get("dispatch_to_accepted_wall_ms") is not None]
    repairs = [row["repair_edits"] for row in group if number(row["repair_edits"]) is not None]
    process_stats = stats(process_completed)
    accepted_author_stats = stats(accepted_author)
    accepted_stats = stats(accepted)
    reviewed_wall_stats = stats(reviewed_wall)
    accepted_wall_stats = stats(accepted_wall)
    return {
        "case_id": case.get("id"), "cohort": case.get("cohort"), "variant": variant, "registered_attempts": len(group),
        "observed_attempts": sum(row["registered_status"] == "observed" for row in group), "pending_attempts": sum(row["registered_status"] == "pending" for row in group),
        "all_samples": stats(row["process_execution_ms"] for row in group), "process_completed": process_stats, "accepted_author": accepted_author_stats,
        "accepted_active_work": accepted_stats, "accepted": accepted_stats, "dispatch_to_independent_review_wall": reviewed_wall_stats, "accepted_dispatch_wall": accepted_wall_stats,
        "process_completed_median_ms": process_stats["median_ms"], "process_completed_range_ms": process_stats["range_ms"],
        "accepted_author_median_ms": accepted_author_stats["median_ms"], "accepted_author_range_ms": accepted_author_stats["range_ms"],
        "accepted_active_work_median_ms": accepted_stats["median_ms"], "accepted_active_work_range_ms": accepted_stats["range_ms"],
        "accepted_dispatch_wall_median_ms": accepted_wall_stats["median_ms"], "accepted_dispatch_wall_range_ms": accepted_wall_stats["range_ms"],
        "first_pass": sum(row["first_quality_status"] == "passed" for row in group),
        "first_fail": sum(row["first_quality_status"] == "failed" for row in group),
        "first_unknown": sum(row["first_quality_status"] not in {"passed", "failed"} for row in group),
        "final_pass": sum(row["quality_status"] == "passed" for row in group),
        "final_fail": sum(row["quality_status"] == "failed" for row in group),
        "final_unknown": sum(row["quality_status"] not in {"passed", "failed"} for row in group),
        "final_not_accepted": sum(row["quality_status"] != "passed" for row in group),
        "timeouts": sum(row["execution_status"] == "timeout" for row in group), "repair_edits": count_stats(repairs),
        "diagnostic_first_snapshot_ms": stats(row["diagnostic_first_snapshot_ms"] for row in group), "reviewer_idle_queue_ms": stats(row["reviewer_idle_queue_ms"] for row in group),
        "accepted_timing_incomplete": sum(row["accepted_timing_status"].startswith("incomplete_") for row in group),
    }


def equal_task_comparisons(groups: list[dict[str, Any]], tasks: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for case in tasks:
        by = {group["variant"]: group for group in groups if group["case_id"] == case.get("id")}
        for baseline in ("A", "B"):
            candidate_group = by.get("C", {}); baseline_group = by.get(baseline, {})
            candidate = candidate_group.get("accepted_active_work", {}).get("median_ms"); base = baseline_group.get("accepted_active_work", {}).get("median_ms")
            candidate_wall = candidate_group.get("accepted_dispatch_wall", {}).get("median_ms"); base_wall = baseline_group.get("accepted_dispatch_wall", {}).get("median_ms")
            output.append({"case_id": case.get("id"), "cohort": case.get("cohort"), "comparison": f"C/{baseline}", "weight": 1, "weighting": "equal_task",
                "candidate_accepted_median_ms": candidate, "baseline_accepted_median_ms": base,
                "candidate_accepted_active_work_median_ms": candidate, "baseline_accepted_active_work_median_ms": base,
                "candidate_dispatch_to_accepted_wall_median_ms": candidate_wall, "baseline_dispatch_to_accepted_wall_median_ms": base_wall,
                "accepted_only_difference_ms": candidate - base if candidate is not None and base is not None else None,
                "accepted_only_change_percent": 100 * (candidate / base - 1) if candidate is not None and base not in (None, 0) else None,
                "limitation": "Equal-task accepted timing is conditional on explicit final machine and independent-review evidence; pending or incomplete samples remain visible."})
    return output


def write_timeline(output: pathlib.Path, timeline: list[dict[str, Any]]) -> None:
    payload = json.dumps(timeline, ensure_ascii=False).replace("<", "\\u003c")
    page = '''<!doctype html><meta charset="utf-8"><title>Archify authoring timeline</title>
<style>
body{font:15px system-ui;margin:30px;max-width:1400px;background:#f7f8fa;color:#16202a}
select{padding:8px;width:70%}
pre{white-space:pre-wrap;background:white;padding:16px}
#brief,#chart,#detail{background:white;padding:16px}
#brief{margin:12px 0;font-weight:600}
.row{display:grid;grid-template-columns:190px 1fr;gap:12px;margin:8px 0}
.rail{position:relative;height:24px;background:#edf0f4}
.bar{position:absolute;height:22px;background:#287dc0;min-width:2px;border-radius:3px;border:0}
.marker{position:absolute;top:-4px;height:32px;border-left:2px solid #c23b57;z-index:2}
.marker-label{position:absolute;top:-22px;left:4px;color:#c23b57;white-space:nowrap;font-size:12px}
small{color:#536170}
</style>
<h1>Authoring event timeline</h1>
<p>Observed command intervals and native receipt timings are separate. Blank space is unclassified waiting or host overhead; no internal function phase is inferred. Overlapping bars remain visible.</p>
<select id="pick"></select>
<div id="brief"></div>
<div id="chart"></div>
<pre id="detail">Select a bar for its observed command.</pre>
<details open><summary>Full run summary</summary><pre id="summary"></pre></details>
<script>
const runs = __PAYLOAD__;
const pick = document.querySelector('#pick');
const brief = document.querySelector('#brief');
const chart = document.querySelector('#chart');
const summary = document.querySelector('#summary');
const detail = document.querySelector('#detail');

for (const [index, item] of runs.entries()) {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = `${item.run.run_id} · ${item.run.registered_status} · ${item.run.quality_status}`;
  pick.append(option);
}

function dateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function spanRecords(item) {
  return item.spans
    .map((span) => ({
      source: span,
      start: dateMs(span.start),
      end: dateMs(span.end),
    }))
    .filter((span) => span.start !== null && span.end !== null && span.end >= span.start);
}

function appendAxisMarker(axisRail, markerTime, axisStart, total) {
  if (markerTime === null) return;
  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.style.left = `${Math.max(0, Math.min(100, 100 * (markerTime - axisStart) / total))}%`;
  const label = document.createElement('span');
  label.className = 'marker-label';
  label.textContent = 'first complete candidate';
  marker.append(label);
  axisRail.append(marker);
}

function draw() {
  const item = runs[Number(pick.value)];
  if (!item) return;
  const run = item.run;
  const spans = spanRecords(item);
  const spanTimes = spans.flatMap((span) => [span.start, span.end]);
  const fallbackStart = spanTimes.length ? Math.min(...spanTimes) : null;
  const fallbackEnd = spanTimes.length ? Math.max(...spanTimes) : null;
  const processStart = dateMs(run.process_started_observed_utc) ?? fallbackStart;
  const processEnd = dateMs(run.process_exit_observed_utc) ?? fallbackEnd;
  const validAxis = processStart !== null && processEnd !== null && processEnd >= processStart;
  const axisStart = validAxis ? processStart : fallbackStart;
  const axisEnd = validAxis ? processEnd : fallbackEnd;
  const total = axisStart !== null && axisEnd !== null ? Math.max(1, axisEnd - axisStart) : 1;
  const firstComplete = typeof run.first_complete_ms === 'number' && Number.isFinite(run.first_complete_ms) && axisStart !== null
    ? axisStart + run.first_complete_ms
    : null;

  const authorMs = run.process_execution_ms ?? 'unknown';
  const firstMs = run.first_complete_ms ?? 'unknown';
  const accepted = run.accepted_status ?? 'unknown';
  brief.textContent = `Author process: ${authorMs} ms · First complete candidate: ${firstMs} ms · Acceptance: ${accepted}`;
  summary.textContent = JSON.stringify(run, null, 2);
  detail.textContent = 'Select a bar for its observed command.';
  chart.replaceChildren();

  if (axisStart === null || axisEnd === null) {
    chart.textContent = 'No usable author or observed span timestamps for this attempt.';
    return;
  }

  const axisRow = document.createElement('div');
  axisRow.className = 'row';
  const axisLabel = document.createElement('small');
  axisLabel.textContent = 'author process window';
  const axisRail = document.createElement('div');
  axisRail.className = 'rail';
  appendAxisMarker(axisRail, firstComplete, axisStart, total);
  axisRow.append(axisLabel, axisRail);
  chart.append(axisRow);

  if (!spans.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No observed completed spans for this attempt.';
    chart.append(empty);
    return;
  }

  for (const span of spans) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('small');
    label.textContent = `${span.source.annotated_phase || span.source.phase || 'unknown'} · ${span.source.duration_ms ?? '?'} ms`;
    const rail = document.createElement('div');
    rail.className = 'rail';
    const bar = document.createElement('button');
    bar.className = 'bar';
    const left = Math.max(0, Math.min(100, 100 * (span.start - axisStart) / total));
    const right = Math.max(left, Math.min(100, 100 * (span.end - axisStart) / total));
    bar.style.left = `${left}%`;
    bar.style.width = `${Math.max(0.2, right - left)}%`;
    bar.title = span.source.command || span.source.event || '';
    bar.onclick = () => { detail.textContent = JSON.stringify(span.source, null, 2); };
    rail.append(bar);
    row.append(label, rail);
    chart.append(row);
  }
}

pick.onchange = draw;
draw();
</script>'''.replace("__PAYLOAD__", payload)
    (output / "timeline.html").write_text(page, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--manifest", type=pathlib.Path, required=True); parser.add_argument("--evidence", type=pathlib.Path, required=True); parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args(argv); manifest = read(args.manifest, {}); args.output.mkdir(parents=True, exist_ok=True)
    tasks = manifest.get("tasks", []) if isinstance(manifest, Mapping) else []; task_by_id = {task.get("id"): task for task in tasks if isinstance(task, Mapping)}
    rows = []; timeline = []
    for spec in manifest.get("runs", []):
        if not isinstance(spec, Mapping): continue
        folder = args.evidence / str(spec.get("run_id")); row = make_row(spec, task_by_id.get(spec.get("case_id"), {}), folder); rows.append(row); spans = []
        path = folder / "annotated-spans.jsonl"
        if not path.exists():
            path = folder / "spans.jsonl"
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                try: value = json.loads(line)
                except json.JSONDecodeError: continue
                if isinstance(value, Mapping): spans.append(dict(value))
        timeline.append({"run": row, "spans": spans, "start": row.get("observer_start_utc")})
    (args.output / "runs.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if rows:
        with (args.output / "runs.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    groups = [group_report(rows, case, variant) for case in tasks for variant in ("A", "B", "C")]
    comparisons = equal_task_comparisons(groups, tasks)
    stage_summary = {"groups": groups, "comparisons": comparisons, "equal_task_comparisons": comparisons, "registered_attempts": len(manifest.get("runs", [])), "observed_attempts": sum(row["registered_status"] == "observed" for row in rows), "pending_attempts": sum(row["registered_status"] == "pending" for row in rows), "weights": "equal per task; no pooled difficulty-weighted latency", "model_rounds": None, "unavailable_metrics": ["model_rounds", "pure_model_reasoning_time", "read_ranges_without_explicit_event", "same_file_reads", "same_range_reads", "git_calls", "browser_ms", "cost"], "accepted_timing_rule": "accepted_total_ms is the compatibility alias for active-work sum: setup + author execution + final machine verification + independent review; null when any component or explicit acceptance evidence is missing", "accepted_wall_clock_rule": "dispatch_to_accepted_wall_ms is process_started_observed_utc to independent review reviewed_at_utc, includes review queue/wait, and remains null unless acceptance is explicit; it is not added to active-work cost", "native_receipt_rule": "native CLI receipt stage timings are reported separately and never added to observer wall or command union"}
    (args.output / "stage-summary.json").write_text(json.dumps(stage_summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"); write_timeline(args.output, timeline)
    print(json.dumps({"attempts": len(rows), "registered_attempts": len(manifest.get("runs", [])), "pending_attempts": stage_summary["pending_attempts"], "output": str(args.output)})); return 0


if __name__ == "__main__":
    raise SystemExit(main())
