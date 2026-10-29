import json,sys,duckdb
prefix="SELECT 'Alice' AS person, 'Paris' AS city"
queries=[
 ('position',prefix+"\nUNION ALL\nSELECT 'Rome' AS city, 'Bob' AS person\nORDER BY person, city;",[['Alice','Paris'],['Rome','Bob']]),
 ('by_name',prefix+"\nUNION ALL BY NAME\nSELECT 'Rome' AS city, 'Bob' AS person\nORDER BY person, city;",[['Alice','Paris'],['Bob','Rome']]),
 ('explicit_order',prefix+"\nUNION ALL\nSELECT 'Bob' AS person, 'Rome' AS city\nORDER BY person, city;",[['Alice','Paris'],['Bob','Rome']]),
 ('missing_by_name',prefix+"\nUNION ALL BY NAME\nSELECT 'Bob' AS person\nORDER BY person, city;",[['Alice','Paris'],['Bob',None]]),
 ('missing_position',prefix+"\nUNION ALL\nSELECT 'Bob' AS person;",None),
 ('duplicate_by_name',prefix+"\nUNION BY NAME\nSELECT 'Paris' AS city, 'Alice' AS person\nORDER BY person, city;",[['Alice','Paris']]),
 ('duplicate_all_by_name',prefix+"\nUNION ALL BY NAME\nSELECT 'Paris' AS city, 'Alice' AS person\nORDER BY person, city;",[['Alice','Paris'],['Alice','Paris']]),
]
results=[]
for name,sql,expected in queries:
 with duckdb.connect(':memory:') as con:
  try:
   cursor=con.execute(sql);columns=[d[0] for d in cursor.description];rows=[list(r) for r in cursor.fetchall()]
   assert expected is not None and rows==expected,(name,rows,expected)
   assert columns==['person','city'],columns
   results.append({'name':name,'sql':sql,'columns':columns,'rows':rows,'expected':expected,'passed':True})
  except duckdb.BinderException as e:
   assert expected is None and 'same number of result columns' in str(e),(name,str(e))
   results.append({'name':name,'sql':sql,'errorType':type(e).__name__,'error':str(e),'passed':True})
print(json.dumps({'python':sys.version.split()[0],'duckdb':duckdb.__version__,'gitRevisionReported':duckdb.__git_revision__,'cases':results},ensure_ascii=False,indent=2))
