import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runImportReview, parseImportReviewArgs } from '../bin/import-review.mjs';
import { DiagnosticError } from '../core/index.mjs';

const HEAD = 'a'.repeat(40);
const URL = 'https://github.com/example/project/pull/17';
const jsonResponse = (data, options = {}) => new Response(JSON.stringify(data), { status: 200, ...options });
function output(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-review-collector-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'review.json');
  fs.writeFileSync(file, 'previous successful report\n');
  return { dir, file, args: [URL, '--out', file], unchanged() {
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous successful report\n');
    assert.deepEqual(fs.readdirSync(dir), ['review.json']);
  } };
}

test('review collector accepts exact GitHub PR URLs and rejects alternate hosts, credentials and ambiguous paths', () => {
  assert.equal(parseImportReviewArgs([`${URL}/`, '--out', 'report.json', '--author', 'coderabbitai[bot]']).number, 17);
  for (const value of ['http://github.com/example/project/pull/17', 'https://github.com.evil.test/example/project/pull/17', 'https://user:secret@github.com/example/project/pull/17', `${URL}?token=secret`, `${URL}#discussion`, 'https://github.com/example/project/issues/17', 'https://github.com/example/project/pull/0']) {
    assert.throws(() => parseImportReviewArgs([value, '--out', 'report.json']), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'cli/usage');
  }
  assert.throws(() => parseImportReviewArgs([URL]), DiagnosticError);
});

test('review collector follows pagination with GET only, retains reply context and atomically replaces output', async t => {
  const out = output(t), calls = [];
  const oldToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'collector-fixture-token-not-real';
  t.after(() => { if (oldToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = oldToken; });
  const comments = [
    { id: 1, body: 'Review this branch', path: 'a.js', user: { login: 'coderabbitai[bot]' } },
    { id: 2, in_reply_to_id: 1, body: 'Intentional behavior', user: { login: 'maintainer' } },
    { id: 3, body: 'Separate reviewer', user: { login: 'another-reviewer' } },
  ];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(new globalThis.URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer collector-fixture-token-not-real');
    assert.equal(fs.readFileSync(out.file, 'utf8'), 'previous successful report\n');
    const page = new globalThis.URL(url).searchParams.get('page');
    if (page === '1') return jsonResponse(comments.slice(0, 2), { headers: { link: '<https://api.github.com/repos/example/project/pulls/17/comments?per_page=100&page=2>; rel="next"' } });
    if (page === '2') return jsonResponse(comments.slice(2));
    return jsonResponse({ head: { sha: HEAD } });
  };
  const result = await runImportReview([...out.args, '--author', 'coderabbitai[bot]', '--json'], { request });
  const report = JSON.parse(fs.readFileSync(out.file, 'utf8'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.comments, 3);
  assert.equal(report.headCommit, HEAD);
  assert.equal(report.author, 'coderabbitai[bot]');
  assert.equal(report.repository.name, 'project');
  assert.equal(report.pullRequest.number, 17);
  assert.deepEqual(report.comments, comments);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, calls.at(-1).url);
  assert.ok(!fs.readFileSync(out.file, 'utf8').includes(process.env.GH_TOKEN));
  assert.ok(!JSON.stringify(result.receipt).includes(process.env.GH_TOKEN));
  assert.deepEqual(fs.readdirSync(out.dir), ['review.json']);
});

test('review collector rejects a PR head change and leaves prior output intact', async t => {
  const out = output(t);
  let heads = 0;
  await assert.rejects(runImportReview(out.args, { request: async url => url.includes('/comments?') ? jsonResponse([]) : jsonResponse({ head: { sha: ++heads === 1 ? HEAD : 'b'.repeat(40) } }) }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-head-changed');
  out.unchanged();
});

test('HTTP and malformed response failures do not publish data or echo response bodies', async t => {
  const out = output(t);
  await assert.rejects(runImportReview(out.args, { request: async () => new Response('credentials should not be echoed', { status: 403 }) }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-http' && !JSON.stringify(e.diagnostics).includes('credentials should not be echoed'));
  out.unchanged();
  await assert.rejects(runImportReview(out.args, { request: async () => new Response('not JSON') }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-response');
  out.unchanged();
  await assert.rejects(runImportReview(out.args, { request: async url => url.includes('/comments?') ? jsonResponse({ error: 'not an array' }) : jsonResponse({ head: { sha: HEAD } }) }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-response');
  out.unchanged();
});

test('collector enforces response and pagination limits without publishing partial results', async t => {
  const out = output(t);
  await assert.rejects(runImportReview(out.args, { request: async () => jsonResponse({}, { headers: { 'content-length': String(33 * 1024 * 1024) } }) }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-limit');
  out.unchanged();
  let pages = 0;
  await assert.rejects(runImportReview(out.args, { request: async url => url.includes('/comments?') ? jsonResponse([{ id: ++pages }], { headers: { link: '<https://api.github.com/page>; rel="next"' } }) : jsonResponse({ head: { sha: HEAD } }) }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-limit');
  assert.equal(pages, 100);
  out.unchanged();
});

test('collector aborts an unsettled request without publishing output', async t => {
  const out = output(t);
  await assert.rejects(runImportReview(out.args, { request: (_url, options) => {
    queueMicrotask(() => options.signal.dispatchEvent(new Event('abort')));
    return new Promise(() => {});
  } }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/github-timeout');
  out.unchanged();
});
