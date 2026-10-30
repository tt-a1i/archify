const cases = [
  ["sort 默认", a => a.sort()],
  ["sort 数值", a => a.sort((x, y) => x - y)],
  ["toSorted 默认", a => a.toSorted()],
  ["toSorted 数值", a => a.toSorted((x, y) => x - y)],
];
for (const [name, run] of cases) {
  const original = [2, 10, 1];
  const result = run(original);
  console.log(name, JSON.stringify(result), JSON.stringify(original), result === original);
}
console.log("类型", [2, 10, 1].sort().map(x => typeof x).join(","));