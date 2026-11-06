import json,pathlib,copy,hashlib,os
from grading import grade_call,grade_pair
D=pathlib.Path(os.environ['REPLAY_INPUTS']);O=json.loads((D/'eval-design/frozen-oracle.json').read_text());case=O['python_function_and_callsite_cases'][0]; call=next(c for c in case['calls'] if c['target']);t=call['target'];target={'file':t['path'],'name':t['name'],'line':t['line'],'column':1}; fact={'file':case['file'],'line':call['line'],'column':call['column_utf16']+1,'endLine':call['end_line'],'endColumn':call['end_column_utf16']+1,'resolution':'imported-function','target':target};rec={'fact':fact,'targetNavigation':{'status':'valid','location':target}}; src=pathlib.Path(case['root'])/t['path'];import ast
n=next(n for n in ast.parse(src.read_text()).body if isinstance(n,ast.FunctionDef) and n.name==t['name']); funcs=[{'file':t['path'],'name':t['name'],'line':t['line'],'endLine':t['end_line'],'sourceRange':{'line':n.lineno,'column':n.col_offset+1,'endLine':n.end_lineno,'endColumn':n.end_col_offset+1,'sha256':hashlib.sha256(ast.get_source_segment(src.read_text(),n).encode()).hexdigest()}}]
def g(r):return grade_call(case,call,r,funcs)[0]
assert g([rec])=='correct-target';assert g([])=='omitted'
for mutation in ['caller_file','end_range','target_name','target_column','nav_status','nav_name','duplicate','resolution','unknown_with_target']:
 r=copy.deepcopy(rec)
 if mutation=='caller_file':r['fact']['file']='WRONG.py'
 if mutation=='end_range':r['fact']['endLine']=9999
 if mutation=='target_name':r['fact']['target']['name']='wrong'
 if mutation=='target_column':r['fact']['target']['column']=99
 if mutation=='nav_status':r['targetNavigation']['status']='changed'
 if mutation=='nav_name':r['targetNavigation']['location']['name']='wrong'
 if mutation=='resolution':r['fact']['resolution']='garbage'
 if mutation=='unknown_with_target':r['fact']['resolution']='unresolved';r['fact']['reason']='unsupported';r['targetNavigation']['status']='unresolved'
 records=[r,r] if mutation=='duplicate' else [r]
 assert g(records)=='wrong-target',mutation
m=json.loads((D/'eval-design/manifest.json').read_text());p=next(p for p in m['projects'] if p['id']=='commander');base=p['checkout_paths']['base'];head=p['checkout_paths']['head'];name='Command.hook'
def definition(root):
 lines=(pathlib.Path(root)/'lib/command.js').read_text().splitlines();a,b=401,413;source='\n'.join([lines[a-1][2:]]+lines[a:b-1]+[lines[b-1][:3]])
 return {'file':'lib/command.js','name':'hook','qualname':name,'kind':'MethodDeclaration','line':a,'column':3,'endLine':b,'endColumn':4,'textSha256':hashlib.sha256(source.encode()).hexdigest()}
items=[{'pairing':'unique-exact-source-slot','base':{'definition':definition(base)},'head':{'definition':definition(head)}}];unpaired=[]
assert grade_pair(name,items,unpaired,base,head)[0]=='correct-target';assert grade_pair(name,[],[],base,head)[0]=='omitted'
for mutation in ['kind','range','hash','duplicate']:
 y=copy.deepcopy(items)
 if mutation=='kind':y[0]['head']['definition']['kind']='Wrong'
 if mutation=='range':y[0]['head']['definition']['endLine']=999
 if mutation=='hash':y[0]['base']['definition']['textSha256']='wrong'
 if mutation=='duplicate':y.append(copy.deepcopy(y[0]))
 assert grade_pair(name,y,unpaired,base,head)[0]=='wrong-target',mutation
print('PASS valid, omitted, 9 malformed calls, 4 malformed pairs')
