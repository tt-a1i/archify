#!/usr/bin/env node
// Optional read-only GitHub collector. check/serve continue importing files;
// neither path calls this collector or executes project commands implicitly.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';

export const USAGE = `Usage:
  archify code-analysis import-review https://github.com/OWNER/REPO/pull/NUMBER
                              --out report.json [--author LOGIN] [--json]

Read the PR head and all inline review comments using GitHub GET requests only.
The PR head must remain unchanged during collection. GH_TOKEN or GITHUB_TOKEN
may provide read access; the token is sent only in GitHub API authorization headers.
--author selects root findings on import; replies from other authors are retained
as discussion context. Without --author, all root review comments are available.
The saved report is an input for config.external.sources format github-review.
No lint command is executed, no review comment is posted, and no file is written
until collection succeeds. Limits: 30 seconds, 100 pages, 10,000 comments, 32 MiB.
Exit codes: 0 report saved, 2 usage, HTTP, consistency or output error.`;

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_COMMENTS = 10000;
const TIMEOUT_MS = 30000;

export function parseImportReviewArgs(argv) {
  const usage = message => fail('cli/usage', `${message}\n${USAGE}`, { supportedFixes: ['pass a GitHub pull-request URL and --out report.json'] });
  const options = {};
  let input;
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) { if (input) usage('Only one pull-request URL is accepted.'); input = value; continue; }
    if (value === '--json') { options.json = true; continue; }
    if (!['--out', '--author'].includes(value) || !argv[i + 1] || argv[i + 1].startsWith('--') || options[value.slice(2)] !== undefined) usage(`Invalid or repeated option: ${value}`);
    options[value.slice(2)] = argv[++i];
  }
  if (!input || !options.out) usage('A GitHub pull-request URL and --out are required.');
  let url;
  try { url = new URL(input); } catch { usage('The pull-request URL is invalid.'); }
  const match = url.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash || !match || ['.', '..'].includes(match?.[2]) || !Number.isSafeInteger(Number(match?.[3]))) usage('Use an exact https://github.com/OWNER/REPO/pull/NUMBER URL without credentials, query or fragment.');
  if (options.author !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\[bot\])?$/.test(options.author)) usage('--author must be a GitHub login, optionally ending in [bot].');
  return { owner: match[1], repository: match[2], number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`, out: path.resolve(options.out), author: options.author, json: !!options.json };
}

export async function runImportReview(argv, { request = fetch } = {}) {
  const options = parseImportReviewArgs(argv);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  let totalBytes = 0;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Archify-external-diagnostics', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const base = `https://api.github.com/repos/${options.owner}/${options.repository}/pulls/${options.number}`;
  const get = async url => {
    let response;
    try { response = await bounded(request(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' }), controller.signal); }
    catch (error) {
      if (error instanceof DiagnosticError) throw error;
      fail('external/github-network', 'The GitHub read request could not complete.', { supportedFixes: ['check network access and retry collection'] });
    }
    if (!response?.ok) fail('external/github-http', `GitHub returned HTTP ${Number.isInteger(response?.status) ? response.status : 'unknown'}.`, { evidence: { status: response?.status ?? null }, supportedFixes: ['confirm repository and pull-request read access', 'check GitHub API rate limits and retry'] });
    const declaredLength = Number(response.headers?.get('content-length'));
    if (declaredLength > MAX_BYTES - totalBytes) limitError('The GitHub response exceeds the 32 MiB collection limit.');
    const reader = response.body?.getReader();
    if (!reader) fail('external/github-response', 'GitHub returned a response without a readable body.', { supportedFixes: ['retry collection'] });
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await bounded(reader.read(), controller.signal);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BYTES) limitError('The GitHub response exceeds the 32 MiB collection limit.');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      controller.abort();
      await bounded(reader.cancel(), controller.signal).catch(() => {});
      if (error instanceof DiagnosticError) throw error;
      fail('external/github-network', 'The GitHub response could not be read completely.', { supportedFixes: ['retry collection'] });
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('external/github-response', 'GitHub returned invalid JSON.', { supportedFixes: ['retry collection and check the API response format'] }); }
    return { data, next: /;\s*rel="?next"?(?:\s*[,;]|\s*$)/.test(response.headers?.get('link') || '') };
  };
  try {
    const initial = (await get(base)).data;
    const headCommit = pullHead(initial);
    const comments = new Map();
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) limitError('GitHub comments exceed the 100-page collection limit.');
      const result = await get(`${base}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(result.data) || result.data.some(comment => !comment || typeof comment !== 'object' || Array.isArray(comment) || !['number', 'string'].includes(typeof comment.id))) fail('external/github-response', 'GitHub returned an invalid review-comments list.', { supportedFixes: ['retry collection using the pull-request review-comments endpoint'] });
      for (const comment of result.data) comments.set(String(comment.id), comment);
      if (comments.size > MAX_COMMENTS) limitError('GitHub comments exceed the 10,000-comment collection limit.');
      if (!result.next && result.data.length < 100) break;
    }
    const finalHead = pullHead((await get(base)).data);
    if (headCommit !== finalHead) fail('external/github-head-changed', 'The PR head changed while comments were collected; no report was published.', { supportedFixes: ['retry collection against the current PR head'] });
    if (controller.signal.aborted) timeoutError();
    const report = {
      schema_version: 1,
      repository: { owner: options.owner, name: options.repository, url: `https://github.com/${options.owner}/${options.repository}` },
      pullRequest: { number: options.number, url: options.url }, headCommit,
      ...(options.author ? { author: options.author } : {}), collectedAt: new Date().toISOString(),
      comments: [...comments.values()],
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_BYTES) limitError('The normalized report exceeds the 32 MiB input limit.');
    atomicWrite(options.out, text);
    return { exitCode: 0, receipt: receipt('ok', { command: 'import-review', out: options.out, pullRequest: options.url, headCommit, comments: report.comments.length, ...(options.author ? { author: options.author } : {}) }) };
  } finally { clearTimeout(timer); controller.abort(); }
}

