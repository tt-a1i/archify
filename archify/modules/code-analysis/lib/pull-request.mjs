// A manually requested PR is a pair of pinned source trees. Repository code,
// package scripts and Git hooks are never run. The existing analyzer measures
// both sides; this module only prepares inputs and records their provenance.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { git, materializeTree, normalizeScope } from './git-sources.mjs';
export { materializeTree, normalizeScope } from './git-sources.mjs';
import { fail } from '../core/index.mjs';

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parsePullRequest(value, repository = null) {
  let number;
  const text = String(value);
  if (/^#?[1-9][0-9]*$/.test(text)) number = Number(text.replace('#', ''));
  else {
    let url;
    try { url = new URL(text); } catch { /* reported below */ }
    const match = url?.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)\/?$/);
    if (!url || url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) {
      fail('pr/input-invalid', 'Use a GitHub PR URL or a positive PR number with --repository.', { supportedFixes: ['pass https://github.com/OWNER/REPO/pull/NUMBER'] });
    }
    if (repository && repository.toLowerCase() !== match[1].toLowerCase()) fail('pr/repository-mismatch', 'The PR URL belongs to a different repository.');
    repository = match[1]; number = Number(match[2]);
  }
  if (!repository || !REPOSITORY.test(repository) || !Number.isSafeInteger(number)) fail('pr/input-invalid', 'A PR number needs a valid OWNER/REPO repository.');
  return { repository, number, url: `https://github.com/${repository}/pull/${number}` };
}

export async function githubJSON(resource) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let response;
  try {
    response = await fetch(`https://api.github.com${resource}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Archify-Code-Analysis', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000), redirect: 'error',
    });
  } catch { fail('pr/github-unavailable', 'GitHub could not be reached.', { supportedFixes: ['check the network and retry the explicitly requested PR'] }); }
  if (!response.ok) fail('pr/github-request-failed', `GitHub returned HTTP ${response.status}.`, {
    evidence: { status: response.status }, supportedFixes: [response.status === 403 || response.status === 429 ? 'check GitHub API limits or configure GH_TOKEN in the server environment' : 'check the PR URL and repository access'],
  });
  return response.json();
}

export async function capturePullRequest(input, { fetchJSON = githubJSON } = {}) {
  const route = `/repos/${input.repository}/pulls/${input.number}`;
  const before = await fetchJSON(route);
  const baseSHA = before.base?.sha, headSHA = before.head?.sha;
  if (before.number !== input.number || !SHA.test(baseSHA) || !SHA.test(headSHA)) fail('pr/metadata-invalid', 'The PR response does not identify both source commits.');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await fetchJSON(`${route}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) fail('pr/metadata-invalid', 'The PR changed-file response is invalid.');
    files.push(...batch.map(file => ({ path: file.filename, previousPath: file.previous_filename || null, status: file.status, additions: file.additions ?? null, deletions: file.deletions ?? null })));
    if (batch.length < 100) break;
  }
  if (files.length !== before.changed_files) fail('pr/files-incomplete', 'GitHub did not return a complete changed-file list.', { evidence: { expected: before.changed_files, received: files.length }, supportedFixes: ['retry; PRs exceeding the GitHub 3000-file limit are not supported'] });
  const comparison = await fetchJSON(`/repos/${input.repository}/compare/${baseSHA}...${headSHA}?per_page=1`);
  const mergeBaseSHA = comparison.merge_base_commit?.sha;
  if (!SHA.test(mergeBaseSHA)) fail('pr/merge-base-missing', 'GitHub did not return the PR comparison base.');
  const after = await fetchJSON(route);
  if (after.base?.sha !== baseSHA || after.head?.sha !== headSHA || after.updated_at !== before.updated_at) fail('pr/changed-during-capture', 'The PR changed while its inputs were being captured.', { supportedFixes: ['run the requested analysis again to capture one consistent PR revision'] });
  return {
    ...input, title: before.title, shortTitle: before.title, status: before.merged_at ? 'merged' : before.state,
    author: before.user?.login || null, base: before.base.ref, baseSHA, headSHA, mergeSHA: before.merge_commit_sha || null,
    created: before.created_at, updated: before.updated_at, mergedAt: before.merged_at,
    additions: before.additions, deletions: before.deletions, files: files.map(file => file.path), changedFiles: files,
    mergeBaseSHA, capturedAt: new Date().toISOString(), patchFile: '', patch: '',
  };
}

