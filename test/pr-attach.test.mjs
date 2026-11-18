import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_ATTACHMENTS, attachPrPack, extractAssetUrls, markdownDestination, parseGhVersion, parsePullRequest, portableAttachmentPath, supportsAttach } from '../archify/pr/attach.mjs';
import { PACK_END, PACK_START, locatePackBlock, sha256 } from '../archify/pr/markdown.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const PICTURE_LINE = /^<a href="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"><picture><source media="\(prefers-color-scheme: dark\)" srcset="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"><img alt="[^"]+" src="\1"><\/picture><\/a>$/;

function svg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${label}</text></svg>`;
}

// Writes a build receipt the way `archify pr build` lays it out.
function receiptFixture({ views = ['topology', 'flow'], bytes, revisions, prefix = 'archify-pr-attach-' } = {}) {
  const dir = createScratchDirectory(path.join(os.tmpdir(), prefix));
  const viewsDir = path.join(dir, 'views');
  fs.mkdirSync(viewsDir);
  const assets = [];
  const lines = [PACK_START, '## Ledger rollout', ''];
  for (const view of views) {
    for (const theme of ['light', 'dark']) {
      const file = path.join(viewsDir, `${view}-${theme}.svg`);
      fs.writeFileSync(file, bytes ? Buffer.alloc(bytes, 0x20) : svg(`${view}-${theme}`));
      assets.push({ id: `${view}-${theme}`, view, theme, path: file, placeholder: `{{archify:asset:${view}-${theme}}}` });
    }
    lines.push(`### ${view}`, '', `<a href="{{archify:asset:${view}-light}}"><picture><source media="(prefers-color-scheme: dark)" srcset="{{archify:asset:${view}-dark}}"><img alt="${view}" src="{{archify:asset:${view}-light}}"></picture></a>`, '');
  }
  lines.push(PACK_END);
  const markdown = lines.join('\n');
  const markdownPath = path.join(dir, 'pr-pack.md');
  fs.writeFileSync(markdownPath, `${markdown}\n`);
  const receipt = { schemaVersion: 1, ok: true, command: 'pr build', kind: 'pr-pack-receipt', revisions, markdown: { path: markdownPath, sha256: sha256(markdown) }, assets };
  const receiptPath = path.join(dir, 'pr-pack.receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  return { dir, receiptPath, markdown, assets };
}

// Scripted gh: models the one behaviour that matters, `--attach` rewriting
// Markdown image references to user-attachments URLs and nothing else.
function fakeGh({ body = '', comments = [], headRefOid = 'a'.repeat(40), version = '2.99.0', auth = true, rewrite = (token) => `https://github.com/user-attachments/assets/${token.replace(/[^a-z0-9]/gi, '')}`, fail = {} } = {}) {
  const state = { body, comments: comments.map((comment) => ({ ...comment })), calls: [], nextComment: 900 };
  const rewriteMarkdown = (text) => text.replace(/!\[([^\]]+)\]\((<[^>]*>|[^)]+)\)/g, (match, token, raw) => {
    const file = raw.startsWith('<') ? raw.slice(1, -1) : raw;
    if (!fs.existsSync(file)) return match;
    const url = rewrite(token, file);
    return url ? `![${token}](${url})` : match;
  });
  const gh = ({ args, input }) => {
    state.calls.push({ args: [...args], input });
    const key = args.slice(0, 2).join(' ');
    if (fail[key]) return { status: 1, stdout: '', stderr: `scripted failure for ${key}` };
    if (args[0] === '--version') return { status: 0, stdout: `gh version ${version} (2026-01-01)\n`, stderr: '' };
    if (key === 'auth status') return auth ? { status: 0, stdout: 'Logged in\n', stderr: '' } : { status: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts.' };
    if (key === 'pr view') {
      const fields = args[args.indexOf('--json') + 1].split(',');
      const full = { number: 42, headRefOid, url: 'https://github.com/acme/checkout/pull/42', body: state.body, comments: state.comments.map(({ id, url, body: commentBody }) => ({ id: `IC_${id}`, url, body: commentBody })) };
      return { status: 0, stdout: JSON.stringify(Object.fromEntries(fields.map((field) => [field, full[field]]))), stderr: '' };
    }
    if (key === 'pr edit') {
      const attached = args.includes('--attach');
      state.body = attached ? rewriteMarkdown(input) : input;
      return { status: 0, stdout: 'https://github.com/acme/checkout/pull/42\n', stderr: '' };
    }
    if (key === 'pr comment') {
      const id = state.nextComment += 1;
      const url = `https://github.com/acme/checkout/pull/42#issuecomment-${id}`;
      state.comments.push({ id, url, body: args.includes('--attach') ? rewriteMarkdown(input) : input });
      return { status: 0, stdout: `${url}\n`, stderr: '' };
    }
    if (args[0] === 'api') {
      const method = args[args.indexOf('-X') + 1];
      const route = args[args.indexOf('-X') + 2];
      const id = Number(/comments\/(\d+)$/.exec(route)?.[1]);
      const comment = state.comments.find((entry) => entry.id === id);
      if (!comment) return { status: 1, stdout: '', stderr: 'HTTP 404' };
      if (method === 'GET') return { status: 0, stdout: JSON.stringify({ id, body: comment.body }), stderr: '' };
      if (method === 'PATCH') {
        comment.body = JSON.parse(input).body;
        return { status: 0, stdout: JSON.stringify({ id }), stderr: '' };
      }
      if (method === 'DELETE') {
        state.comments = state.comments.filter((entry) => entry.id !== id);
        return { status: 0, stdout: '', stderr: '' };
      }
    }
    return { status: 1, stdout: '', stderr: `unexpected gh ${args.join(' ')}` };
  };
  return { gh, state };
}

