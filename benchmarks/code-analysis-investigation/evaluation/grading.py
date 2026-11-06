import ast,hashlib,pathlib,re

def grade_call(case,call,records,functions):
 candidates=[r for r in records if r.get('fact',{}).get('line')==call['line'] and r.get('fact',{}).get('column')==call['column_utf16']+1]
 if not candidates:return 'omitted',None
 if len(candidates)!=1:return 'wrong-target',candidates
 rec=candidates[0]; f=rec.get('fact',{}); nav=rec.get('targetNavigation',{})
 identity={'file':case['file'],'line':call['line'],'column':call['column_utf16']+1,'endLine':call['end_line'],'endColumn':call['end_column_utf16']+1}
 if any(f.get(k)!=v for k,v in identity.items()):return 'wrong-target',rec
 if f.get('resolution')=='unresolved' and f.get('reason') and nav.get('status')=='unresolved':
  return ('explicit-unknown' if not f.get('target') and not nav.get('location') else 'wrong-target'),rec
 expected=call['target']; actual=f.get('target')
 if not expected or not isinstance(actual,dict):return ('wrong-target' if actual else 'omitted'),rec
 if f.get('resolution') not in ('same-file-function','imported-function'):return 'wrong-target',rec
 source=pathlib.Path(case['root'])/expected['path']; tree=ast.parse(source.read_text()); matches=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==expected['name']]; assert len(matches)==1
 n=matches[0];column=n.col_offset+1; endcolumn=n.end_col_offset+1
 expected_target={'file':expected['path'],'name':expected['name'],'line':expected['line'],'column':column}
 normalized_target=dict(actual)
 if f.get('resolution')=='same-file-function' and 'file' not in normalized_target:normalized_target['file']=case['file']
 if normalized_target!=expected_target:return 'wrong-target',rec
 defs=[fn for fn in functions if fn.get('file')==expected['path'] and fn.get('name')==expected['name'] and fn.get('line')==expected['line'] and fn.get('endLine')==expected['end_line']]
 if len(defs)!=1:return 'wrong-target',rec
 source_range=defs[0].get('sourceRange')
 range_expected={'line':expected['line'],'column':column,'endLine':expected['end_line'],'endColumn':endcolumn,'sha256':hashlib.sha256(ast.get_source_segment(source.read_text(),n).encode()).hexdigest()}
 if not source_range or source_range!=range_expected:return 'wrong-target',rec
 # Navigation is a separate validity gate; no credit for stale/missing or wrong location.
 if nav.get('status')!='valid' or nav.get('location')!=expected_target:return 'wrong-target',rec
 return 'correct-target',rec

def grade_pair(name,changed,unpaired,base_root,head_root,result=None):
 ranges={'Command.hook':((401,413),(401,413)),'Command._dispatchSubcommand':((1053,1062),(1053,1067)),'Command._chainOrCallSubCommandHook':(None,(1202,1212))}; br,hr=ranges[name]
 hits=[x for x in (changed if br else unpaired) if (x.get('head',{}).get('definition',{}) if br else x.get('definition',{})).get('qualname')==name]
 if not hits:return 'omitted',None
 if len(hits)!=1:return 'wrong-target',hits
 item=hits[0]
 if result is not None:
  occurrences=[x for x in changed+unpaired+result.get('positionOnlyDefinitions',{}).get('items',[]) if any(d.get('qualname')==name for d in [x.get('definition',{}),x.get('base',{}).get('definition',{}),x.get('head',{}).get('definition',{})])]
  if len(occurrences)!=1:return 'wrong-target',occurrences
  for side,record in ([('base',item.get('base',{})),('head',item.get('head',{}))] if br else [('head',item)]):
   snap=result.get('sides',{}).get(side,{}); sid=snap.get('snapshot',{}).get('snapshotId')
   if not isinstance(sid,str) or not re.fullmatch(r'[0-9a-f]{64}',sid) or record.get('snapshotId')!=sid or record.get('side')!=side or snap.get('side')!=side or snap.get('sourceIdentity')!='valid':return 'wrong-target',item
 if (br and item.get('pairing')!='unique-exact-source-slot') or (not br and (item.get('side')!='head' or item.get('reason')!='head-only')):return 'wrong-target',item
 def check(definition,root,r):
  a,b=r; lines=(pathlib.Path(root)/'lib/command.js').read_text().splitlines(); source='\n'.join([lines[a-1][2:]]+lines[a:b-1]+[lines[b-1][:3]]); want={'file':'lib/command.js','name':name.split('.')[-1],'qualname':name,'kind':'MethodDeclaration','line':a,'column':3,'endLine':b,'endColumn':4,'textSha256':hashlib.sha256(source.encode()).hexdigest()}; return all(definition.get(k)==v for k,v in want.items())
 if not check(item['head']['definition'] if br else item['definition'],head_root,hr):return 'wrong-target',item
 if br and (not check(item['base']['definition'],base_root,br) or item['base']['definition']['textSha256']==item['head']['definition']['textSha256']):return 'wrong-target',item
 return 'correct-target',item


