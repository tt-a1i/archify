"""Compare six replay directories without relabeling their finite denominators."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--work', type=Path, required=True)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--package', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
for key in ['work', 'source', 'package', 'out']:
    setattr(a, key, getattr(a, key).resolve())
a.out.parent.mkdir(parents=True, exist_ok=True)

def normalize(value, run, install):
    if isinstance(value, dict):
        return {k: normalize(v, run, install) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v, run, install) for v in value]
    return value.replace(str(run), '<RUN>').replace(str(install), '<INSTALL>') if isinstance(value, str) else value

records = []
for language in ['go', 'rust', 'java', 'js', 'ts', 'python']:
    source = a.work / f'combined-{language}-source'
    archive = a.work / f'combined-{language}-zip'
    facts, questions = [], []
    for raw in source.glob('**/raw-facts.json'):
        rel = raw.relative_to(source)
        assert raw.read_bytes() == (archive / rel).read_bytes(), (language, str(rel))
        facts.append(str(rel))
    assert facts, language
    for question in source.glob('*.json'):
        if 'question' not in question.name and 'paired' not in question.name and question.name != 'follow-up.json':
            continue
        left = normalize(json.loads(question.read_text()), source, a.source)
        right = normalize(json.loads((archive / question.name).read_text()), archive, a.package)
        assert left == right, (language, question.name)
        questions.append(question.name)
    assert questions, language
    filename = 'result.json' if language == 'python' else 'report.json'
    report = json.loads((source / filename).read_text())
    records.append({'language': language, 'rawFactsByteIdentical': facts, 'questionsEqualAfterInstallOutputPathsOnly': questions, 'score': report.get('score', report.get('counts'))})
files = subprocess.check_output(['git', 'ls-files', 'archify/modules/code-analysis'], cwd=a.source, text=True).splitlines()
for file in files:
    assert (a.source / file).read_bytes() == (a.package / file).read_bytes(), file
heads = {'ts1261': 'cbc557b7b616dfc1dde2a6b2a7e04af32c9b5d54', 'js1260': '80875e5e75d3a9e1a91a50a51a56a0315550a19f', 'java1259': 'ddfd5683095ba6d86de784446ea4cb1a3c37610b', 'rust1258': '9e41b7483f26ecb1c57f0172b1d96d4e457b217e', 'go1256': '561957dd275f6d33991865c4c6db36b1c4b87dab', 'python1252': '93378351dc97768fd7e0882a50f32ecc7a34e2a6', 'ci1242': 'ced8cc446ee463b92d0c65ca1aff6b1ecb7ffb99'}
for head in heads.values():
    subprocess.run(['git', 'merge-base', '--is-ancestor', head, 'HEAD'], cwd=a.source, check=True)
zipfile = a.work / 'combined-package-one.zip'
assert zipfile.read_bytes() == (a.work / 'combined-package-two.zip').read_bytes()
receipt = {'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=a.source, text=True).strip(), 'ancestorsPreserved': heads, 'languages': records, 'trackedModuleFilesEqual': len(files), 'zipSha256': hashlib.sha256(zipfile.read_bytes()).hexdigest(), 'twoCanonicalBuildsByteIdentical': True, 'buildNode': '22.23.3', 'zlib': '1.3.1-e00f703', 'runtimeNode': '26.12.0', 'platform': 'darwin-arm64', 'limitations': ['Local composition only, no formal PR merge/approval/release/live install.', 'JS and Rust real pairs preserve partial status and nonzero exits.', 'Overlapping reused evidence is not independent all-language accuracy.']}
a.out.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'factsCompared': sum(len(r['rawFactsByteIdentical']) for r in records), 'questionsCompared': sum(len(r['questionsEqualAfterInstallOutputPathsOnly']) for r in records), 'moduleFiles': len(files), 'ancestors': len(heads), 'zipSha256': receipt['zipSha256']}))
