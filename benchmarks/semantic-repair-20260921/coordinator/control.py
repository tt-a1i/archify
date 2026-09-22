import argparse,pathlib,json,time,importlib.util,datetime,shutil
p=argparse.ArgumentParser();p.add_argument('action');p.add_argument('run');p.add_argument('handle');a=p.parse_args()
W=pathlib.Path('/Users/tushaokun/.codex/worktrees/archify-firstdraft-study-20260921/archify');O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921');out=O/a.run
with (O/'ledger.jsonl').open('a') as f:f.write(json.dumps({'event':a.action,'kind':'timed','run_id':a.run,'handle':a.handle,'recorded_epoch':time.time()})+'\n')
if a.action in ('terminal','aborted'):
 source_output=pathlib.Path('/private/tmp/archify-semantic-repair-20260921/runs')/a.run/'output'
 shutil.copytree(source_output,out/'artifacts',dirs_exist_ok=True)
 (out/'done.json').write_text(json.dumps({'task_status':'completed' if a.action=='terminal' else 'interrupted-at-cap','epoch':time.time(),'delivery_status':'see artifact receipts, not implied by task completion'}))
 for i in range(30):
  if (out/'receipt.json').exists():break
  time.sleep(.1)
 spec=importlib.util.spec_from_file_location('trace',W/'benchmarks/source-tools-20260921/trace_extract.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 found=[]
 for session in pathlib.Path('/Users/tushaokun/.codex/sessions/2026/09/21').glob('*.jsonl'):
  with session.open() as f: first=json.loads(f.readline())
  source=first.get('payload',{}).get('source',{})
  if isinstance(source,dict) and source.get('subagent',{}).get('thread_spawn',{}).get('agent_path')==a.handle:found.append(session)
 if len(found)!=1:raise RuntimeError(f'expected one native session, found {len(found)}')
 base_categories=m.categories
 def categories(command):
  result=base_categories(command)
  if 'semantic-navigation.cjs' in command:result.append('semantic-navigation')
  if 'route-repair.mjs' in command:result.append('route-repair')
  return sorted(set(result))
 m.categories=categories
 receipt=json.loads((out/'receipt.json').read_text())
 try:result=m.extract(found[0],receipt)
 except ValueError:
  if a.action!='aborted':raise
  start=None;last=None;identity={};faults=[]
  for line in found[0].read_text().splitlines():
   event=json.loads(line);payload=event.get('payload',{});stamp=event.get('timestamp');last=stamp or last
   if event.get('type')=='turn_context':identity={k:payload.get(k) for k in ('model','effort')}
   if event.get('type')=='event_msg' and payload.get('type')=='task_started':start=stamp
   if event.get('type')=='event_msg' and payload.get('type') in ('turn_aborted','error','task_failed'):faults.append({'event':payload.get('type'),'timestamp':stamp})
  if not start:raise RuntimeError('aborted subject has no native start')
  first=receipt.get('first_complete_seconds');start_epoch=datetime.datetime.fromisoformat(start.replace('Z','+00:00')).timestamp()
  result={'identity':identity,'task_started_at':start,'native_task_seconds':None,'native_observed_seconds':datetime.datetime.fromisoformat(last.replace('Z','+00:00')).timestamp()-start_epoch,'first_complete_from_native_start_seconds':receipt['start_epoch']+first-start_epoch if first is not None else None,'surfaced_faults':faults,'censored':True,'limits':'Interrupted at cap, no completed native interval; no successful latency claim.'}
 (out/'native-trace.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result.get(k) for k in ['native_task_seconds','first_complete_from_native_start_seconds','identity','surfaced_faults','censored']}))
