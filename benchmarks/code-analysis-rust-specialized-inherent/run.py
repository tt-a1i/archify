#!/usr/bin/env python3
"""Replay source-frozen Rust paths with the normal CLI, never project execution."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');p.add_argument('--candidate-model',default='rust-source-direct-v3');a=p.parse_args()
a.cli=a.cli.resolve();a.samples_root=a.samples_root.resolve();a.out=a.out.resolve();assert not a.out.exists();a.out.mkdir(parents=True)
here=Path(__file__).parent;m=json.loads((here/'source-first.json').read_text());project=a.samples_root/'serde-json';commands=[];units=[];scopes={}
def verify():
 assert subprocess.check_output(['git','-C',str(project),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 assert not subprocess.check_output(['git','-C',str(project),'status','--porcelain','--untracked-files=no'],text=True)
 for file,digest in m['project']['hashes'].items():assert hashlib.sha256((project/file).read_bytes()).hexdigest()==digest,file
verify()
def run(label,args):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];proc=subprocess.run(cmd,capture_output=True,text=True);(a.out/(label+'.stdout')).write_text(proc.stdout);(a.out/(label+'.stderr')).write_text(proc.stderr);commands.append(dict(label=label,command=cmd,exit=proc.returncode));assert proc.returncode==0,(label,proc.returncode,proc.stderr)
for profile,settings in m['profiles'].items():
 config=a.out/(profile+'-config.json');config.write_text(json.dumps({'rust':settings})+'\n');dest=a.out/profile
 run(profile+'-check',['check',project,'--language','rust','--config',config,'--fail-on','never','--json','--out',dest]);facts=json.loads((dest/'raw-facts.json').read_text());assert facts['callModel']==('rust-source-direct-v2' if a.expect=='baseline' else a.candidate_model)
 scopes[profile]=dict(files=len(facts['files']),calls=len(facts['calls']),functions=len(facts['functions']),parseErrors=facts.get('parse_errors',[]),build=facts['languageScope']['build'],model=facts['callModel'])
 for case in m['cases']:
  point=case['call'];matches=[c for c in facts['calls'] if all(c[k]==point[k] for k in ['file','line','column','endLine','endColumn'])];assert len(matches)==1;call=matches[0];expected=case['target'];status='correct' if call.get('target')==expected else 'wrong' if call.get('target') else 'missed';assert status==('missed' if a.expect=='baseline' else 'correct')
  # Select the narrowest captured enclosing function, including physically nested local impl bodies.
  owners=[f for f in facts['functions'] if f['file']==point['file'] and (f['sourceRange']['line'],f['sourceRange']['column'])<=(point['line'],point['column']) and (point['endLine'],point['endColumn'])<=(f['sourceRange']['endLine'],f['sourceRange']['endColumn'])];assert owners
  owner=min(owners,key=lambda f:(f['sourceRange']['endLine']-f['sourceRange']['line'],f['sourceRange']['endColumn']-f['sourceRange']['column']))
  label=profile+'-'+case['id'];qpath=a.out/(label+'-question.json')
  run(label,['task',dest,'--root',project,'--entry',point['file'],'--function',owner['qualname'],'--question','Which concrete-impl source declaration is the candidate for this constructor path?','--format','json','--out',qpath,'--json'])
  q=json.loads(qpath.read_text());assert q['calls']['coverage']=='available';records=[r for r in q['calls']['records'] if r['fact']==call];assert len(records)==1,(label,'selected call not displayed');nav=records[0]['targetNavigation'];assert nav['status']==('unresolved' if a.expect=='baseline' else 'valid')
  units.append(dict(profile=profile,id=case['id'],cohort=case['cohort'],status=status,call=call,navigationStatus=nav['status']))
 for control in m['controls'][:2]:
  text=(project/control['file']).read_text().splitlines()[control['line']-1];column=text.index(control['text'])+1;matches=[c for c in facts['calls'] if c['file']==control['file'] and c['line']==control['line'] and c['column']==column];assert len(matches)==1 and matches[0]['resolution']=='unresolved' and 'target' not in matches[0];units.append(dict(profile=profile,id=control['id'],status='unknown',call=matches[0]))
 assert any(x['file']=='src/macros.rs' for x in facts['languageScope']['opaqueMacros']);assert not any(c['file']=='src/macros.rs' and c['line']==265 for c in facts['calls'])
 scopes[profile]['macroControl']='unexpanded macro body remains opaque; no runtime call claimed'
verify();report=dict(expect=a.expect,score={s:sum(u['status']==s for u in units) for s in ['correct','wrong','missed','unknown']},units=units,profiles=scopes,commands=commands,limits=['Two profiles overlap:10known-target observations are5physical sites.','The older two Map sites are design inputs for this follow-up, not a blind holdout. Three cross-file sites were reserved from initial rule tuning.','Source candidates do not prove argument applicability, compilation/runtime dispatch or complete callers.']);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
