import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildConfigurationLevel1, buildConfigurationPlan, DEFAULT_LIMITS as LEVEL1_DEFAULT_LIMITS } from './config-level1.mjs';

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const MAX_REPORTED_MODULES = 100;
const BINARY_SAMPLE_BYTES = 8192;

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode',
  'node_modules', 'vendor', 'dist', 'build', 'coverage', 'target',
  '.next', '.nuxt', '.output', '.cache', '.pytest_cache', '.mypy_cache',
  '.ruff_cache', '.tox', '.nox', '.gradle', '.terraform', '.turbo', '.dart_tool',
  '__pycache__', '.venv', 'venv', 'site-packages', '_archive', 'out', 'generated', 'gen',
  'logs', 'log', 'deriveddata', 'pods',
]);

const EXCLUDED_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dll', '.dylib', '.eot',
  '.exe', '.flac', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.lockb',
  '.map', '.mov', '.mp3', '.mp4', '.o', '.obj', '.otf', '.pdf', '.png',
  '.pyc', '.so', '.sqlite', '.sqlite3', '.tar', '.tiff', '.ttf', '.wav',
  '.webm', '.webp', '.woff', '.woff2', '.xls', '.xlsx', '.zip',
]);

const EXCLUDED_BASENAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'cargo.lock', 'poetry.lock', 'uv.lock', 'composer.lock', 'gemfile.lock', 'go.sum',
]);

const EXCLUDED_FILE = /(?:^|\/)(?:npm-debug|yarn-debug|yarn-error|pnpm-debug)\.log$|(?:\.min\.[cm]?[jt]s|\.generated\.[^/]+|\.log|\.tmp|\.temp|\.bak|\.swp)$/i;

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyw': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.cs': 'csharp',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.scala': 'scala',
  '.ex': 'elixir', '.exs': 'elixir', '.clj': 'clojure', '.cljs': 'clojure',
  '.dart': 'dart', '.lua': 'lua', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell', '.sql': 'sql', '.vue': 'vue', '.svelte': 'svelte',
}));

const MANIFESTS = new Map([
  ['package.json', 'node-package'], ['pyproject.toml', 'python-project'],
  ['requirements.txt', 'python-requirements'], ['setup.py', 'python-package'],
  ['go.mod', 'go-module'], ['cargo.toml', 'rust-package'],
  ['pom.xml', 'maven-project'], ['build.gradle', 'gradle-project'],
  ['build.gradle.kts', 'gradle-project'], ['gemfile', 'ruby-bundle'],
  ['composer.json', 'php-package'], ['mix.exs', 'elixir-project'],
  ['deno.json', 'deno-project'], ['deno.jsonc', 'deno-project'],
]);

const ENTRYPOINT_BASENAME = /^(?:main|app|application|server|cli|worker|manage|program|bootstrap)\.(?:[cm]?[jt]sx?|pyw?|go|rs|java|kt|kts|cs|rb|php|swift|scala|exs?|clj|dart|lua|sh|ps1)$/i;
const INDEX_BASENAME = /^index\.(?:[cm]?[jt]sx?|pyw?|go|rs|java|kt|kts|cs|rb|php|swift|scala|exs?|clj|dart|lua|sh|ps1)$/i;
const TEST_PATH = /(^|\/)(?:test|tests|__tests__|spec|specs)(\/|$)|(?:\.test|\.spec|_test|test_)\.[^/]+$/i;
const DOC_PATH = /(^|\/)(?:docs?|documentation)(\/|$)|\.(?:md|mdx|rst|adoc)$/i;
const INFRA_PATH = /(^|\/)(?:\.github\/workflows|k8s|kubernetes|helm|terraform|deploy|deployment|infra)(\/|$)|(^|\/)(?:dockerfile[^/]*|compose[^/]*\.ya?ml|docker-compose[^/]*\.ya?ml)$|\.(?:tf|tfvars)$/i;
const CONFIG_EXTENSION = /\.(?:jsonc?|ya?ml|toml|ini|conf|config|properties|xml|env|gradle)$/i;

