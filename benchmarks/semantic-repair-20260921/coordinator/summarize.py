import pathlib,json,hashlib,collections,datetime
O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921');tasks=json.loads((O/'tasks.json').read_text());rows=[]
for run in tasks['order']:
 root=O/run
 if not (root/'native-trace.json').exists():continue
 trace=json.loads((root/'native-trace.json').read_text());receipt=json.loads((root/'receipt.json').read_text());eval_=json.loads((root/'evaluation.json').read_text()) if (root/'evaluation.json').exists() else {};finalize=json.loads((root/'artifacts/finalize.json').read_text()) if (root/'artifacts/finalize.json').exists() else {}
 categories=collections.Counter(x for call in trace.get('tool_calls',[]) for x in call.get('categories',[]));first=trace.get('first_complete_from_native_start_seconds');total=trace.get('native_task_seconds')
 nav=root/'artifacts/navigation-001.json';navigation=json.loads(nav.read_text()) if nav.exists() else None
 route=root/'artifacts/route-repair.json';routing=json.loads(route.read_text()) if route.exists() else None
 def epoch(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
 intervals=sorted((epoch(c['started_at']),epoch(c['completed_at'])) for c in trace.get('tool_calls',[]) if c.get('completed_at'));merged=[]
 for lo,hi in intervals:
  if merged and lo<=merged[-1][1]:merged[-1][1]=max(merged[-1][1],hi)
  else:merged.append([lo,hi])
 public_seconds=sum(hi-lo for lo,hi in merged)
 rows.append({'run':run,'public_call_return_union_seconds':public_seconds,'public_interval_limit':'Async commands may outlive a call-return interval. The complement is not isolated thinking, decoding or network time.','identity':trace.get('identity'),'native_seconds':total,'first_complete_seconds':first,'after_first_seconds':total-first if total is not None and first is not None else None,'candidate_versions':len(receipt['snapshots']),'first_validation_codes':(eval_.get('snapshots') or [{}])[0].get('codes'),'finalize_ok':finalize.get('ok'),'finalize_gates':finalize.get('gates'),'finalize_last_duration_ms':finalize.get('durationMs'),'final_candidate_sha256':finalize.get('specification',{}).get('sha256'),'final_codes':sorted(set(d.get('code') for d in finalize.get('diagnostics',[]))),'navigation_receipt_present':navigation is not None,'navigation_tool_version':navigation.get('tool',{}).get('typescript') if navigation else None,'route_helper_status':routing.get('status') if routing else 'not-invoked','surfaced_faults':trace.get('surfaced_faults'),'observer_expired':receipt['expired'],'coarse_tool_categories':dict(categories),'reported_usage':trace.get('reported_turn_usage'),'quality':'pending independent source and common-viewport review; machine gates alone are not acceptance'})
review_file=O/'quality-review-1.json'
if review_file.exists():
 key=json.loads((O/'quality-review-key.json').read_text());grades={}
 for case in json.loads(review_file.read_text())['cases']:
  grades[key[case['id']]]={'blind_case':case['id'],'first_semantic':case['stages']['first']['semantic'],'final_semantic':case['stages']['final']['semantic'],'first_visual':case['stages']['first']['visual'],'final_visual':case['stages']['final']['visual'],'first_final_semantic_difference':case['first_final_semantic_difference']}
 for row in rows:
  row['quality']=grades[row['run']];row['accepted_delivery']=row['finalize_ok'] and row['quality']['final_semantic']=='pass' and row['quality']['final_visual']=='pass'
(O/'metrics.json').write_text(json.dumps({'rows':rows,'warning':'No equal-quality E2E speedup claim before independent quality review. Coarse lexical tool categories and before/after candidate times do not isolate hidden model reasoning or network cost.'},indent=2)+'\n')
print(json.dumps([{k:r[k] for k in ['run','native_seconds','first_complete_seconds','after_first_seconds','candidate_versions','finalize_ok','route_helper_status']} for r in rows],indent=2))
