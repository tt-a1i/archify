#!/usr/bin/env python3
"""Read-only review prioritization and dependency queries; never classify defects."""
import argparse
from collections import Counter
from fnmatch import fnmatch
from itertools import combinations
import json
from pathlib import Path
import subprocess
import sys


def git(root, *args):
    cp = subprocess.run(['git','-C',str(root),*args],capture_output=True,timeout=60)
    if cp.returncode:
        raise ValueError(cp.stderr.decode(errors='replace').strip())
    return cp.stdout


def history(root, ref, limit, max_files, excludes, min_joint):
    root=Path(root).resolve()
    top=Path(git(root,'rev-parse','--show-toplevel').decode().strip()).resolve()
    if root != top: raise ValueError('Use the repository root; subdirectory history is not implied.')
    revision=git(root,'rev-parse','--verify','--end-of-options',ref+'^{commit}').decode().strip()
    commits=git(root,'rev-list','--no-merges','--max-count='+str(limit),revision).decode().splitlines()
    counts=Counter();pairs=Counter();evidence={};skipped=[];used=[]
    for commit in commits:
        names=git(root,'diff-tree','--root','--no-commit-id','--name-only','--no-renames','-z','-r',commit).decode('utf8',errors='replace').split('\0')
        names=sorted({n for n in names if n and not any(fnmatch(n,p) for p in excludes)})
        if len(names)>max_files:
            skipped.append({'commit':commit,'files_after_exclusion':len(names),'reason':'over configured breadth limit'});continue
        if not names:continue
        used.append(commit);counts.update(names)
        for pair in combinations(names,2):
            pairs[pair]+=1;evidence.setdefault(pair,[]).append(commit)
    changes=[{'path':p,'touching_commits':n} for p,n in sorted(counts.items(),key=lambda x:(-x[1],x[0]))]
    coupled=[{'a':a,'b':b,'joint_commits':n,'a_commits':counts[a],'b_commits':counts[b],
              'commit_ids':evidence[(a,b)]} for (a,b),n in sorted(pairs.items(),key=lambda x:(-x[1],x[0])) if n>=min_joint]
    return {'provider':'git','status':'ok','revision':revision,'root':str(root),
            'selection':{'requested_commits':limit,'available_selected':len(commits),'counted_commits':len(used),
                         'no_merges':True,'max_files_per_commit':max_files,'exclude':excludes,'min_joint_commits':min_joint,
                         'shallow':git(root,'rev-parse','--is-shallow-repository').decode().strip()=='true'},
            'commit_ids':used,'skipped_commits':skipped,'files':changes,'cochanges':coupled,
            'limitations':['Change counts prioritize investigation; they do not prove defects, ownership, or causality.',
                           'Renames are not followed. Formatting, bots and mixed-purpose commits can create false coupling.',
                           'No commit messages, tests, or fix diffs were read. Only history reachable from the fixed revision is used.',
                           'These counts describe the selected history, not runtime exposure or whole project history.']}


def dependencies(path, node_id, direction, limit):
    raw=json.loads(Path(path).read_text());a=raw.get('architecture',raw)
    nodes={n['id']:n for n in a['nodes']}
    if node_id not in nodes:raise ValueError('Unknown node; use an exact architecture node ID.')
    children={}
    for n in nodes.values():children.setdefault(n['parent'],[]).append(n['id'])
    pending=[node_id];seen=set();files=set()
    while pending:
        current=pending.pop()
        if current in seen:continue
        seen.add(current)
        if nodes[current]['kind']=='file':files.add(current)
        pending.extend(children.get(current,[]))
    edges=[]
    for e in a['edges']:
        outgoing=e['from'] in files and e['to'] not in files
        incoming=e['to'] in files and e['from'] not in files
        if (direction in ('out','both') and outgoing) or (direction in ('in','both') and incoming):
            edges.append({**e,'direction':'out' if outgoing else 'in','source_sha256':nodes[e['from']]['sha256']})
    edges.sort(key=lambda e:(e['from'],e['line'],e['to']))
    return {'provider':a['provider'],'status':'ok','node':nodes[node_id],'scope_files':len(files),
            'total_crossing_imports':len(edges),
            'truncated':len(edges)>limit,'edges':edges[:limit],'sources':a['sources'],'coverage':a['coverage'],
            'limitations':['This queries a captured import graph, not runtime calls or complete API dependencies.',
                           'Import counts are facts, not architecture violations. Confirm the intended module boundary separately.']}


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='op',required=True)
    h=sub.add_parser('history');h.add_argument('--root',required=True);h.add_argument('--ref',required=True)
    h.add_argument('--limit',type=int,default=100);h.add_argument('--max-files',type=int,default=50)
    h.add_argument('--min-joint',type=int,default=3);h.add_argument('--exclude',action='append',default=[])
    d=sub.add_parser('dependencies');d.add_argument('--input',required=True);d.add_argument('--node',required=True)
    d.add_argument('--direction',choices=['in','out','both'],default='both');d.add_argument('--limit',type=int,default=100)
    for command in (h,d):command.add_argument('--out',required=True)
    args=p.parse_args()
    if args.limit<1 or args.op=='history' and (args.max_files<1 or args.min_joint<1):p.error('limits must be positive')
    try:
        value=history(args.root,args.ref,args.limit,args.max_files,args.exclude,args.min_joint) if args.op=='history' else dependencies(args.input,args.node,args.direction,args.limit)
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as e:
        value={'status':'unavailable','error':str(e),'limitations':['Unavailable evidence is not evidence of absence.']}
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('x') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({'status':value['status'],'out':str(out)}))
    return 0 if value['status']=='ok' else 2

if __name__=='__main__':sys.exit(main())