const HAND_WRITTEN = '## Why\n\nHand-written motivation.\n\n- [ ] migrate\n- [x] tests\n';

test('attachment paths become CommonMark-safe destinations without losing their Windows spelling', () => {
  assert.equal(markdownDestination('out/flow-dark.svg'), 'out/flow-dark.svg');
  assert.equal(markdownDestination('C:\\repo\\out\\flow-dark.svg'), 'C:/repo/out/flow-dark.svg');
  assert.equal(markdownDestination('out/my pack/flow (dark).svg'), '<out/my pack/flow (dark).svg>');
  assert.equal(markdownDestination('C:\\repo\\my pack\\flow.svg'), '<C:/repo/my pack/flow.svg>');
  assert.equal(portableAttachmentPath('\\\\server\\share\\flow.svg'), '//server/share/flow.svg');
});

test('attach keeps a spaced attachment path as one reference from upload through mapping', async () => {
  const { receiptPath, assets } = receiptFixture({ prefix: 'archify pr attach space-' });
  assert.ok(assets.every((asset) => asset.path.includes(' ')), 'fixture paths contain a space');
  const { gh, state } = fakeGh({ body: HAND_WRITTEN });
  const result = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  assert.equal(result.ok, true);
  const upload = state.calls.find((call) => call.args.includes('--attach'));
  assert.match(upload.input, /!\[archify-asset-0:[a-f0-9]{16}\]\(<[^>]*topology-light\.svg>\)/);
  assert.ok(upload.args.filter((arg, index) => upload.args[index - 1] === '--attach').every((arg) => !arg.startsWith('<')), '--attach receives the bare path');
  for (const asset of assets) assert.match(result.assets[asset.path], /^https:\/\/github\.com\/user-attachments\/assets\//);
});

test('attach --dry-run runs the preflight only and previews the final layout without writing', async () => {
  const { receiptPath, assets } = receiptFixture();
  const { gh, state } = fakeGh({ body: HAND_WRITTEN });
  const result = await attachPrPack({ pullRequest: 'https://github.com/acme/checkout/pull/42', receipt: receiptPath, dryRun: true, gh });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.repo, 'acme/checkout');
  assert.deepEqual(result.pullRequest, { number: 42, url: 'https://github.com/acme/checkout/pull/42' });
  assert.equal(result.attachments.length, 4);
  assert.match(result.attachments[0].token, /^archify-asset-0:[a-f0-9]{16}$/);
  assert.deepEqual(result.steps.map((step) => step.action), ['preflight', 'read-target', 'skipped', 'skipped']);
  assert.deepEqual(Object.values(result.assets), [null, null, null, null]);
  assert.match(result.markdown.preview, /<user-attachments:topology-dark>/);
  assert.equal(state.body, HAND_WRITTEN);
  assert.deepEqual(state.calls.map((call) => call.args.slice(0, 2).join(' ')), ['--version', 'auth status', 'pr view']);
  assert.ok(assets.every((asset) => fs.existsSync(asset.path)));
});