function toPosix(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function excludedDirectory(relativePath) {
  return relativePath.split('/').some((part) => {
    const normalized = part.toLowerCase();
    return EXCLUDED_DIRECTORIES.has(normalized) || /^\.?venv(?:[-_.].+)?$/.test(normalized);
  })
    || /^\.validator-check-/i.test(relativePath);
}

function excludedFile(relativePath) {
  return EXCLUDED_BASENAMES.has(path.posix.basename(relativePath).toLowerCase())
    || EXCLUDED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
    || EXCLUDED_FILE.test(relativePath);
}

function sensitiveFile(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (!basename.startsWith('.env')) return false;
  return !/^\.env\.(?:example|sample|template)$/.test(basename);
}

function manifestKind(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (MANIFESTS.has(basename)) return MANIFESTS.get(basename);
  if (/\.csproj$/i.test(basename)) return 'dotnet-project';
  if (/^(?:workspace|project)\.ya?ml$/i.test(basename)) return 'workspace-config';
  return null;
}

function isEntrypoint(relativePath, language) {
  if (!language) return false;
  const basename = path.posix.basename(relativePath);
  if (ENTRYPOINT_BASENAME.test(basename)) return true;
  if (!INDEX_BASENAME.test(basename)) return false;
  const segments = relativePath.split('/');
  return segments.length <= 2 || (segments.length <= 3 && ['src', 'app', 'bin', 'cmd'].includes(segments[0].toLowerCase()));
}

function roleOf(relativePath, language, manifest, infrastructure) {
  if (TEST_PATH.test(relativePath)) return 'test';
  if (manifest) return 'manifest';
  if (infrastructure) return 'infrastructure';
  if (DOC_PATH.test(relativePath)) return 'documentation';
  if (language) return 'source';
  if (CONFIG_EXTENSION.test(relativePath) || /(^|\/)\.[^/]+rc$/i.test(relativePath)) return 'config';
  return 'other-text';
}

function modulePathOf(relativePath) {
  const segments = relativePath.split('/');
  if (segments.length === 1) return '.';
  const first = segments[0].toLowerCase();
  if (['apps', 'packages', 'services', 'modules', 'cmd', 'internal'].includes(first) && segments.length >= 3) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (['src', 'app', 'lib'].includes(first) && segments.length >= 3) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

function gitFiles(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean).map(toPosix);
}

function walkFiles(root) {
  const files = [];
  const pending = [''];
  while (pending.length) {
    const relativeDir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = toPosix(path.join(relativeDir, entry.name));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectory(relative)) pending.push(relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  return files;
}

export function repositoryState(root) {
  const headResult = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (headResult.error || headResult.status !== 0) {
    return { source: 'filesystem', head: null, dirty: null, fingerprint: null, reusable: false };
  }
  const statusResult = spawnSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
  });
  if (statusResult.error || statusResult.status !== 0) {
    return { source: 'git-working-tree', head: headResult.stdout.trim(), dirty: null, fingerprint: null, reusable: false };
  }
  const head = headResult.stdout.trim();
  const fingerprintHash = createHash('sha256').update(head).update('\0').update(statusResult.stdout);
  const statusEntries = statusResult.stdout.toString('utf8').split('\0').filter(Boolean);
  for (let index = 0; index < statusEntries.length; index += 1) {
    const entry = statusEntries[index];
    const status = entry.slice(0, 2);
    const relativePath = toPosix(entry.slice(3));
    if (status[0] === 'R' || status[0] === 'C') index += 1;
    const absolutePath = path.resolve(root, ...relativePath.split('/'));
    if (!isInside(root, absolutePath)) continue;
    try {
      const stat = fs.lstatSync(absolutePath);
      fingerprintHash.update('\0').update(relativePath).update('\0').update(String(stat.mode));
      if (stat.isSymbolicLink()) fingerprintHash.update(fs.readlinkSync(absolutePath));
      else if (stat.isFile()) fingerprintHash.update(fs.readFileSync(absolutePath));
    } catch {
      fingerprintHash.update('\0missing');
    }
  }
  const fingerprint = fingerprintHash.digest('hex');
  return {
    source: 'git-working-tree',
    head,
    dirty: statusResult.stdout.length > 0,
    fingerprint,
    reusable: true,
  };
}

// Extensions whose content type is already settled by the name. Sniffing them
// costs one open+read per file and can only confirm what the extension says,
// so the sniff is reserved for files the name does not identify.
const TEXT_EXTENSION = /\.(?:md|mdx|rst|adoc|txt|csv|tsv|log|lock|patch|diff|proto|tf|tfvars|gradle|properties|cfg|conf|ini|env|editorconfig|gitignore|gitattributes|dockerignore|npmrc|nvmrc|snap|map|svg|html?|css|scss|less)$/i;

