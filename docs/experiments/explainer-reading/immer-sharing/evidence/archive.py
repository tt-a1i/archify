from pathlib import Path
import shutil
r=Path('/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48');d=Path('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/immer-sharing');e=d/'evidence';e.mkdir(exist_ok=True)
for p in r.iterdir():
 if p.is_file() and p.suffix in ['.md','.mjs','.cjs','.json','.txt','.py','.log','.ts']:shutil.copyfile(p,e/p.name)
for name in ['candidate-1.html','candidate-2-before-label.html']:shutil.copyfile(r/name,e/name)
for name in ['screenshots','exports','exports-before-label']:shutil.copytree(r/name,e/name,dirs_exist_ok=True)
print('Archived evidence files:',sum(p.is_file() for p in e.rglob('*')))
