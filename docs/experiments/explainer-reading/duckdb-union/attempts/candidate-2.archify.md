# 为什么城市跑进了姓名列？ {#union-alignment}

`UNION ALL` 按位置对齐：第二个查询把城市 `Rome` 放在第一列，它就进了结果的姓名列。把两边的列顺序写成一致，或使用 `UNION ALL BY NAME` 按列名匹配，都能修正这个例子。[](source:probe)

- 下面的 `person` 是姓名，`city` 是城市；两个列都是文本，所以错位也能执行。
- `BY NAME` 决定怎样对齐列；`ALL` 决定是否保留重复行。[](source:tests)[](source:unique)

@answer span=12 scope="DuckDB 2.0.0 · 合成数据 · 两个文本列"
@meta locale=zh-CN style=editorial
@source probe title="七组查询的实际运行结果" path=source/probe-1.json
@source docs title="DuckDB：集合操作" url=https://duckdb.org/docs/current/sql/query_syntax/setops
@source tests title="DuckDB 2.0.0：按名称拼接测试" url=https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_all_by_name.test
@source unique title="DuckDB 2.0.0：去重测试" url=https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_by_name.test

## 按位置：城市落进姓名列 {#position span=6}

```sql title="按位置拼接"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL
SELECT 'Rome' AS city, 'Bob' AS person
ORDER BY person, city;
```

实际结果：

| person（姓名） | city（城市） |
| --- | --- |
| Alice | Paris |
| Rome | Bob |

结果列名由第一个查询决定。第二个查询虽然把 `Rome` 标为 `city`，它仍是第一列的值，便填进 `person`；`Bob` 则填进第二列。[](source:docs)[](source:probe)

## 按列名：姓名归姓名，城市归城市 {#by-name span=6}

```sql title="按名称匹配"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL BY NAME
SELECT 'Rome' AS city, 'Bob' AS person
ORDER BY person, city;
```

实际结果：

| person（姓名） | city（城市） |
| --- | --- |
| Alice | Paris |
| Bob | Rome |

第二个查询的列顺序没有改。`BY NAME` 把名为 `person` 的值放进 `person`，名为 `city` 的值放进 `city`。[](source:probe)

## 也可以先把两边的列顺序写一致 {#explicit-order span=6}

能控制查询时，两边都先写姓名、再写城市，普通 `UNION ALL` 也能得到 `Alice / Paris` 和 `Bob / Rome`：

```sql title="显式统一顺序"
SELECT 'Alice' AS person, 'Paris' AS city
UNION ALL
SELECT 'Bob' AS person, 'Rome' AS city
ORDER BY person, city;
```

这三条完整查询都带 `ORDER BY`，用于固定这里展示的行顺序。拼接本身不保证顺序。[](source:probe)

## 缺列与重复行，要分别决定 {#exceptions span=6}

**缺列。** 如果第二个查询只有 `SELECT 'Bob' AS person`，按名称拼接会为该行的 `city` 填入 SQL `NULL`。Bob 这一行仍然保留；`NULL` 是空值，不是空字符串。普通 `UNION ALL` 要求两边列数相同，此例会报错。[](source:probe)

**重复行。** 两个查询都给出 `Alice / Paris` 时：

| 写法 | 实际保留的行数 |
| --- | --- |
| `UNION BY NAME` | 1 行 |
| `UNION ALL BY NAME` | 2 行 |

两种写法都按名称对齐；加上 `ALL`，重复行也保留。选择前分别确认列的含义、缺列是否允许，以及重复行是否需要留下。[](source:unique)[](source:probe)
