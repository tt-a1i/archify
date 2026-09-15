import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKER,
  authorize,
  formatSummary,
  ghFetch,
  parseCommands,
  plan,
} from './triage-commands.mjs';

const allowlist = {
  users: ['tt-a1i', 'YunyueLi'],
  settableLabels: ['bug', 'documentation', 'duplicate', 'needs-repro', 'question', 'good first issue'],
};
const context = { actor: 'triager', issueNumber: 42, repository: 'tt-a1i/archify' };

test('parseCommands reads multiple command lines and comma-separated names', () => {
  const body = 'Looks like a renderer defect.\n/label bug, good first issue\n/unlabel question\n/needs-repro';
  assert.deepEqual(parseCommands(body), [
    { command: 'label', args: ['bug', 'good first issue'] },
    { command: 'unlabel', args: ['question'] },
    { command: 'needs-repro', args: [] },
  ]);
});

test('parseCommands ignores commands inside code fences and unknown slash lines', () => {
  const body = ['/label bug', '```sh', '/label documentation', '```', '/tmp/output.svg', '/close', '~~~', '/dup #3', '~~~'].join(
    '\n',
  );
  assert.deepEqual(parseCommands(body), [{ command: 'label', args: ['bug'] }]);
  assert.deepEqual(parseCommands('/tmp/foo\n/close\n/approve'), []);
  assert.deepEqual(parseCommands(''), []);
  assert.deepEqual(parseCommands(undefined), []);
});

test('parseCommands accepts /duplicate as an alias and keeps a number-less /dup for plan to reject', () => {
  assert.deepEqual(parseCommands('/duplicate #17'), [{ command: 'dup', args: ['#17'] }]);
  assert.deepEqual(parseCommands('/DUP 17'), [{ command: 'dup', args: ['17'] }]);
  assert.deepEqual(parseCommands('/dup'), [{ command: 'dup', args: [] }]);
  const result = plan(parseCommands('/dup'), allowlist, [], context);
  assert.deepEqual(result.add, []);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].command, '/dup');
});

test('authorize accepts allowlisted users and write collaborators, refuses read-only users and bots', () => {
  assert.equal(authorize('tt-a1i', allowlist, 'none'), true);
  assert.equal(authorize('yunyueli', allowlist, 'read'), true, 'logins compare case-insensitively');
  assert.equal(authorize('stranger', allowlist, 'write'), true);
  assert.equal(authorize('stranger', allowlist, 'admin'), true);
  assert.equal(authorize('stranger', allowlist, 'maintain'), true);
  assert.equal(authorize('stranger', allowlist, 'read'), false);
  assert.equal(authorize('stranger', allowlist, 'none'), false);
  assert.equal(authorize('tt-a1i', allowlist, 'admin', 'Bot'), false);
  assert.equal(authorize('', allowlist, 'admin'), false);
});

test('plan applies settable labels and rejects the rest with a reason', () => {
  const result = plan(parseCommands('/label bug, accepted, awaiting-author'), allowlist, [], context);
  assert.deepEqual(result.add, ['bug']);
  assert.deepEqual(result.remove, []);
  assert.deepEqual(result.rejected, [
    { command: '/label accepted', reason: 'not settable via command' },
    { command: '/label awaiting-author', reason: 'not settable via command' },
  ]);
  assert.deepEqual(result.replies, []);
});

test('plan handles /dup: adds duplicate with a reply, rejects a self-reference', () => {
  const ok = plan(parseCommands('/dup #7'), allowlist, [], context);
  assert.deepEqual(ok.add, ['duplicate']);
  assert.equal(ok.replies.length, 1);
  assert.match(ok.replies[0], /candidate duplicate of #7 by @triager/);
  assert.match(ok.replies[0], /A maintainer will confirm and close/);

  const self = plan(parseCommands('/dup #42'), allowlist, [], context);
  assert.deepEqual(self.add, []);
  assert.deepEqual(self.replies, []);
  assert.equal(self.rejected[0].command, '/dup #42');

  const junk = plan(parseCommands('/dup something'), allowlist, [], context);
  assert.deepEqual(junk.add, []);
  assert.equal(junk.rejected.length, 1);
});

test('plan handles /needs-repro with the fixed checklist reply', () => {
  const result = plan(parseCommands('/needs-repro'), allowlist, [], context);
  assert.deepEqual(result.add, ['needs-repro']);
  assert.equal(result.replies.length, 1);
  const reply = result.replies[0];
  assert.match(reply, /tt-a1i\/archify\/blob\/main\/\.github\/ISSUE_TEMPLATE\/bug-report\.yml/);
  assert.match(reply, /CONTRIBUTING\.md#local-setup-and-verification/);
  for (const phrase of ['version or commit', 'installation method', 'exact command', 'redacted typed JSON', 'receipt', 'expected behavior vs actual']) {
    assert.ok(reply.includes(phrase), `reply mentions "${phrase}"`);
  }
});

test('plan dedupes combined adds/removes and drops labels requested both ways', () => {
  const body = '/label bug, bug\n/dup #7\n/unlabel question, question\n/label documentation\n/unlabel documentation';
  const result = plan(parseCommands(body), allowlist, ['bug'], context);
  assert.deepEqual(result.add, ['duplicate'], 'bug is already present and documentation was also removed');
  assert.deepEqual(result.remove, ['question'], 'removing an absent label stays planned; DELETE 404 is ignored');
  assert.deepEqual(result.rejected, [{ command: '/label documentation', reason: 'requested both add and remove' }]);
});

test('formatSummary starts with the hidden marker and lists changes, rejections, and replies', () => {
  const result = plan(parseCommands('/label bug, accepted\n/unlabel question\n/dup #7'), allowlist, [], context);
  const summary = formatSummary('triager', result);
  assert.ok(summary.startsWith(`${MARKER}\n`));
  assert.match(summary, /- Added: `bug`, `duplicate`/);
  assert.match(summary, /- Removed: `question`/);
  assert.match(summary, /- Rejected `\/label accepted`: not settable via command/);
  assert.match(summary, /candidate duplicate of #7/);
  assert.match(formatSummary('triager', { add: [], remove: [], replies: [], rejected: [] }), /No label changes\./);
});

test('ghFetch sends GitHub headers, serialises the body, and retries once on 5xx', async () => {
  const calls = [];
  let attempt = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    attempt += 1;
    return { status: attempt === 1 ? 502 : 201, ok: attempt !== 1 };
  };
  const response = await ghFetch('https://api.github.com/x', {
    method: 'POST',
    token: 't0k3n',
    body: { labels: ['bug'] },
    fetchImpl,
  });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t0k3n');
  assert.equal(calls[0].init.headers.Accept, 'application/vnd.github+json');
  assert.ok(calls[0].init.headers['X-GitHub-Api-Version']);
  assert.equal(calls[0].init.body, '{"labels":["bug"]}');

  const once = [];
  await ghFetch('https://api.github.com/y', {
    token: 't',
    fetchImpl: async (url, init) => {
      once.push(init);
      return { status: 404, ok: false };
    },
  });
  assert.equal(once.length, 1, '4xx is not retried');
  assert.equal(once[0].body, undefined);
});
