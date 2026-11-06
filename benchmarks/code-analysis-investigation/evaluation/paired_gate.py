"""Check the frozen paired acceptance contract, including known SLF4J partial coverage."""
import json, pathlib, sys

def validate(outputs, grades, modes):
    reason_message='Some captured source regions failed parsing or freshness checks; other valid regions remain available.'
    expected_reasons=[{'code':'source-regions-unavailable','side':side,'count':1,'message':reason_message} for side in ('base','head')]
    for mode in modes:
        for project in ('redux','commander','httpx','pluggy','slf4j'):
            folder=outputs/mode/('paired-'+project)
            receipt=json.loads((folder/'stdout').read_text()); cmd=json.loads((folder/'command.json').read_text()); result=json.loads((folder/'result.json').read_text())
            if project!='slf4j':
                if cmd['exit']!=0 or receipt.get('status')!='ok' or result.get('status')!='ready':raise ValueError('paired ready gate failed: '+str(folder))
                continue
            if cmd['exit']!=1 or receipt.get('status')!='incomplete' or receipt.get('evidence')!='partial' or result.get('status')!='partial':raise ValueError('SLF4J partial receipt mismatch')
            if receipt.get('reasons')!=expected_reasons or result.get('comparison',{}).get('reasons')!=expected_reasons:raise ValueError('SLF4J reasons mismatch')
            if receipt.get('definitionCoverage')!={'base':'available','head':'available'} or result.get('definitionCoverage')!={'base':'available','head':'available'}:raise ValueError('SLF4J selected definition coverage mismatch')
            for side in ('base','head'):
                snapshot=result['sides'][side]; unavailable=snapshot['unavailableFiles']; items=unavailable['items']
                if snapshot.get('sourceIdentity')!='valid' or snapshot.get('parseErrors')!=1 or (unavailable.get('total'),unavailable.get('included'),unavailable.get('omitted'))!=(1,1,0) or len(items)!=1:raise ValueError('SLF4J unavailable count mismatch: '+side)
                item=items[0]
                if item.get('file')!='slf4j-migrator/jcl/jclcontent.java' or item.get('status')!='parse-error' or item.get('parseError')!='parsing errors detected in line: 19, column: 1! Expecting: one of these possible Token sequences:':raise ValueError('SLF4J parse fixture mismatch: '+side)
        summary=grades[mode]['summary']
        for kind,total in (('changed-definition',8),('paired-outgoing-import',4)):
            if summary.get(kind)!={'total':total,'statuses':{'correct-target':total}}:raise ValueError('strict unit grade failed: '+mode+' '+kind)
    print('PASS four ready pairs; SLF4J expected partial; 8 definitions and 4 outgoing imports correct per mode')
if __name__=='__main__':
    validate(pathlib.Path(sys.argv[1]),json.loads(pathlib.Path(sys.argv[2]).read_text()),sys.argv[3:])