function looksBinary(absolutePath, size, extension) {
  if (size === 0) return false;
  if (LANGUAGE_BY_EXTENSION.has(extension) || CONFIG_EXTENSION.test(extension) || TEXT_EXTENSION.test(extension)) return false;
  const descriptor = fs.openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(Math.min(size, BINARY_SAMPLE_BYTES));
    const read = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).includes(0);
  } finally {
    fs.closeSync(descriptor);
  }
}

function compareModules(left, right) {
  if (left === '.') return -1;
  if (right === '.') return 1;
  return left.localeCompare(right);
}

function compareFiles(left, right) {
  const roleOrder = new Map([
    ['manifest', 0], ['infrastructure', 1], ['config', 2], ['source', 3],
    ['test', 4], ['documentation', 5], ['other-text', 6],
  ]);
  if (left.entrypoint !== right.entrypoint) return left.entrypoint ? -1 : 1;
  return (roleOrder.get(left.role) ?? 99) - (roleOrder.get(right.role) ?? 99)
    || left.path.localeCompare(right.path);
}

function roundRobinModules(modules) {
  const orderedModules = [...modules.values()].sort((left, right) => compareModules(left.path, right.path));
  const queues = orderedModules.map((module) => [...module.records].sort(compareFiles));
  const ordered = [];
  for (let offset = 0; ; offset += 1) {
    let appended = false;
    for (const queue of queues) {
      if (offset < queue.length) {
        ordered.push(queue[offset]);
        appended = true;
      }
    }
    if (!appended) return ordered;
  }
}

function publicFile(record) {
  return {
    path: record.path,
    module: record.modulePath,
    role: record.role,
    size: record.size,
    ...(record.language ? { language: record.language } : {}),
    ...(record.manifest ? { manifest: record.manifest } : {}),
    ...(record.entrypoint ? { entrypoint: true } : {}),
  };
}

export function createRepositorySnapshot(root) {
  const absoluteRoot = path.resolve(root || '.');
  let rootStat;
  try {
    rootStat = fs.statSync(absoluteRoot);
  } catch (error) {
    throw new Error(`Repository root cannot be read: ${error.message}`);
  }
  if (!rootStat.isDirectory()) throw new Error('Repository root must be a directory.');

  const stateBefore = repositoryState(absoluteRoot);
  const discovered = gitFiles(absoluteRoot);
  const discovery = discovered ? 'git' : 'filesystem';
  const names = [...new Set(discovered || walkFiles(absoluteRoot))].sort();
  const records = [];
  const filtered = {
    directories: 0, excludedFiles: 0, sensitiveFiles: 0, binaries: 0, symlinks: 0, unreadable: 0,
  };
  const languages = new Map();
  const roles = new Map();

  for (const relativePath of names) {
    if (!relativePath || path.posix.isAbsolute(relativePath) || relativePath.split('/').includes('..')) continue;
    if (excludedDirectory(relativePath)) { filtered.directories += 1; continue; }
    if (sensitiveFile(relativePath)) { filtered.sensitiveFiles += 1; continue; }
    if (excludedFile(relativePath)) { filtered.excludedFiles += 1; continue; }
    const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'));
    if (!isInside(absoluteRoot, absolutePath)) continue;
    const extension = path.extname(relativePath).toLowerCase();
    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) { filtered.symlinks += 1; continue; }
      if (!stat.isFile()) continue;
      if (looksBinary(absolutePath, stat.size, extension)) { filtered.binaries += 1; continue; }
    } catch {
      filtered.unreadable += 1;
      continue;
    }

    const language = LANGUAGE_BY_EXTENSION.get(extension) || null;
    const manifest = manifestKind(relativePath);
    const infrastructure = INFRA_PATH.test(relativePath);
    const role = roleOf(relativePath, language, manifest, infrastructure);
    const entrypoint = isEntrypoint(relativePath, language);
    const modulePath = modulePathOf(relativePath);
    records.push({ path: relativePath, size: stat.size, language, manifest, infrastructure, role, entrypoint, modulePath });
    roles.set(role, (roles.get(role) || 0) + 1);
    if (language) languages.set(language, (languages.get(language) || 0) + 1);
  }

  return {
    schemaVersion: 1,
    root: absoluteRoot,
    createdAt: new Date().toISOString(),
    repositoryState: stateBefore,
    discovery,
    discoveredFiles: names.length,
    records,
    filtered,
    roles: Object.fromEntries([...roles].sort(([left], [right]) => left.localeCompare(right))),
    languages: Object.fromEntries([...languages].sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function assertRepositorySnapshotCurrent(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.records) || !snapshot.root) {
    throw new Error('Repository snapshot is invalid or unsupported.');
  }
  for (const record of snapshot.records) {
    if (!record || typeof record.path !== 'string' || !record.path
      || path.posix.isAbsolute(record.path) || record.path.split('/').includes('..')) {
      throw new Error('Repository snapshot contains an invalid file path.');
    }
  }
  if (!snapshot.repositoryState?.reusable || !snapshot.repositoryState.fingerprint) {
    throw new Error('Repository snapshot cannot be safely reused because this directory is not a readable Git working tree.');
  }
  const current = repositoryState(snapshot.root);
  if (!current.reusable || current.fingerprint !== snapshot.repositoryState.fingerprint) {
    throw new Error('Repository changed after this inspection snapshot was created; start again without --snapshot.');
  }
  return current;
}

