# NetworkX source and actual graph

NetworkX3.7 tag commit49ca2290b80c1389eb4d8d8e49dcba73f8fec016. Isolated venv Python3.12.13. The installed three shortest-path modules byte-match the pinned files (identity.json). The main three-node DiGraph has A→D cost5, A→B cost1, B→D cost1. These are constructed numbers without physical units or performance meaning.

Pinned documentation/implementation:
- https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/generic.py#L43-L74 — shortest_path's weight parameter defaults to None; None counts each edge as one; a string selects that attribute; an absent selected attribute contributes one.
- https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/generic.py#L134-L177 — None chooses the unweighted branch; source/target uses bidirectional_shortest_path there, versus bidirectional_dijkstra for default method with a selected weight. Algorithm details need not dominate the explanation.
- https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/weighted.py#L41-L78 — selected attribute lookup uses default1 when absent.

Six probe cases in probe-1.json (probe-2.json identical):
1. Edges store cost, weight omitted: path A→D; objective1 edge; stored cost total5.
2. Same graph, weight='cost': path A→B→D; two edges; objective/stored cost total2.
3. Same graph, weight='weight' (that attribute absent): path A→D; objective1 from defaults; stored cost total5.
4. Rename stored attribute to weight, still omit parameter: path A→D; objective1 edge; stored weight total5. Merely naming the data weight does not make shortest_path read it.
5. Stored weight and parameter weight='weight': A→B→D; objective2, two edges.
6. Main cost graph, remove only direct A→D cost, request weight='cost': A→D with objective1 from the missing-attribute default. Its actual stored cost is absent, not an observed cost of1. The probe records storedAttributeTotal=null.

All graphs unchanged by queries. The graph direction is A→D/A→B/B→D only; do not imply reverse edges. Every chosen optimum is unique in these cases. No tests cover tie selection, negative weights, missing routes or performance. A small native workflow diagram may depict the graph if all three labeled directed edges remain correct. Show each route's edge count and cost under the same input, not disconnected decorative diagrams.

The complete runnable primary example is simple: import networkx as nx; create nx.DiGraph(); add the three edges with cost=5/1/1; print nx.shortest_path(G,'A','D') and nx.shortest_path(G,'A','D',weight='cost'). Expected output lines are ['A', 'D'] then ['A', 'B', 'D']. Do not claim networkx is preinstalled; scope says NetworkX3.7. Avoid an installation tutorial. Parent will execute Copy bytes in the recorded venv.
