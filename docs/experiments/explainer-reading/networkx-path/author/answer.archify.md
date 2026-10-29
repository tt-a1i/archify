# 为什么 shortest_path 会选存储成本更高的路线？ {#shortest-path}

默认调用按边数选最短路径，不读取边上存储的 `cost`。指定 `weight='cost'` 后，才按 `cost` 之和选择。[](source:generic)

- 同一张图中，直达只经过一条边，存储的 `cost` 是 5。
- 经 B 经过两条边，存储的 `cost` 之和是 `1 + 1 = 2`。
- 指定的属性缺失时，该边在计算中按 1 计；这不表示边上存有成本 1。[](source:weighted)

@answer scope="NetworkX 3.7 · 有向图 · 示例数字为构造值"
@meta locale=zh-CN
@source generic title="NetworkX 3.7 shortest_path 参数与分支" url=https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/generic.py#L43-L74
@source weighted title="NetworkX 3.7 缺失权重的默认值" url=https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/weighted.py#L41-L78
@source probe title="三节点图的固定输入与运行结果" path=probe-1.json

## 同一张图，两种最短标准 {#routes}

图中箭头表示有向边，数字是边上存储的 `cost`。[](source:probe)

@workflow id=graph title="从 A 到 D 的有向边"
| a | A | external |
| b | B | backend |
| d | D | external |
| a > d | cost=5 |
| a > b | cost=1 |
| b > d | cost=1 |

| 路线 | 边数 | 存储的 cost 之和 |
| --- | --- | --- |
| A → D | 1 | 5 |
| A → B → D | 2 | 2 |

| 调用 | 优化目标 | 返回路线 |
| --- | --- | --- |
| `shortest_path(G, 'A', 'D')` | 边数 | A → D |
| `shortest_path(G, 'A', 'D', weight='cost')` | `cost` 之和 | A → B → D |

## 怎样复现？ {#example}

下面的代码使用 NetworkX 3.7。输出是节点列表。[](source:probe)

```python title="复制并运行"
import networkx as nx

G = nx.DiGraph()
G.add_edge('A', 'D', cost=5)
G.add_edge('A', 'B', cost=1)
G.add_edge('B', 'D', cost=1)

print(nx.shortest_path(G, 'A', 'D'))
print(nx.shortest_path(G, 'A', 'D', weight='cost'))
```

```text title="输出"
['A', 'D']
['A', 'B', 'D']
```

## 属性名或数据缺失会怎样？ {#missing}

`weight` 参数必须指向要使用的边属性。属性即使叫 `weight`，省略参数仍按边数计算。[](source:generic)

@callout level=warning title="缺失属性按 1 参与计算"
| 若指定 `weight='cost'`，但 A → D 没有 `cost`，该边的计算权重是 1；它并没有存储 `cost=1`。此时该图会选 A → D。[](source:probe) |

若图里只有 `cost`，却指定 `weight='weight'`，各边缺少所选属性，都会按 1 计。此时返回 A → D；它存储的 `cost` 仍是 5。[](source:probe)
