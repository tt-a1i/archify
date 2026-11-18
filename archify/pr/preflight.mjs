import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FULL_SHA_RE, runGit } from '../renderers/shared/repository-evidence.mjs';
import { failPrPack as fail } from './errors.mjs';

const MODES = ['ask', 'on-demand', 'proactive'];
const TARGETS = ['body', 'comment'];

function commit(root, ref) {
  // End option parsing before accepting a user-supplied revision.
  const result = runGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  if (result.status !== 0 || !FULL_SHA_RE.test(sha)) {
    fail('pr-preflight/ref-unavailable', 'preflight', `Ref "${ref}" does not resolve to a local commit.`, {
      subject: { repoRoot: root, ref }, supportedFixes: ['fetch the ref or pass an existing local ref with --base / --head'],
    });
  }
  return sha;
}

function defaultBase(root) {
  const symbolic = runGit(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const candidates = [...(symbolic.status === 0 ? [symbolic.stdout.trim()] : []), 'origin/main', 'origin/dev', 'origin/master'];
  for (const ref of candidates) {
    const result = runGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
    if (result.status === 0 && FULL_SHA_RE.test(result.stdout.trim())) return ref;
  }
  fail('pr-preflight/base-required', 'preflight', 'Could not discover origin/HEAD, origin/main, origin/dev, or origin/master.', {
    subject: { repoRoot: root }, supportedFixes: ['pass --base with the intended local comparison ref'],
  });
}

export function classifyPrFile(file) {
  const lower = file.toLowerCase();
  const name = path.posix.basename(lower);
  if (/^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|composer\.lock|gemfile\.lock|go\.sum)$/.test(name)) return 'lockfile';
  if (/(^|\/)(?:test|tests|__tests__|spec|specs)(\/|$)/.test(lower) || /(?:[._-](?:test|spec))\.[^/]+$/.test(name)) return 'test';
  if (/(^|\/)(?:schemas?)(\/|$)/.test(lower) || /\.schema\.(?:json|sql)$/.test(name) || name === 'schema.sql' || (/(^|\/)migrations?(\/|$)/.test(lower) && /\.sql$/.test(name)) || /\.(?:proto|graphql|gql)$/.test(name)) return 'schema';
  if (/(^|\/)(?:docs?|documentation)(\/|$)/.test(lower) || /\.(?:md|mdx|rst|txt|adoc)$/.test(name) || /^(?:license|notice|copying)(?:\.|$)/.test(name)) return 'docs';
  if (/(^|\/)(?:\.github|\.gitlab|config)(\/|$)/.test(lower) || /\.(?:json|ya?ml|toml|ini|conf|config|properties)$/.test(name) || /^\.(?:gitignore|gitattributes|editorconfig|npmrc|nvmrc)$/.test(name) || /(?:^|\.)(?:config|rc)\.[^/]+$/.test(name) || /^(?:dockerfile|makefile)$/.test(name)) return 'config';
  return 'code';
}

function changedFiles(root, baseSha, headSha) {
  const result = runGit(root, ['diff', '--numstat', '-z', '--find-renames', baseSha, headSha, '--']);
  if (result.status !== 0) {
    fail('pr-preflight/diff-failed', 'preflight', 'Could not read the Git diff statistics.', {
      subject: { repoRoot: root }, supportedFixes: ['check that both revision objects are available locally'],
    });
  }
  const tokens = result.stdout.split('\0');
  const files = [];
  for (let index = 0; index < tokens.length && tokens[index] !== ''; index += 1) {
    const row = tokens[index];
    const first = row.indexOf('\t');
    const second = row.indexOf('\t', first + 1);
    const added = row.slice(0, first);
    const deleted = row.slice(first + 1, second);
    let file = row.slice(second + 1);
    let basePath;
    if (!file) {
      basePath = tokens[++index];
      file = tokens[++index];
    }
    const binary = added === '-' || deleted === '-';
    files.push({ path: file, ...(basePath ? { basePath } : {}), additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary, category: classifyPrFile(file) });
  }
  return files;
}

