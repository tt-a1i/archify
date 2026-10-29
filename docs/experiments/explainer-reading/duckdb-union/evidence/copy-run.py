import json,sys,duckdb,hashlib
from pathlib import Path
# Usage: python copy-run.py <copies.json> <probe-1.json>
captured=json.loads(Path(sys.argv[1]).read_text())
probe=json.loads(Path(sys.argv[2]).read_text())
by_sql={c['sql'].strip():c for c in probe['cases']}
assert captured['copied']==[c['text'] for c in captured['visible']]
results=[]
for sql in captured['copied']:
 expected=by_sql[sql.strip()]
 with duckdb.connect(':memory:') as con:
  cursor=con.execute(sql);rows=[list(x) for x in cursor.fetchall()];columns=[x[0] for x in cursor.description]
  assert rows==expected['rows'] and columns==expected['columns']
  results.append({'case':expected['name'],'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'columns':columns,'rows':rows})
for panel,case in [('position','position'),('by-name','by_name')]:
 table=next(t for t in captured['tables'] if t['panel']==panel)
 expected=next(c for c in probe['cases'] if c['name']==case)
 assert table['rows']==expected['rows'],(panel,table,expected)
assert len(results)==3
print(json.dumps({'duckdb':duckdb.__version__,'copiedPrograms':results,'visibleResultTablesMatchQueries':2,'clipboardBoundary':'API intercepted; OS clipboard permissions not tested'},ensure_ascii=False,indent=2))
