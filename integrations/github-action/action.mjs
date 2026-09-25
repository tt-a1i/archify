#!/usr/bin/env node
// Archify GitHub Action runtime.
//
// Modes
//   deliver  Validate and deliver every matching typed JSON source to standalone HTML.
//   compare  On a pull request, compare each matching architecture source against the
//            PR base revision with `archify compare` and summarize authored changes.
//   scan     Draft an architecture source from repository code with `archify scan`,
//            then deliver it like `deliver` mode.
//
// Inputs arrive as ARCHIFY_* environment variables set by action.yml. Results are
// written to the output directory, the job summary, and step outputs. Every Archify
// command runs without a shell; paths from the repository are passed as argv only.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = path.resolve(HERE, '../../archify/bin/archify.mjs');
const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const COMMENT_MARKER = '<!-- archify-github-action:compare -->';
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);
const MAX_TABLE_ROWS = 50;
const CHANGE_LABELS = { added: 'Added', removed: 'Removed', changed: 'Changed' };

export function readInputs(env = process.env) {
  const bool = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    return /^(true|1|yes)$/i.test(String(value).trim());
  };
  const workspace = path.resolve(env.GITHUB_WORKSPACE || process.cwd());
  return {
    mode: (env.ARCHIFY_MODE || 'deliver').trim(),
    files: splitList(env.ARCHIFY_FILES || ''),
    type: (env.ARCHIFY_TYPE || '').trim(),
    quality: (env.ARCHIFY_QUALITY || 'standard').trim(),
    outputDir: path.resolve(workspace, env.ARCHIFY_OUTPUT_DIR || 'archify-artifacts'),
    repoRoot: env.ARCHIFY_REPO_ROOT ? path.resolve(workspace, env.ARCHIFY_REPO_ROOT) : '',
    baseRef: (env.ARCHIFY_BASE_REF || '').trim(),
    comment: bool(env.ARCHIFY_COMMENT, false),
    failOnError: bool(env.ARCHIFY_FAIL_ON_ERROR, true),
    scanPath: env.ARCHIFY_SCAN_PATH ? path.resolve(workspace, env.ARCHIFY_SCAN_PATH) : '',
    scanTitle: (env.ARCHIFY_SCAN_TITLE || '').trim(),
    token: env.ARCHIFY_GITHUB_TOKEN || '',
    cli: env.ARCHIFY_CLI ? path.resolve(env.ARCHIFY_CLI) : DEFAULT_CLI,
    workspace,
  };
}