function pullHead(pull) {
  const head = pull?.head?.sha;
  if (typeof head !== 'string' || !/^[a-fA-F0-9]{40}$/.test(head)) fail('external/github-response', 'GitHub returned no valid pull-request head commit.', { supportedFixes: ['confirm that the URL identifies an available pull request'] });
  return head.toLowerCase();
}

function bounded(promise, signal) {
  if (signal.aborted) { timeoutError(); }
  return new Promise((resolve, reject) => {
    const abort = () => { try { timeoutError(); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function timeoutError() { fail('external/github-timeout', 'GitHub collection exceeded its 30-second total deadline; no report was published.', { supportedFixes: ['retry collection when the API is responsive'] }); }
function limitError(message) { fail('external/github-limit', message, { supportedFixes: ['export a smaller bounded review-comment report explicitly'] }); }
function atomicWrite(file, text) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch {
    fail('external/output-unwritable', 'The collected report could not be published; the previous output was preserved.', { subject: { file }, supportedFixes: ['choose a writable --out file path'] });
  } finally { try { fs.unlinkSync(temporary); } catch { /* Already published or never created. */ } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') console.log(USAGE);
  else runImportReview(args).then(({ exitCode, receipt: result }) => {
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : `Saved ${result.comments} review comments to ${result.out}`);
    process.exitCode = exitCode;
  }).catch(error => {
    const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'external/github-error', severity: 'error', message: 'Review collection failed.', subject: {}, evidence: {}, supportedFixes: ['retry collection'] }];
    if (args.includes('--json')) console.log(JSON.stringify(receipt('error', { command: 'import-review', diagnostics }), null, 2));
    else console.error(diagnostics.map(d => `[${d.code}] ${d.message}`).join('\n'));
    process.exitCode = 2;
  });
}
