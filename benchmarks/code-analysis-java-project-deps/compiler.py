#!/usr/bin/env python3
"""Optional independent attribution of the frozen API + Simple source graph."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['jdk-home','facts','sample','deps','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for n in ['jdk_home','facts','sample','deps','out']:setattr(a,n,getattr(a,n).resolve())
a.out.mkdir(parents=True,exist_ok=True);here=Path(__file__).resolve().parent;prior=here.parent/'code-analysis-java-captured-superclass';f=json.loads(a.facts.read_text());m=json.loads((here/'source-first.json').read_text())
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 for file in f['files']:assert (a.sample/file['path']).read_bytes().decode('utf8')==file['sourceText'],file['path']
 for file,digest in m['project']['hashes'].items():assert hashlib.sha256((a.sample/file).read_bytes()).hexdigest()==digest,file
verify();javac=a.jdk_home/'bin/javac';java=a.jdk_home/'bin/java'
if not javac.is_file() or not java.is_file():raise SystemExit('Optional audit requires an installed JDK17+ home with bin/java and bin/javac. Normal Java analysis needs no JDK or Maven.')
version=subprocess.check_output([str(javac),'-version'],text=True).strip();artifacts=json.loads((prior/'audit-dependencies.json').read_text())['slf4jApiArtifacts'];a.deps.mkdir(parents=True,exist_ok=True);downloads=[];start=time.monotonic()
for item in artifacts:
 dest=a.deps/(item['artifact']+'-'+item['version']+'.jar')
 if not dest.exists():subprocess.run(['curl','--fail','--location','--silent','--show-error',item['url'],'--output',str(dest)],check=True);downloads.append(dest.name)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==item['sha256'],dest.name
excluded=['slf4j-api/src/test/java/org/slf4j/LoggerFactoryTest.java']
sources=sorted(x['path'] for x in f['files'] if x['path'].startswith(('slf4j-api/','slf4j-simple/')) and x['path'] not in excluded and not x['path'].endswith('module-info.java'))
sourceList=a.out/'sources.txt';sourceList.write_text('\n'.join(sources)+'\n');tools=a.out/'tools';tools.mkdir(exist_ok=True);helper=prior/'InheritedQualifierCalls.java'
subprocess.run([str(javac),'-proc:none','-d',str(tools),str(helper)],check=True)
cp=os.pathsep.join(str(a.deps/(x['artifact']+'-'+x['version']+'.jar')) for x in artifacts)
r=subprocess.run([str(java),'-cp',str(tools),'InheritedQualifierCalls',str(a.sample),cp,str(sourceList)],capture_output=True,text=True);(a.out/'compiler.tsv').write_text(r.stdout);(a.out/'compiler.log').write_text(r.stderr);verify()
report=dict(sourceRevision=m['project']['revision'],jdk=version,sourceFiles=len(sources),sourceList=sources,excludedSources=excluded,exclusionReason='Full 78-source graph has two upstream compiler errors in this unrelated test: TestingProvider.getRequesteApiVersion does not implement getRequestedApiVersion. Sources unchanged; analyzer still captures all 260 files.',exit=r.returncode,dependencyBytes=sum(x['bytes'] for x in artifacts),downloaded=downloads,seconds=time.monotonic()-start,helperSha256=hashlib.sha256(helper.read_bytes()).hexdigest(),method='JavacTask parse/analyze --release17 -proc:none; API and Simple main/test sources plus pinned JUnit4.13.1/hamcrest-core1.3; no project emit/build/test execution.',projectExecuted=False)
(a.out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='sourceList'}));assert r.returncode==0,r.stderr[-1000:]