export async function repositoryContext(root, repository = null) {
  const top = (await git(path.resolve(root), ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  // Git expands Windows 8.3 names; use the native realpath for both inputs so
  // a checkout reached through a short path still has the correct scope.
  const scope = normalizeScope(path.relative(fs.realpathSync.native(top), fs.realpathSync.native(root)).split(path.sep).join('/') || '.');
  if (!repository) {
    const remote = (await git(top, ['remote', 'get-url', 'origin'])).toString('utf8').trim();
    repository = /^(?:https:\/\/github\.com\/|git@github\.com:)([^\s]+?)(?:\.git)?$/.exec(remote)?.[1];
    if (!repository || !REPOSITORY.test(repository)) fail('pr/repository-required', 'Pass --repository OWNER/REPO for this checkout.');
  }
  if (!REPOSITORY.test(repository)) fail('pr/input-invalid', 'Invalid GitHub repository identity.');
  return { root: top, scope, repository };
}

async function ensureObject(cache, localRoot, repository, sha) {
  try { await git(cache, ['cat-file', '-e', `${sha}^{commit}`]); return; } catch { /* fetch into this task-owned cache */ }
  // Prefer already-present objects. The user's checkout, refs and index are
  // never written. A missing local object falls back to the fixed GitHub host.
  try { await git(cache, ['fetch', '--no-tags', '--no-write-fetch-head', '--depth=1', localRoot, sha]); }
  catch {
    // Avoid downloading the repository's unrelated images and packaged ZIPs.
    // materializeTree bulk-prefetches missing blobs in the selected scope.
    await git(cache, ['config', 'remote.origin.url', `https://github.com/${repository}.git`]);
    await git(cache, ['config', 'remote.origin.promisor', 'true']);
    await git(cache, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
    await git(cache, ['fetch', '--no-tags', '--no-write-fetch-head', '--depth=1', '--filter=blob:none', 'origin', sha]);
  }
  await git(cache, ['cat-file', '-e', `${sha}^{commit}`]);
}

// Only source preparation lives here. prepare/serve own analysis, tasks and views.
export async function resolvePullRequest(root, value, repository = null, scope = null) {
  const explicit = String(value).startsWith('https:') ? parsePullRequest(value, repository) : null;
  const context = await repositoryContext(root, explicit?.repository || repository);
  return { root: context.root, input: explicit || parsePullRequest(value, context.repository), scope: normalizeScope(scope ?? context.scope) };
}

export async function preparePullRequest({ root, out, input, scope }, { fetchJSON = githubJSON } = {}) {
  input = parsePullRequest(input.number, input.repository);
  const pr = await capturePullRequest(input, { fetchJSON });
  scope = normalizeScope(scope);
  const cache = path.join(out, '.pr-objects', ...input.repository.toLowerCase().split('/'));
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(path.join(cache, 'HEAD'))) await git(cache, ['init', '--bare']);
  for (const sha of new Set([pr.mergeBaseSHA, pr.headSHA])) await ensureObject(cache, root, input.repository, sha);
  const directory = path.join(out, 'pull-requests', ...input.repository.toLowerCase().split('/'), String(input.number), 'run-' + randomBytes(12).toString('hex'));
  const roots = { base: path.join(directory, 'base'), head: path.join(directory, 'head') };
  try {
    const manifests = {};
    for (const [side, sha] of [['base', pr.mergeBaseSHA], ['head', pr.headSHA]]) {
      manifests[side] = await materializeTree({ cache, sha, scope, target: roots[side], blobSource: 'https://github.com/' + input.repository + '.git' });
    }
    const relative = file => scope === '.' ? file : file?.startsWith(scope + '/') ? file.slice(scope.length + 1) : null;
    const changedFiles = pr.changedFiles.flatMap(file => {
      const current = relative(file.path), previous = relative(file.previousPath);
      return current || previous ? [{ ...file, path: current || previous, previousPath: current ? previous : null,
        status: !current ? 'removed' : file.status === 'renamed' && !previous ? 'added' : file.status }] : [];
    });
    return { pr, scope, directory, roots, manifests, changedFiles, sourceGitRoot: cache,
      source: side => ({ root: scope, revision: side === 'base' ? pr.mergeBaseSHA : pr.headSHA,
        baseRevision: pr.mergeBaseSHA, sourceKind: 'git-tree', url: 'https://github.com/' + input.repository }) };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
