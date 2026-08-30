import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildProjectIndex,
  createEvidenceLedger,
  inspectProjectSource,
  searchProjectSource,
  queryProjectIndex,
  repositoryIdentity,
  verifyEvidenceLedger,
} from '../evidence/project-index.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-project-index-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'indexed-app',
    version: '1.2.3',
    dependencies: { zod: '^3.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), [
    "import { answer } from './util.js';",
    'export function run() { return answer; }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export const answer = 42;\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/indexed-app.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return { root, revision: git(root, 'rev-parse', 'HEAD') };
}

function traceGitCalls(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-git-trace-'));
  const wrapper = path.join(directory, 'git');
  const logPath = path.join(directory, 'calls.jsonl');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(wrapper, [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    "fs.appendFileSync(process.env.ARCHIFY_TEST_GIT_TRACE, `${JSON.stringify(args)}\\n`);",
    'let input;',
    'try { input = fs.readFileSync(0); } catch { input = Buffer.alloc(0); }',
    `const result = spawnSync(${JSON.stringify(realGit)}, args, { input, stdio: ['pipe', 'inherit', 'inherit'] });`,
    'if (result.error) throw result.error;',
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n'), { mode: 0o755 });
  const previousPath = process.env.PATH;
  const previousTrace = process.env.ARCHIFY_TEST_GIT_TRACE;
  process.env.PATH = `${directory}${path.delimiter}${previousPath}`;
  process.env.ARCHIFY_TEST_GIT_TRACE = logPath;
  let result;
  try {
    result = action();
  } finally {
    process.env.PATH = previousPath;
    if (previousTrace === undefined) delete process.env.ARCHIFY_TEST_GIT_TRACE;
    else process.env.ARCHIFY_TEST_GIT_TRACE = previousTrace;
  }
  const calls = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { result, calls };
}

function rehashProjectIndex(index) {
  return createHash('sha256').update(JSON.stringify({
    repository: {
      origin: index.repository.origin,
      revision: index.repository.revision,
      objectFormat: index.repository.objectFormat,
    },
    files: index.files,
    packages: index.packages,
    analysis: index.analysis,
  })).digest('hex');
}

test('project index pins repository facts, imports, symbols, and package metadata to one revision', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.repository.revision, data.revision);
  assert.equal(index.repository.objectFormat, 'sha1');
  assert.equal(index.repository.origin, 'https://github.com/example/indexed-app');
  assert.match(index.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(index.files.map((file) => file.path), [
    'package.json',
    'src/index.ts',
    'src/util.ts',
  ]);

  const entry = index.files.find((file) => file.path === 'src/index.ts');
  assert.equal(entry.language, 'typescript');
  assert.deepEqual(entry.imports, ['./util.js']);
  assert.deepEqual(entry.symbols, [{ kind: 'function', name: 'run', line: 2 }]);
  assert.match(entry.blobOid, /^[a-f0-9]{40}$/);
  assert.deepEqual(index.packages, [{
    manager: 'node',
    path: 'package.json',
    name: 'indexed-app',
    version: '1.2.3',
    dependencies: ['typescript', 'zod'],
  }]);

  fs.writeFileSync(path.join(data.root, 'src', 'index.ts'), 'working tree change\n');
  const repeated = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.equal(repeated.digest, index.digest);
  assert.deepEqual(repeated.files, index.files);
});

test('project index query returns a compact mechanical slice with editable evidence hints', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const receipt = queryProjectIndex(index, {
    symbols: ['run'],
    imports: ['./util.js'],
    paths: ['src'],
    languages: ['typescript'],
    maxResults: 5,
  });

  assert.equal(receipt.command, 'project-index-query');
  assert.equal(receipt.indexDigest, index.digest);
  assert.deepEqual(receipt.summary, {
    filesMatched: 1,
    packagesMatched: 0,
    returned: 1,
    truncated: false,
  });
  assert.equal(receipt.files[0].path, 'src/index.ts');
  assert.deepEqual(receipt.files[0].matched.symbols, [{ kind: 'function', name: 'run', line: 2 }]);
  assert.deepEqual(receipt.files[0].matched.imports, ['./util.js']);
  assert.deepEqual(receipt.files[0].selectionHints[0], {
    claimIdSuggested: 'run-index',
    path: 'src/index.ts',
    line: 2,
    endLine: 2,
    symbol: { kind: 'function', name: 'run' },
    summary: '',
  });

  const packageReceipt = queryProjectIndex(index, { packages: ['zod'] });
  assert.equal(packageReceipt.files.length, 0);
  assert.equal(packageReceipt.packages[0].name, 'indexed-app');
  assert.deepEqual(packageReceipt.packages[0].matched, ['zod']);
  assert.throws(() => queryProjectIndex(index), /requires at least one/);
  assert.throws(() => queryProjectIndex(index, { symbols: ['run'], maxResults: 0 }), /1 through 200/);
});

