#!/usr/bin/env python3
"""Reproduce optional source attribution; never build or execute upstream projects."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser()
for name in ['jdk-home','facts','sample','deps','out']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--profile',choices=['commons','slf4j-api'],required=True);a=p.parse_args()
for name in ['jdk_home','facts','sample','deps','out']:setattr(a,name,getattr(a,name).resolve())
a.out.mkdir(parents=True,exist_ok=True);a.deps.mkdir(parents=True,exist_ok=True)
here=Path(__file__).resolve().parent;meta=json.loads((here/'audit-dependencies.json').read_text());facts=json.loads(a.facts.read_text());prefix='' if a.profile=='commons' else 'slf4j-api/';excluded=[] if not prefix else ['slf4j-api/src/test/java/org/slf4j/LoggerFactoryTest.java']
expected=json.loads((here/'source-first.json').read_text())['project']['revision'] if not prefix else json.loads((here/'workspace-boundary-source.json').read_text())['projectRevision']
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==expected
 for file in facts['files']:assert (a.sample/file['path']).read_bytes().decode('utf8')==file['sourceText'],file['path']
verify()
javac=a.jdk_home/'bin/javac';java=a.jdk_home/'bin/java'
if not javac.is_file() or not java.is_file():raise SystemExit('Optional audit needs a JDK17+ home with bin/java and bin/javac; normal Java analysis does not need this SDK.')
version=subprocess.check_output([str(javac),'-version'],text=True).strip()
artifacts=meta['artifacts'] if not prefix else meta['slf4jApiArtifacts'];downloads=[];start=time.monotonic()
for item in artifacts:
 dest=a.deps/(item['artifact']+'-'+item['version']+'.jar')
 if not dest.exists():
  subprocess.run(['curl','--fail','--location','--silent','--show-error',item['url'],'--output',str(dest)],check=True);downloads.append(dest.name)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==item['sha256'],dest.name
classpath=os.pathsep.join(str(a.deps/(item['artifact']+'-'+item['version']+'.jar')) for item in artifacts)
sources=sorted(file['path'][len(prefix):] for file in facts['files'] if file['path'].startswith(prefix) and file['path'] not in excluded and not file['path'].endswith('module-info.java'))
if prefix:assert sources==json.loads((here/'slf4j-compiler-scope.json').read_text())['selectedCompilerFiles']
sourceList=a.out/'sources.txt';sourceList.write_text('\n'.join(sources)+'\n');tools=a.out/'tools';tools.mkdir(exist_ok=True)
subprocess.run([str(javac),'-proc:none','-d',str(tools),str(here/'InheritedQualifierCalls.java')],check=True)
root=a.sample/'slf4j-api' if prefix else a.sample
r=subprocess.run([str(java),'-cp',str(tools),'InheritedQualifierCalls',str(root),classpath,str(sourceList)],capture_output=True,text=True)
(a.out/'compiler.tsv').write_text(r.stdout);(a.out/'compiler.log').write_text(r.stderr);verify()
report=dict(profile=a.profile,jdk=version,sourceRevision=expected,sourceFiles=len(sources),excludedSources=excluded,exit=r.returncode,downloaded=downloads,dependencyBytes=sum(x['bytes'] for x in artifacts),seconds=time.monotonic()-start,helperSha256=hashlib.sha256((here/'InheritedQualifierCalls.java').read_bytes()).hexdigest(),method='JavacTask parse/analyze --release17 -proc:none; no project emit, test execution or build scripts.',projectExecuted=False)
(a.out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));assert r.returncode==0,r.stderr[-1500:]
