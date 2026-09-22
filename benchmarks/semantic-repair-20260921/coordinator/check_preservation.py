"""Compare frozen repair inputs without treating geometry edits as meaning edits."""
import json,re,sys,pathlib,hashlib
MISSING=object()
ALLOWED=re.compile(r'^/(?:components|boundaries)/\d+/(?:pos|size)(?:/|$)|^/connections/\d+/(?:via|route|fromSide|toSide|channelX|channelY)(?:/|$)')
def changes(a,b,path=''):
 if type(a) is not type(b):return [{'path':path,'before':a,'after':b}]
 if isinstance(a,dict):
  out=[]
  for key in sorted(a.keys()|b.keys()):
   pointer=path+'/'+str(key).replace('~','~0').replace('/','~1')
   if key not in a:out.append({'path':pointer,'before_missing':True,'after':b[key]})
   elif key not in b:out.append({'path':pointer,'before':a[key],'after_missing':True})
   else:out.extend(changes(a[key],b[key],pointer))
  return out
 if isinstance(a,list):
  if len(a)!=len(b):return [{'path':path,'before':a,'after':b}]
  return [row for i,(left,right) in enumerate(zip(a,b)) for row in changes(left,right,path+'/'+str(i))]
 return [] if a==b else [{'path':path,'before':a,'after':b}]
def evaluate(a,b):
 diff=changes(a,b);unexpected=[x for x in diff if not ALLOWED.match(x['path'])]
 return {'nongeometric_fields_unchanged':not unexpected,'changes':diff,'nongeometric_changes':unexpected,'limit':'This checks literal preservation, not original semantic truth or visual quality. Those require independent review.'}
if __name__=='__main__':
 before,after,out=map(pathlib.Path,sys.argv[1:]);result=evaluate(json.loads(before.read_text()),json.loads(after.read_text()));result.update({'before_sha256':hashlib.sha256(before.read_bytes()).hexdigest(),'after_sha256':hashlib.sha256(after.read_bytes()).hexdigest()});out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'nongeometric_fields_unchanged':result['nongeometric_fields_unchanged'],'changed_paths':[x['path'] for x in result['changes']]}));sys.exit(0 if result['nongeometric_fields_unchanged'] else 1)
