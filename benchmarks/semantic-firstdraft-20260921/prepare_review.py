"""Copy exact candidates and capture images into condition-blinded review cases."""
import argparse
import hashlib
import json
import pathlib
import random
import shutil


def read(path):
    return json.loads(path.read_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True, type=pathlib.Path)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    parser.add_argument('--review-name', default='initial-quality')
    parser.add_argument('runs', nargs='+')
    args = parser.parse_args()
    review = args.scratch / args.review_name
    review.mkdir(exist_ok=False)
    tasks = {x['id']: x for x in read(args.out / 'freeze.json')['tasks']['tasks']}
    runs = args.runs[:]
    random.Random(921).shuffle(runs)
    key = {f'case-{i + 1:02}': run for i, run in enumerate(runs)}
    (args.out / f'{args.review_name}-key.json').write_text(json.dumps(key, indent=2) + '\n')
    cases = []
    for case_id, run in key.items():
        observed = args.out / run
        workspace = args.scratch / 'runs' / run
        evaluation = read(observed / 'evaluation.json')
        task_id = run.rsplit('-', 1)[0]
        task = tasks[task_id]
        dest = review / case_id
        dest.mkdir()
        case = {'id': case_id, 'source_root': str(args.scratch / 'repos' / task_id),
                'source_revision': task['revision'], 'request': task['prompt'],
                'required': task['required'], 'stages': []}
        for stage in ['first', 'final']:
            row = {'stage': stage, 'available': False, 'images': []}
            snapshots = evaluation['snapshots']
            source = ((observed / f"snapshot-{snapshots[0]['index']:03}.json") if snapshots else None) if stage == 'first' else workspace / 'output/diagram.architecture.json'
            if source is not None and source.exists():
                target = dest / f'{stage}.json'
                shutil.copy2(source, target)
                digest = hashlib.sha256(target.read_bytes()).hexdigest()
                matched = next((item for item in snapshots if item['sha256'] == digest), {})
                row.update({'available': True, 'path': str(target), 'sha256': digest,
                            'production_validate_exit': matched.get('validation_exit'),
                            'production_diagnostic_codes': matched.get('diagnostic_codes')})
                if stage == 'final':
                    row['author_complete_machine_pass'] = evaluation['final'].get('eligible_delivery', False)
                    row['protocol_eligible'] = evaluation.get('protocol', {}).get('eligible', False)
                visual = observed / ('visual' if stage == 'final' or evaluation['first_visual'].get('reused_final') else 'first-visual')
                if visual.exists():
                    for image in sorted(visual.glob('*.png')):
                        suffix = image.name[image.name.index('.visual-check'):] if '.visual-check' in image.name else '-' + image.name
                        target_image = dest / (stage + suffix)
                        shutil.copy2(image, target_image)
                        row['images'].append(str(target_image))
            case['stages'].append(row)
        cases.append(case)
    policy = '''Condition labels, timings, tool choices, author narrative and mechanism are withheld. Independently inspect exact first/final JSON, source and images. Use ONLY the visible required clauses; no hidden behavior or count requirements. Extra authored claims must still be true. Verify reference entailment, not just existing files/valid line numbers. Inspect contact sheets first; use 1440x900 individual images if needed for readability. Normal Reader vertical document scrolling is allowed; missing captures mean visual unavailable, not pass. Machine validation is separate from semantic and perceptual acceptance. Return every case and each stage separately with required-clause results (number, pass/fail, source location and concise reason), material extra contradictions if any, visual status/reason, and final overall quality pass only when source semantics, material entailment and available final readability are all acceptable. Do not infer performance or seek the condition key. Do not alter candidates or source.'''
    (review / 'cases.json').write_text(json.dumps({'policy': policy, 'cases': cases}, indent=2) + '\n')
    print(str(review / 'cases.json'))
