# 写了 `cost`，为什么还选直达路？ {#shortest-path}

省略 `weight` 时，`shortest_path` 比较经过几条边，不读取边上的 `cost`。指定 `weight='cost'` 后，才比较 `cost` 之和。[](source:generic)

- 同一张图中，直达只经过一条边，边上的 `cost` 是 5。
- 经 B 经过两条边，边上的 `cost` 之和是 `1 + 1 = 2`。
- 指定的属性缺失时，该边在计算中按 1 计；这不表示边上存有 `cost=1`。[](source:weighted)

@answer scope="NetworkX 3.7 · 有向图 · 示例数字为构造值"
@meta locale=zh-CN
@source generic title="NetworkX 3.7 shortest_path 参数与分支" url=https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/generic.py#L43-L74
@source weighted title="NetworkX 3.7 缺失权重的默认值" url=https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/weighted.py#L41-L78
@source probe title="三节点图的固定输入与运行结果" path=source/probe-1.json

## 同一张图，两种最短标准 {#routes span=6}

图中箭头表示有向边，数字是边上边上的 `cost`。[](source:probe)

@workflow id=graph title="从 A 到 D 的有向边"
| a | A | external |
| b | B | backend |
| d | D | external |
| a > d | 5 |
| a > b | 1 |
| b > d | 1 |

| 比较什么 | 选中的路线 |
| --- | --- |
| 边数（默认） | **A → D**：只经过 1 条边；`cost` 合计 5。 |
| `cost` 总和 | **A → B → D**：`cost` 合计 **2**（1 + 1），小于直达的 5；需经过 2 条边。 |

## 怎样复现？ {#example span=6}

下面的代码使用 NetworkX 3.7。输出是节点列表。[](source:probe)

```python title="复制并运行"
import networkx as nx

G = nx.DiGraph()
G.add_edge('A', 'D', cost=5)
G.add_edge('A', 'B', cost=1)
G.add_edge('B', 'D', cost=1)

print(nx.shortest_path(G, 'A', 'D'))
print(nx.shortest_path(
    G, 'A', 'D', weight='cost'
))
```

```text title="输出"
['A', 'D']
['A', 'B', 'D']
```

## 属性名或数据缺失会怎样？ {#missing span=6}

`weight` 参数必须指向要使用的边属性。属性即使叫 `weight`，省略参数仍按边数计算。[](source:generic)

@callout level=warning title="缺失属性按 1 参与计算"
| 若指定 `weight='cost'`，但 A → D 没有 `cost`，该边的计算权重是 1；它并没有存储 `cost=1`。此时该图会选 A → D。[](source:probe) |

若图里只有 `cost`，却指定 `weight='weight'`，各边缺少所选属性，都会按 1 计。此时返回 A → D；它边上的 `cost` 仍是 5。[](source:probe)