export function buildRepositoryIndex(root, options = {}) {
  const started = process.hrtime.bigint();
  const absoluteRoot = path.resolve(root || '.');
  const createdSnapshot = !options.snapshot;
  const snapshot = options.snapshot || createRepositorySnapshot(absoluteRoot);
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.records) || !snapshot.repositoryState) {
    throw new Error('Repository snapshot is invalid or unsupported.');
  }
  if (snapshot.records.some((record) => !record || typeof record.path !== 'string' || !record.path
    || path.posix.isAbsolute(record.path) || record.path.split('/').includes('..'))) {
    throw new Error('Repository snapshot contains an invalid file path.');
  }
  if (path.resolve(snapshot.root) !== absoluteRoot) throw new Error('Repository snapshot root does not match the requested repository.');

  const batchSize = Number(options.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
  }
  const batch = Number(options.batch ?? 1);
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error('batch must be a positive integer.');

  const records = snapshot.records;
  const filtered = snapshot.filtered;

  const modules = new Map();
  for (const record of records) {
    const module = modules.get(record.modulePath) || {
      path: record.modulePath, records: [], roles: new Map(), languages: new Map(),
    };
    module.records.push(record);
    module.roles.set(record.role, (module.roles.get(record.role) || 0) + 1);
    if (record.language) module.languages.set(record.language, (module.languages.get(record.language) || 0) + 1);
    modules.set(record.modulePath, module);
  }

  const orderedFiles = roundRobinModules(modules);
  const fileBatches = Math.max(1, Math.ceil(orderedFiles.length / batchSize));
  const level1BatchSize = Number(options.level1Limits?.maximumFiles ?? LEVEL1_DEFAULT_LIMITS.maximumFiles);
  if (!Number.isSafeInteger(level1BatchSize) || level1BatchSize < 1) throw new Error('Level 1 maximumFiles must be a positive integer.');
  const configurationCandidates = buildConfigurationPlan(records).length;
  const configurationBatches = Math.max(1, Math.ceil(configurationCandidates / level1BatchSize));
  const totalBatches = Math.max(fileBatches, configurationBatches);
  if (batch > totalBatches) throw new Error(`batch must be between 1 and ${totalBatches} for this repository.`);
  const start = (batch - 1) * batchSize;
  const batchRecords = orderedFiles.slice(start, start + batchSize);
  const cumulativeRecords = orderedFiles.slice(0, start + batchRecords.length);
  const coveredModules = new Set(cumulativeRecords.map((record) => record.modulePath));
  const uncoveredModules = [...modules.keys()].filter((modulePath) => !coveredModules.has(modulePath)).sort(compareModules);
  const moduleSummaries = [...modules.values()].sort((left, right) => compareModules(left.path, right.path)).map((module) => ({
    path: module.path,
    files: module.records.length,
    roles: Object.fromEntries([...module.roles].sort(([left], [right]) => left.localeCompare(right))),
    languages: Object.fromEntries([...module.languages].sort(([left], [right]) => left.localeCompare(right))),
  }));
  const nextBatch = batch < totalBatches ? batch + 1 : null;
  const level1 = buildConfigurationLevel1(absoluteRoot, records, { batch, limits: options.level1Limits });
  if (createdSnapshot && snapshot.repositoryState.reusable) assertRepositorySnapshotCurrent(snapshot);
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1000000n);
  const { source, head, dirty } = snapshot.repositoryState;

  return {
    schemaVersion: 1,
    command: 'inspect-repo',
    ok: true,
    repository: { root: absoluteRoot, source, head, dirty },
    policy: {
      mode: 'filter-and-batch-v1',
      scoring: false,
      ast: false,
      sourceBodiesIncluded: false,
      snapshotReuse: Boolean(options.snapshotReused),
      batch,
      batchSize,
    },
    summary: {
      discovery: snapshot.discovery,
      discoveredFiles: snapshot.discoveredFiles,
      retainedFiles: records.length,
      filteredFiles: Object.values(filtered).reduce((total, value) => total + value, 0),
      filtered,
      roles: snapshot.roles,
      languages: snapshot.languages,
      modules: modules.size,
      durationMs: elapsedMs,
    },
    directoryModules: {
      total: moduleSummaries.length,
      reported: Math.min(moduleSummaries.length, MAX_REPORTED_MODULES),
      truncated: moduleSummaries.length > MAX_REPORTED_MODULES,
      items: moduleSummaries.slice(0, MAX_REPORTED_MODULES),
    },
    coverage: {
      semanticCompletenessClaimed: false,
      directoryModules: {
        covered: coveredModules.size,
        total: modules.size,
        complete: uncoveredModules.length === 0,
        uncovered: uncoveredModules.slice(0, MAX_REPORTED_MODULES),
        unreportedUncovered: Math.max(0, uncoveredModules.length - MAX_REPORTED_MODULES),
      },
      fileInventory: {
        surfaced: cumulativeRecords.length,
        total: orderedFiles.length,
        complete: cumulativeRecords.length === orderedFiles.length,
      },
      batch,
      batchSize,
      totalBatches,
      fileBatches,
      configurationBatches,
      nextBatch,
      ...(nextBatch ? {
        nextArguments: [absoluteRoot,
          ...(options.snapshotPath ? ['--snapshot', options.snapshotPath] : []),
          '--batch-size', String(batchSize), '--batch', String(nextBatch), '--json'],
      } : {}),
    },
    level1,
    manifests: batchRecords.filter((record) => record.manifest).map(publicFile),
    entrypoints: batchRecords.filter((record) => record.entrypoint).map(publicFile),
    files: batchRecords.map(publicFile),
  };
}

