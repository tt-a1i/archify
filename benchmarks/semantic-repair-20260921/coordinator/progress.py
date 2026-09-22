import pathlib,json,sys,datetime,time,importlib.util
handle=sys.argv[1];W=pathlib.Path('/Users/tushaokun/.codex/worktrees/archify-firstdraft-study-20260921/archify')
spec=importlib.util.spec_from_file_location('trace',W/'benchmarks/source-tools-20260921/trace_extract.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for path in pathlib.Path('/Users/tushaokun/.codex/sessions/2026/09/21').glob('*.jsonl'):
 with path.open() as f:first=json.loads(f.readline())
 source=first.get('payload',{}).get('source',{})
 if not isinstance(source,dict) or source.get('subagent',{}).get('thread_spawn',{}).get('agent_path')!=handle:continue
 start=None;calls=[];events=[]
 for line in path.read_text().splitlines():
  try:e=json.loads(line)
  except ValueError:continue
  p=e.get('payload',{});t=p.get('type')
  if e.get('type')=='event_msg' and t=='task_started':start=e['timestamp']
  if e.get('type')=='event_msg' and t in ('task_complete','turn_aborted','error','task_failed'):events.append(t)
  if e.get('type')=='response_item' and t in ('function_call','custom_tool_call'):
   categories=m.categories(str(p.get('input',p.get('arguments',''))));calls.append(categories)
 print(json.dumps({'handle':handle,'elapsed_seconds':time.time()-m.epoch(start) if start else None,'tool_calls':len(calls),'recent_tool_categories':calls[-3:],'terminal_events':events}))
