import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachPrPack } from '../archify/pr/attach.mjs';
import { PACK_START, PACK_END, sha256 } from '../archify/pr/markdown.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const HOST = 'gitlab.example.com';
const PROJECT = `https://${HOST}/group/subgroup/project`;
const MR = `${PROJECT}/-/merge_requests/42`;
const HEAD = 'a'.repeat(40);

function fixture({ head = HEAD, repository = PROJECT } = {}) {
  const dir = createScratchDirectory(path.join(os.tmpdir(), 'archify-gitlab-attach-'));
  const file = path.join(dir, 'topology-light.svg');
  fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const markdown = `${PACK_START}\n## Architecture\n\n![Topology]({{archify:asset:topology-light}})\n${PACK_END}`;
  const markdownPath = path.join(dir, 'pr-pack.md');
  fs.writeFileSync(markdownPath, `${markdown}\n`);
  const receiptPath = path.join(dir, 'receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ schemaVersion: 1, ok: true, command: 'pr build', kind: 'pr-pack-receipt', platform: 'gitlab', repository, revisions: { headSha: head }, markdown: { path: markdownPath, sha256: sha256(markdown) }, assets: [{ id: 'topology-light', view: 'topology', theme: 'light', path: file, placeholder: '{{archify:asset:topology-light}}' }] }));
  return receiptPath;
}

function fakeGlab({ notes = [], head = HEAD, headAfterUpload = head, failUpload = false } = {}) {
  const state = { calls: [], notes: notes.map((note) => ({ ...note })), uploads: 0 };
  const glab = ({ args, input }) => {
    state.calls.push({ args: [...args], input });
    const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
    const error = (message) => ({ status: 1, stdout: '', stderr: message });
    if (args[0] !== 'api') return error(`unexpected glab command ${args[0]}`);
    assert.equal(args[args.indexOf('--hostname') + 1], HOST);
    const route = args.find((arg) => /^(?:\/?api\/v4\/)?(?:projects\/|user(?:\?|$))/.test(arg));
    if (!route) return error('missing API route');
    const endpoint = route.replace(/^\/?api\/v4\//, '').split('?')[0];
    const methodIndex = Math.max(args.indexOf('--method'), args.indexOf('-X'));
    const method = methodIndex < 0 ? 'GET' : args[methodIndex + 1].toUpperCase();
    if (endpoint === 'user' && method === 'GET') return ok({ id: 7, username: 'me' });
    const decoded = decodeURIComponent(endpoint);
    if (!decoded.startsWith('projects/group/subgroup/project/')) return error(`unexpected endpoint ${endpoint}`);
    if (decoded.endsWith('/merge_requests/42') && method === 'GET') return ok({ iid: 42, sha: state.uploads ? headAfterUpload : head, web_url: MR, target_project_id: 123, project_id: 123 });
    if (decoded.endsWith('/uploads') && method === 'POST') {
      assert.ok(args.some((arg, i) => args[i - 1] === '--form' && arg.startsWith('file=@')));
      if (failUpload) return error('upload failed');
      state.uploads += 1;
      return ok({ url: `/uploads/${'a'.repeat(32)}/topology-light.svg`, markdown: `![topology-light](/uploads/${'a'.repeat(32)}/topology-light.svg)` });
    }
    if (decoded.endsWith('/merge_requests/42/notes') && method === 'GET') {
      const query = new URLSearchParams(route.split('?')[1] || '');
      const page = Number(query.get('page') || 1);
      return ok(state.notes.slice((page - 1) * 100, page * 100));
    }
    if (/\/merge_requests\/42\/notes(?:\/\d+)?$/.test(decoded) && ['POST', 'PUT'].includes(method)) {
      assert.equal(args[args.indexOf('--input') + 1], '-');
      const body = JSON.parse(input).body;
      if (method === 'POST') {
        const note = { id: 99, author: { id: 7, username: 'me' }, body };
        state.notes.push(note);
        return ok(note);
      }
      const note = state.notes.find((n) => n.id === Number(decoded.split('/').at(-1)));
      if (!note) return error('note not found');
      note.body = body;
      return ok(note);
    }
    return error(`unexpected ${method} ${endpoint}`);
  };
  return { glab, state };
}

const writes = (state) => state.calls.filter(({ args }) => args.includes('--form') || args.includes('--input'));

test('GitLab dry run performs no upload or note write', async () => {
  const { glab, state } = fakeGlab();
  const result = await attachPrPack({ pullRequest: MR, receipt: fixture(), dryRun: true, glab });
  assert.equal(result.ok, true);
  assert.equal(writes(state).length, 0);
});

test('GitLab rejects stale head before writes unless explicitly allowed', async () => {
  const { glab, state } = fakeGlab();
  const receipt = fixture({ head: 'b'.repeat(40) });
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt, glab }), (error) => error.code === 'pr-attach/head-sha-outdated');
  assert.equal(writes(state).length, 0);
  assert.equal((await attachPrPack({ pullRequest: MR, receipt, allowStale: true, glab })).ok, true);
});

