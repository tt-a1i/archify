# 改一个嵌套任务后，哪些对象被共享？ {#immer-sharing}

把第一个任务的 `done` 从 `false` 改成 `true` 后，Immer 为根对象、`tasks` 数组和第一个任务创建新引用；`user` 和第二个任务仍由两个版本共享。[](source:produce)

- 原始数据的值不变；新版本的第一个任务变为 `true`。
- 共享表示 `===` 为 `true`，不是只表示内容相等。
- 默认冻结也会冻结共享对象，所以原对象的可观察状态并非完全不变。[](source:freezing)

@answer scope="Immer 11.2.9 · 普通对象和数组 · 默认 autoFreeze"
@meta locale=zh-CN style=editorial
@source produce title="Immer：使用 produce" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/produce.mdx
@source finalize title="Immer：finalize 源码" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/src/core/finalize.ts
@source freezing title="Immer：自动冻结" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/freezing.mdx
@source pitfalls title="Immer：单向树限制" url=https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/pitfalls.md

## 两个版本指向什么？ {#references}

图中每个节点代表一个对象或数组；两个根指向同一节点表示共享。箭头是属性引用，分别标出原版和新版。新旧首项的值分别为 `false` 和 `true`。

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

未修改的状态在 finalize 时返回原引用；修改过的状态返回副本。[](source:finalize)

## 怎么自己检查？ {#check}

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
  first: next.tasks[0] === base.tasks[0],
  second: next.tasks[1] === base.tasks[1],
});
console.log('首项 done:', base.tasks[0].done, '→', next.tasks[0].done);
console.log('共享对象冻结:', Object.isFrozen(base.user),
  Object.isFrozen(base.tasks[1]));
```

```text title="运行结果"
相同引用（===）: { root: false, user: true, tasks: false, first: false, second: true }
首项 done: false → true
共享对象冻结: true true
```

## 冻结与边界是什么？ {#limits}

默认自动冻结下，这个例子的新版树被冻结。共享的 `base.user` 和 `base.tasks[1]` 也因此被冻结；不要在 `produce` 外直接修改它们。[](source:freezing)

这张图展示的是不同版本之间的共享。单个输入应是单向树：同一对象不能在树中出现两次，也不能有环。[](source:pitfalls)
