import networkx as nx
G = nx.DiGraph()
G.add_edge('A', 'D', cost=5)
G.add_edge('A', 'B', cost=1)
G.add_edge('B', 'D', cost=1)
print(nx.shortest_path(G, 'A', 'D'))
print(nx.shortest_path(G, 'A', 'D', weight='cost'))