export function assessPrMateriality(files, stats) {
  const isPureRename = (file) => Boolean(file.basePath) && !file.binary && file.additions === 0 && file.deletions === 0;
  if (files.some((file) => file.category === 'schema' && !isPureRename(file))) return { shouldOffer: true, reasons: ['schema-change'] };
  const reasons = [];
  if (!files.length) reasons.push('no-changes');
  else if (files.every((file) => ['docs', 'lockfile'].includes(file.category))) reasons.push('only-docs-and-lockfiles');
  else if (files.every((file) => ['docs', 'lockfile', 'test'].includes(file.category))) reasons.push('only-tests-and-supporting-files');
  if (files.length && files.every((file) => ['docs', 'lockfile', 'config'].includes(file.category))) reasons.push('only-configuration-and-supporting-files');
  if (files.length && files.every(isPureRename)) reasons.push('rename-only');
  // Binary changes have unknown line counts and must not silently look small.
  if (files.length && files.length <= 2 && stats.additions + stats.deletions < 40 && !files.some((file) => file.binary)) reasons.push('small-change');
  return { shouldOffer: reasons.length === 0, reasons: reasons.length ? reasons : ['material-change'] };
}

function readPolicy(file, repository) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('pr-preflight/policy-unreadable', 'preflight', `Could not read policy file ${file}: ${error.message}`, {
      subject: { path: file }, supportedFixes: ['make the policy file readable and retry'],
    });
  }
  let fence = null;
  let comment = false;
  let match = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    // Indented code cannot introduce either a rule or a Markdown comment/fence.
    if (!comment && /^(?: {4}| {0,3}\t)/.test(line)) continue;
    if (!comment && marker) {
      fence = marker[1];
      continue;
    }
    // HTML comments may span lines; fence markers inside them are inert.
    let hadComment = comment;
    let cursor = 0;
    while (cursor < line.length) {
      const boundary = line.indexOf(comment ? '-->' : '<!--', cursor);
      if (boundary < 0) break;
      hadComment = true;
      cursor = boundary + (comment ? 3 : 4);
      comment = !comment;
    }
    if (hadComment) continue;
    const directive = line.match(/^ {0,3}\[archify pr:[ \t]*(ask|on-demand|proactive)[ \t]*(?:,[ \t]*target[ \t]*=[ \t]*(body|comment)[ \t]*)?\][ \t]*$/);
    if (directive) match = directive;
  }
  if (!match) return null;
  return { mode: repository && match[1] === 'proactive' ? 'ask' : match[1], ...(match[2] ? { target: match[2] } : {}), source: file };
}

function personalPolicy(root, { globalRulesFile, env }) {
  if (globalRulesFile === false) return null;
  function read(file) {
    const absolute = path.resolve(file);
    let inRepository = false;
    if (fs.existsSync(absolute)) {
      const relative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
      inRepository = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    }
    return readPolicy(absolute, inRepository);
  }
  if (globalRulesFile) return read(globalRulesFile);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const files = {
    codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md'),
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'CLAUDE.md'),
    cursor: path.join(home, '.cursor', 'AGENTS.md'),
    devin: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'devin', 'AGENTS.md'),
  };
  const explicitHost = env.ARCHIFY_AGENT?.toLowerCase();
  const detected = [
    ...(env.CODEX_THREAD_ID || env.CODEX_INTERNAL_ORIGINATOR || env.CODEX_CI ? ['codex'] : []),
    ...(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT ? ['claude'] : []),
    ...(env.CURSOR_AGENT || env.CURSOR_TRACE_ID || env.TERM_PROGRAM?.toLowerCase() === 'cursor' ? ['cursor'] : []),
    ...(env.DEVIN_SESSION_ID || env.DEVIN_AGENT || env.DEVIN ? ['devin'] : []),
  ];
  const host = Object.hasOwn(files, explicitHost) ? explicitHost : detected.length === 1 ? detected[0] : null;
  const own = host ? read(files[host]) : null;
  if (own) return own;
  const found = Object.values(files).map(read).filter(Boolean);
  if (!found.length) return null;
  // Unidentified or other-host rules may request silence, never grant publication consent.
  const silent = found.filter((policy) => policy.mode === 'on-demand');
  const selected = silent.length ? silent : found;
  const targets = new Set(selected.map((policy) => policy.target).filter(Boolean));
  return {
    mode: silent.length ? 'on-demand' : 'ask',
    ...(targets.size ? { target: targets.size === 1 ? [...targets][0] : 'body' } : {}),
    source: targets.size > 1 ? 'global-conflict' : selected[0].source,
  };
}