test('source search reads line-numbered evidence from the pinned commit instead of the working tree', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  fs.writeFileSync(path.join(data.root, 'src', 'index.ts'), 'working tree answer should never be searched\n');

  const receipt = searchProjectSource(index, {
    terms: ['return answer'],
    paths: ['src/index.ts'],
    contextLines: 0,
  });

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.command, 'project-index-source-search');
  assert.equal(receipt.indexDigest, index.digest);
  assert.equal(receipt.repository.origin, 'https://github.com/example/indexed-app');
  assert.equal(receipt.repository.revision, data.revision);
  assert.match(receipt.repository.revision, /^[a-f0-9]{40}$/);
  assert.equal(receipt.truncated, false);
  assert.deepEqual(receipt.matches, [{
    path: 'src/index.ts',
    blobOid: index.files.find((file) => file.path === 'src/index.ts').blobOid,
    line: 2,
    endLine: 2,
    matchedLines: [{ line: 2, terms: ['return answer'] }],
    sourceLines: [{ line: 2, text: 'export function run() { return answer; }' }],
    rangeSha256: '9baf13b41e5ca7d1b8f0e54af609d2aa5c69491e9e86c841e3034e32e5d4fe57',
  }]);
});

test('source search batches multiple terms and paths with stable result limiting', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const searched = traceGitCalls(() => searchProjectSource(index, {
    terms: ['run', 'answer'],
    paths: ['src/util.ts', 'src/index.ts'],
    contextLines: 0,
    maxResults: 2,
  }));

  assert.equal(searched.calls.filter((args) => args.includes('cat-file') && args.includes('--batch')).length, 1);
  assert.deepEqual(searched.result.query.terms, ['answer', 'run']);
  assert.deepEqual(searched.result.query.paths, ['src/index.ts', 'src/util.ts']);
  assert.equal(searched.result.matchesFound, 3);
  assert.equal(searched.result.returned, 2);
  assert.equal(searched.result.truncated, true);
  assert.deepEqual(searched.result.matches.map((match) => ({
    path: match.path,
    line: match.line,
    matchedLines: match.matchedLines,
  })), [
    { path: 'src/index.ts', line: 1, matchedLines: [{ line: 1, terms: ['answer'] }] },
    { path: 'src/index.ts', line: 2, matchedLines: [{ line: 2, terms: ['answer', 'run'] }] },
  ]);
});

test('source search stops materializing repository blobs after the result budget is proven truncated', () => {
  const data = fixture();
  for (let index = 0; index < 40; index += 1) {
    fs.writeFileSync(
      path.join(data.root, `${String(index).padStart(3, '0')}-match.txt`),
      `needle ${index}\n`,
    );
  }
  git(data.root, 'add', '.');
  git(data.root, 'commit', '-m', 'many searchable files');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  const index = buildProjectIndex({ repoRoot: data.root, revision });

  const receipt = searchProjectSource(index, {
    terms: ['needle'],
    contextLines: 0,
    maxResults: 1,
  });

  assert.equal(receipt.returned, 1);
  assert.equal(receipt.truncated, true);
  assert.equal(receipt.matchesFound, 2, 'only the returned result plus one truncation sentinel is materialized');
  assert.ok(receipt.filesRead < index.files.length, 'result limiting must stop blob reads before the whole repository');
  assert.ok(receipt.bytesRead < index.files.reduce((sum, file) => sum + file.bytes, 0));
});

