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