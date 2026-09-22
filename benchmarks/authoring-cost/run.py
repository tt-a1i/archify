#!/usr/bin/env python3
"""Prepare a fresh packaged-skill author session; collect outside its read boundary."""
import argparse, datetime, hashlib, json, os, pathlib, shutil, subprocess, sys, time, zipfile
HERE = pathlib.Path(__file__).resolve().parent
NODE_BIN = '/opt/homebrew/opt/node@22/bin'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def call(argv, **kw): return subprocess.check_output(argv, text=True, **kw).strip()
def prepare(manifest, run_id, sessions, evidence):
    spec = next(x for x in manifest['runs'] if x['run_id'] == run_id)
    case = next(x for x in manifest['tasks'] if x['id'] == spec['case_id'])
    variant = manifest['variants'][spec['variant']]
    root = (sessions/run_id).resolve()
    private = (evidence/run_id).resolve()
    if root.exists() or private.exists(): raise ValueError('Run already exists; never overwrite an attempt')
    root.mkdir(parents=True); private.mkdir(parents=True)
    home = root/'home'; auth = home/'.codex'; auth.mkdir(parents=True)
    # Authentication is copied locally, never into event logs or archives.
    for name in ('auth.json','models_cache.json'):
        source = pathlib.Path.home()/'.codex'/name
        if source.exists(): shutil.copy2(source, auth/name); (auth/name).chmod(0o600)
    package = pathlib.Path(variant['package_path'])
    if sha(package) != variant['package_sha256']: raise ValueError('Package hash changed')
    with zipfile.ZipFile(package) as z:
        for info in z.infolist():
            target=(root/info.filename).resolve()
            if not target.is_relative_to(root): raise ValueError('Unsafe ZIP entry')
        z.extractall(root)
    repo = root/'source'
    source = pathlib.Path(case['target_repo'])
    if call(['git','-C',str(source),'rev-parse','HEAD']) != case['target_repo_sha']: raise ValueError('Target moved')
    subprocess.run(['git','clone','--quiet','--no-local',str(source),str(repo)],check=True)
    subprocess.run(['git','-C',str(repo),'checkout','--quiet','--detach',case['target_repo_sha']],check=True)
    subprocess.run(['git','-C',str(repo),'remote','set-url','origin',case['repository_url']],check=True)
    tmp = root/'tmp'; tmp.mkdir()
    chrome = root/'chrome-wrapper'
    chrome.write_text('#!/bin/sh\nexec '+chr(39)+CHROME+chr(39)+' --no-sandbox --disable-crash-reporter --disable-breakpad \"$@\"\n')
    chrome.chmod(0o755)
    # Read metadata is allowed for ancestor canonicalization. Other task files,
    # global skills, raw events, scoring keys and prior artifacts are unreadable.
    profile = f'''(version 1)
(allow default)
(deny file-read-data (subpath "{pathlib.Path.home()}"))
(deny file-read-data (require-all (subpath "/private/tmp") (require-not (subpath "{root}"))))
(deny file-write* (subpath "{repo}") (subpath "{root/'archify'}"))
(deny file-write* (require-all (require-not (subpath "{root}")) (require-not (subpath "/dev")) (require-not (subpath "/private/var/folders"))))
'''
    (root/'sandbox.sb').write_text(profile)
    prompt = (case['prompt'] + f'\n\nUse the Archify skill at {root}/archify/SKILL.md. '
              f'The target repository is {repo}. Write the complete candidate to {root}/candidate.json '
              f'and deliver the checked HTML to {root}/diagram.html. Inspect the source read-only; '
              'do not install dependencies or run target startup scripts. Keep required responsibilities, '
              'relations and evidence complete. Use the packaged native acceptance commands, including '
              'real-browser evidence. Keep output files in this workspace. '
              f"Limit repair edits after the first complete candidate to {manifest['limits']['max_repair_edits']}; "
              'if still failing, retain the candidate and report the actual failure.\n')
    (private/'prompt.txt').write_text(prompt)
    cfg = manifest['model']
    config_identity = {'model':cfg,'limits':manifest['limits'],'isolation':manifest['isolation'],'observer_sha256':sha(HERE/'observe.py'),'runner_sha256':sha(pathlib.Path(__file__))}
    args = ['/usr/bin/sandbox-exec','-f',str(root/'sandbox.sb'),'/opt/homebrew/bin/codex','exec',
            '--ignore-user-config','--ignore-rules','--skip-git-repo-check','--ephemeral','--json',
            '--sandbox','danger-full-access','-m',cfg['requested_model'],'-c',
            'model_reasoning_effort='+json.dumps(cfg['reasoning_effort']),'-C',str(root),'-']
    env = dict(os.environ, HOME=str(home), CODEX_HOME=str(auth), TMPDIR=str(tmp),
               TMPPREFIX=str(tmp/'zsh'), PATH=NODE_BIN+':/opt/homebrew/bin:/usr/bin:/bin', ARCHIFY_CHROME=str(chrome))
    # Prove the deny boundary before any paid author invocation.
    canary = evidence/'isolation-canary.txt'; canary.write_text('private evaluation material')
    check=subprocess.run(args[:3]+['/bin/cat',str(canary)],cwd=root,env=env,capture_output=True)
    if check.returncode == 0: raise ValueError('Scoring material readable inside sandbox')
    positive=subprocess.run(args[:3]+['/bin/zsh','-lc',"cat <<'ARCHIFY_PREFLIGHT'\nHEREDOC_OK\nARCHIFY_PREFLIGHT"],cwd=root,env=env,capture_output=True,text=True)
    if positive.returncode or positive.stdout.strip()!='HEREDOC_OK': raise ValueError('Isolated shell heredoc preflight failed')
    meta={**spec,'variant_sha':variant['sha'],'target_repo_sha':case['target_repo_sha'],
          'cohort':case['cohort'],'attempt':1,'config_hash':hashlib.sha256(json.dumps(config_identity,sort_keys=True).encode()).hexdigest(),
          'model':cfg,'config_identity':config_identity,'package_sha256':variant['package_sha256'],'prompt_sha256':sha(private/'prompt.txt'),
          'workspace':str(root),'isolation':{'canary_read_exit':check.returncode,'policy_sha256':sha(root/'sandbox.sb')},
          'fresh_session':True,'tool_index':'none','os_filesystem_cache':'uncontrolled; warmed by setup',
          'provider_cache':'uncontrolled; report observed usage','command':args}
    (private/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    return root,private,args,env

def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=pathlib.Path,required=True)
    p.add_argument('--run-id',required=True);p.add_argument('--sessions',type=pathlib.Path,required=True)
    p.add_argument('--evidence',type=pathlib.Path,required=True);p.add_argument('--prepare-only',action='store_true')
    a=p.parse_args();m=json.loads(a.manifest.read_text())
    setup_start=time.monotonic();setup_utc=datetime.datetime.now(datetime.timezone.utc).isoformat()
    root,private,args,env=prepare(m,a.run_id,a.sessions,a.evidence)
    (private/'run-setup.json').write_text(json.dumps({'run_id':a.run_id,'phase':'run_setup','start_utc':setup_utc,'duration_ms':1000*(time.monotonic()-setup_start),'timing_source':'runner monotonic','scope':'package extraction, isolated home, source clone, sandbox and shell preflight'},indent=2)+'\n')
    print(json.dumps({'run_id':a.run_id,'workspace':str(root),'evidence':str(private)}),flush=True)
    if a.prepare_only:return
    cmd=[sys.executable,str(HERE/'observe.py'),'--run-dir',str(private),'--workspace',str(root),
         '--metadata',str(private/'metadata.json'),'--timeout-seconds',str(m['limits']['timeout_seconds']),
         '--prompt-file',str(private/'prompt.txt'),'--',*args]
    raise SystemExit(subprocess.call(cmd,cwd=root,env=env))
if __name__=='__main__':main()
