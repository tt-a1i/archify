from pathlib import Path
import networkx as nx,json,sys,hashlib

def graph(key='cost',missing_direct=False):
 g=nx.DiGraph();g.add_edge('A','D',**({} if missing_direct else {key:5}));g.add_edge('A','B',**{key:1});g.add_edge('B','D',**{key:1});return g

def snapshot(g):return [{'from':a,'to':b,'attributes':dict(v)} for a,b,v in g.edges(data=True)]
configs=[('cost_default','cost',None,False,['A','D'],1),('cost_requested','cost','cost',False,['A','B','D'],2),('wrong_attribute','cost','weight',False,['A','D'],1),('weight_named_but_omitted','weight',None,False,['A','D'],1),('weight_requested','weight','weight',False,['A','B','D'],2),('missing_direct_cost','cost','cost',True,['A','D'],1)]
results=[]
for name,stored_key,requested,missing,expected,length in configs:
 g=graph(stored_key,missing);before=snapshot(g);kwargs={} if requested is None else {'weight':requested};route=nx.shortest_path(g,'A','D',**kwargs);distance=nx.shortest_path_length(g,'A','D',**kwargs)
 assert route==expected,(name,route);assert distance==length,(name,distance);assert snapshot(g)==before
 declared=[g[a][b].get(stored_key) for a,b in zip(route,route[1:])]
 results.append({'name':name,'edges':before,'call':f"nx.shortest_path(G, 'A', 'D'"+(f", weight='{requested}'" if requested else '')+")",'requestedWeight':requested,'objective':'edge count' if requested is None else f"sum of {requested}; absent attributes default to 1",'path':route,'edgeCount':len(route)-1,'objectiveLength':distance,'storedAttribute':stored_key,'pathStoredValues':declared,'storedAttributeTotal':sum(declared) if all(v is not None for v in declared) else None,'graphPreserved':True})
print(json.dumps({'python':sys.version.split()[0],'networkx':nx.__version__,'scope':'six fixed directed three-node graphs/calls, positive present weights, missing-attribute default; no performance, negative-weight, tie, unreachable-node or backend comparison','cases':results},indent=2))
