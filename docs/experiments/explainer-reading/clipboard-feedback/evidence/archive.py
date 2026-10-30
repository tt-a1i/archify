from pathlib import Path
import shutil,json,hashlib
r=Path('/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round47');d=Path('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/clipboard-feedback');e=d/'evidence';e.mkdir(exist_ok=True)
files=['plan.md','probe-failures.md','candidate-2-decision.md','source-review.md','source-commit.txt','open-pr-search.json','base-regression.log','base-regression.exit','candidate-regression.log','candidate-regression.exit','candidate-2-focused.log','candidate-2-core.log','candidate-2-generated.log','candidate-1.patch','candidate-2.patch','base-data-url-observation.json','base-injected-observation.json','sandbox-base-v2-observation.json','clipboard-browser.json','clipboard-browser-2.json','browser-matrix.json','browser-matrix-2.json','full-replay-2.json','full-replay-2.mjs','copy-verification.json','candidate-2-copied.py','candidate-2-copy-stdout.txt','export-inspection.json','toolchain.json','package-identity.json','package-finalize.json','package-check.json','build-1.log','build-2.log','polars-finalize.json','polars-check.json','taskgroup-finalize.json','taskgroup-check.json']
files += [p.name for p in r.glob('browser-*.mjs')] + ['create-sandbox.mjs','create-sandbox-v2.mjs','archive.py']
if (r/'canonical-browser.json').exists():files+=['canonical-browser.json']
for n in files:shutil.copyfile(r/n,e/n)
for folder in ['screenshots-2','exports-2']:shutil.copytree(r/folder,e/folder,dirs_exist_ok=True)
for n in ['polars-question-failure.png','taskgroup-question-failure.png']:
 dest=e/'candidate-1';dest.mkdir(exist_ok=True);shutil.copyfile(r/'screenshots'/n,dest/n)
for arm in ['base','candidate']:
 dest=e/'replay'/arm;dest.mkdir(parents=True,exist_ok=True)
 for n in ['polars-0.html','taskgroup-0.html']:shutil.copyfile(r/'full-replay-2'/arm/n,dest/n)
print('Archived',len(list(e.rglob('*'))),'entries')