export function resolvePrPolicy({ repoRoot, mode, target, globalRulesFile, env = process.env } = {}) {
  if (mode !== undefined && !MODES.includes(mode)) fail('pr-preflight/invalid-policy', 'arguments', `Unknown PR mode "${mode}".`, { supportedFixes: [`use one of: ${MODES.join(', ')}`] });
  if (target !== undefined && !TARGETS.includes(target)) fail('pr-preflight/invalid-policy', 'arguments', `Unknown PR target "${target}".`, { supportedFixes: ['use body or comment'] });
  const root = path.resolve(repoRoot || process.cwd());
  const contributing = readPolicy(path.join(root, 'CONTRIBUTING.md'), true);
  const agents = readPolicy(path.join(root, 'AGENTS.md'), true);
  const global = personalPolicy(root, { globalRulesFile, env });
  return { mode: 'ask', target: 'body', source: 'default', ...contributing, ...agents, ...global, ...(mode !== undefined ? { mode, source: 'cli' } : {}), ...(target !== undefined ? { target, source: 'cli' } : {}) };
}

function initialize(directory, result) {
  const manifest = path.join(path.resolve(directory), 'pr-pack.json');
  const draft = {
    schema_version: 1, kind: 'pr-pack', title: 'Describe the pull request changes',
    summary: 'Replace this summary and add views describing the changes before building.',
    baseRef: result.baseRef, headRef: result.headRef, baseSha: result.baseSha, headSha: result.headSha,
    stats: result.stats, views: [],
  };
  try {
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    fail(error.code === 'EEXIST' ? 'pr-preflight/init-exists' : 'pr-preflight/init-failed', 'preflight', `Could not initialize ${manifest}: ${error.message}`, {
      subject: { manifest }, supportedFixes: ['choose a writable directory without an existing pr-pack.json'],
    });
  }
  return { manifest, requiresAuthoring: true };
}

// Read committed three-dot changes only; never fetch or mutate the checkout.
export function preflightPrPack({ repoRoot = process.cwd(), base, head = 'HEAD', init, mode, target, globalRulesFile } = {}) {
  const root = path.resolve(repoRoot);
  const check = runGit(root, ['rev-parse', '--show-toplevel']);
  if (check.status !== 0) fail('pr-preflight/repository-required', 'preflight', `${root} is not a readable Git worktree.`, { subject: { repoRoot: root }, supportedFixes: ['pass --repo-root with a Git checkout'] });
  const actualRoot = check.stdout.replace(/\n$/, '');
  const baseRef = base || defaultBase(actualRoot);
  const headRef = head;
  const baseTip = commit(actualRoot, baseRef);
  const headSha = commit(actualRoot, headRef);
  const merge = runGit(actualRoot, ['merge-base', baseTip, headSha]);
  const baseSha = merge.stdout.trim();
  if (merge.status !== 0 || !FULL_SHA_RE.test(baseSha)) fail('pr-preflight/merge-base-unavailable', 'preflight', `No merge-base between "${baseRef}" and "${headRef}".`, { supportedFixes: ['fetch enough history for both refs to share an ancestor'] });
  const files = changedFiles(actualRoot, baseSha, headSha);
  const stats = { filesChanged: files.length, additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0) };
  const result = { schemaVersion: 1, ok: true, command: 'pr preflight', repoRoot: actualRoot, baseRef, headRef, baseSha, headSha, stats, files, materiality: assessPrMateriality(files, stats), policy: resolvePrPolicy({ repoRoot: actualRoot, mode, target, globalRulesFile }) };
  if (init) result.initialized = initialize(init, result);
  return result;
}
