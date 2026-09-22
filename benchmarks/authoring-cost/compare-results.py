#!/usr/bin/env python3
"""Descriptive per-task results; no pooled difficulty weights or inference."""
import argparse
import collections
import json
import pathlib
import statistics

METRICS = ['process_execution_ms', 'first_complete_ms', 'post_json_ms', 'accepted_active_work_ms', 'dispatch_to_accepted_wall_ms', 'independent_review_ms', 'final_machine_verification_ms', 'tool_union_ms', 'command_count', 'repair_edits', 'input_tokens', 'output_tokens', 'cached_input_tokens']


def stats(values):
    values = [x for x in values if isinstance(x, (int, float)) and not isinstance(x, bool)]
    return {'n': len(values), 'median': statistics.median(values) if values else None, 'range': [min(values), max(values)] if values else None}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--report', type=pathlib.Path, required=True)
    p.add_argument('--evidence', type=pathlib.Path, required=True)
    a = p.parse_args()
    rows = json.loads((a.report / 'runs.json').read_text())
    groups = []
    for cohort, case in sorted({(r['cohort'], r['case_id']) for r in rows}):
        for variant in 'ABC':
            selected = [r for r in rows if r['cohort'] == cohort and r['case_id'] == case and r['variant'] == variant]
            groups.append({'cohort': cohort, 'case_id': case, 'variant': variant, 'registered': len(selected), 'quality': dict(collections.Counter(r['quality_status'] for r in selected)), 'first_quality': dict(collections.Counter(r['first_quality_status'] for r in selected)), 'metrics': {metric: stats(r.get(metric) for r in selected) for metric in METRICS}})
    comparisons = []
    for cohort in sorted({r['cohort'] for r in rows}):
        cases = sorted({r['case_id'] for r in rows if r['cohort'] == cohort})
        for baseline in 'AB':
            for metric in ['process_execution_ms', 'first_complete_ms', 'post_json_ms', 'accepted_active_work_ms', 'dispatch_to_accepted_wall_ms']:
                pairs = []
                for case in cases:
                    b = next(g for g in groups if g['cohort'] == cohort and g['case_id'] == case and g['variant'] == baseline)
                    c = next(g for g in groups if g['cohort'] == cohort and g['case_id'] == case and g['variant'] == 'C')
                    bm, cm = b['metrics'][metric], c['metrics'][metric]
                    complete = bm['n'] == b['registered'] and cm['n'] == c['registered'] and bm['median'] is not None and cm['median'] is not None
                    pairs.append({'case_id': case, 'baseline': bm, 'candidate': cm, 'complete': complete, 'difference_ms': cm['median'] - bm['median'] if complete else None, 'change_percent': 100 * (cm['median'] / bm['median'] - 1) if complete and bm['median'] else None})
                usable = [x for x in pairs if x['change_percent'] is not None]
                comparisons.append({'cohort': cohort, 'comparison': 'C/' + baseline, 'metric': metric, 'pairs': pairs, 'all_tasks_complete': len(usable) == len(cases), 'equal_task_mean_change_percent': statistics.mean(x['change_percent'] for x in usable) if len(usable) == len(cases) else None, 'equal_task_mean_difference_ms': statistics.mean(x['difference_ms'] for x in usable) if len(usable) == len(cases) else None})
    diagnostics = []
    for r in rows:
        path = a.evidence / r['run_id'] / 'machine-review/common-first-validate.stdout.txt'
        if not path.exists():
            continue
        try:
            d = json.loads(path.read_text())
        except ValueError:
            continue
        diagnostics.append({'run_id': r['run_id'], 'variant': r['variant'], 'cohort': r['cohort'], 'common_first_validation_ok': d.get('ok'), 'codes': sorted({x['code'] for x in d.get('diagnostics', []) if 'code' in x}), 'legacy_A_geometry_is_diagnostic_only': r['variant'] == 'A'})
    result = {'formula': 'For each case, median(C)/median(baseline)-1; arithmetic mean of the three case-relative changes. Only complete case matrices enter equal-weight totals. Negative means lower measured duration.', 'limits': ['Descriptive small samples, no significance/P95/noninferiority claim', 'Process execution includes rejected outputs and is not qualified delivery latency', 'Active work includes review work but excludes queue gaps and separately disclosed shared work', 'Dispatch-to-acceptance wall includes review scheduling and cold preparation confounds', 'Development environment-affected pairs are retained, not used for causal latency attribution'], 'groups': groups, 'comparisons': comparisons, 'first_diagnostics': diagnostics}
    (a.report / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'groups': len(groups), 'comparisons': len(comparisons), 'output': str(a.report / 'analysis.json')}))


if __name__ == '__main__':
    main()
