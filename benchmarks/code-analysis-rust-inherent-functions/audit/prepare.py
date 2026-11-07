"""Prepare isolated pinned sources and an explicit Cargo subprocess guard."""
import argparse,hashlib,io,json,os,shutil,subprocess,sys,tarfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--workspaces-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
here=Path(__file__).resolve().parent;inputs=json.loads((here/'inputs.json').read_text());samples=a.samples_root.resolve();workspaces=a.workspaces_root.resolve();out=a.out.resolve()
assert samples not in workspaces.parents and samples!=workspaces and samples not in out.parents and samples!=out
workspaces.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
for project,meta in inputs['projects'].items():
 source=samples/project;dest=workspaces/project
 assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()==meta['revision']
 # Refuse an occupied destination rather than overwriting existing analysis.
 dest.mkdir()
 data=subprocess.check_output(['git','-C',str(source),'archive','--format=tar',meta['revision']])
 with tarfile.open(fileobj=io.BytesIO(data))as t:t.extractall(dest,filter='data')
 lock=here/'locks'/(project+'.lock');assert hashlib.sha256(lock.read_bytes()).hexdigest()==meta['lockSha256'];shutil.copyfile(lock,dest/'Cargo.lock')
original_home=Path(os.environ.get('CARGO_HOME',str(Path.home()/'.cargo'))).resolve();cargo=shutil.which('cargo');assert cargo
home=out/'cargo-home';(home/'bin').mkdir(parents=True,exist_ok=True);(out/'bin').mkdir(exist_ok=True)
for name in ['registry','git']:
 if(original_home/name).exists():(home/name).symlink_to(original_home/name,target_is_directory=True)
settings=out/'guard-settings.json';settings.write_text(json.dumps({'cargo':cargo,'log':str(out/'cargo-commands.jsonl')})+'\n')
# RA 1.89 prefers CARGO_HOME/bin/cargo over CARGO/PATH, so both point to this guard.
launcher=out/'bin/cargo';launcher.write_text('#!/usr/bin/env python3\nimport os\nos.execv('+repr(sys.executable)+','+repr([sys.executable,str(here/'cargo_guard.py'),str(settings)])+'+__import__("sys").argv[1:])\n');launcher.chmod(0o755);(home/'bin/cargo').symlink_to(launcher)
print(json.dumps({'workspaces':str(workspaces),'out':str(out),'fetch':'Run cargo fetch --locked --target aarch64-apple-darwin --manifest-path <workspace>/Cargo.toml before the offline LSP audit; this downloads sources but does not compile.'}))