test('attach --target body uploads through Markdown tokens, maps every asset and writes one-line pictures inside the anchors', async () => {
  const { receiptPath, assets } = receiptFixture();
  const { gh, state } = fakeGh({ body: HAND_WRITTEN });
  const result = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  assert.equal(result.ok, true);
  assert.equal(result.comment, null);
  assert.deepEqual(result.steps.map((step) => step.action), ['preflight', 'read-target', 'upload', 'write']);
  assert.equal(Object.keys(result.assets).length, 4);
  for (const asset of assets) assert.match(result.assets[asset.path], /^https:\/\/github\.com\/user-attachments\/assets\//);
  const upload = state.calls.find((call) => call.args.includes('--attach'));
  assert.equal(upload.args.filter((arg) => arg === '--attach').length, 4);
  assert.match(upload.input, /!\[archify-asset-0:[a-f0-9]{16}\]\(.*topology-light\.svg\)/);
  assert.ok(upload.input.startsWith(HAND_WRITTEN.trimEnd()), 'staged body keeps the hand-written text');
  assert.ok(state.body.startsWith(HAND_WRITTEN.trimEnd()));
  assert.doesNotMatch(state.body, /archify-asset-|\{\{archify:asset/);
  const block = locatePackBlock(state.body);
  const pictures = state.body.slice(block.start, block.end).split('\n').filter((line) => line.startsWith('<a href='));
  assert.equal(pictures.length, 2);
  for (const line of pictures) assert.match(line, PICTURE_LINE);
  assert.equal(result.markdown.sha256, sha256(state.body.slice(block.start, block.end)));
  assert.equal(result.markdown.bodySha256, sha256(state.body));

  // Re-running replaces only the anchored block; the hand-written body survives byte for byte.
  const rerun = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  assert.equal(rerun.ok, true);
  assert.equal(state.body.split(PACK_START).length, 2);
  assert.equal(state.body.split(PACK_END).length, 2);
  assert.ok(state.body.startsWith(HAND_WRITTEN.trimEnd()));
  assert.equal(state.body.slice(locatePackBlock(state.body).end), '\n');
});

test('attach restores the original body when the upload rewrites only part of the tokens', async () => {
  const { receiptPath } = receiptFixture();
  const original = `${HAND_WRITTEN}\n${PACK_START}\nprevious pack\n${PACK_END}\n\nReviewer notes below.\n`;
  const { gh, state } = fakeGh({ body: original, rewrite: (token) => (token.startsWith('archify-asset-3:') ? null : `https://github.com/user-attachments/assets/${token.replace(/[^a-z0-9]/gi, '')}`) });
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh }), (error) => {
    assert.equal(error.code, 'pr-attach/asset-mapping-incomplete');
    assert.equal(error.stage, 'map');
    assert.deepEqual(error.diagnostics[0].evidence.missing, ['flow-dark']);
    assert.deepEqual(error.rollback, { restored: true, status: 0, stderr: '' });
    return true;
  });
  assert.equal(state.body, original);
  const edits = state.calls.filter((call) => call.args.slice(0, 2).join(' ') === 'pr edit');
  assert.equal(edits.length, 2);
  assert.equal(edits[1].input, original);
  assert.equal(edits[1].args.includes('--attach'), false);
});

test('attach restores the body when the final write fails, and never edits when the upload itself fails', async () => {
  const { receiptPath } = receiptFixture();
  let edits = 0;
  const base = fakeGh({ body: HAND_WRITTEN });
  const gh = (call) => {
    if (call.args.slice(0, 2).join(' ') === 'pr edit' && !call.args.includes('--attach')) {
      edits += 1;
      if (edits === 1) return { status: 1, stdout: '', stderr: 'HTTP 502' };
    }
    return base.gh(call);
  };
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh }), (error) => {
    assert.equal(error.code, 'pr-attach/write-failed');
    assert.equal(error.rollback.restored, true);
    return true;
  });
  assert.equal(base.state.body, HAND_WRITTEN);

  const failing = fakeGh({ body: HAND_WRITTEN, fail: { 'pr edit': true } });
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh: failing.gh }), (error) => {
    assert.equal(error.code, 'pr-attach/upload-failed');
    assert.equal(error.stage, 'upload');
    return true;
  });
  assert.equal(failing.state.body, HAND_WRITTEN);
});

