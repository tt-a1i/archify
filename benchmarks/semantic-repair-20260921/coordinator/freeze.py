import pathlib,json,hashlib,subprocess,shutil,time
W=pathlib.Path('/Users/tushaokun/.codex/worktrees/archify-firstdraft-study-20260921/archify');T=pathlib.Path('/private/tmp/archify-semantic-repair-20260921');O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
tasks=json.loads((O/'tasks.json').read_text());by={x['repo']:x for x in tasks['tasks']}
assert not (O/'freeze.json').exists(),'frozen comparisons must not be silently rewritten'
subprocess.run(['python3',str(T/'prepare_prompts.py')],check=True)
rows=[]
for run in tasks['order']:
 root=T/'runs'/run;task=by[run.split('-')[0]]
 revision=subprocess.check_output(['git','-C',str(root/'source'),'rev-parse','HEAD'],text=True).strip()
 assert revision==task['revision']
 assert not subprocess.check_output(['git','-C',str(root/'source'),'status','--porcelain'])
 draft=root/'TASK.draft.md';text=draft.read_text();assert 'TO_BE_FILLED' not in text
 (root/'TASK.md').write_text(text)
 assert not list((root/'output').iterdir())
 helpers={str(p.relative_to(root)):sha(p) for parent in [root/'tools',root/'benchmarks'] if parent.exists() for p in parent.rglob('*') if p.is_file()}
 package_manifest={str(p.relative_to(root/'archify')):sha(p) for p in (root/'archify').rglob('*') if p.is_file()}
 rows.append({'run':run,'source_revision':revision,'prompt_sha256':sha(root/'TASK.md'),'helpers':helpers,'package_tree_sha256':hashlib.sha256(json.dumps(package_manifest,sort_keys=True).encode()).hexdigest()})
assert len(set(x['package_tree_sha256'] for x in rows))==1
freeze={'epoch':time.time(),'runs':rows,'tasks_sha256':sha(O/'tasks.json'),'rubric_sha256':sha(O/'rubrics.json'),'package_sha256':sha(W/'archify.zip'),'typescript_lock_sha256':sha(T/'tool-deps/package-lock.json'),'policy':'fresh Terra/medium serial, fixed scopes/quality, no whole-author retries, setup separate; OS cache/provider scheduling uncontrolled','repair_eligibility':'first structurally complete or final candidate, in original run order; independently source-complete and sole supported route diagnostics; no candidate editing to manufacture eligibility'}
(O/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n')
print(json.dumps(freeze))