test('source inspect stably limits exact ranges and reads multiple paths in one blob batch', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const inspected = traceGitCalls(() => inspectProjectSource(index, {
    ranges: [
      { path: 'src/util.ts', line: 1, endLine: 1 },
      { path: 'src/index.ts', line: 2, endLine: 2 },
      { path: 'package.json', line: 1, endLine: 1 },
      { path: 'src/index.ts', line: 1, endLine: 1 },
    ],
    maxResults: 3,
  }));

  assert.equal(inspected.calls.filter((args) => args.includes('cat-file') && args.includes('--batch')).length, 1);
  assert.equal(inspected.result.indexDigest, index.digest);
  assert.equal(inspected.result.repository.revision, data.revision);
  assert.equal(inspected.result.returned, 3);
  assert.equal(inspected.result.truncated, true);
  assert.deepEqual(inspected.result.ranges, [
    {
      path: 'package.json',
      blobOid: index.files.find((file) => file.path === 'package.json').blobOid,
      line: 1,
      endLine: 1,
      sourceLines: [{ line: 1, text: '{' }],
      rangeSha256: '021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96',
    },
    {
      path: 'src/index.ts',
      blobOid: index.files.find((file) => file.path === 'src/index.ts').blobOid,
      line: 1,
      endLine: 1,
      sourceLines: [{ line: 1, text: "import { answer } from './util.js';" }],
      rangeSha256: '463ec5abd950497523b0eecfc2e514b7dc84e8b94f6b6fe20e5efff4e477bc01',
    },
    {
      path: 'src/index.ts',
      blobOid: index.files.find((file) => file.path === 'src/index.ts').blobOid,
      line: 2,
      endLine: 2,
      sourceLines: [{ line: 2, text: 'export function run() { return answer; }' }],
      rangeSha256: '9baf13b41e5ca7d1b8f0e54af609d2aa5c69491e9e86c841e3034e32e5d4fe57',
    },
  ]);
});

test('source packets fail closed for tampered origin, revision, index digest, and blob facts', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });

  const malformedIndex = structuredClone(index);
  delete malformedIndex.files.find((file) => file.path === 'src/index.ts').mode;
  malformedIndex.digest = rehashProjectIndex(malformedIndex);
  assert.throws(
    () => searchProjectSource(malformedIndex, { terms: ['answer'], paths: ['src/index.ts'] }),
    (error) => error.code === 'evidence-ledger/index-invalid',
  );

  const originTampered = structuredClone(index);
  originTampered.repository.origin = 'https://github.com/example/not-the-repository';
  originTampered.digest = rehashProjectIndex(originTampered);
  assert.throws(
    () => searchProjectSource(originTampered, { terms: ['answer'], paths: ['src/index.ts'] }),
    (error) => error.code === 'project-index/source-origin-mismatch',
  );

  const digestTampered = structuredClone(index);
  digestTampered.digest = `${index.digest[0] === '0' ? '1' : '0'}${index.digest.slice(1)}`;
  assert.throws(
    () => searchProjectSource(digestTampered, { terms: ['answer'], paths: ['src/index.ts'] }),
    (error) => error.code === 'evidence-ledger/index-digest-mismatch',
  );

  const blobTampered = structuredClone(index);
  blobTampered.files.find((file) => file.path === 'src/index.ts').blobOid = '0'.repeat(40);
  blobTampered.digest = rehashProjectIndex(blobTampered);
  assert.throws(
    () => inspectProjectSource(blobTampered, {
      ranges: [{ path: 'src/index.ts', line: 1, endLine: 1 }],
    }),
    (error) => error.code === 'project-index/source-tree-mismatch',
  );

  fs.writeFileSync(path.join(data.root, 'src', 'later.ts'), 'export const later = true;\n');
  git(data.root, 'add', '.');
  git(data.root, 'commit', '-m', 'later revision');
  const revisionTampered = structuredClone(index);
  revisionTampered.repository.revision = git(data.root, 'rev-parse', 'HEAD');
  revisionTampered.digest = rehashProjectIndex(revisionTampered);

  assert.throws(
    () => searchProjectSource(revisionTampered, { terms: ['return answer'], paths: ['src/index.ts'] }),
    (error) => error.code === 'project-index/source-tree-mismatch',
  );
});

test('source search and inspect redact likely credentials while hashing the original pinned range', () => {
  const data = fixture();
  const secret = 'archify-super-secret-value';
  fs.writeFileSync(path.join(data.root, 'src', 'secrets.ts'), `export const API_TOKEN = "${secret}";\n`);
  git(data.root, 'add', 'src/secrets.ts');
  git(data.root, 'commit', '-m', 'secret redaction fixture');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  const index = buildProjectIndex({ repoRoot: data.root, revision });

  const searched = searchProjectSource(index, { terms: ['API_TOKEN'], paths: ['src/secrets.ts'], contextLines: 0 });
  const inspected = inspectProjectSource(index, {
    ranges: [{ path: 'src/secrets.ts', line: 1, endLine: 1 }],
  });
  for (const receipt of [searched, inspected]) {
    assert.doesNotMatch(JSON.stringify(receipt), new RegExp(secret));
  }
  assert.equal(searched.matches[0].sourceLines[0].text, 'export const API_TOKEN = "[REDACTED]";');
  assert.equal(searched.matches[0].redactions, 1);
  assert.equal(inspected.ranges[0].redactions, 1);
  assert.equal(
    inspected.ranges[0].rangeSha256,
    createHash('sha256').update(`export const API_TOKEN = "${secret}";`).digest('hex'),
  );
});

