"""Prepare condition/timing-blinded source and screenshot cases after all authors."""
import argparse
import hashlib
import json
import pathlib
import random
import shutil


def read(path):
    return json.loads(path.read_text())


def prepare(out, destination):
    frozen = read(out / 'freeze.json')
    order = frozen['initial_order']
    assert all((out / name / 'evaluation.json').exists() for name in order), 'Wait for all six evaluations'
    cases = []
    for name in order:
        records = out / name
        evaluation = read(records / 'evaluation.json')
        source = pathlib.Path(read(records / 'start.json')['workspace']) / 'repo'
        task = next(t for t in frozen['tasks']['tasks'] if t['id'] == name.rsplit('-', 1)[0])
        observer = read(records / 'receipt.json')
        first = next((s for s in observer['snapshots'] if s['structurally_complete']), None)
        final = records / 'artifacts/diagram.architecture.json'
        if first:
            spec = records / f"snapshot-{first['index']:03}.json"
            if final.exists() and hashlib.sha256(final.read_bytes()).hexdigest() == first['sha256']:
                visual = records / 'visual'
                cases.append((name, ['first', 'final'], spec, visual, source, task))
                continue
            visual = records / ('visual' if evaluation.get('first_visual', {}).get('reused_final') else 'first-visual')
            cases.append((name, ['first'], spec, visual, source, task))
        if final.exists():
            cases.append((name, ['final'], final, records / 'visual', source, task))
    random.Random(210921).shuffle(cases)
    destination.mkdir(parents=True, exist_ok=False)
    manifest, mapping = [], []
    for index, (name, phases, spec, visual, source, task) in enumerate(cases, 1):
        ident = f'case-{index:02}'
        case = destination / ident
        case.mkdir()
        shutil.copyfile(spec, case / 'diagram.json')
        shutil.copytree(source, case / 'repo')
        (case / 'task.json').write_text(json.dumps(task, indent=2) + '\n')
        images = []
        for image in sorted(visual.glob('*.png')):
            shutil.copyfile(image, case / image.name)
            images.append(str(case / image.name))
        manifest.append({'id': ident, 'specification': str(case / 'diagram.json'),
                         'task': str(case / 'task.json'), 'source_root': str(case / 'repo'),
                         'source_revision': task['revision'], 'captures': images,
                         'capture_note': 'If captures are absent, assess source semantics only and report perceptual acceptance unknown.'})
        mapping.append({'case': ident, 'run': name, 'phases': phases,
                        'sha256': hashlib.sha256(spec.read_bytes()).hexdigest()})
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (out / 'blind-mapping.json').write_text(json.dumps(mapping, indent=2) + '\n')
    print(json.dumps({'manifest': str(destination / 'manifest.json'), 'cases': len(manifest)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    parser.add_argument('--destination', required=True, type=pathlib.Path)
    args = parser.parse_args()
    prepare(args.out, args.destination)
