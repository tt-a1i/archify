"""Summarize observed author history; qualify savings only with independent quality."""
import argparse
import json
import pathlib
import statistics


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def summarize(out):
    frozen = read(out / 'freeze.json')
    quality = read(out / 'quality-adjudication.json', {}).get('runs', {})
    rows = []
    for name in frozen['initial_order']:
        directory = out / name
        trace = read(directory / 'native-trace.json', {})
        observer = read(directory / 'receipt.json', {})
        evaluation = read(directory / 'evaluation.json', {})
        receipts = []
        initializing = 0
        for entry in observer.get('sidecars', []):
            if entry['filename'] != 'diagram.finalize-summary.json':
                continue
            try:
                value = read(directory / entry['snapshot'])
                # finalize first writes a not-run summary, then a terminal one.
                # Only the terminal summary has elapsed duration; initialization
                # is not a failed finalize or an extra model repair attempt.
                if not isinstance(value.get('durationMs'), (int, float)):
                    initializing += 1
                    continue
                receipts.append({'epoch': entry['epoch'], 'ok': value.get('ok'),
                                 'sha256': value.get('specification', {}).get('sha256'),
                                 'duration_ms': value.get('durationMs'),
                                 'gates': value.get('gates')})
            except (ValueError, AttributeError):
                receipts.append({'epoch': entry['epoch'], 'parse_error': True})
        usable = receipts and all(r.get('sha256') and 'ok' in r for r in receipts)
        repairs = None
        if usable:
            repairs = 0
            failed = False
            previous = None
            for r in receipts:
                if failed and r['sha256'] != previous:
                    repairs += 1
                failed = failed or not r['ok']
                previous = r['sha256']
        q = quality.get(name, {})
        versions = []
        before_finalize = []
        for snapshot in observer.get('snapshots', []):
            if not snapshot.get('structurally_complete'):
                continue
            value = read(directory / f"snapshot-{snapshot['index']:03}.json")
            canonical = json.dumps(value, sort_keys=True, separators=(',', ':'))
            if not versions or versions[-1] != canonical:
                versions.append(canonical)
                epoch = observer['start_epoch'] + snapshot['elapsed_seconds']
                if receipts and epoch < receipts[0]['epoch']:
                    before_finalize.append(canonical)
        machine = evaluation.get('final', {}).get('eligible_delivery', False)
        qualified = machine and q.get('final_pass') is True
        rows.append({'run': name, 'condition': name.rsplit('-', 1)[1],
                     'native_seconds': trace.get('native_task_seconds'),
                     'full_seconds': trace.get('full_task_seconds'),
                     'setup_and_dispatch_seconds': trace.get('full_task_seconds', 0) - trace.get('native_task_seconds', 0) if trace.get('native_task_seconds') is not None else None,
                     'after_first_structural_seconds': trace['native_task_seconds'] - trace['first_complete_from_native_start_seconds'] if trace.get('native_task_seconds') is not None and trace.get('first_complete_from_native_start_seconds') is not None else None,
                     'first_structural_seconds': trace.get('first_complete_from_native_start_seconds'),
                     'candidate_versions_observed': len(observer.get('snapshots', [])),
                     'candidate_content_changes_observed': max(0, len(versions)-1) if versions else None,
                     'candidate_content_changes_before_first_finalize': max(0, len(before_finalize)-1) if receipts else None,
                     'first_finalize_pass': receipts[0].get('ok') if receipts else None,
                     'finalize_receipts': receipts,
                     'nonterminal_finalize_updates': initializing,
                     'observed_finalized_repairs_after_failure': repairs,
                     'observer_expired': observer.get('expired'),
                     'observer_max_gap_seconds': observer.get('max_poll_gap_seconds'),
                     'protocol_eligible': evaluation.get('protocol', {}).get('eligible'),
                     'machine_delivery': machine, 'first_quality': q.get('first_pass'),
                     'final_quality': q.get('final_pass'), 'qualified_delivery': qualified})
    pairs = []
    for task in frozen['tasks']['tasks']:
        baseline = next(r for r in rows if r['run'] == task['id'] + '-B1')
        candidate = next(r for r in rows if r['run'] == task['id'] + '-P1')
        both = baseline['qualified_delivery'] and candidate['qualified_delivery']
        item = {'task': task['id'], 'both_quality_qualified': both}
        if both:
            b, p = baseline['full_seconds'], candidate['full_seconds']
            item.update(seconds_saved=b-p, fraction_saved=(b-p)/b)
            br, pr = baseline['observed_finalized_repairs_after_failure'], candidate['observed_finalized_repairs_after_failure']
            item['repair_reduction'] = br-pr if br is not None and pr is not None else None
        pairs.append(item)
    valid = [p for p in pairs if p['both_quality_qualified']]
    med = lambda key: statistics.median(p[key] for p in valid) if valid and all(p.get(key) is not None for p in valid) else None
    med_seconds, med_fraction, med_repairs = (med(k) for k in ['seconds_saved', 'fraction_saved', 'repair_reduction'])
    all_p = all(r['qualified_delivery'] for r in rows if r['condition'] == 'P1')
    gate = frozen['protocol']['success_screen']
    passed = bool(all_p and len(valid) >= gate['minimum_both_quality_pairs']
                  and med_seconds is not None and med_seconds >= gate['median_full_time_seconds_saved']
                  and med_fraction >= gate['median_full_time_fraction_saved']
                  and med_repairs is not None and med_repairs >= gate['median_model_repair_reduction']
                  and all(p['fraction_saved'] >= -gate['maximum_qualified_pair_slowdown_fraction'] for p in valid))
    return {'rows': rows, 'pairs': pairs, 'all_P_quality_pass': all_p,
            'qualified_pairs': len(valid), 'median_seconds_saved': med_seconds,
            'median_fraction_saved': med_fraction, 'median_observed_repair_reduction': med_repairs,
            'screen_pass': passed, 'promotion_qualified': False,
            'limits': 'Repair counts are observed finalized candidate revisions after a failed finalize, not unobserved model intentions. Content changes before first finalize are reported separately and must not be hidden by a zero finalized-repair count. A content change is not necessarily one model turn. Missing quality is unknown. A passing screen still requires the frozen confirmation pairs.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    args = parser.parse_args()
    result = summarize(args.out)
    (args.out / 'summary-metrics.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('rows', 'pairs')}))
