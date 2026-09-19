import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPython } from '../extract/py/index.mjs';
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