test('source packet queries reject unbounded term, path, and inspect-range inputs', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.throws(
    () => searchProjectSource(index, { terms: Array.from({ length: 201 }, (_, value) => `term-${value}`) }),
    (error) => error.code === 'project-index/source-query-limit',
  );
  assert.throws(
    () => searchProjectSource(index, {
      terms: ['answer'],
      paths: Array.from({ length: 201 }, (_, value) => `src/path-${value}.ts`),
    }),
    (error) => error.code === 'project-index/source-query-limit',
  );
  assert.throws(
    () => inspectProjectSource(index, {
      ranges: Array.from({ length: 1001 }, () => ({ path: 'src/index.ts', line: 1, endLine: 1 })),
    }),
    (error) => error.code === 'project-index/source-query-limit',
  );
});

test('project-index source-search CLI emits a bounded revision-pinned source receipt', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-source-search-cli-'));
  const indexPath = path.join(directory, 'project-index.json');
  const outputPath = path.join(directory, 'source-search.json');
  fs.writeFileSync(indexPath, JSON.stringify(index));
  fs.writeFileSync(path.join(data.root, 'src', 'index.ts'), 'uncommitted source must not appear\n');

  const result = spawnSync(process.execPath, [
    cli,
    'project-index',
    'source-search',
    indexPath,
    '--term', 'return answer',
    '--term=missing literal',
    '--path', 'src',
    '--context', '0',
    '--max-results', '1',
    '--output', outputPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), receipt);
  assert.equal(receipt.command, 'project-index-source-search');
  assert.equal(receipt.indexDigest, index.digest);
  assert.equal(receipt.repository.revision, data.revision);
  assert.deepEqual(receipt.query, {
    terms: ['missing literal', 'return answer'],
    paths: ['src'],
    contextLines: 0,
    maxResults: 1,
  });
  assert.equal(receipt.returned, 1);
  assert.equal(receipt.matches[0].sourceLines[0].text, 'export function run() { return answer; }');
});

test('project-index inspect CLI resolves explicit ranges from the index revision', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-source-inspect-cli-'));
  const indexPath = path.join(directory, 'project-index.json');
  const outputPath = path.join(directory, 'source-inspect.json');
  fs.writeFileSync(indexPath, JSON.stringify(index));

  const result = spawnSync(process.execPath, [
    cli,
    'project-index',
    'inspect',
    indexPath,
    '--range', 'src/util.ts:1-1',
    '--range=src/index.ts:1-2',
    '--max-results', '1',
    '--output', outputPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), receipt);
  assert.equal(receipt.command, 'project-index-source-inspect');
  assert.equal(receipt.indexDigest, index.digest);
  assert.equal(receipt.repository.revision, data.revision);
  assert.equal(receipt.requested, 2);
  assert.equal(receipt.returned, 1);
  assert.equal(receipt.truncated, true);
  assert.deepEqual(receipt.ranges[0], {
    path: 'src/index.ts',
    blobOid: index.files.find((file) => file.path === 'src/index.ts').blobOid,
    line: 1,
    endLine: 2,
    sourceLines: [
      { line: 1, text: "import { answer } from './util.js';" },
      { line: 2, text: 'export function run() { return answer; }' },
    ],
    rangeSha256: '0f869bdeaa85dd46327c490808cf6f757529ba42451f387ceb6f3c4558302112',
  });
});

