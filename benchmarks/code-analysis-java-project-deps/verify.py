#!/usr/bin/env python3
"""Validate source/ZIP call evidence and retained partial upstream migration status."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['source','zip','pair-source','pair-zip','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--freshness-source',type=Path);p.add_argument('--freshness-zip',type=Path)
a=p.parse_args();s=json.loads((a.source/'report.json').read_text());z=json.loads((a.zip/'report.json').read_text());assert s['units']==z['units'] and s['scope']==z['scope'] and s['score']==z['score']
sf=json.loads((a.source/'capture/raw-facts.json').read_text());zf=json.loads((a.zip/'capture/raw-facts.json').read_text())
for field in ['callModel','files','imports','calls','functions','parse_errors','packageMarkers','languageScope']:assert sf.get(field)==zf.get(field),field
ps=json.loads((a.pair_source/'report.json').read_text());pz=json.loads((a.pair_zip/'report.json').read_text())
for field in ['exit','status','definitionCoverage','headOnlyReset','sourceLimits','reasons']:assert ps[field]==pz[field],field
report=dict(score=s['score'],rawFieldsAgree=['callModel','files','imports','calls','functions','parse_errors','packageMarkers','languageScope'],upstreamPair=dict(status=ps['status'],exit=ps['exit'],knownHeadReferences=ps['headOnlyReset']['knownReferences']['total'],simpleHeadReferences=2),commandsPerDistribution=len(s['commands'])+1,sourceExits=[x['exit'] for x in s['commands']]+[ps['exit']],zipExits=[x['exit'] for x in z['commands']]+[pz['exit']],limits=['Source and ZIP are two distributions of the same implementation, not independent accuracy samples.','Real upstream added-definition pair remains partial; status/exit parity is not a claim that every source parsed.'],projectExecuted=False)
if a.freshness_source or a.freshness_zip:
 assert a.freshness_source and a.freshness_zip
 fs=json.loads((a.freshness_source/'report.json').read_text())['commands'];fz=json.loads((a.freshness_zip/'report.json').read_text())['commands']
 assert [{k:v for k,v in r.items() if k!='command'} for r in fs]==[{k:v for k,v in r.items() if k!='command'} for r in fz]
 report['commandsPerDistribution']+=len(fs);report['sourceExits'] += [r['exit'] for r in fs];report['zipExits'] += [r['exit'] for r in fz];report['savedTasks']=[{k:v for k,v in r.items() if k!='command'} for r in fs]
a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
