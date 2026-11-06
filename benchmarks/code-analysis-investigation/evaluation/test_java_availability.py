"""Test model-dependent availability against a real saved paired result."""
import copy,json,pathlib,sys
from grading import grade_java_availability

if len(sys.argv)!=2:
 raise SystemExit('usage: python3.13 test_java_availability.py /path/to/paired-slf4j/result.json')
x=json.loads(pathlib.Path(sys.argv[1]).read_text())
name='LoggerFactory.bind()'
def grade(obj):return grade_java_availability(obj,name)['status']
assert grade(x)=='contract-expanded'
assert grade_java_availability(x,name)['historical_contract_result']=='wrong-target'
for mutation in ('producer','model','total','items','missing-side'):
 y=copy.deepcopy(x)
 if mutation=='producer':y['sides']['head']['producer']['adapter']='other@1'
 if mutation=='model':del y['sides']['head']['callModel']
 records=[item for item in y['changedDefinitions']['items'] if item.get('head',{}).get('definition',{}).get('qualname')==name]; assert len(records)==1
 entry=records[0]['head']['knownReferences']
 if mutation=='total':entry['total']+=1
 if mutation=='items':entry['items']=[]
 if mutation=='missing-side':del records[0]['base']
 assert grade(y)=='contract-violation', mutation
# An unknown model is accepted only when both reference fields explicitly report unavailable.
y=copy.deepcopy(x)
for side in ('base','head'):y['sides'][side]['callModel']='unknown'
for item in y['changedDefinitions']['items']:
 if item.get('head',{}).get('definition',{}).get('qualname')==name:
  for side in ('base','head'):
   for key in ('knownReferences','unresolvedWithinSourceRange'):
    item[side][key]={'coverage':'unavailable','total':None,'included':0,'omitted':None,'items':[]}
assert grade(y)=='explicit-unknown'
print('PASS real expanded availability, historical predicate, producer/model/count/side corruptions, and unknown model boundary')