test('project-index query and evidence-ledger hydrate CLI avoid full-index rediscovery', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-project-query-'));
  const indexPath = path.join(directory, 'index.json');
  const selectionsPath = path.join(directory, 'selections.json');
  fs.writeFileSync(indexPath, JSON.stringify(index));
  fs.writeFileSync(selectionsPath, JSON.stringify([{
    claimId: 'run-entry',
    path: 'src/index.ts',
    line: 2,
    summary: 'run returns the imported answer',
  }]));

  const queried = spawnSync(process.execPath, [
    cli,
    'project-index',
    'query',
    indexPath,
    '--symbols', 'run,missing',
    '--max-results', '3',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(queried.status, 0, queried.stderr);
  const queryReceipt = JSON.parse(queried.stdout);
  assert.equal(queryReceipt.files.length, 1);
  assert.equal(queryReceipt.files[0].path, 'src/index.ts');

  const hydrated = spawnSync(process.execPath, [
    cli,
    'evidence-ledger',
    'hydrate',
    indexPath,
    selectionsPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(hydrated.status, 0, hydrated.stderr);
  const ledger = JSON.parse(hydrated.stdout);
  assert.equal(ledger.facts[0].blobOid, index.files.find((file) => file.path === 'src/index.ts').blobOid);
  assert.match(ledger.facts[0].rangeSha256, /^[a-f0-9]{64}$/);
});

test('evidence ledger records range hashes and revalidates every selected fact fail-closed', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const ledger = createEvidenceLedger(index, [{
    claimId: 'run-imports-answer',
    path: 'src/index.ts',
    line: 1,
    endLine: 2,
    summary: 'run reads the imported answer',
  }]);

  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.repository.revision, data.revision);
  assert.equal(ledger.repository.objectFormat, 'sha1');
  assert.equal(ledger.facts.length, 1);
  assert.match(ledger.facts[0].rangeSha256, /^[a-f0-9]{64}$/);
  assert.equal(ledger.facts[0].blobOid, index.files[1].blobOid);
  assert.deepEqual(verifyEvidenceLedger(ledger, { repoRoot: data.root, projectIndex: index }), {
    schemaVersion: 1,
    verified: true,
    ledgerDigest: ledger.ledgerDigest,
    indexDigest: index.digest,
    origin: index.repository.origin,
    revision: data.revision,
    objectFormat: 'sha1',
    factCount: 1,
  });
  assert.throws(
    () => verifyEvidenceLedger(ledger, { repoRoot: data.root }),
    /requires the original ProjectIndex receipt/,
  );

  const digestTampered = structuredClone(ledger);
  digestTampered.repository.indexDigest = `${ledger.repository.indexDigest[0] === '0' ? '1' : '0'}${ledger.repository.indexDigest.slice(1)}`;
  assert.match(digestTampered.repository.indexDigest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => verifyEvidenceLedger(digestTampered, { repoRoot: data.root, projectIndex: index }),
    /index digest does not match/,
  );

  const tampered = structuredClone(ledger);
  tampered.facts[0].rangeSha256 = '0'.repeat(64);
  assert.throws(
    () => verifyEvidenceLedger(tampered, { repoRoot: data.root, projectIndex: index }),
    /ledger digest does not match/,
  );
});

test('evidence ledger digest binds repository, claims, summaries, and ranges to verification', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const first = createEvidenceLedger(index, [{
    claimId: 'first-claim',
    path: 'src/index.ts',
    line: 1,
    summary: 'first summary',
  }]);
  const second = createEvidenceLedger(index, [{
    claimId: 'second-claim',
    path: 'src/index.ts',
    line: 2,
    summary: 'second summary',
  }]);
  assert.match(first.ledgerDigest, /^[a-f0-9]{64}$/);
  assert.match(second.ledgerDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.repository.revision, second.repository.revision);
  assert.equal(first.facts.length, second.facts.length);
  assert.notEqual(first.ledgerDigest, second.ledgerDigest);

  const summaryTampered = structuredClone(first);
  summaryTampered.facts[0].summary = 'tampered summary';
  assert.throws(
    () => verifyEvidenceLedger(summaryTampered, { repoRoot: data.root, projectIndex: index }),
    /ledger digest does not match/,
  );
  const digestTampered = structuredClone(first);
  digestTampered.ledgerDigest = `${first.ledgerDigest[0] === '0' ? '1' : '0'}${first.ledgerDigest.slice(1)}`;
  assert.throws(
    () => verifyEvidenceLedger(digestTampered, { repoRoot: data.root, projectIndex: index }),
    /ledger digest does not match/,
  );
});

test('evidence ledger batches repeated source reads by unique path and blob', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const created = traceGitCalls(() => createEvidenceLedger(index, [
    { claimId: 'import', path: 'src/index.ts', line: 1 },
    { claimId: 'function', path: 'src/index.ts', line: 2 },
  ]));
  assert.equal(created.result.facts.length, 2);
  assert.equal(created.calls.filter((args) => args.includes('cat-file') && args.includes('--batch')).length, 1);
  assert.equal(created.calls.filter((args) => args.includes('cat-file') && args.includes('-p')).length, 0);

  const verified = traceGitCalls(() => verifyEvidenceLedger(created.result, {
    repoRoot: data.root,
    projectIndex: index,
  }));
  assert.equal(verified.result.verified, true);
  assert.equal(verified.calls.filter((args) => args.includes('ls-tree')).length, 1);
  assert.equal(verified.calls.filter((args) => args.includes('cat-file') && args.includes('--batch')).length, 1);
  assert.equal(verified.calls.filter((args) => args.includes('cat-file') && args.includes('-p')).length, 0);
});

