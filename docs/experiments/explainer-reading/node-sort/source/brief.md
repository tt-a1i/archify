# Verified Array sorting case in Node 22.23.3

Runtime: existing /Users/tsk/.local/share/archify-tuning/rounds/pr671-20261025/tools/node-v22.23.3-darwin-arm64/bin/node. It reports v22.23.3, V8 12.4.254.21-node.57, darwin/arm64. Node tag v22.23.3 resolves to 80dc632040e6bada37aac1220dde9c79581c9c22; its src/node_version.h has 22/23/3. The probe records the executable hash. This identifies the tested runtime, not a source-reproduced binary or the latest Node major.

Primary pinned implementation:
- Default comparison: https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/third_party/v8/builtins/array-sort.tq#L358-L380
- User comparison: https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/third_party/v8/builtins/array-sort.tq#L382-L394
- Array sort writes the working values back to its receiver: https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/third_party/v8/builtins/array-sort.tq#L1364-L1415
- sort returns the original object: https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/third_party/v8/builtins/array-sort.tq#L1419-L1440
- toSorted shares comparison behavior but creates a copy: https://github.com/nodejs/node/blob/80dc632040e6bada37aac1220dde9c79581c9c22/deps/v8/src/builtins/array-to-sorted.tq#L88-L130
- Normative reference (live): https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort and https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.tosorted

Own probe.mjs ran twice in separate Node processes; JSON is byte-identical. Fresh input [2,10,1] is used for each numeric case:
- sort(): result [1,10,2], original becomes [1,10,2], returned array === original true.
- sort((a,b)=>a-b): result [1,2,10], original becomes [1,2,10], returned array === original true.
- toSorted(): result [1,10,2], original remains [2,10,1], identity false.
- toSorted((a,b)=>a-b): result [1,2,10], original remains [2,10,1], identity false.
- Control with strings ['2','10','1'] and sort(): result ['1','10','2'], original reordered, identity true.
The numeric arrays' elements remain typeof 'number' after sorting. Default comparison does not permanently replace numbers with strings. String(10) < String(2) is true; 10 < 2 is false. For these digit strings, the leading '1' places '10' before '2'. Use numeric comparison for numeric ascending order in this finite-number example.

Phrase the mechanism semantically: default comparison follows string order. Do not claim V8 necessarily allocates a string per integer comparison; pinned code has a small-integer lexicographic fast path. Comparison rule and mutation/copy behavior are independent choices. toSorted alone does not make sorting numeric. No deep-copy promise: this case contains only primitive values.

Scope: ordinary dense Array, these finite numbers and simple digit strings. TypedArrays, sparse arrays, undefined/NaN, BigInt, locale collation, objects and side-effecting/inconsistent comparators are untested. No performance claim. Prefer complete runnable code with fresh arrays, actual outputs and an explicit original-array check when explaining mutation.