export function splitList(value) {
  return String(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function globToRegExp(pattern) {
  let source = '';
  const normalized = pattern.replace(/^\.\//, '');
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        const followedBySlash = normalized[index + 2] === '/';
        source += followedBySlash ? '(?:.*/)?' : '.*';
        index += followedBySlash ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function walk(root, relative = '', found = []) {
  const directory = path.join(root, relative);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, child, found);
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

export function matchFiles(paths, patterns) {
  const expressions = patterns.map(globToRegExp);
  return [...new Set(paths.filter((file) => expressions.some((expression) => expression.test(file))))].sort();
}

function runCli(cli, args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let receipt = null;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    receipt = null;
  }
  return { status: result.status ?? 1, receipt, stdout: result.stdout, stderr: result.stderr || result.error?.message || '' };
}

function git(args, cwd, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: options.encoding ?? 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

function safeName(file) {
  return file.replace(/\.json$/i, '').replace(/[^A-Za-z0-9._-]+/g, '__');
}

function code(value) {
  return `\`${String(value).replace(/`/g, "'").replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')}\``;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function diagnosticsSummary(receipt, fallback) {
  const diagnostics = receipt?.diagnostics || receipt?.validation?.diagnostics || [];
  if (diagnostics.length) {
    return diagnostics.slice(0, 3).map((entry) => entry.code || entry.message).join(', ');
  }
  return String(receipt?.error || fallback || 'failed').split('\n')[0].slice(0, 160);
}

// ---------------------------------------------------------------- deliver

export function deliverFiles(inputs, files) {
  const results = [];
  fs.mkdirSync(inputs.outputDir, { recursive: true });
  for (const file of files) {
    const absolute = path.resolve(inputs.workspace, file);
    let type = inputs.type;
    let declaresRepository = false;
    try {
      const document = readJson(absolute);
      type ||= document.diagram_type;
      declaresRepository = Boolean(document.meta?.repository);
    } catch (error) {
      results.push({ file, type: type || '?', ok: false, detail: `invalid JSON: ${error.message}` });
      continue;
    }
    if (!TYPES.has(type)) {
      results.push({ file, type: type || '?', ok: false, detail: 'unknown diagram_type' });
      continue;
    }
    // Drafts generated inside the output directory are named by file name alone.
    const inOutput = !path.relative(inputs.outputDir, absolute).startsWith('..');
    const artifactName = safeName(inOutput ? path.basename(file) : file);
    const output = path.join(inputs.outputDir, `${artifactName}.html`);
    const args = ['deliver', type, absolute, output, '--json', '--quality', inputs.quality];
    const repoRoot = inputs.repoRoot || (declaresRepository ? inputs.workspace : '');
    if (repoRoot && type === 'architecture') args.push('--repo-root', repoRoot);
    const run = runCli(inputs.cli, args, { cwd: inputs.workspace });
    const receiptPath = path.join(inputs.outputDir, `${artifactName}.receipt.json`);
    fs.writeFileSync(receiptPath, run.stdout || JSON.stringify({ ok: false, error: run.stderr }));
    const ok = run.status === 0 && run.receipt?.ok === true;
    const warnings = run.receipt?.validation?.warnings;
    results.push({
      file,
      type,
      ok,
      output: path.relative(inputs.workspace, output),
      detail: ok ? (warnings ? `${warnings} warning(s)` : 'clean') : diagnosticsSummary(run.receipt, run.stderr),
    });
  }
  return results;
}

export function deliverSummary(results, heading = 'Archify delivery') {
  const passed = results.filter((result) => result.ok).length;
  const lines = [
    `## ${heading}`,
    '',
    results.length === 0
      ? 'No matching diagram sources.'
      : `${passed} of ${results.length} diagram source(s) delivered.`,
  ];
  if (results.length) {
    lines.push('', '| Source | Type | Result | Detail |', '|---|---|---|---|');
    for (const result of results) {
      lines.push(`| ${code(result.file)} | ${result.type} | ${result.ok ? 'pass' : '**fail**'} | ${code(result.detail)} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- compare

function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return {};
  try {
    return JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function resolveBase(inputs, env = process.env) {
  const event = readEvent(env);
  const candidate = inputs.baseRef || event.pull_request?.base?.sha || (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : '');
  if (!candidate) {
    throw new Error('compare mode needs a base revision: run on pull_request or set base-ref');
  }
  if (!git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], inputs.workspace).ok) {
    // Shallow checkouts often lack the base commit; fetch just that revision.
    const fetchTarget = candidate.replace(/^origin\//, '');
    git(['fetch', '--no-tags', '--depth=1', 'origin', fetchTarget], inputs.workspace);
  }
  const resolved = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], inputs.workspace);
  if (!resolved.ok) {
    const fetched = git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'], inputs.workspace);
    if (fetched.ok && !inputs.baseRef && !event.pull_request?.base?.sha) return fetched.stdout.trim();
    throw new Error(`base revision ${candidate} is not available; use actions/checkout with fetch-depth: 0`);
  }
  return resolved.stdout.trim();
}

function labelsOf(document) {
  const labels = {};
  for (const component of document?.components || []) labels[component.id] = component.label || component.id;
  return labels;
}

export function summarizeCompareReceipt(receipt, labels = {}) {
  if (!receipt?.ok) return { ok: false, rows: [], error: diagnosticsSummary(receipt, 'compare failed') };
  const rows = [];
  const nodeName = (change) => change.headLabel || change.baseLabel || change.id;
  const edgeName = (change) => {
    const side = change.head || change.base || {};
    return `${labels[side.from] || side.from || '?'} → ${labels[side.to] || side.to || '?'}`;
  };
  for (const [kind, title, nameOf] of [['components', 'component', nodeName], ['connections', 'connection', edgeName]]) {
    for (const change of receipt.changes?.[kind] || []) {
      if (!CHANGE_LABELS[change.status]) continue;
      // Position-only edits are layout noise for review; semantic, topology, and evidence changes stay.
      if (change.status === 'changed' && (change.classifications || []).every((item) => item === 'geometry')) continue;
      rows.push({ status: change.status, kind: title, name: nameOf(change) });
    }
  }
  return { ok: true, rows };
}

export function compareFiles(inputs, patterns, base) {
  const headFiles = matchFiles(walk(inputs.workspace), patterns);
  const baseListing = git(['ls-tree', '-r', '--name-only', base], inputs.workspace);
  const baseFiles = baseListing.ok ? matchFiles(baseListing.stdout.split('\n').filter(Boolean), patterns) : [];
  const all = [...new Set([...headFiles, ...baseFiles])].sort();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-compare-'));
  fs.mkdirSync(inputs.outputDir, { recursive: true });
  const results = [];
  try {
    for (const file of all) {
      const headPath = path.join(inputs.workspace, file);
      const inHead = headFiles.includes(file);
      const baseBlob = git(['show', `${base}:${file}`], inputs.workspace);
      const inBase = baseFiles.includes(file) && baseBlob.ok;
      let headDocument = null;
      let baseDocument = null;
      try {
        if (inHead) headDocument = readJson(headPath);
        if (inBase) baseDocument = JSON.parse(baseBlob.stdout);
      } catch (error) {
        results.push({ file, state: 'error', error: `invalid JSON: ${error.message}` });
        continue;
      }
      const type = (headDocument || baseDocument)?.diagram_type;
      if (type !== 'architecture') continue;
      if (!inBase) { results.push({ file, state: 'added' }); continue; }
      if (!inHead) { results.push({ file, state: 'removed' }); continue; }
      if (fs.readFileSync(headPath, 'utf8') === baseBlob.stdout) { results.push({ file, state: 'unchanged' }); continue; }

      const basePath = path.join(staging, `${safeName(file)}.base.json`);
      fs.writeFileSync(basePath, baseBlob.stdout);
      const output = path.join(inputs.outputDir, `${safeName(file)}.delta.html`);
      const args = ['compare', 'architecture', basePath, headPath, output, '--json', '--quality', inputs.quality];
      const repoRoot = inputs.repoRoot || ((baseDocument.meta?.repository || headDocument.meta?.repository) ? inputs.workspace : '');
      if (repoRoot) args.push('--repo-root', repoRoot);
      const run = runCli(inputs.cli, args, { cwd: inputs.workspace });
      fs.writeFileSync(path.join(inputs.outputDir, `${safeName(file)}.delta.json`), run.stdout || JSON.stringify({ ok: false, error: run.stderr }));
      const summary = summarizeCompareReceipt(run.receipt || { ok: false, error: run.stderr }, { ...labelsOf(baseDocument), ...labelsOf(headDocument) });
      results.push(summary.ok
        ? { file, state: summary.rows.length ? 'changed' : 'unchanged', rows: summary.rows, output: path.relative(inputs.workspace, output) }
        : { file, state: 'error', error: summary.error });
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return results;
}

export function compareSummary(results, base) {
  const lines = ['## Archify architecture review', ''];
  const changed = results.filter((result) => result.state !== 'unchanged');
  if (!results.length) {
    lines.push('No matching architecture sources in this pull request.');
  } else if (!changed.length) {
    lines.push(`No authored architecture changes against ${code(base.slice(0, 12))}.`);
  } else {
    lines.push(`Compared against base ${code(base.slice(0, 12))}.`);
  }
  for (const result of changed) {
    lines.push('');
    if (result.state === 'added') lines.push(`### ${code(result.file)} — new diagram`);
    else if (result.state === 'removed') lines.push(`### ${code(result.file)} — diagram removed`);
    else if (result.state === 'error') lines.push(`### ${code(result.file)} — comparison failed`, '', code(result.error));
    else {
      lines.push(`### ${code(result.file)} — ${result.rows.length} authored change(s)`, '', '| Change | Kind | Target |', '|---|---|---|');
      for (const row of result.rows.slice(0, MAX_TABLE_ROWS)) {
        lines.push(`| ${CHANGE_LABELS[row.status]} | ${row.kind} | ${code(row.name)} |`);
      }
      if (result.rows.length > MAX_TABLE_ROWS) lines.push('', `…and ${result.rows.length - MAX_TABLE_ROWS} more (see the delta receipt).`);
    }
  }
  lines.push('', '<sub>Architecture Delta compares authored JSON only; it infers no runtime impact, risk, or merge safety.</sub>');
  return `${lines.join('\n')}\n`;
}

export async function upsertPullRequestComment({ token, apiUrl, repository, pullNumber, body }) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };
  const base = `${apiUrl.replace(/\/$/, '')}/repos/${repository}/issues`;
  const content = `${COMMENT_MARKER}\n${body}`;
  let existing = null;
  for (let page = 1; page <= 10 && !existing; page += 1) {
    const response = await fetch(`${base}/${pullNumber}/comments?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`listing comments failed with HTTP ${response.status}`);
    const comments = await response.json();
    existing = comments.find((comment) => typeof comment.body === 'string' && comment.body.startsWith(COMMENT_MARKER));
    if (comments.length < 100) break;
  }
  const response = existing
    ? await fetch(`${base}/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body: content }) })
    : await fetch(`${base}/${pullNumber}/comments`, { method: 'POST', headers, body: JSON.stringify({ body: content }) });
  if (!response.ok) throw new Error(`writing the comment failed with HTTP ${response.status}`);
  return existing ? 'updated' : 'created';
}

// ---------------------------------------------------------------- scan

export function scanProject(inputs) {
  if (!inputs.scanPath) throw new Error('scan mode needs scan-path');
  const draftDirectory = path.join(inputs.outputDir, 'scan');
  fs.mkdirSync(draftDirectory, { recursive: true });
  const name = path.basename(inputs.scanPath) || 'repository';
  const draft = path.join(draftDirectory, `${safeName(name)}.architecture.json`);
  const args = ['scan', inputs.scanPath, '--output', draft, '--json'];
  if (inputs.scanTitle) args.push('--title', inputs.scanTitle);
  const run = runCli(inputs.cli, args, { cwd: inputs.workspace });
  if (run.status !== 0 || !run.receipt?.ok) {
    throw new Error(`archify scan failed: ${diagnosticsSummary(run.receipt, run.stderr)}`);
  }
  return path.relative(inputs.workspace, draft);
}

// ---------------------------------------------------------------- main

function writeOutputs(env, values) {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, ' ')}`);
  fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function publishSummary(env, inputs, markdown) {
  fs.mkdirSync(inputs.outputDir, { recursive: true });
  const summaryPath = path.join(inputs.outputDir, 'summary.md');
  fs.writeFileSync(summaryPath, markdown);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  return summaryPath;
}

export async function main(env = process.env) {
  const inputs = readInputs(env);
  if (!['deliver', 'compare', 'scan'].includes(inputs.mode)) {
    throw new Error(`unknown mode "${inputs.mode}" (expected deliver, compare, or scan)`);
  }
  if (!['standard', 'showcase'].includes(inputs.quality)) {
    throw new Error(`unknown quality "${inputs.quality}" (expected standard or showcase)`);
  }
  if (inputs.type && !TYPES.has(inputs.type)) throw new Error(`unknown type "${inputs.type}"`);

  if (inputs.mode === 'compare') {
    const patterns = inputs.files.length ? inputs.files : ['**/*.architecture.json'];
    const base = resolveBase(inputs, env);
    const results = compareFiles(inputs, patterns, base);
    const markdown = compareSummary(results, base);
    const summaryPath = publishSummary(env, inputs, markdown);
    const failed = results.filter((result) => result.state === 'error').length;
    const changes = results.reduce((total, result) => total + (result.rows?.length || 0), 0)
      + results.filter((result) => result.state === 'added' || result.state === 'removed').length;
    let commented = 'skipped';
    const pullNumber = readEvent(env).pull_request?.number;
    if (inputs.comment && pullNumber && inputs.token && env.GITHUB_REPOSITORY) {
      commented = await upsertPullRequestComment({
        token: inputs.token,
        apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
        repository: env.GITHUB_REPOSITORY,
        pullNumber,
        body: markdown,
      });
    }
    writeOutputs(env, { ok: failed === 0, changes, 'summary-path': summaryPath, 'output-dir': inputs.outputDir, comment: commented });
    return failed && inputs.failOnError ? 1 : 0;
  }

  let files;
  let heading = 'Archify delivery';
  if (inputs.mode === 'scan') {
    files = [scanProject(inputs)];
    heading = 'Archify scan';
  } else {
    if (!inputs.files.length) throw new Error('deliver mode needs files (for example docs/**/*.architecture.json)');
    files = matchFiles(walk(inputs.workspace), inputs.files);
  }
  const results = deliverFiles(inputs, files);
  const summaryPath = publishSummary(env, inputs, deliverSummary(results, heading));
  const failed = results.filter((result) => !result.ok).length;
  writeOutputs(env, {
    ok: failed === 0,
    delivered: results.length - failed,
    failed,
    'summary-path': summaryPath,
    'output-dir': inputs.outputDir,
  });
  return failed && inputs.failOnError ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((status) => {
    process.exitCode = status;
  }, (error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