test('evidence ledger rejects empty and malformed fact receipts before verification', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const ledger = createEvidenceLedger(index, [{
    claimId: 'valid-claim',
    path: 'src/index.ts',
    line: 1,
    endLine: 2,
  }]);
  const malformed = [
    (value) => { value.facts = []; },
    (value) => { value.facts[0].claimId = '   '; },
    (value) => { value.facts.push(structuredClone(value.facts[0])); },
    (value) => { value.facts[0].path = '../src/index.ts'; },
    (value) => { value.facts[0].path = 'src\\index.ts'; },
    (value) => { value.facts[0].blobOid = 'not-a-blob'; },
    (value) => { value.facts[0].rangeSha256 = 'not-a-range-hash'; },
    (value) => { value.facts[0].line = 0; },
    (value) => { value.facts[0].line = 1.5; },
    (value) => { value.facts[0].endLine = 0; },
    (value) => { value.facts[0].summary = 42; },
    (value) => { value.repository.indexDigest = 'not-an-index-digest'; },
  ];

  for (const mutate of malformed) {
    const value = structuredClone(ledger);
    mutate(value);
    assert.throws(
      () => verifyEvidenceLedger(value, { repoRoot: data.root, projectIndex: index }),
      (error) => ['evidence-ledger/schema-invalid', 'evidence-ledger/fact-invalid'].includes(error.code),
    );
  }

  const tamperedIndex = structuredClone(index);
  tamperedIndex.digest = '0'.repeat(64);
  assert.throws(
    () => createEvidenceLedger(tamperedIndex, [{ claimId: 'claim', path: 'src/index.ts', line: 1 }]),
    /digest does not match/,
  );
  assert.throws(
    () => createEvidenceLedger(index, [{ claimId: 'claim', path: '../src/index.ts', line: 1 }]),
    /unique claimId/,
  );
});

test('canonical and raw GitHub repository identities compare compatibly', () => {
  const data = fixture();
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  const ledger = createEvidenceLedger(index, [{ claimId: 'origin', path: 'src/index.ts', line: 1 }]);

  for (const origin of [
    'https://github.com/EXAMPLE/INDEXED-APP',
    'git@github.com:example/indexed-app.git',
    'https://github.com/example/indexed-app.git',
  ]) {
    const compatible = structuredClone(ledger);
    compatible.repository.origin = origin;
    assert.equal(verifyEvidenceLedger(compatible, { repoRoot: data.root, projectIndex: index }).verified, true);
  }
});

test('repository identities are unambiguous canonical URIs and remain idempotent', () => {
  const data = fixture();
  const github = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.equal(github.repository.origin, 'https://github.com/example/indexed-app');
  git(data.root, 'remote', 'set-url', 'origin', github.repository.origin);
  assert.equal(
    buildProjectIndex({ repoRoot: data.root, revision: data.revision }).repository.origin,
    github.repository.origin,
  );

  git(data.root, 'remote', 'set-url', 'origin', 'github:example/indexed-app.git');
  const scpAlias = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.equal(scpAlias.repository.origin, 'ssh://github/example/indexed-app');
  assert.notEqual(scpAlias.repository.origin, github.repository.origin);
  git(data.root, 'remote', 'set-url', 'origin', scpAlias.repository.origin);
  assert.equal(
    buildProjectIndex({ repoRoot: data.root, revision: data.revision }).repository.origin,
    scpAlias.repository.origin,
  );

  git(data.root, 'remote', 'set-url', 'origin', '/team/indexed-app.git');
  const absoluteLocal = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  git(data.root, 'remote', 'set-url', 'origin', 'team/indexed-app.git');
  const relativeLocal = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.equal(absoluteLocal.repository.origin, 'file:///team/indexed-app.git');
  assert.equal(
    relativeLocal.repository.origin,
    pathToFileURL(path.join(fs.realpathSync(data.root), 'team', 'indexed-app.git')).href,
  );
  assert.notEqual(absoluteLocal.repository.origin, relativeLocal.repository.origin);
  git(data.root, 'remote', 'set-url', 'origin', relativeLocal.repository.origin);
  assert.equal(
    buildProjectIndex({ repoRoot: data.root, revision: data.revision }).repository.origin,
    relativeLocal.repository.origin,
  );
});

test('relative local repository identity is checkout-relative and independent of process cwd', () => {
  const data = fixture();
  git(data.root, 'remote', 'set-url', 'origin', '../bare.git');
  const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-index-cwd-a-'));
  const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-index-cwd-b-'));
  const run = (cwd) => spawnSync(process.execPath, [
    cli,
    'project-index',
    data.root,
    '--revision', data.revision,
    '--json',
  ], { cwd, encoding: 'utf8' });
  const first = run(cwdA);
  const second = run(cwdB);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstIndex = JSON.parse(first.stdout);
  const secondIndex = JSON.parse(second.stdout);
  assert.equal(
    firstIndex.repository.origin,
    pathToFileURL(path.resolve(fs.realpathSync(data.root), '../bare.git')).href,
  );
  assert.equal(secondIndex.repository.origin, firstIndex.repository.origin);
  assert.equal(secondIndex.digest, firstIndex.digest);
});

