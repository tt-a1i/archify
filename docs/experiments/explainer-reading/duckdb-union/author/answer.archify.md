# 为什么 UNION ALL 把城市放进姓名列？ {#union-alignment}

普通 `UNION ALL` 按列的位置拼接，而不是按别名匹配。第二个查询把城市放在第一列，所以 `Rome` 出现在结果的 `person` 列。[](source:probe)

- 结果列名取自第一个查询；第二个查询的列名不会改变位置匹配。[](source:docs)
- 调整第二个查询的列顺序，或使用 `UNION ALL BY NAME`，都能修正这个例子。[](source:probe)
- `BY NAME` 决定列如何匹配；`ALL` 决定是否保留重复行。[](source:tests)

@answer scope="DuckDB 2.0.0 · 独立查询 · 两个文本列"
@meta locale=zh-CN style=editorial
@source probe title="本地运行结果：七个合成数据案例" path=probe-1.json
@source docs title="DuckDB 集合操作文档" url=https://duckdb.org/docs/current/sql/query_syntax/setops
@source tests title="DuckDB 固定版本：按名称拼接测试" url=https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_all_by_name.test
@source unique title="DuckDB 固定版本：去重测试" url=https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_by_name.test

## 第二行为什么错位？ {#position}

```sql title="按位置拼接"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL
SELECT 'Rome' AS city, 'Bob' AS person
ORDER BY person, city;
```

| 位置 | 第一查询：结果列名 | 第二查询：送入的值 |
| --- | --- | --- |
| 第 1 列 | `person` | `Rome`，原别名为 `city` |
| 第 2 列 | `city` | `Bob`，原别名为 `person` |

实际结果是 `Alice / Paris` 和 `Rome / Bob`。两个值都是文本，因此这个例子没有因类型转换报错。`ORDER BY` 固定此处展示的顺序；拼接本身不保证顺序。[](source:probe)

## 如何修正列对齐？ {#fix}

如果能控制每个查询的列顺序，让两边都先选 `person`，再选 `city`：

```sql title="显式统一顺序"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL
SELECT 'Bob' AS person, 'Rome' AS city
ORDER BY person, city;
```

如果列的顺序可能不同，但名称可靠，可以按名称匹配：

```sql title="按名称匹配"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL BY NAME
SELECT 'Rome' AS city, 'Bob' AS person
ORDER BY person, city;
```

两条查询的实际结果都是 `Alice / Paris` 和 `Bob / Rome`。[](source:probe)

## 缺列和重复行如何处理？ {#exceptions}

按名称匹配时，某个查询缺少的列会填入 SQL `NULL`。例如第二个查询只选 `Bob AS person` 时，该行的 `city` 是 `NULL`，并非空字符串，也不是被删掉的行。普通 `UNION ALL` 则要求列数一致；这个缺列例子会报错。[](source:probe)

| 选择 | 两边都有 Alice / Paris 时 | 列匹配方式 |
| --- | --- | --- |
| `UNION BY NAME` | 一行 | 按名称 |
| `UNION ALL BY NAME` | 两行 | 按名称 |

去重和列匹配是两个独立决定。[](source:unique)[](source:probe)

## 执行前检查什么？ {#check}

- [ ] 普通 `UNION ALL`：逐列核对位置和含义。
- [ ] 使用 `BY NAME`：核对名称，并确认缺列填 `NULL` 是否符合需求。
- [ ] 决定是否保留重复行；需要保留时使用 `ALL`。
- [ ] 如果需要稳定顺序，在最终结果上写 `ORDER BY`。
