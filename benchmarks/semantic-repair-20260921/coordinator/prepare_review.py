import pathlib,json,shutil,hashlib
T=pathlib.Path('/private/tmp/archify-semantic-repair-20260921');O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921');R=T/'quality-review';R.mkdir(exist_ok=False)
map_={'ky-U':'ky-N','ky-V':'ky-B','query-U':'query-B','query-V':'query-N','pqueue-U':'pqueue-R','pqueue-V':'pqueue-B'}
(O/'quality-review-key.json').write_text(json.dumps(map_,indent=2)+'\n')
tasks=json.loads((O/'tasks.json').read_text());by={x['repo']:x for x in tasks['tasks']};cases=[]
shutil.copy2(O/'rubrics.json',R/'rubrics.json')
for anonymous,run in map_.items():
 d=R/anonymous;d.mkdir();obs=O/run;root=T/'runs'/run;eval_=json.loads((obs/'evaluation.json').read_text());snapshots=eval_['snapshots'];case={'id':anonymous,'rubric_id':by[run.split('-')[0]]['id'],'source_root':str(T/run.split('-')[0]),'request':by[run.split('-')[0]]['prompt'],'candidates':[]}
 for stage in ['first','final']:
  candidate=obs/f"snapshot-{snapshots[0]['snapshot']:03}.json" if stage=='first' and snapshots else root/'output/candidate.json'
  row={'stage':stage}
  if not candidate.exists():row['available']=False;case['candidates'].append(row);continue
  dest=d/f'{stage}.json';shutil.copy2(candidate,dest);digest=hashlib.sha256(dest.read_bytes()).hexdigest();row.update({'available':True,'path':str(dest),'sha256':digest})
  matched=next((x for x in snapshots if x['sha256']==digest),None);row['production_validate_exit']=matched.get('validation_exit') if matched else None;row['production_codes']=matched.get('codes') if matched else None
  visual_base=obs/'visual'
  if stage=='first' and not eval_.get('first_visual',{}).get('reused_final'):visual_base=obs/'first-visual'
  image=next(visual_base.glob('*.1440x900.light.png'),None) if visual_base.exists() else None
  if image:
   out=d/f'{stage}-1440x900.png';shutil.copy2(image,out);row['image']=str(out)
  else:row['image']=None
  case['candidates'].append(row)
 cases.append(case)
(R/'cases.json').write_text(json.dumps({'review_policy':'Condition labels, native timing, tool usage and author narration withheld. Use exact candidates + pinned source and common viewport images. First and final separate. Missing image does not prove perceptual pass. No mandatory count or node names.','cases':cases},indent=2)+'\n')
print(str(R/'cases.json'))
