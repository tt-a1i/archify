const assert = require('node:assert/strict');
const { produce } = require('../runtime/node_modules/immer');
const fresh = () => ({ user: { name: 'Lin' }, tasks: [{ title: 'Read', done: false }, { title: 'Write', done: false }] });
const identities = (base, next) => ({ root: next === base, user: next.user === base.user, tasks: next.tasks === base.tasks, firstTask: next.tasks[0] === base.tasks[0], secondTask: next.tasks[1] === base.tasks[1] });
const frozen = state => ({ root: Object.isFrozen(state), user: Object.isFrozen(state.user), tasks: Object.isFrozen(state.tasks), firstTask: Object.isFrozen(state.tasks[0]), secondTask: Object.isFrozen(state.tasks[1]) });
const recipes = {
  change_first_task: draft => { draft.tasks[0].done = true; },
  no_op: () => {},
  assign_same_value: draft => { draft.tasks[0].done = false; },
  change_user: draft => { draft.user.name = 'Mei'; },
};
const expected = {
  change_first_task: [false, true, false, false, true],
  no_op: [true, true, true, true, true],
  assign_same_value: [true, true, true, true, true],
  change_user: [false, false, true, true, true],
};
const rows = [];
for (const [id, recipe] of Object.entries(recipes)) {
  const base = fresh(), before = JSON.stringify(base), frozenBefore = frozen(base);
  const next = produce(base, recipe), sameReference = identities(base, next);
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(Object.values(sameReference), expected[id]);
  assert.equal(next.tasks[0].done, id === 'change_first_task');
  assert.equal(next.user.name, id === 'change_user' ? 'Mei' : 'Lin');
  rows.push({ id, base, next, baseValuesUnchanged: JSON.stringify(base) === before, sameReference, frozenBefore, baseFrozenAfter: frozen(base), nextFrozenAfter: frozen(next) });
}
console.log(JSON.stringify({ node: process.versions.node, immer: require('../runtime/node_modules/immer/package.json').version, scope: 'Fresh plain object/array tree per case; default autoFreeze; no plugins, aliases, cycles, external inserted objects or performance measurement.', cases: rows }, null, 2));