def grade_supplemental_pair(result, project, qualname, oracle, roots):
 """Grade a single source-frozen non-TS definition, including both identities.

 The expected extent and digest come only from the pre-candidate oracle. Check
 the frozen source bytes and slice too, so stale roots cannot grant credit.
 """
 units = [u for u in oracle['units'] if u['project'] == project and u['qualname'] == qualname]
 if len(units) != 2 or {u['side'] for u in units} != {'base', 'head'}:
  raise ValueError('invalid oracle unit')
 expected = {u['side']: u for u in units}
 for side, u in expected.items():
  raw = (pathlib.Path(roots[side]) / u['file']).read_bytes()
  if u.get('source_file_sha256') and hashlib.sha256(raw).hexdigest() != u['source_file_sha256']:
   raise ValueError('source hash mismatch')
  if not u.get('absent'):
   if hashlib.sha256(u['source_text'].encode()).hexdigest() != u['definition_sha256']:
    raise ValueError('oracle text hash mismatch')
   lines = raw.decode('utf8').splitlines(keepends=True); r = u['definition_range']
   def offset(line, col):
    prefix=''.join(lines[:line-1]); s=lines[line-1]; n=col-1; used=0; chars=0
    for ch in s:
     if used == n: break
     used += len(ch.encode('utf-16-le')) // 2; chars += 1
    if used != n: raise ValueError('invalid UTF-16 source coordinate')
    return len(prefix)+chars
   text=raw.decode('utf8'); a=offset(r['line'],r['column']); b=offset(r['endLine'],r['endColumn'])
   if text[a:b] != u['source_text']: raise ValueError('oracle source slice mismatch')
 if not result: return 'omitted', None
 lists = [result.get(k, {}).get('items', []) for k in ('changedDefinitions','unpairedDefinitions','positionOnlyDefinitions')]
 def definitions(item):
  return [v for v in (item.get('definition'), item.get('base',{}).get('definition'), item.get('head',{}).get('definition')) if isinstance(v,dict)]
 hits=[item for items in lists for item in items if any(d.get('qualname') == qualname for d in definitions(item))]
 if not hits: return 'omitted', None
 if len(hits)!=1: return 'wrong-target', hits
 item=hits[0]; changed=not expected['base'].get('absent')
 if changed:
  if item not in lists[0] or item.get('pairing')!='unique-exact-source-slot': return 'wrong-target',item
  sides=[(side,item.get(side,{})) for side in ('base','head')]
 else:
  if item not in lists[1] or item.get('side')!='head' or item.get('reason')!='head-only': return 'wrong-target',item
  sides=[('head',item)]
 for side, record in sides:
  u=expected[side]; d=record.get('definition',{}); snap=result.get('sides',{}).get(side,{})
  snapshot_id=snap.get('snapshot',{}).get('snapshotId')
  if record.get('side') != side or not isinstance(snapshot_id,str) or not re.fullmatch(r'[0-9a-f]{64}', snapshot_id) or record.get('snapshotId') != snapshot_id or snap.get('side') != side or snap.get('sourceIdentity') != 'valid': return 'wrong-target',item
  name=qualname.rsplit('.',1)[-1].split('(')[0]; r=u['definition_range']
  identity={'file':u['file'],'name':name,'qualname':qualname,'kind':u['kind'],'line':u.get('identity_line',r['line']),'column':r['column'],'endLine':r['endLine'],'endColumn':r['endColumn'],'textSha256':u['definition_sha256']}
  if any(d.get(k)!=v for k,v in identity.items()): return 'wrong-target',item
  # New output keeps identity start separately from full comparison extent.
  if d.get('sourceRange') != {**r,'sha256':u['definition_sha256']}: return 'wrong-target',item
 if changed and expected['base']['definition_sha256']==expected['head']['definition_sha256']: return 'wrong-target',item
 return 'correct-target',item


