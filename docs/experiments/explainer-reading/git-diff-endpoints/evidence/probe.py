"""Constructed tracked-file scenarios; never operates in the user's repository."""
from pathlib import Path
import json,os,subprocess,tempfile

def run():
    with tempfile.TemporaryDirectory(prefix='archify-diff-endpoints-') as raw:
        root=Path(raw)
        env={**os.environ,'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':os.devnull,'GIT_TERMINAL_PROMPT':'0','LC_ALL':'C'}
        for key in list(env):
            if key.startswith('GIT_') and key not in {'GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT'}:env.pop(key)
        def git(*args):
            return subprocess.check_output(['/usr/bin/git','-c','core.autocrlf=false','-c','color.ui=false',*args],cwd=root,env=env,text=True)
        git('init','-q');(root/'value.txt').write_text('value=1\n');git('add','value.txt')
        git('-c','user.name=Example','-c','user.email=example@example.invalid','-c','commit.gpgsign=false','commit','-qm','initial')
        initial=git('rev-parse','HEAD').strip();observations=[]
        scenarios=[('clean','1','1'),('staged-only','2','2'),('unstaged-only','1','3'),('both-distinct','2','3'),('same-endpoints','2','1')]
        for name,index,work in scenarios:
            (root/'value.txt').write_text('value='+index+'\n');git('add','value.txt');(root/'value.txt').write_text('value='+work+'\n')
            before={'head':git('show','HEAD:value.txt'),'index':git('show',':value.txt'),'worktree':(root/'value.txt').read_text()}
            differences={label:git('diff','--no-ext-diff','--no-textconv',*flags,'--','value.txt') for label,flags in [('git diff',[]),('git diff --cached',['--cached']),('git diff HEAD',['HEAD'])]}
            after={'head':git('show','HEAD:value.txt'),'index':git('show',':value.txt'),'worktree':(root/'value.txt').read_text()}
            assert before==after and git('rev-parse','HEAD').strip()==initial
            assert bool(differences['git diff'])==(index!=work)
            assert bool(differences['git diff --cached'])==(index!='1')
            assert bool(differences['git diff HEAD'])==(work!='1')
            observations.append({'case':name,**before,'diffs':differences,'shortStatus':git('status','--short'),'readOnlyPreserved':True})
        return {'version':git('--version').strip(),'scope':'five constructed tracked-file cases; existing HEAD, no conflicts, default text comparison','cases':observations}
if __name__=='__main__':print(json.dumps(run(),ensure_ascii=False,indent=2))
