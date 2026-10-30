const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = __dirname;
const actualRequire = createRequire(root + '/runtime/package.json');
const probe = JSON.parse(fs.readFileSync(root + '/source/probe-1.json', 'utf8')).cases[0];
const expected = [
  ['相同引用（===）:', { root: probe.sameReference.root, user: probe.sameReference.user, tasks: probe.sameReference.tasks, first: probe.sameReference.firstTask, second: probe.sameReference.secondTask }],
  ['首项 done:', probe.base.tasks[0].done, '→', probe.next.tasks[0].done],
  ['共享对象冻结:', probe.baseFrozenAfter.user, probe.baseFrozenAfter.secondTask],
];
const rows = [];
for (const arm of ['author', 'candidate-1']) {
  const code = fs.readFileSync(root + '/' + arm + '-copied.cjs', 'utf8');
  const captured = [];
  vm.runInNewContext(code, { require: actualRequire, console: { log: (...args) => captured.push(args) } });
  assert.deepEqual(JSON.parse(JSON.stringify(captured)), expected);
  const stdout = execFileSync(process.execPath, [root + '/' + arm + '-copied.cjs'], { env: { ...process.env, NODE_PATH: root + '/runtime/node_modules' }, encoding: 'utf8' });
  fs.writeFileSync(root + '/' + arm + '-copy-stdout.txt', stdout);
  rows.push({ arm, codeSha256: crypto.createHash('sha256').update(code).digest('hex'), capturedMatchesActualProbe: true, stdout });
}
assert.equal(rows[0].stdout, rows[1].stdout);
fs.writeFileSync(root + '/copy-verification.json', JSON.stringify({ rows, stdoutIdentical: true, scope: 'Actual Copy API payloads executed as unmodified CommonJS files. Separate VM console capture checks arguments against real probe. Code reflow and optional trailing commas, no AST equality claim. OS clipboard permissions not tested.' }, null, 2) + '\n');
console.log({ copies: rows.length, stdoutIdentical: true, captureMatchesProbe: true });