test('attach --target comment creates a sticky comment, then updates it in place on re-runs', async () => {
  const { receiptPath } = receiptFixture();
  const { gh, state } = fakeGh({ body: HAND_WRITTEN, comments: [{ id: 7, url: 'https://github.com/acme/checkout/pull/42#issuecomment-7', body: 'LGTM from a human' }] });
  const first = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, target: 'comment', gh });
  assert.equal(first.ok, true);
  assert.equal(first.comment.id, 901);
  assert.equal(state.comments.length, 2);
  assert.equal(state.comments[0].body, 'LGTM from a human');
  assert.equal(state.body, HAND_WRITTEN);
  const sticky = state.comments[1];
  assert.ok(sticky.body.startsWith(PACK_START));
  assert.ok(sticky.body.endsWith(PACK_END));
  for (const line of sticky.body.split('\n').filter((entry) => entry.startsWith('<a href='))) assert.match(line, PICTURE_LINE);

  state.calls.length = 0;
  const second = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, target: 'comment', gh });
  assert.equal(second.comment.id, 901, 'the existing sticky comment is reused');
  assert.equal(state.comments.length, 2, 'the existing comment is updated without a temporary comment');
  assert.equal(state.calls.some((call) => call.args.includes('--attach')), false);
  assert.equal(state.comments[1].id, 901);
  assert.doesNotMatch(state.comments[1].body, /archify-asset-/);
  assert.deepEqual(second.steps.map((step) => step.action), ['preflight', 'read-target', 'skipped', 'write']);
});

test('attach --target comment deletes its temporary comment when mapping fails', async () => {
  const { receiptPath } = receiptFixture();
  const { gh, state } = fakeGh({ rewrite: () => null });
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, target: 'comment', gh }), (error) => {
    assert.equal(error.code, 'pr-attach/asset-mapping-incomplete');
    assert.equal(error.rollback.deletedComment, 901);
    return true;
  });
  assert.equal(state.comments.length, 0);
});

test('attach preflight blocks oversized and excessive attachments, old gh, missing auth and bad references', async () => {
  const oversized = receiptFixture({ views: ['big'], bytes: 5 * 1024 * 1024 });
  const { gh, state } = fakeGh();
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: oversized.receiptPath, gh }), (error) => {
    assert.equal(error.code, 'pr-attach/attachment-too-large');
    assert.equal(error.stage, 'preflight');
    return true;
  });
  assert.equal(state.calls.length, 0, 'limits are checked before gh runs');

  const many = receiptFixture({ views: Array.from({ length: MAX_ATTACHMENTS / 2 + 1 }, (_, index) => `v${index}`) });
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: many.receiptPath, gh }), (error) => {
    assert.equal(error.code, 'pr-attach/too-many-attachments');
    assert.equal(error.diagnostics[0].evidence.attachments, MAX_ATTACHMENTS + 2);
    return true;
  });

  const ok = receiptFixture();
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: ok.receiptPath, gh: fakeGh({ version: '2.80.0' }).gh }), (error) => error.code === 'pr-attach/gh-version');
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: ok.receiptPath, gh: fakeGh({ auth: false }).gh }), (error) => error.code === 'pr-attach/gh-auth');
  await assert.rejects(attachPrPack({ pullRequest: 'feature-branch', receipt: ok.receiptPath, gh }), (error) => error.code === 'pr-attach/invalid-pull-request');
  await assert.rejects(attachPrPack({ pullRequest: 'https://github.com/acme/checkout/pull/42', repo: 'other/repo', receipt: ok.receiptPath, gh }), (error) => error.code === 'pr-attach/repo-mismatch');
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: ok.receiptPath, target: 'review', gh }), (error) => error.code === 'cli/unsupported-option');

  fs.appendFileSync(path.join(ok.dir, 'pr-pack.md'), 'hand edit\n');
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: ok.receiptPath, gh }), (error) => error.code === 'pr-attach/markdown-drifted');
});

test('attach helpers parse gh versions, PR references and user-attachments tokens strictly', () => {
  assert.deepEqual(parseGhVersion('gh version 2.99.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.99.0'), [2, 99, 0]);
  assert.equal(parseGhVersion('nope'), null);
  assert.equal(supportsAttach([2, 99, 0]), true);
  assert.equal(supportsAttach([3, 0, 0]), true);
  assert.equal(supportsAttach([2, 98, 9]), false);
  assert.equal(supportsAttach(null), false);
  assert.deepEqual(parsePullRequest('https://github.com/acme/checkout/pull/42/files'), { number: 42, repo: 'acme/checkout' });
  assert.deepEqual(parsePullRequest('42', 'acme/checkout'), { number: 42, repo: 'acme/checkout' });
  const attachments = [{ id: 'a-light', token: 'archify-asset-0:0123456789abcdef' }, { id: 'a-dark', token: 'archify-asset-1:0123456789abcdef' }];
  const body = '![archify-asset-0:0123456789abcdef](https://github.com/user-attachments/assets/aaa-111)\n![archify-asset-1:0123456789abcdef](views/a-dark.svg)\n![archify-asset-1:0123456789abcdef](https://evil.example/assets/x)';
  assert.deepEqual(extractAssetUrls(body, attachments), { urls: { 'a-light': 'https://github.com/user-attachments/assets/aaa-111' }, missing: ['a-dark'] });
});