test('local repository identities preserve Git suffixes and filename punctuation', () => {
  const data = fixture();
  const identities = new Map();
  for (const remote of ['/team/repo', '/team/repo.git', '/team/repo#copy', '/team/repo?copy']) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    identities.set(remote, buildProjectIndex({ repoRoot: data.root, revision: data.revision }).repository.origin);
  }
  assert.equal(new Set(identities.values()).size, identities.size);
  assert.equal(identities.get('/team/repo.git'), 'file:///team/repo.git');
  assert.equal(identities.get('/team/repo#copy'), 'file:///team/repo%23copy');
  assert.equal(identities.get('/team/repo?copy'), 'file:///team/repo%3Fcopy');
  assert.equal(repositoryIdentity('file:///team/repo?copy'), 'file:///team/repo%3Fcopy');
  assert.equal(repositoryIdentity('file:///team/repo%23copy'), 'file:///team/repo%23copy');
});

test('Windows drive and UNC remotes cannot collide with SCP remotes', () => {
  assert.equal(repositoryIdentity('C:\\Team\\repo.git'), 'file:///C:/Team/repo.git');
  assert.equal(repositoryIdentity('C:/Team/repo.git'), 'file:///C:/Team/repo.git');
  assert.equal(repositoryIdentity('\\\\fileserver\\share\\repo.git'), 'file://fileserver/share/repo.git');
  assert.equal(repositoryIdentity('file:///C:/Team/repo.git'), 'file:///C:/Team/repo.git');
  assert.equal(repositoryIdentity('file://fileserver/share/repo.git'), 'file://fileserver/share/repo.git');
  assert.equal(repositoryIdentity('C:Team/repo.git'), 'ssh://c/Team/repo');
  assert.notEqual(repositoryIdentity('C:\\Team\\repo.git'), repositoryIdentity('C:Team/repo.git'));
});

test('project index rejects a nested directory and unavailable revisions', () => {
  const data = fixture();
  assert.throws(
    () => buildProjectIndex({ repoRoot: path.join(data.root, 'src'), revision: data.revision }),
    /Git top-level directory/,
  );
  assert.throws(
    () => buildProjectIndex({ repoRoot: data.root, revision: 'f'.repeat(40) }),
    /does not identify an available commit/,
  );
});

test('project index and evidence ledger honor Git sha256 object IDs when supported', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-project-sha256-'));
  const initialized = spawnSync('git', ['init', '--object-format=sha256', root], { encoding: 'utf8' });
  if (initialized.status !== 0) {
    t.skip('installed Git does not support sha256 object repositories');
    return;
  }
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const sha256 = true;\n');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/sha256.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'sha256 fixture');
  const revision = git(root, 'rev-parse', 'HEAD');
  assert.match(revision, /^[a-f0-9]{64}$/);

  const index = buildProjectIndex({ repoRoot: root, revision });
  assert.equal(index.repository.objectFormat, 'sha256');
  assert.equal(index.repository.revision, revision);
  assert.match(index.files[0].blobOid, /^[a-f0-9]{64}$/);
  const ledger = createEvidenceLedger(index, [{ claimId: 'sha256', path: 'src/index.ts', line: 1 }]);
  assert.equal(ledger.repository.objectFormat, 'sha256');
  assert.match(ledger.facts[0].blobOid, /^[a-f0-9]{64}$/);
  const verified = verifyEvidenceLedger(ledger, { repoRoot: root, projectIndex: index });
  assert.equal(verified.objectFormat, 'sha256');
  assert.equal(verified.revision, revision);

  const wrongLength = structuredClone(ledger);
  wrongLength.facts[0].blobOid = 'a'.repeat(40);
  assert.throws(
    () => verifyEvidenceLedger(wrongLength, { repoRoot: root, projectIndex: index }),
    (error) => error.code === 'evidence-ledger/fact-invalid',
  );
});

test('project index uses stable binary path ordering', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.root, 'src', 'Z.ts'), 'export const upper = true;\n');
  fs.writeFileSync(path.join(data.root, 'src', 'a.ts'), 'export const lower = true;\n');
  fs.writeFileSync(path.join(data.root, 'src', 'é.ts'), 'export const accented = true;\n');
  git(data.root, 'add', '.');
  git(data.root, 'commit', '-m', 'add sorting fixtures');
  const revision = git(data.root, 'rev-parse', 'HEAD');

  const index = buildProjectIndex({ repoRoot: data.root, revision });
  assert.deepEqual(index.files.map((file) => file.path), [
    'package.json',
    'src/Z.ts',
    'src/a.ts',
    'src/index.ts',
    'src/util.ts',
    'src/é.ts',
  ]);
});

