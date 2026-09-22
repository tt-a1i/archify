#!/usr/bin/env python3
"""Fixed-input, common native CLI comparison; run only without author contention."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, time, zipfile

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--manifest',type=pathlib.Path,required=True)
    p.add_argument('--candidate',type=pathlib.Path,required=True)
    p.add_argument('--repo-root',type=pathlib.Path,required=True)
    p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--chrome',required=True)
    a=p.parse_args(); m=json.loads(a.manifest.read_text())
    if a.output.exists(): raise SystemExit('Keep prior attempts; choose a new output directory')
    a.output.mkdir(parents=True)
    candidate=a.output/'frozen.json'; shutil.copy2(a.candidate,candidate)
    identity={'candidate_sha256':digest(candidate),'target_sha':subprocess.check_output(['git','-C',str(a.repo_root),'rev-parse','HEAD'],text=True).strip(),'workflow':'validate, deliver, check, visual-check; A uses supported legacy flags and inline hash receipt, B/C additionally require their persistent provenance sidecar','warmup':'one recorded warmup per variant, then three balanced repetitions','timing':'parent monotonic command and end-to-end fixed pipeline wall; no model; screenshots included equally','quality':'CLI result only; semantic and actual visual review remain separate','adapter_revision':2}
    (a.output/'protocol.json').write_text(json.dumps(identity,indent=2)+'\n')
    packages={}
    for v in ['A','B','C']:
        spec=m['variants'][v]; package=pathlib.Path(spec['package_path'])
        if digest(package)!=spec['package_sha256']: raise SystemExit('Package drift')
        folder=a.output/v;folder.mkdir()
        with zipfile.ZipFile(package) as z:z.extractall(folder)
        packages[v]=folder/'archify/bin/archify.mjs'
    node='/opt/homebrew/opt/node@22/bin/node';env=dict(os.environ,ARCHIFY_CHROME=a.chrome)
    rows=[]
    for repeat, order in [(0,'ABC'),(1,'ABC'),(2,'BCA'),(3,'CAB')]:
        for v in order:
            out=a.output/f'{repeat}-{v}';out.mkdir();artifact=out/'diagram.html'
            strict=[] if v=='A' else ['--require-provenance']
            capture_options=[] if v=='A' else ['--out-dir',out/'visual']
            commands=[('validate',['validate','architecture',candidate,'--repo-root',a.repo_root,'--quality','showcase','--json']),('deliver',['deliver','architecture',candidate,artifact,'--repo-root',a.repo_root,'--quality','showcase','--json']),('check',['check',artifact,*strict]),('visual-check',['visual-check',artifact,*strict,*capture_options,'--json'])]
            t0=time.monotonic();checks=[]
            for name,args in commands:
                t=time.monotonic()
                try:
                    result=subprocess.run([node,str(packages[v]),*map(str,args)],env=env,capture_output=True,text=True,timeout=90)
                    code=result.returncode;stdout=result.stdout;stderr=result.stderr
                except subprocess.TimeoutExpired as e:
                    code=124;stdout=e.stdout or '';stderr=e.stderr or ''
                    if isinstance(stdout,bytes):stdout=stdout.decode(errors='replace')
                    if isinstance(stderr,bytes):stderr=stderr.decode(errors='replace')
                duration=1000*(time.monotonic()-t)
                (out/(name+'.stdout.txt')).write_text(stdout);(out/(name+'.stderr.txt')).write_text(stderr)
                checks.append({'command':name,'duration_ms':duration,'exit_code':code})
                if code:break
                if name=='deliver':
                    receipt=json.loads(stdout)
                    bound=(receipt.get('ok') is True and receipt.get('specification',{}).get('sha256')==digest(candidate) and receipt.get('artifact',{}).get('sha256')==digest(artifact))
                    (out/'external-identity.json').write_text(json.dumps({'status':'passed' if bound else 'failed','input_sha256':digest(candidate),'artifact_sha256':digest(artifact),'basis':'native deliver stdout receipt; independently recomputed hashes','persistent_provenance':'unavailable in A' if v=='A' else 'native sidecar additionally checked'},indent=2)+'\n')
                    if not bound:
                        checks[-1]['exit_code']=1
                        checks[-1]['identity_error']='native receipt hashes do not bind current bytes'
                        break
            row={'variant':v,'variant_sha':m['variants'][v]['sha'],'repeat':repeat,'warmup':repeat==0,'status':'passed' if len(checks)==4 and all(c['exit_code']==0 for c in checks) else 'failed','duration_ms':1000*(time.monotonic()-t0),'checks':checks,'artifact_sha256':digest(artifact) if artifact.exists() else None}
            rows.append(row);(a.output/'runs.json').write_text(json.dumps(rows,indent=2)+'\n')
            print(json.dumps({k:row[k] for k in ['variant','repeat','status','duration_ms']}),flush=True)
    if digest(candidate)!=identity['candidate_sha256']:raise SystemExit('Input mutated')

if __name__=='__main__':main()
