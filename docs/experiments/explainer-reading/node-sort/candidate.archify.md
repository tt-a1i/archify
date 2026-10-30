# 为什么 `sort()` 把 10 排在 2 前面？ {#sort-numbers}

默认排序按字符串顺序比较，所以 `10` 排在 `2` 前。要按数值升序，传入 `(a, b) => a - b`。[](source:spec-sort)

- 数组里的元素仍是数字；比较规则不会把它们永久替换成字符串。[](source:v8-default)
- `sort` 修改原数组；`toSorted` 返回新数组，但默认比较规则相同。[](source:v8-copy)

@answer span=12 scope="普通稠密 Array · 示例为有限数字与简单数字字符串 · Node 22.23.3"
@meta locale=zh-CN style=editorial
@source spec-sort title="ECMAScript: Array.prototype.sort" url=https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort
@source spec-copy title="ECMAScript: Array.prototype.toSorted" url=https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.tosorted
@source v8-default title="Node 22.23.3 中 V8 的默认比较" url=https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/third_party/v8/builtins/array-sort.tq#L358-L380
@source v8-copy title="Node 22.23.3 中 V8 的 toSorted" url=https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/src/builtins/array-to-sorted.tq#L88-L130

@source probe title="本地探针：五组排序结果与原数组" path=source/probe-1.json
@source repeated title="第二次独立运行" path=source/probe-2.json

## 先分清两个选择 {#choices span=6}

每格都从新的 `[2, 10, 1]` 开始。行区分比较规则，列区分是否修改原数组。四格都显示返回的结果。[](source:probe)

| 比较规则 | `sort` | `toSorted` |
| --- | --- | --- |
| 默认 | `[1, 10, 2]` | `[1, 10, 2]` |
| 数值升序 | `[1, 2, 10]` | `[1, 2, 10]` |

`sort` 修改并返回原数组本身；`toSorted` 保留原数组，返回新数组。因此只换成 `toSorted()`，不会得到数值升序。

## 为什么是这个顺序？ {#why span=6}

默认比较看的是字符串顺序。`String(10)` 是 `"10"`，`String(2)` 是 `"2"`；比较首位时，`"1"` 排在 `"2"` 前。数值比较则是 `10 > 2`。[](source:v8-default)

同样，字符串数组 `["2", "10", "1"]` 默认排序后是 `["1", "10", "2"]`。数字数组的结果写作 `[1, 10, 2]`：其中每个元素的类型仍是 `number`。

## 自己运行，检查结果和原数组 {#run span=12}

下面每次调用都创建新数组，输出排序结果、调用后的原数组，以及返回值是否就是原数组。最后一行检查默认排序后元素的类型。

```js title="Node 22.23.3：四种组合"
const cases = [
  ["sort 默认", a => a.sort()],
  ["sort 数值",
    a => a.sort((x, y) => x - y)],
  ["toSorted 默认", a => a.toSorted()],
  ["toSorted 数值",
    a => a.toSorted((x, y) => x - y)],
];
for (const [name, run] of cases) {
  const original = [2, 10, 1];
  const result = run(original);
  console.log(
    name,
    JSON.stringify(result),
    JSON.stringify(original),
    result === original
  );
}
console.log(
  "类型",
  [2, 10, 1].sort()
    .map(x => typeof x).join(",")
);
```

```text title="实际输出：名称 / 结果 / 原数组 / 是否同一个数组"
sort 默认 [1,10,2] [1,10,2] true
sort 数值 [1,2,10] [1,2,10] true
toSorted 默认 [1,10,2] [2,10,1] false
toSorted 数值 [1,2,10] [2,10,1] false
类型 number,number,number
```

@callout level=note title="适用范围"
| 这里的减法比较器用于示例中的有限数字。稀疏数组、`undefined`、`NaN`、对象和其他特殊情况不在本例范围内。 |
