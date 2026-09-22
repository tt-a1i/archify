import pathlib,json,subprocess,hashlib,time,sys
W=pathlib.Path('/Users/tushaokun/.codex/worktrees/archify-firstdraft-study-20260921/archify');T=pathlib.Path('/private/tmp/archify-semantic-repair-20260921');O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921')
run,snapshot,case,stage=sys.argv[1:];snapshot=int(snapshot)
assert (T/'quality-review/result.json').exists(),'independent semantic review must finish before selecting a candidate'
assert not (O/'repair-pair.json').exists(),'do not overwrite a frozen repair comparison'
task=next(x for x in json.loads((O/'tasks.json').read_text())['tasks'] if x['repo']==run.split('-')[0]);source=T/task['repo'];candidate=O/run/f'snapshot-{snapshot:03}.json';raw=candidate.read_bytes();digest=hashlib.sha256(raw).hexdigest();rows=[]
common='''You are a fresh timed architecture repair author. You are not alone in the shared filesystem; own only output/ in this workspace. Read TASK.md and supplied archify/SKILL.md. No sibling runs, other workspaces, evaluator records, network, package install, target execution, subagents or user questions. The supplied input/candidate.json is frozen source-backed work; preserve it and the source/ checkout unchanged. This is a geometry repair task, not new authoring.

Use /opt/homebrew/opt/node@22/bin/node. First run the full supplied finalize on input/candidate.json to output/diagram.html with --repo-root SOURCE_ROOT --quality showcase --json, saving stdout to output/finalize.json. Keep the candidate bytes unchanged during every gate. On failure, create/edit output/candidate.json only, preserving every node, relationship, boundary, label, source reference, view, conclusion, ordering and nongeometric value. Change only positions/dimensions or supported route geometry. No removals, renames, abbreviation, semantic redesign, font reductions or source edits. After each repair run full finalize against output/candidate.json with exactly the same source/quality arguments. At most three repair iterations and 600 seconds total, no whole-run retry. Retain all outputs and stop truthfully at the cap. A validation-only or reduced-error result is not delivery. Full validate/deliver/check/browser gates are required. Do not take separate screenshots; independent source-preservation and common-viewport review follows.

'''
for name in json.loads((O/'repair-preplan.json').read_text())['order']:
 root=T/'runs'/name;subprocess.run(['git','clone','--quiet','--no-hardlinks',str(source),str(root/'source')],check=True);subprocess.run(['git','-C',str(root/'source'),'remote','set-url','origin',task['url']],check=True)
 (root/'input/candidate.json').write_bytes(raw);prompt=common.replace('SOURCE_ROOT',str(root/'source'))
 if name.endswith('-R'):
  prompt+='''This condition supplies one offline local route helper. After the initial finalize reports only a supported route-rhythm failure on one connection, invoke it once as the next repair action, using the exact supplied candidate:

/opt/homebrew/opt/node@22/bin/node benchmarks/semantic-repair-20260921/route-repair/route-repair.mjs input/candidate.json --repo-root '''+str(root/'source')+''' --out output/candidate.json > output/route-repair.json

Read its receipt. A repaired result writes the candidate and still requires full finalize. A declined result (exit 2) or unchanged result is not a successful repair; preserve the receipt and use ordinary local manual repair if needed within the remaining budget. This call counts as one repair iteration and is included in your time. Do not alter input to make the tool applicable or override authored pins.
'''
 else:prompt+='Use ordinary supplied Skill diagnostics and manual local geometry edits. No additional route helper or semantic navigation is supplied.\n'
 (root/'TASK.md').write_text(prompt);rows.append({'run':name,'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest(),'input_sha256':digest,'source_revision':task['revision']})
result={'frozen_epoch':time.time(),'selected_from_run':run,'snapshot':snapshot,'input_sha256':digest,'review_case':case,'review_stage':stage,'review_result_sha256':hashlib.sha256((T/'quality-review/result.json').read_bytes()).hexdigest(),'selection_rule':'first independently source-complete eligible first/final candidate in original order; supported codes identify exactly one automatic route, no authored pins','runs':rows,'identity':{'model':'gpt-5.6-terra','effort':'medium'},'note':'A supplied-candidate repair comparison is not a repeated full generation or an end-to-end first-draft win.'}
(O/'repair-pair.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