test('attach refuses a build for another PR head before writing unless allowStale is explicit', async () => {
  const { receiptPath } = receiptFixture({ revisions: { baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) } });
  const { gh, state } = fakeGh();
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh }), (error) => {
    assert.equal(error.code, 'pr-attach/head-sha-outdated');
    assert.equal(error.diagnostics[0].evidence.headRefOid, 'a'.repeat(40));
    return true;
  });
  assert.equal(state.calls.some((call) => call.args.includes('--attach')), false);
  const result = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, allowStale: true, gh });
  assert.equal(result.ok, true);
  assert.match(state.body, /"headSha":"c{40}"/);
});

test('attach fills PR URLs and caches unchanged SVG bytes across metadata-only and partial updates', async () => {
  const { receiptPath, assets, dir } = receiptFixture({ revisions: { headSha: 'a'.repeat(40) } });
  const markdownPath = path.join(dir, 'pr-pack.md');
  const draft = fs.readFileSync(markdownPath, 'utf8').trimEnd().replace('## Ledger rollout', '## Ledger rollout\n[Code]({{archify:pr-url}}/files#diff-abcR10)');
  fs.writeFileSync(markdownPath, `${draft}\n`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  receipt.markdown.sha256 = sha256(draft);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const { gh, state } = fakeGh({ body: HAND_WRITTEN });
  const first = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  assert.match(state.body, /\[Code\]\(https:\/\/github.com\/acme\/checkout\/pull\/42\/files#diff-abcR10\)/);
  assert.match(state.body, /<!-- archify-pr-pack:start -->\n<!-- archify-pr-meta: /);
  const revisedDraft = draft.replace('## Ledger rollout', '## Ledger rollout update');
  fs.writeFileSync(markdownPath, `${revisedDraft}\n`);
  receipt.markdown.sha256 = sha256(revisedDraft);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  state.calls.length = 0;
  const same = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  assert.deepEqual(same.assets, first.assets);
  assert.match(state.body, /## Ledger rollout update/);
  assert.equal(state.calls.filter((call) => call.args.includes('--attach')).length, 0);
  assert.equal(state.calls.filter((call) => call.args.slice(0, 2).join(' ') === 'pr edit').length, 1);
  fs.appendFileSync(assets[0].path, '<!-- changed -->');
  state.calls.length = 0;
  const partial = await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  const upload = state.calls.find((call) => call.args.includes('--attach'));
  assert.equal(upload.args.filter((arg) => arg === '--attach').length, 1);
  assert.notEqual(partial.assets[assets[0].path], first.assets[assets[0].path]);
  for (const asset of assets.slice(1)) assert.equal(partial.assets[asset.path], first.assets[asset.path]);
});

test('attach ignores malformed metadata and untrusted cached URLs', async () => {
  const { receiptPath, assets } = receiptFixture();
  const key = `${assets[0].id}:${sha256(fs.readFileSync(assets[0].path)).slice(0, 16)}`;
  for (const metadata of ['not JSON', JSON.stringify({ v: 1, assets: { [key]: 'https://evil.example/image.svg' } })]) {
    const { gh, state } = fakeGh({ body: `${PACK_START}\n<!-- archify-pr-meta: ${metadata} -->\n${PACK_END}` });
    await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
    const upload = state.calls.find((call) => call.args.includes('--attach'));
    assert.equal(upload.args.filter((arg) => arg === '--attach').length, 4);
    assert.doesNotMatch(state.body, /evil.example/);
  }
});


test('an unchanged-asset refresh restores its original body when the final write fails', async () => {
  const { receiptPath } = receiptFixture();
  const { gh, state } = fakeGh({ body: HAND_WRITTEN });
  await attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh });
  const original = state.body;
  state.calls.length = 0;
  let failed = false;
  const failOnce = (call) => {
    if (!failed && call.args.slice(0, 2).join(' ') === 'pr edit') {
      failed = true;
      state.body = 'partially updated body';
      return { status: 1, stdout: '', stderr: 'connection lost after write' };
    }
    return gh(call);
  };
  await assert.rejects(attachPrPack({ pullRequest: '42', repo: 'acme/checkout', receipt: receiptPath, gh: failOnce }), (error) => error.code === 'pr-attach/write-failed' && error.rollback.restored);
  assert.equal(state.body, original);
  assert.equal(state.calls.some((call) => call.args.includes('--attach')), false);
});
