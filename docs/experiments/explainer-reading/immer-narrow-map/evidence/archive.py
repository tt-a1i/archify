from pathlib import Path
import shutil,json,hashlib
r=Path('/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round49');d=Path('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/immer-narrow-map');e=d/'evidence';e.mkdir(exist_ok=True)
for p in r.iterdir():
 if p.is_file() and (p.suffix in ['.md','.mjs','.cjs','.json','.txt','.py','.stdout','.stderr','.exit'] or p.name in ['base.html','candidate-1.html','candidate-2.html','candidate-1-native.html']):shutil.copy2(p,e/p.name)
for n in ['screenshots','exports','native-1']:shutil.copytree(r/n,e/n,dirs_exist_ok=True)
html=[str(p.relative_to(d.parent.parent.parent.parent)) for p in d.rglob('*.html')]
(e/'archive-formatting.json').write_text(json.dumps({'generatedHtmlWhitespacePreserved':html,'rawLogsNormalized':False},indent=2)+'\n')
manifest={str(p.relative_to(d)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(d.rglob('*')) if p.is_file() and p!=e/'manifest.json'};(e/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print({'files':len(manifest),'html':len(html)})