test('project index budgets analysis per path while deduplicating blob reads only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-project-budget-'));
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const shared = Buffer.alloc(1024 * 1024, 0x20);
  Buffer.from('export const shared = 1;').copy(shared);
  const firstPath = path.join(sourceRoot, '000.ts');
  fs.writeFileSync(firstPath, shared);
  for (let index = 1; index < 65; index += 1) {
    fs.linkSync(firstPath, path.join(sourceRoot, `${String(index).padStart(3, '0')}.ts`));
  }
  fs.writeFileSync(path.join(sourceRoot, 'oversized.ts'), Buffer.alloc((1024 * 1024) + 1, 0x20));
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/budget.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'budget fixture');
  const revision = git(root, 'rev-parse', 'HEAD');

  const index = buildProjectIndex({ repoRoot: root, revision });
  assert.equal(index.analysis.filesAnalyzed, 64);
  assert.equal(index.analysis.filesSkipped, 2);
  assert.equal(index.analysis.bytesAnalyzed, 64 * 1024 * 1024);
  assert.deepEqual(index.analysis.skipped, [
    { path: 'src/064.ts', bytes: 1024 * 1024, reason: 'max-total-bytes' },
    { path: 'src/oversized.ts', bytes: (1024 * 1024) + 1, reason: 'max-file-bytes' },
  ]);

  const analyzed = index.files.find((file) => file.path === 'src/000.ts');
  const skipped = index.files.find((file) => file.path === 'src/064.ts');
  assert.equal(analyzed.blobOid, skipped.blobOid);
  assert.equal(Object.hasOwn(analyzed, 'symbols'), true);
  assert.equal(Object.hasOwn(skipped, 'symbols'), false);
  assert.equal(Object.hasOwn(skipped, 'imports'), false);
});

test('project index and evidence receipts never retain remote credentials or query secrets', () => {
  const data = fixture();
  git(data.root, 'remote', 'set-url', 'origin', 'https://agent:super-secret@example.test/team/indexed-app.git?token=query-secret');
  const index = buildProjectIndex({ repoRoot: data.root, revision: data.revision });
  assert.equal(index.repository.origin, 'https://example.test/team/indexed-app');
  assert.doesNotMatch(JSON.stringify(index), /agent|super-secret|query-secret/);

  const ledger = createEvidenceLedger(index, [{
    claimId: 'safe-origin',
    path: 'src/index.ts',
    line: 1,
  }]);
  assert.equal(ledger.repository.origin, 'https://example.test/team/indexed-app');
  assert.doesNotMatch(JSON.stringify(ledger), /agent|super-secret|query-secret/);
  assert.equal(verifyEvidenceLedger(ledger, { repoRoot: data.root, projectIndex: index }).verified, true);
});

test('project-index and evidence-ledger CLI round-trip pinned receipts', () => {
  const data = fixture();
  const output = path.join(data.root, 'project-index.json');
  let result = spawnSync(process.execPath, [
    cli,
    'project-index',
    data.root,
    '--revision', data.revision,
    '--output', output,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).digest, JSON.parse(fs.readFileSync(output, 'utf8')).digest);

  const selectionPath = path.join(data.root, 'selections.json');
  const ledgerPath = path.join(data.root, 'evidence-ledger.json');
  fs.writeFileSync(selectionPath, JSON.stringify([{ claimId: 'run', path: 'src/index.ts', line: 1, endLine: 2 }]));
  result = spawnSync(process.execPath, [
    cli,
    'evidence-ledger',
    'create',
    output,
    selectionPath,
    '--output', ledgerPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).facts.length, 1);

  result = spawnSync(process.execPath, [
    cli,
    'evidence-ledger',
    'verify',
    ledgerPath,
    '--repo-root', data.root,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--project-index <index\.json>/);

  result = spawnSync(process.execPath, [
    cli,
    'evidence-ledger',
    'verify',
    ledgerPath,
    '--project-index', output,
    '--repo-root', data.root,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    verified: true,
    ledgerDigest: JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).ledgerDigest,
    indexDigest: JSON.parse(fs.readFileSync(output, 'utf8')).digest,
    origin: 'https://github.com/example/indexed-app',
    revision: data.revision,
    objectFormat: 'sha1',
    factCount: 1,
  });
});