test('GitLab rejects a receipt built for another project before writes', async () => {
  const { glab, state } = fakeGlab();
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt: fixture({ repository: `https://${HOST}/group/other` }), glab }), (error) => error.code === 'pr-attach/repo-mismatch');
  assert.equal(writes(state).length, 0);
});

test('GitLab posts a comment and updates only the current user sticky comment', async () => {
  const other = { id: 10, author: { id: 8, username: 'other' }, body: `${PACK_START}\nother content\n${PACK_END}` };
  const { glab, state } = fakeGlab({ notes: [other] });
  const receipt = fixture();
  assert.equal((await attachPrPack({ pullRequest: MR, receipt, glab })).ok, true);
  assert.equal(state.notes.length, 2);
  assert.equal(state.notes[0].body, other.body);
  assert.match(state.notes[1].body, new RegExp(`/uploads/${'a'.repeat(32)}/topology-light\\.svg`));
  assert.equal((await attachPrPack({ pullRequest: MR, receipt, glab })).ok, true);
  assert.equal(state.notes.length, 2);
  assert.equal(state.notes[0].body, other.body);
  assert.equal(state.uploads, 1);
  assert.ok(state.calls.some(({ args }) => args.includes('PUT')));
});

test('GitLab upload failure leaves existing notes untouched', async () => {
  const note = { id: 10, author: { id: 7, username: 'me' }, body: `${PACK_START}\nold content\n${PACK_END}` };
  const { glab, state } = fakeGlab({ notes: [note], failUpload: true });
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt: fixture(), glab }), (error) => error.code === 'pr-attach/upload-failed');
  assert.deepEqual(state.notes, [note]);
  assert.ok(state.calls.some(({ args }) => args.includes('--form')), 'upload was attempted');
  assert.equal(state.calls.some(({ args }) => args.includes('--input')), false);
});

test('GitLab finds the current user sticky comment on later pages', async () => {
  const others = Array.from({ length: 100 }, (_, i) => ({ id: i + 100, author: { id: 8 }, body: `unrelated ${i}` }));
  const own = { id: 501, author: { id: 7 }, body: `${PACK_START}\nold\n${PACK_END}` };
  const { glab, state } = fakeGlab({ notes: [...others, own] });
  assert.equal((await attachPrPack({ pullRequest: MR, receipt: fixture(), glab })).ok, true);
  assert.equal(state.notes.length, 101);
  assert.notEqual(state.notes[100].body, own.body);
  assert.ok(state.calls.some(({ args }) => args.some((arg) => /page=2(?:&|$)/.test(arg))));
});

test('GitLab rejects body target and a receipt without a head revision before writes', async () => {
  const { glab, state } = fakeGlab();
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt: fixture(), target: 'body', glab }), (error) => error.code === 'cli/unsupported-option');
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt: fixture({ head: null }), glab }), (error) => error.code === 'pr-attach/head-sha-outdated');
  assert.equal(writes(state).length, 0);
});

test('GitLab rechecks the head after upload before publishing a comment', async () => {
  const { glab, state } = fakeGlab({ headAfterUpload: 'b'.repeat(40) });
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt: fixture(), glab }), (error) => error.code === 'pr-attach/head-sha-outdated');
  assert.equal(state.uploads, 1);
  assert.equal(state.notes.length, 0);
  assert.equal(state.calls.some(({ args }) => args.includes('--input')), false);
});

test('GitLab rejects a story pack before contacting the MR', async () => {
  const { glab, state } = fakeGlab();
  const receipt = fixture();
  const pack = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  pack.assets[0].animated = true;
  fs.writeFileSync(receipt, JSON.stringify(pack));
  await assert.rejects(attachPrPack({ pullRequest: MR, receipt, glab }), (error) => error.code === 'pr-attach/gitlab-static-pack-required');
  assert.equal(state.calls.length, 0);
});
