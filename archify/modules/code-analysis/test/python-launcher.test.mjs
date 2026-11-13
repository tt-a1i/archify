import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPython } from '../extract/py/index.mjs';
import { runPythonFixture } from './helpers.mjs';

test('fixture selection rejects older Python and preserves py launcher arguments', () => {
  const calls = [];
  const result = runPythonFixture('fixture-root', 'fixture code', [['2.7'], ['3.7'], ['py', '-3']], (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args.includes('fixture code')) return { status: 0, stdout: 'ok' };
    assert.equal(args.at(-1), 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)');
    return { status: cmd === 'py' ? 0 : 1 };
  });
  assert.equal(result.stdout, 'ok');
  assert.deepEqual(calls.map(call => call.cmd), ['2.7', '3.7', 'py', 'py']);
  assert.deepEqual(calls[2].args.slice(0, 2), ['-3', '-c']);
  assert.deepEqual(calls[3].args, ['-3', '-c', 'fixture code']);
  assert.equal(calls[3].options.timeout, 10000);
  assert.equal(calls[3].options.cwd, 'fixture-root');
});

test('fixture failure is returned without trying another interpreter', () => {
  const calls = [];
  const result = runPythonFixture('root', 'fixture', [['python'], ['other']], (cmd) => {
    calls.push(cmd);
    return { status: calls.length === 1 ? 0 : 42 };
  });
  assert.equal(result.status, 42);
  assert.deepEqual(calls, ['python', 'python']);
});
test('Python selection skips incompatible and broken launchers', () => {
  const calls = [];
  const result = runPython({}, [['old', []], ['broken', []], ['py', ['-3']]], (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'old') return { status: 1 };
    if (cmd === 'broken') return { error: { code: 'ENOENT' } };
    return { status: 0, stdout: args.includes('-c') ? '' : '{"files":[]}' };
  });
  assert.equal(result.command, 'py');
  assert.deepEqual(result.output, { files: [] });
  assert.equal(calls.length, 4);
  assert.equal(calls[3][1][0], '-3');
});
test('compatible Python extractor errors are reported without fallback', () => {
  let calls = 0;
  assert.throws(() => runPython({}, [['py', []], ['other', []]], () => {
    calls++;
    return calls === 1 ? { status: 0 } : { status: 1, stderr: 'extractor failed' };
  }), error => error.diagnostics[0].code === 'extract/python-failed');
  assert.equal(calls, 2);
});
