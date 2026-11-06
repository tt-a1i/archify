#!/usr/bin/env python3
"""Fetch pinned public sources and run one analyzer revision from source and archive."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, sys, zipfile
B = pathlib.Path(__file__).resolve().parent
URLS = {'redux':'https://github.com/reduxjs/redux.git','commander':'https://github.com/tj/commander.js.git','pluggy':'https://github.com/pytest-dev/pluggy.git','httpx':'https://github.com/encode/httpx.git','slf4j':'https://github.com/qos-ch/slf4j.git','guava':'https://github.com/google/guava.git','pandas':'https://github.com/pandas-dev/pandas.git'}
PINS = {'labs':'bf0a29e7664f52973d06a8e6a608df2db1ecbd39','combined':'7fa882747cda2fc150c120b62a039c6d783d1ccf','python':'8739a9769e69eb822ad9459eb15baa2884b35209','paired':'92606d7e8d1a55a800c0ee0ea34753630682c0f5'}
def call(*args, **kw):
 print('+', ' '.join(map(str,args)), flush=True)
 return subprocess.run(list(map(str,args)),check=True,**kw)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def check_bundle():
 prov=json.loads((B/'provenance.json').read_text())
 for name,digest in prov['bundle_sha256'].items():
  if sha(B/name)!=digest: raise ValueError('bundle input hash mismatch: '+name)
 for name in ('paired-design/supplemental-source-oracle.json','evaluation/outgoing-source-oracle.json'):
  p=B/name
  if p.with_suffix('.sha256').read_text().split()[0]!=sha(p):raise ValueError('oracle digest mismatch: '+name)
def checkout(url,commit,path):
 path.mkdir(); call('git','init','-q',path);call('git','-C',path,'remote','add','origin',url);call('git','-C',path,'fetch','-q','--depth=1','origin',commit);call('git','-C',path,'checkout','-q','--detach','FETCH_HEAD')
 actual=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
 if actual!=commit or subprocess.check_output(['git','-C',str(path),'status','--porcelain'],text=True).strip():raise ValueError('checkout identity mismatch: '+str(path))
def main():
 p=argparse.ArgumentParser();p.add_argument('--work',type=pathlib.Path,required=True,help='new empty directory');p.add_argument('--revision',choices=list(PINS),default='paired');p.add_argument('--product-sha',help='exact fetchable product commit, overriding --revision');p.add_argument('--archive-sha256',help='expected SHA-256 of the committed archive; required with --product-sha');p.add_argument('--require-paired-contract',action='store_true',help='enforce the frozen paired ready/partial and strict unit-grade contract');p.add_argument('--prepare-only',action='store_true',help='validate bundle and prerequisites without network or creating work');a=p.parse_args()
 if a.product_sha and (not re.fullmatch(r'[0-9a-f]{40}', a.product_sha) or not a.archive_sha256):p.error('--product-sha requires a full lowercase 40-character SHA and --archive-sha256')
 if a.archive_sha256 and not re.fullmatch(r'[0-9a-f]{64}', a.archive_sha256):p.error('--archive-sha256 must be a lowercase 64-character digest')
 check_bundle()
 for executable in ('git','node','npm','python3.13'):
  if not shutil.which(executable):raise RuntimeError('missing prerequisite: '+executable)
 node=subprocess.check_output(['node','--version'],text=True).strip(); py=subprocess.check_output(['python3.13','--version'],text=True).strip()
 if node!='v22.23.2' or not py.startswith('Python 3.13.'):raise RuntimeError('requires Node 22.23.2 and Python 3.13; got '+node+' / '+py)
 if a.work.exists():raise RuntimeError('work directory must not exist')
 if a.prepare_only:print('bundle and local prerequisites validated; no sources fetched');return
 work=a.work.resolve(); work.mkdir(parents=True);sources=work/'sources';sources.mkdir(); inputs=work/'inputs'; outputs=work/'outputs';outputs.mkdir()
 for d in ('eval-design','paired-design','evaluation'):(inputs/d).mkdir(parents=True)
 for name in json.loads((B/'provenance.json').read_text())['bundle_sha256']:
  target=inputs/name;target.write_bytes((B/name).read_bytes())
 for name in ('paired-design/supplemental-source-oracle.sha256','evaluation/outgoing-source-oracle.sha256'):(inputs/name).write_bytes((B/name).read_bytes())
 m=json.loads((inputs/'eval-design/manifest.json').read_text())
 for project in m['projects']:
  for side in ('base','head'):
   commit=project.get(side+'_sha')
   if commit and side in project['checkout_paths']: checkout(URLS[project['id']],commit,sources/(project['id']+'-'+side))
 # Relocate only the declared path fields, leaving expected semantic data intact.
 for project in m['projects']:
  project['checkout_paths']={s:v.replace('@SOURCES@',str(sources)) for s,v in project['checkout_paths'].items()}
 (inputs/'eval-design/manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 op=inputs/'eval-design/frozen-oracle.json';o=json.loads(op.read_text());o['source_hashes_sha256']={k.replace('@SOURCES@',str(sources)):v for k,v in o['source_hashes_sha256'].items()}
 for case in o['python_function_and_callsite_cases']:case['root']=case['root'].replace('@SOURCES@',str(sources))
 op.write_text(json.dumps(o,indent=2)+'\n')
 for file,digest in o['source_hashes_sha256'].items():
  if sha(pathlib.Path(file))!=digest:raise ValueError('source hash mismatch: '+file)
 product=work/'product-source';checkout('https://github.com/tt-a1i/archify.git',a.product_sha or PINS[a.revision],product)
 archive=product/'archify.zip'
 expected_archive=a.archive_sha256 or ('5580acd25f745f34eb4d4f1e8e5f3d2cb0468ff76ba5baeefeb63417378e4ea3' if not a.product_sha and a.revision=='paired' else None)
 if expected_archive and sha(archive)!=expected_archive:raise ValueError('committed ZIP digest mismatch')
 if subprocess.check_output(['git','-C',str(product),'status','--porcelain','--','archify.zip'],text=True).strip():raise ValueError('committed ZIP changed')
 extracted=work/'product-archive';extracted.mkdir()
 with zipfile.ZipFile(archive) as z:
  for info in z.infolist():
   path=pathlib.PurePosixPath(info.filename)
   if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0]!='archify' or (info.external_attr >> 16) & 0o170000 == 0o120000:raise ValueError('unsafe ZIP member: '+info.filename)
  z.extractall(extracted)
 if not (extracted/'archify/bin/archify.mjs').is_file():raise ValueError('ZIP missing expected CLI')
 # Dependency installation skips lifecycle scripts; no target repository is executed.
 for tree in (product,extracted):call('npm','ci','--ignore-scripts',cwd=tree/'archify/modules/code-analysis')
 env=os.environ.copy();env.update(REPLAY_INPUTS=str(inputs),REPLAY_OUTPUTS=str(outputs),PYTHON=shutil.which('python3.13'),NODE=shutil.which('node'))
 for name,tree in [('source',product),('archive',extracted)]:
  cmd=['python3.13',B/'evaluation/run.py','--name',name,'--cli',tree/'archify/bin/archify.mjs']
  if name=='archive':cmd+=['--archive-sha256',sha(archive)]
  call(*cmd,env=env)
 for project in m['projects']:
  for side, root in project['checkout_paths'].items():
   actual=subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip()
   dirty=subprocess.check_output(['git','-C',root,'status','--porcelain','--untracked-files=no'],text=True).strip()
   if actual!=project[side+'_sha'] or dirty:raise ValueError('target source changed during run: '+root)
 for file,digest in o['source_hashes_sha256'].items():
  if sha(pathlib.Path(file))!=digest:raise ValueError('source hash changed during run: '+file)
 call('python3.13',B/'evaluation/grade_adversarial.py',env=env)
 call('python3.13',B/'evaluation/paired_adversarial.py',env=env)
 call('python3.13',B/'evaluation/score.py','source','archive',env=env)
 if a.require_paired_contract or a.revision=='paired':call('python3.13',B/'evaluation/paired_gate.py',outputs,outputs/'unit-results.json','source','archive',env=env)
 call('python3.13',B/'evaluation/compare_runs.py','source','archive',env=env)
 print('Completed; inspect',outputs)
if __name__=='__main__':main()