export function formatRepositoryIndex(result) {
  const lines = [
    `Repository index: ${result.repository.root}`,
    `Discovery: ${result.summary.discovery}; retained ${result.summary.retainedFiles}/${result.summary.discoveredFiles} files in ${result.summary.durationMs}ms`,
    `Batch ${result.coverage.batch}/${result.coverage.totalBatches}: ${result.files.length} files`,
    ...(result.level1.configurations
      ? [
        `Level 1 batch ${result.level1.batch}/${result.level1.totalBatches}: ${result.level1.parsedFiles}/${result.level1.inspectedFiles} parsed, ${result.level1.rejectedFiles} rejected`,
        `Level 1 coverage: ${result.level1.coverage.surfaced}/${result.level1.coverage.total} configuration candidates`,
        `Level 1 boundaries: ${result.level1.boundaries.services.length} services, ${result.level1.boundaries.dependencies.length} dependencies, ${result.level1.boundaries.entrypoints.length} entrypoints, ${result.level1.boundaries.deployment.length} deployment, ${result.level1.boundaries.apis.length} APIs, ${result.level1.boundaries.ci.length} CI${result.level1.boundariesTruncated ? ' (truncated; inspect configurations)' : ''}`,
      ]
      : []),
    `Directory coverage: ${result.coverage.directoryModules.covered}/${result.coverage.directoryModules.total}`,
    `Inventory coverage: ${result.coverage.fileInventory.surfaced}/${result.coverage.fileInventory.total}`,
    '',
    'Files:',
    ...result.files.map((file) => `- ${file.path} [${file.module}; ${file.role}]`),
    ...(result.coverage.nextArguments ? ['', `Next batch arguments: ${JSON.stringify(result.coverage.nextArguments)}`] : []),
  ];
  return lines.join('\n');
}