def grade_outgoing(result, unit, root):
 raw=(pathlib.Path(root)/unit['file']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=unit['source_file_sha256'] or raw.decode().splitlines()[unit['line']-1].strip()!=unit['source_line']: raise ValueError('outgoing source drift')
 if not result: return 'omitted',None
 side=unit['side']; group=result.get('outgoingImports',{}).get(side,{})
 hits=[x for x in group.get('items',[]) if x.get('fact',{}).get('from')==unit['file'] and x.get('fact',{}).get('line')==unit['line'] and x.get('fact',{}).get('specifier')==unit['specifier']]
 if not hits: return 'omitted',None
 if len(hits)!=1: return 'wrong-target',hits
 rec=hits[0]; fact=rec['fact']; snap=result.get('sides',{}).get(side,{}); sid=snap.get('snapshot',{}).get('snapshotId'); nav=rec.get('targetNavigation',{})
 if not isinstance(sid,str) or not re.fullmatch(r'[0-9a-f]{64}', sid) or snap.get('side')!=side or snap.get('sourceIdentity')!='valid' or group.get('side')!=side or group.get('snapshotId')!=sid or rec.get('side')!=side or rec.get('snapshotId')!=sid or not isinstance(rec.get('factIndex'),int) or isinstance(rec.get('factIndex'),bool) or rec['factIndex']<0: return 'wrong-target',rec
 if fact.get('kind')!='static' or fact.get('resolved') is not False or bool(fact.get('lazy',False))!=unit['lazy'] or fact.get('to') is not None or nav.get('location') is not None: return 'wrong-target',rec
 if rec.get('originStatus')!='valid' or group.get('originStatus')!='valid' or nav.get('status')!='external-or-unresolved' or nav.get('reason')!='external-or-unresolved-import-destination': return 'wrong-target',rec
 return 'correct-target',rec

def grade_java_availability(result, name):
 """Grade availability only; do not infer call-target correctness from it."""
 if not result:
  return {'status':'omitted','historical_contract_result':'omitted','observed':[]}
 records=[z for key in ('changedDefinitions','unpairedDefinitions') for item in result.get(key,{}).get('items',[]) for z in ([item.get('base',{}),item.get('head',{})] if key=='changedDefinitions' else [item]) if z.get('definition',{}).get('qualname')==name]
 statuses=[z.get(k,{}) for z in records for k in ('knownReferences','unresolvedWithinSourceRange')]
 historical='explicit-unknown' if records and all(t.get('coverage')=='unavailable' and t.get('total') is None and t.get('included')==0 and t.get('omitted') is None for t in statuses) else 'wrong-target' if records else 'omitted'
 expected_sides={'base','head'} if name=='LoggerFactory.bind()' else {'head'}
 if len(records)!=len(expected_sides) or {r.get('side') for r in records}!=expected_sides:
  return {'status':'contract-violation' if records else 'omitted','historical_contract_result':historical,'observed':records}
 modes=[]
 for r in records:
  side=result.get('sides',{}).get(r['side'],{}); snap=side.get('snapshot',{}); producer=side.get('producer',{})
  recognized=(side.get('language')=='java' and snap.get('language')=='java' and isinstance(producer.get('adapter'),str) and producer['adapter'].startswith('java-parser@') and producer['adapter']==snap.get('adapter') and side.get('callModel')=='java-static-lexical-v1')
  for key in ('knownReferences','unresolvedWithinSourceRange'):
   t=r.get(key,{})
   if recognized:
    total,included,omitted,items=t.get('total'),t.get('included'),t.get('omitted'),t.get('items')
    valid=(t.get('coverage')=='available' and all(type(n) is int and n>=0 for n in (total,included,omitted)) and isinstance(items,list) and len(items)==included and included+omitted==total)
    modes.append('contract-expanded' if valid else 'contract-violation')
   else:
    valid=(t.get('coverage')=='unavailable' and t.get('total') is None and t.get('included')==0 and t.get('omitted') is None and t.get('items')==[])
    modes.append('explicit-unknown' if valid else 'contract-violation')
 status=modes[0] if modes and len(set(modes))==1 else 'contract-violation'
 return {'status':status,'historical_contract_result':historical,'observed':records}
