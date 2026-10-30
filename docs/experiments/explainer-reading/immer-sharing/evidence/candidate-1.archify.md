# 改了一个任务，为什么 `user` 还是同一个对象？ {#immer-sharing}

在这个例子中，Immer 只为改动路径上的根对象、`tasks` 数组和第一个任务换了引用。没改动的 `user` 和第二个任务，仍是两个版本共用的同一个对象。[](source:produce)

- 原版第一个任务的 `done` 仍为 `false`，新版为 `true`。
- 共享表示 `===` 为 `true`，不是只表示内容相等。
- 默认冻结会让共享对象也被冻结；“数据值没变”不代表对象仍可直接修改。[](source:freezing)

@answer span=12 scope="Immer 11.2.9 · 普通对象和数组 · 默认 autoFreeze"
@meta locale=zh-CN style=editorial
@source produce title="Immer：使用 produce" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/produce.mdx
@source finalize title="Immer：finalize 源码" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/src/core/finalize.ts
@source freezing title="Immer：自动冻结" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/freezing.mdx
@source pitfalls title="Immer：单向树限制" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/pitfalls.md
@source probe title="四组本地实测：引用、数据值与冻结" path=source/probe-1.json
@source repeat title="第二次独立运行" path=source/probe-2.json

## 两个版本指向什么？ {#references span=6}

每个方框表示一个对象或数组，箭头表示属性引用；`0`、`1` 是数组下标。两条箭头汇入同一方框，表示它们指向同一个对象。

@architecture id=object-map title="修改第一个任务后的引用"
| base | 原版 root | external |
| next | 新版 root | frontend |
| oldtasks | 原版 tasks | external |
| newtasks | 新版 tasks | frontend |
| user | 共享 user | database |
| oldfirst | 原版首项 false | external |
| newfirst | 新版首项 true | frontend |
| second | 共享第二项 | database |
| base > oldtasks | tasks |
| next > newtasks | tasks |
| base > user | user |
| next > user | user |
| oldtasks > oldfirst | 0 |
| newtasks > newfirst | 0 |
| oldtasks > second | 1 |
| newtasks > second | 1 |

把图与实际的 `===` 结果对照：[](source:probe)

| 对照位置 | 新版与原版 |
| --- | --- |
| 根对象 | 不同对象 |
| `tasks` 数组 | 不同对象 |
| `tasks[0]` | 不同对象 |
| `user` | 同一个对象 |
| `tasks[1]` | 同一个对象 |

未修改的状态在 finalize 时返回原引用；修改过的状态返回副本。[](source:finalize)

## 怎么自己检查？ {#check span=6}

原始数据中用户是 `Lin`，任务是 `Read` 和 `Write`，两项初始 `done` 均为 `false`。以下代码使用默认配置；`false` 表示引用不同。

```js title="example.cjs"
const { produce } = require('immer');
const base = {
  user: { name: 'Lin' },
  tasks: [
    { title: 'Read', done: false },
    { title: 'Write', done: false },
  ],
};
const next = produce(base, draft => {
  draft.tasks[0].done = true;
});
console.log('相同引用（===）:', {
  root: next === base,
  user: next.user === base.user,
  tasks: next.tasks === base.tasks,
  first:
    next.tasks[0] === base.tasks[0],
  second:
    next.tasks[1] === base.tasks[1],
});
console.log(
  '首项 done:',
  base.tasks[0].done,
  '→', next.tasks[0].done,
);
console.log(
  '共享对象冻结:',
  Object.isFrozen(base.user),
  Object.isFrozen(base.tasks[1]),
);
```

引用输出与对照表一致；首项的输出是 `false → true`，两个共享对象的冻结检查均为 `true`。[](source:probe)

## 共享后还要注意什么？ {#limits span=12}

默认自动冻结下，这个例子的新版树被冻结。共享的 `base.user` 和 `base.tasks[1]` 也因此被冻结；不要在 `produce` 外直接修改它们。[](source:freezing)

空回调、把 `false` 再赋为 `false` 这两个实测对照，都返回了原根对象：`next === base` 为 `true`。[](source:probe)

这张图展示的是不同版本之间的共享。单个输入应是单向树：同一对象不能在树中出现两次，也不能有环。[](source:pitfalls)
