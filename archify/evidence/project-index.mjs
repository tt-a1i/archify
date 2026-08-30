import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const HEX_RE = /^[a-f0-9]+$/i;
const OBJECT_FORMAT_LENGTHS = Object.freeze({ sha1: 40, sha256: 64 });
const SAFE_REVISION_RE = /^[A-Za-z0-9][A-Za-z0-9._/@{}^~:+-]*$/;
const MAX_ANALYZED_FILE_BYTES = 1024 * 1024;
const MAX_ANALYZED_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_TERMS = 200;
const MAX_SOURCE_PATH_FILTERS = 200;
const MAX_SOURCE_INSPECT_RANGES = 1000;
const MAX_SOURCE_SEARCH_FILES = 256;
const MAX_SOURCE_SEARCH_BYTES = 32 * 1024 * 1024;
const SOURCE_SEARCH_BATCH_FILES = 8;

const LANGUAGES = Object.freeze({
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.mjs': 'javascript',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescript',
});

function projectError(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || 'project-index/invalid';
  error.details = details;
  return error;
}

function validObjectFormat(value) {
  return Object.hasOwn(OBJECT_FORMAT_LENGTHS, value);
}

function validObjectId(value, objectFormat) {
  return typeof value === 'string'
    && validObjectFormat(objectFormat)
    && value.length === OBJECT_FORMAT_LENGTHS[objectFormat]
    && HEX_RE.test(value);
}

function compareBinaryText(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function gitText(repoRoot, args, failureMessage) {
  try {
    const output = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.endsWith('\r\n') ? output.slice(0, -2) : output.replace(/\n$/, '');
  } catch (cause) {
    throw projectError(failureMessage, {
      code: 'project-index/git-command',
      gitArgs: args,
      exitCode: cause.status,
    });
  }
}

function resolveRepository(repoRootInput) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(repoRootInput));
  } catch (cause) {
    throw projectError(`Could not resolve repository root: ${cause.message}`, {
      code: 'project-index/root-unreadable',
    });
  }
  const topLevel = gitText(root, ['rev-parse', '--show-toplevel'], `"${root}" is not a Git repository.`);
  if (fs.realpathSync(topLevel) !== root) {
    throw projectError(`Repository root must be the Git top-level directory: ${topLevel}`, {
      code: 'project-index/root-not-top-level',
      root,
      topLevel,
    });
  }
  const origin = repositoryIdentity(gitText(
    root,
    ['remote', 'get-url', 'origin'],
    'Repository must have an origin remote.',
  ), root);
  const objectFormat = gitText(
    root,
    ['rev-parse', '--show-object-format'],
    'Could not determine repository object format.',
  ).toLowerCase();
  if (!validObjectFormat(objectFormat)) {
    throw projectError(`Unsupported Git object format ${JSON.stringify(objectFormat)}.`, {
      code: 'project-index/object-format-unsupported',
    });
  }
  return { root, origin, objectFormat };
}

function resolveRevision(root, requested = 'HEAD', objectFormat = 'sha1') {
  const revision = String(requested || 'HEAD');
  if (!SAFE_REVISION_RE.test(revision)) {
    throw projectError(`Unsafe revision ${JSON.stringify(revision)}.`, {
      code: 'project-index/revision-invalid',
    });
  }
  const resolved = gitText(
    root,
    ['rev-parse', '--verify', `${revision}^{commit}`],
    `Revision ${revision} does not identify an available commit.`,
  ).toLowerCase();
  if (!validObjectId(resolved, objectFormat)) {
    throw projectError(`Revision ${revision} did not resolve to a full ${objectFormat} commit OID.`, {
      code: 'project-index/revision-invalid',
    });
  }
  return resolved;
}

function parseTreeEntries(raw, objectFormat) {
  if (!raw) return [];
  return raw.split('\0').filter(Boolean).map((entry) => {
    const match = entry.match(/^([0-7]{6}) blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/i);
    if (!match) return null;
    if (!validObjectId(match[2], objectFormat)) {
      throw projectError(`Git tree returned an invalid ${objectFormat} blob OID.`, {
        code: 'project-index/tree-oid-invalid',
      });
    }
    return {
      path: match[4],
      mode: match[1],
      blobOid: match[2].toLowerCase(),
      bytes: Number(match[3]),
    };
  }).filter(Boolean).sort((a, b) => compareBinaryText(a.path, b.path));
}

function treeEntries(root, revision, objectFormat) {
  return parseTreeEntries(gitText(
    root,
    ['ls-tree', '-r', '-l', '-z', '--full-tree', revision],
    `Could not list files at revision ${revision}.`,
  ), objectFormat);
}

function treeEntriesAtPaths(root, revision, filePaths, objectFormat) {
  if (!filePaths.length) return [];
  const uniquePaths = [...new Set(filePaths)].sort(compareBinaryText);
  return parseTreeEntries(gitText(
    root,
    ['--literal-pathspecs', 'ls-tree', '-r', '-l', '-z', '--full-tree', revision, '--', ...uniquePaths],
    `Could not resolve evidence paths at revision ${revision}.`,
  ), objectFormat);
}

function languageFor(filePath) {
  return LANGUAGES[path.extname(filePath).toLowerCase()] || null;
}

function shouldAnalyze(entry) {
  return entry.mode.startsWith('100')
    && (Boolean(languageFor(entry.path)) || path.basename(entry.path) === 'package.json');
}

function batchBlobs(root, entries, objectFormat) {
  if (!entries.length) return new Map();
  const uniqueEntries = [...new Map(entries.map((entry) => [entry.blobOid.toLowerCase(), {
    ...entry,
    blobOid: entry.blobOid.toLowerCase(),
  }])).values()];
  const unique = uniqueEntries.map((entry) => entry.blobOid);
  const expectedBytes = uniqueEntries.reduce((total, entry) => total + entry.bytes, 0);
  const result = spawnSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: `${unique.join('\n')}\n`,
    encoding: null,
    maxBuffer: Math.max(4 * 1024 * 1024, expectedBytes + (2 * 1024 * 1024)),
  });
  if (result.error || result.status !== 0) {
    throw projectError('Could not read indexed blobs from Git.', {
      code: 'project-index/blob-read',
      reason: result.error?.message,
      exitCode: result.status,
    });
  }

  const output = result.stdout;
  const blobs = new Map();
  let offset = 0;
  for (const requestedOid of unique) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw projectError('Git batch output ended before a blob header.', { code: 'project-index/blob-read' });
    const header = output.subarray(offset, headerEnd).toString('utf8');
    const match = header.match(/^([a-f0-9]+) blob (\d+)$/i);
    if (!match || !validObjectId(match[1], objectFormat) || match[1].toLowerCase() !== requestedOid) {
      throw projectError(`Git returned an unexpected blob header: ${header}`, { code: 'project-index/blob-read' });
    }
    const size = Number(match[2]);
    const start = headerEnd + 1;
    const end = start + size;
    if (end > output.length) throw projectError('Git batch output ended inside a blob.', { code: 'project-index/blob-read' });
    blobs.set(requestedOid, output.subarray(start, end).toString('utf8'));
    offset = end + 1;
  }
  return blobs;
}

function uniqueMatches(content, patterns) {
  const found = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (!value || seen.has(value)) continue;
      seen.add(value);
      found.push(value);
    }
  }
  return found.sort(compareBinaryText);
}

function importsFor(language, content) {
  if (language === 'javascript' || language === 'typescript') {
    return uniqueMatches(content, [
      /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
      /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]);
  }
  if (language === 'python') {
    return uniqueMatches(content, [
      /(?:^|\n)\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/g,
      /(?:^|\n)\s*import\s+([A-Za-z_][\w.]*)/g,
    ]);
  }
  if (['java', 'kotlin'].includes(language)) {
    return uniqueMatches(content, [/(?:^|\n)\s*import\s+([A-Za-z_][\w.*]*)/g]);
  }
  if (language === 'go') {
    return uniqueMatches(content, [/(?:^|\n)\s*import\s+(?:[A-Za-z_][\w]*\s+)?"([^"]+)"/g]);
  }
  if (language === 'rust') {
    return uniqueMatches(content, [/(?:^|\n)\s*use\s+([A-Za-z_][\w:]*)/g]);
  }
  return [];
}

function symbolsFor(language, content) {
  const lines = content.split(/\r\n|\n|\r/);
  const symbols = [];
  const seen = new Set();
  const patterns = language === 'javascript' || language === 'typescript'
    ? [
      ['function', /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/],
      ['class', /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/],
      ['interface', /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/],
      ['type', /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/],
      ['enum', /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/],
      ['const', /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/],
    ]
    : language === 'python'
      ? [['function', /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/], ['class', /^class\s+([A-Za-z_][\w]*)/]]
      : ['java', 'kotlin', 'csharp'].includes(language)
        ? [['type', /^(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*(?:class|interface|record|enum)\s+([A-Za-z_][\w]*)/]]
        : language === 'go'
          ? [['function', /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/], ['type', /^type\s+([A-Za-z_][\w]*)/]]
          : language === 'rust'
            ? [['function', /^(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/], ['type', /^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/]]
            : [];

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    for (const [kind, pattern] of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const key = `${kind}:${match[1]}`;
      if (seen.has(key)) break;
      seen.add(key);
      symbols.push({ kind, name: match[1], line: index + 1 });
      break;
    }
  }
  return symbols;
}

function packageFact(entry, content) {
  if (path.basename(entry.path) !== 'package.json') return null;
  try {
    const parsed = JSON.parse(content);
    const dependencies = new Set([
      ...Object.keys(parsed.dependencies || {}),
      ...Object.keys(parsed.devDependencies || {}),
      ...Object.keys(parsed.peerDependencies || {}),
      ...Object.keys(parsed.optionalDependencies || {}),
    ]);
    return {
      manager: 'node',
      path: entry.path,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      version: typeof parsed.version === 'string' ? parsed.version : null,
      dependencies: [...dependencies].sort(compareBinaryText),
    };
  } catch {
    return null;
  }
}

function digestIndex(index) {
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

/**
 * Build an immutable, revision-pinned index of mechanical repository facts.
 * The interface deliberately exposes no inferred topology or causality.
 */
export function buildProjectIndex({ repoRoot, revision = 'HEAD' }) {
  const repository = resolveRepository(repoRoot);
  const resolvedRevision = resolveRevision(repository.root, revision, repository.objectFormat);
  const entries = treeEntries(repository.root, resolvedRevision, repository.objectFormat);
  const candidates = [];
  const skipped = [];
  let candidateBytes = 0;
  for (const entry of entries) {
    if (!shouldAnalyze(entry)) continue;
    if (entry.bytes > MAX_ANALYZED_FILE_BYTES) {
      skipped.push({ path: entry.path, bytes: entry.bytes, reason: 'max-file-bytes' });
      continue;
    }
    if (candidateBytes + entry.bytes > MAX_ANALYZED_TOTAL_BYTES) {
      skipped.push({ path: entry.path, bytes: entry.bytes, reason: 'max-total-bytes' });
      continue;
    }
    candidates.push(entry);
    candidateBytes += entry.bytes;
  }
  const blobs = batchBlobs(repository.root, candidates, repository.objectFormat);
  const analyzedPaths = new Set(candidates.map((entry) => entry.path));
  const files = entries.map((entry) => {
    const language = languageFor(entry.path);
    const content = analyzedPaths.has(entry.path) ? blobs.get(entry.blobOid) : undefined;
    return {
      ...entry,
      ...(language ? { language } : {}),
      ...(content !== undefined && language ? {
        imports: importsFor(language, content),
        symbols: symbolsFor(language, content),
      } : {}),
    };
  });
  const packages = entries.map((entry) => {
    const content = analyzedPaths.has(entry.path) ? blobs.get(entry.blobOid) : undefined;
    return content === undefined ? null : packageFact(entry, content);
  }).filter(Boolean).sort((a, b) => compareBinaryText(a.path, b.path));
  const result = {
    schemaVersion: 1,
    repository: {
      root: repository.root,
      origin: repository.origin,
      revision: resolvedRevision,
      objectFormat: repository.objectFormat,
    },
    files,
    packages,
    analysis: {
      filesAnalyzed: candidates.length,
      filesSkipped: skipped.length,
      bytesAnalyzed: candidateBytes,
      maxFileBytes: MAX_ANALYZED_FILE_BYTES,
      maxTotalBytes: MAX_ANALYZED_TOTAL_BYTES,
      skipped,
    },
  };
  return Object.freeze({ ...result, digest: digestIndex(result) });
}

function encodedUriPath(segments) {
  return segments.filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
}

function isWindowsAbsolute(input) {
  return /^[A-Za-z]:[\\/]/.test(input) || /^\\\\/.test(input) || /^\/\/[^/]/.test(input);
}

function windowsFileIdentity(input) {
  const normalized = path.win32.normalize(input);
  const unc = normalized.match(/^\\\\([^\\]+)\\([\s\S]+)$/);
  if (unc) {
    return `file://${unc[1].toLowerCase()}/${encodedUriPath(unc[2].split('\\'))}`;
  }
  const drive = normalized.match(/^([A-Za-z]):\\([\s\S]*)$/);
  if (!drive) return null;
  return `file:///${drive[1].toUpperCase()}:/${encodedUriPath(drive[2].split('\\'))}`;
}

export function repositoryIdentity(remote, repoRoot) {
  const value = String(remote || '');
  const cleanRemotePath = (input) => input
    .replace(/^\/+/, '')
    .replace(/[?#][\s\S]*$/, '')
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '');
  const localIdentity = (input) => {
    const localPath = String(input);
    if (isWindowsAbsolute(localPath)) return windowsFileIdentity(localPath);
    if (repoRoot && isWindowsAbsolute(repoRoot)) {
      return windowsFileIdentity(path.win32.resolve(repoRoot, localPath));
    }
    let absolute = path.isAbsolute(localPath)
      ? path.resolve(localPath)
      : path.resolve(repoRoot || process.cwd(), localPath);
    try {
      absolute = fs.realpathSync(absolute);
    } catch {
      // A remote target does not need to exist locally; the resolved absolute path is still unambiguous.
    }
    return pathToFileURL(absolute).href;
  };
  if (isWindowsAbsolute(value)) return localIdentity(value);
  if (/^file:/i.test(value)) {
    const fileUrl = value.match(/^file:\/\/([^/]*)(\/[\s\S]*)$/i);
    if (!fileUrl) return '';
    const authority = fileUrl[1];
    let literalPath;
    try {
      literalPath = decodeURIComponent(fileUrl[2]);
    } catch {
      return '';
    }
    if (authority && authority.toLowerCase() !== 'localhost') {
      return localIdentity(`\\\\${authority}${literalPath.replaceAll('/', '\\')}`);
    }
    if (/^\/[A-Za-z]:\//.test(literalPath)) literalPath = literalPath.slice(1);
    return localIdentity(literalPath);
  }
  const scp = !value.includes('://')
    ? value.match(/^(?:[^@/:\s]+@)?([^/:\s]+):([^\s]+)$/)
    : null;
  if (scp) {
    const host = scp[1].toLowerCase();
    const repoPath = cleanRemotePath(scp[2]);
    if (host === 'github.com') return `https://github.com/${repoPath.toLowerCase()}`;
    return `ssh://${host}/${repoPath}`;
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const repoPath = cleanRemotePath(parsed.pathname);
    if (host === 'github.com' && !parsed.port) return `https://github.com/${repoPath.toLowerCase()}`;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${host}${port}/${repoPath}`;
  } catch {
    return value ? localIdentity(value) : '';
  }
}

function digestEvidenceLedger(ledger, repoRoot) {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: ledger.schemaVersion,
    repository: {
      origin: repositoryIdentity(ledger.repository.origin, repoRoot),
      revision: ledger.repository.revision.toLowerCase(),
      objectFormat: ledger.repository.objectFormat,
      indexDigest: ledger.repository.indexDigest.toLowerCase(),
    },
    facts: ledger.facts.map((fact) => ({
      claimId: fact.claimId,
      path: fact.path,
      line: fact.line,
      endLine: fact.endLine,
      blobOid: fact.blobOid.toLowerCase(),
      rangeSha256: fact.rangeSha256.toLowerCase(),
      summary: fact.summary,
    })),
  })).digest('hex');
}

function canonicalRange(content, line, endLine) {
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(endLine) || endLine < line || endLine > lines.length) {
    throw projectError(`Evidence range ${line}-${endLine} is outside a ${lines.length}-line file.`, {
      code: 'evidence-ledger/range-invalid',
      line,
      endLine,
      lineCount: lines.length,
    });
  }
  return lines.slice(line - 1, endLine).join('\n');
}

function validRepositoryPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || path.posix.isAbsolute(filePath)) return false;
  if (/[\\\u0000-\u001f\u007f]/u.test(filePath)) return false;
  const segments = filePath.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    && path.posix.normalize(filePath) === filePath;
}

function validClaimId(claimId) {
  return typeof claimId === 'string'
    && claimId.length > 0
    && claimId === claimId.trim()
    && !/[\u0000-\u001f\u007f]/u.test(claimId);
}

function validateEvidenceLedgerSchema(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)
    || ledger.schemaVersion !== 1
    || !ledger.repository || typeof ledger.repository !== 'object' || Array.isArray(ledger.repository)
    || typeof ledger.repository.origin !== 'string' || !repositoryIdentity(ledger.repository.origin)
    || !validObjectFormat(ledger.repository.objectFormat)
    || !validObjectId(ledger.repository.revision, ledger.repository.objectFormat)
    || !SHA256_RE.test(ledger.repository.indexDigest || '')
    || !SHA256_RE.test(ledger.ledgerDigest || '')
    || !Array.isArray(ledger.facts) || ledger.facts.length === 0) {
    throw projectError('Evidence ledger is not a supported, non-empty schemaVersion 1 receipt.', {
      code: 'evidence-ledger/schema-invalid',
    });
  }

  const claimIds = new Set();
  for (const [index, fact] of ledger.facts.entries()) {
    const schemaValid = fact && typeof fact === 'object' && !Array.isArray(fact)
      && validClaimId(fact.claimId)
      && validRepositoryPath(fact.path)
      && validObjectId(fact.blobOid, ledger.repository.objectFormat)
      && SHA256_RE.test(fact.rangeSha256 || '')
      && Number.isInteger(fact.line) && fact.line > 0
      && Number.isInteger(fact.endLine) && fact.endLine >= fact.line
      && typeof fact.summary === 'string';
    if (!schemaValid || claimIds.has(fact?.claimId)) {
      throw projectError(`Evidence fact ${index + 1} has an invalid or duplicate schema.`, {
        code: 'evidence-ledger/fact-invalid',
        factIndex: index,
      });
    }
    claimIds.add(fact.claimId);
  }
  return ledger;
}

function validateProjectIndexForEvidence(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)
    || index.schemaVersion !== 1
    || !index.repository || typeof index.repository !== 'object' || Array.isArray(index.repository)
    || typeof index.repository.root !== 'string' || index.repository.root.length === 0
    || typeof index.repository.origin !== 'string' || !repositoryIdentity(index.repository.origin)
    || !validObjectFormat(index.repository.objectFormat)
    || !validObjectId(index.repository.revision, index.repository.objectFormat)
    || !Array.isArray(index.files)
    || !Array.isArray(index.packages)
    || !index.analysis || typeof index.analysis !== 'object' || Array.isArray(index.analysis)
    || !SHA256_RE.test(index.digest || '')) {
    throw projectError('Evidence ledger requires a valid ProjectIndex.', { code: 'evidence-ledger/index-invalid' });
  }
  if (digestIndex(index) !== index.digest.toLowerCase()) {
    throw projectError('ProjectIndex digest does not match its contents.', { code: 'evidence-ledger/index-digest-mismatch' });
  }

  const seenPaths = new Set();
  for (const file of index.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)
      || !validRepositoryPath(file.path)
      || typeof file.mode !== 'string' || !/^[0-7]{6}$/.test(file.mode)
      || !validObjectId(file.blobOid, index.repository.objectFormat)
      || !Number.isInteger(file.bytes) || file.bytes < 0
      || seenPaths.has(file.path)) {
      throw projectError('ProjectIndex contains an invalid or duplicate file fact.', {
        code: 'evidence-ledger/index-invalid',
      });
    }
    seenPaths.add(file.path);
  }
  return index;
}

function queryTerms(values, label) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw projectError(`${label} must be an array of non-empty strings.`, {
      code: 'project-index/query-invalid',
    });
  }
  return [...new Set(values.map((value) => value.trim()))].sort(compareBinaryText);
}

function pathMatchesPrefix(filePath, prefix) {
  const clean = prefix.replace(/\/+$/, '');
  return filePath === clean || filePath.startsWith(`${clean}/`);
}

function suggestedClaimId(filePath, symbol) {
  const stem = `${symbol.name}-${path.posix.basename(filePath, path.posix.extname(filePath))}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return stem || 'source-symbol';
}

function sourceOptions(index, {
  terms,
  paths,
  maxResults = 20,
  contextLines = 2,
  repoRoot = index?.repository?.root,
} = {}) {
  const normalizedTerms = queryTerms(terms, 'terms');
  const normalizedPaths = queryTerms(paths, 'paths').map((filePath) => filePath.replace(/\/+$/, ''));
  if (!normalizedTerms.length) {
    throw projectError('Project source search requires at least one literal term.', {
      code: 'project-index/source-term-required',
    });
  }
  if (normalizedPaths.some((filePath) => !validRepositoryPath(filePath))) {
    throw projectError('Project source search paths must be normalized repository-relative paths.', {
      code: 'project-index/source-path-invalid',
    });
  }
  if (normalizedTerms.length > MAX_SOURCE_TERMS || normalizedPaths.length > MAX_SOURCE_PATH_FILTERS) {
    throw projectError(`Project source search accepts at most ${MAX_SOURCE_TERMS} terms and ${MAX_SOURCE_PATH_FILTERS} paths.`, {
      code: 'project-index/source-query-limit',
    });
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) {
    throw projectError('maxResults must be an integer from 1 through 200.', {
      code: 'project-index/source-limit',
    });
  }
  if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 20) {
    throw projectError('contextLines must be an integer from 0 through 20.', {
      code: 'project-index/source-context-limit',
    });
  }
  return {
    terms: normalizedTerms,
    paths: [...new Set(normalizedPaths)].sort(compareBinaryText),
    maxResults,
    contextLines,
    repoRoot,
  };
}

function pinnedSourceContext(index, repoRoot) {
  const repository = resolveRepository(repoRoot);
  if (repository.objectFormat !== index.repository.objectFormat) {
    throw projectError('Project source repository object format does not match the index.', {
      code: 'project-index/source-object-format-mismatch',
    });
  }
  if (repositoryIdentity(repository.origin, repository.root)
    !== repositoryIdentity(index.repository.origin, index.repository.root)) {
    throw projectError('Project source repository origin does not match the index.', {
      code: 'project-index/source-origin-mismatch',
    });
  }
  const revision = resolveRevision(repository.root, index.repository.revision, repository.objectFormat);
  if (revision !== index.repository.revision.toLowerCase()) {
    throw projectError('Project source revision does not match the index.', {
      code: 'project-index/source-revision-mismatch',
    });
  }
  const revisionTree = treeEntries(repository.root, revision, repository.objectFormat);
  const indexedTree = index.files.map(({ path: filePath, mode, blobOid, bytes }) => ({
    path: filePath,
    mode,
    blobOid: blobOid.toLowerCase(),
    bytes,
  })).sort((left, right) => compareBinaryText(left.path, right.path));
  if (JSON.stringify(revisionTree) !== JSON.stringify(indexedTree)) {
    throw projectError('Project source revision tree does not match the index.', {
      code: 'project-index/source-tree-mismatch',
    });
  }
  const byPath = new Map(revisionTree.map((entry) => [entry.path, entry]));
  return { byPath, repository, revision };
}

function readPinnedSourceBlobs(context, requestedFiles) {
  const revisionEntries = [];
  for (const file of requestedFiles) {
    const entry = context.byPath.get(file.path);
    if (!entry || entry.blobOid !== file.blobOid.toLowerCase() || entry.bytes !== file.bytes) {
      throw projectError(`Project source blob for ${JSON.stringify(file.path)} does not match the index.`, {
        code: 'project-index/source-blob-mismatch',
      });
    }
    revisionEntries.push(entry);
  }
  return {
    blobs: batchBlobs(context.repository.root, revisionEntries, context.repository.objectFormat),
    repository: context.repository,
    revision: context.revision,
  };
}

function pinnedSourceBlobs(index, requestedFiles, repoRoot) {
  return readPinnedSourceBlobs(pinnedSourceContext(index, repoRoot), requestedFiles);
}

function redactSourceLine(text) {
  let value = text;
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(value)) {
    return { text: '[REDACTED PRIVATE KEY]', redacted: true };
  }
  value = value.replace(
    /(\b(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|secret|password|passwd|client[_-]?secret)\b\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi,
    '$1$2[REDACTED]$2',
  );
  value = value.replace(
    /(\b(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|secret|password|passwd|client[_-]?secret)\b\s*[:=]\s*)(?!["'`])([^\s,;]+)/gi,
    '$1[REDACTED]',
  );
  value = value.replace(/\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]');
  value = value.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return { text: value, redacted: value !== text };
}

function numberedSourceRange(content, line, endLine) {
  const range = canonicalRange(content, line, endLine);
  let redactions = 0;
  const sourceLines = range.split('\n').map((text, offset) => {
    const redacted = redactSourceLine(text);
    if (redacted.redacted) redactions += 1;
    return { line: line + offset, text: redacted.text };
  });
  return {
    sourceLines,
    rangeSha256: createHash('sha256').update(range).digest('hex'),
    ...(redactions ? { redactions } : {}),
  };
}

/**
 * Search literal source terms in blobs pinned by a validated ProjectIndex.
 * Results are mechanical line windows only; no topology or causal summary is inferred.
 */
export function searchProjectSource(index, options = {}) {
  validateProjectIndexForEvidence(index);
  const query = sourceOptions(index, options);
  const requestedFiles = index.files.filter((file) => (
    file.mode.startsWith('100')
    && (!query.paths.length || query.paths.some((prefix) => pathMatchesPrefix(file.path, prefix)))
  )).sort((left, right) => compareBinaryText(left.path, right.path));
  const pinned = pinnedSourceContext(index, query.repoRoot);
  const budgetedFiles = [];
  let budgetedBytes = 0;
  let budgetReason = null;
  for (const file of requestedFiles) {
    if (budgetedFiles.length >= MAX_SOURCE_SEARCH_FILES) {
      budgetReason = 'file-limit';
      break;
    }
    if (budgetedBytes + file.bytes > MAX_SOURCE_SEARCH_BYTES) {
      budgetReason = 'byte-limit';
      break;
    }
    budgetedFiles.push(file);
    budgetedBytes += file.bytes;
  }
  const found = [];
  let filesRead = 0;
  let bytesRead = 0;
  let filesSearched = 0;
  let bytesSearched = 0;
  let stoppedAtResultLimit = false;
  search: for (let offset = 0; offset < budgetedFiles.length; offset += SOURCE_SEARCH_BATCH_FILES) {
    const batch = budgetedFiles.slice(offset, offset + SOURCE_SEARCH_BATCH_FILES);
    const loaded = readPinnedSourceBlobs(pinned, batch);
    filesRead += batch.length;
    bytesRead += batch.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of batch) {
      const content = loaded.blobs.get(file.blobOid.toLowerCase());
      filesSearched += 1;
      bytesSearched += file.bytes;
      if (content.includes('\0')) continue;
      const lines = content.split(/\r\n|\n|\r/);
      if (lines.at(-1) === '') lines.pop();
      for (const [lineOffset, text] of lines.entries()) {
        const matchedTerms = query.terms.filter((term) => text.includes(term));
        if (!matchedTerms.length) continue;
        const matchLine = lineOffset + 1;
        const line = Math.max(1, matchLine - query.contextLines);
        const endLine = Math.min(lines.length, matchLine + query.contextLines);
        found.push({
          path: file.path,
          blobOid: file.blobOid.toLowerCase(),
          line,
          endLine,
          matchedLines: [{ line: matchLine, terms: matchedTerms }],
          ...numberedSourceRange(content, line, endLine),
        });
        if (found.length > query.maxResults) {
          stoppedAtResultLimit = true;
          break search;
        }
      }
    }
  }
  const matches = found.slice(0, query.maxResults);
  const truncationReasons = [
    ...(stoppedAtResultLimit ? ['result-limit'] : []),
    ...(budgetReason ? [budgetReason] : []),
  ];
  const exactMatchCount = !stoppedAtResultLimit && !budgetReason;
  return {
    schemaVersion: 1,
    command: 'project-index-source-search',
    indexDigest: index.digest.toLowerCase(),
    repository: {
      origin: repositoryIdentity(index.repository.origin, index.repository.root),
      revision: pinned.revision,
      objectFormat: pinned.repository.objectFormat,
    },
    query: {
      terms: query.terms,
      paths: query.paths,
      contextLines: query.contextLines,
      maxResults: query.maxResults,
    },
    searchBudget: {
      maxFiles: MAX_SOURCE_SEARCH_FILES,
      maxBytes: MAX_SOURCE_SEARCH_BYTES,
      batchFiles: SOURCE_SEARCH_BATCH_FILES,
      resultSentinel: query.maxResults + 1,
    },
    filesEligible: requestedFiles.length,
    filesRead,
    bytesRead,
    filesSearched,
    bytesSearched,
    matchesFound: found.length,
    matchesFoundExact: exactMatchCount,
    returned: matches.length,
    truncated: matches.length < found.length || Boolean(budgetReason),
    ...(truncationReasons.length ? { truncationReasons } : {}),
    matches,
  };
}

/**
 * Inspect exact source ranges from blobs pinned by a validated ProjectIndex.
 * Input order never changes output order; ranges use stable binary path order.
 */
export function inspectProjectSource(index, {
  ranges,
  maxResults = 20,
  repoRoot = index?.repository?.root,
} = {}) {
  validateProjectIndexForEvidence(index);
  if (!Array.isArray(ranges) || !ranges.length) {
    throw projectError('Project source inspect requires at least one exact range.', {
      code: 'project-index/source-range-required',
    });
  }
  if (ranges.length > MAX_SOURCE_INSPECT_RANGES) {
    throw projectError(`Project source inspect accepts at most ${MAX_SOURCE_INSPECT_RANGES} ranges.`, {
      code: 'project-index/source-query-limit',
    });
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) {
    throw projectError('maxResults must be an integer from 1 through 200.', {
      code: 'project-index/source-limit',
    });
  }
  const indexedFiles = new Map(index.files.map((file) => [file.path, file]));
  const prepared = ranges.map((range, rangeIndex) => {
    if (!range || typeof range !== 'object' || Array.isArray(range)
      || !validRepositoryPath(range.path)
      || !Number.isInteger(range.line) || range.line < 1
      || !Number.isInteger(range.endLine) || range.endLine < range.line) {
      throw projectError(`Project source range ${rangeIndex + 1} is invalid.`, {
        code: 'project-index/source-range-invalid',
      });
    }
    const file = indexedFiles.get(range.path);
    if (!file || !file.mode.startsWith('100')) {
      throw projectError(`Project source path ${JSON.stringify(range.path)} is not in the index.`, {
        code: 'project-index/source-path-missing',
      });
    }
    return { path: range.path, line: range.line, endLine: range.endLine, file };
  }).sort((left, right) => compareBinaryText(left.path, right.path)
    || left.line - right.line
    || left.endLine - right.endLine);
  const limited = prepared.slice(0, maxResults);
  const requestedFiles = [...new Map(limited.map(({ file }) => [file.path, file])).values()];
  const pinned = pinnedSourceBlobs(index, requestedFiles, repoRoot);
  const inspectedRanges = limited.map(({ path: filePath, line, endLine, file }) => ({
    path: filePath,
    blobOid: file.blobOid.toLowerCase(),
    line,
    endLine,
    ...numberedSourceRange(pinned.blobs.get(file.blobOid.toLowerCase()), line, endLine),
  }));
  return {
    schemaVersion: 1,
    command: 'project-index-source-inspect',
    indexDigest: index.digest.toLowerCase(),
    repository: {
      origin: repositoryIdentity(index.repository.origin, index.repository.root),
      revision: pinned.revision,
      objectFormat: pinned.repository.objectFormat,
    },
    requested: prepared.length,
    returned: inspectedRanges.length,
    truncated: inspectedRanges.length < prepared.length,
    ranges: inspectedRanges,
  };
}

/**
 * Query a ProjectIndex without loading its multi-megabyte receipt into an
 * authoring context. Categories combine with AND; terms inside one category
 * combine with OR. The result contains mechanical matches and selection hints,
 * never inferred topology or causality.
 */
export function queryProjectIndex(index, {
  symbols,
  imports,
  paths,
  languages,
  packages,
  maxResults = 20,
} = {}) {
  validateProjectIndexForEvidence(index);
  const query = {
    symbols: queryTerms(symbols, 'symbols'),
    imports: queryTerms(imports, 'imports'),
    paths: queryTerms(paths, 'paths'),
    languages: queryTerms(languages, 'languages'),
    packages: queryTerms(packages, 'packages'),
  };
  if (!Object.values(query).some((terms) => terms.length)) {
    throw projectError('ProjectIndex query requires at least one symbol, import, path, language, or package.', {
      code: 'project-index/query-required',
    });
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) {
    throw projectError('maxResults must be an integer from 1 through 200.', {
      code: 'project-index/query-limit',
    });
  }

  const fileMatches = index.files.map((file) => {
    const matchedSymbols = (file.symbols || []).filter((symbol) => query.symbols.includes(symbol.name));
    const matchedImports = (file.imports || []).filter((specifier) => query.imports.includes(specifier));
    const matchedPaths = query.paths.filter((prefix) => pathMatchesPrefix(file.path, prefix));
    const matchedLanguages = query.languages.filter((language) => file.language === language);
    if ((query.symbols.length && !matchedSymbols.length)
      || (query.imports.length && !matchedImports.length)
      || (query.paths.length && !matchedPaths.length)
      || (query.languages.length && !matchedLanguages.length)) {
      return null;
    }
    if (!query.symbols.length && !query.imports.length && !query.paths.length && !query.languages.length) {
      return null;
    }
    return {
      path: file.path,
      blobOid: file.blobOid,
      bytes: file.bytes,
      ...(file.language ? { language: file.language } : {}),
      matched: {
        ...(matchedSymbols.length ? { symbols: matchedSymbols } : {}),
        ...(matchedImports.length ? { imports: matchedImports } : {}),
        ...(matchedPaths.length ? { pathPrefixes: matchedPaths } : {}),
        ...(matchedLanguages.length ? { languages: matchedLanguages } : {}),
      },
      selectionHints: matchedSymbols.map((symbol) => ({
        claimIdSuggested: suggestedClaimId(file.path, symbol),
        path: file.path,
        line: symbol.line,
        endLine: symbol.line,
        symbol: { kind: symbol.kind, name: symbol.name },
        summary: '',
      })),
      score: matchedSymbols.length * 8
        + matchedImports.length * 4
        + matchedPaths.length * 2
        + matchedLanguages.length,
    };
  }).filter(Boolean).sort((left, right) => right.score - left.score || compareBinaryText(left.path, right.path));

  const packageMatches = index.packages.filter((entry) => query.packages.some((term) => (
    entry.name === term || entry.dependencies.includes(term)
  ))).map((entry) => ({
    ...entry,
    matched: query.packages.filter((term) => entry.name === term || entry.dependencies.includes(term)),
  }));
  const limitedFiles = fileMatches.slice(0, maxResults).map(({ score, ...file }) => file);
  const remaining = Math.max(0, maxResults - limitedFiles.length);
  const limitedPackages = packageMatches.slice(0, remaining);

  return {
    schemaVersion: 1,
    command: 'project-index-query',
    indexDigest: index.digest,
    repository: {
      origin: index.repository.origin,
      revision: index.repository.revision,
      objectFormat: index.repository.objectFormat,
    },
    query: { ...query, maxResults },
    summary: {
      filesMatched: fileMatches.length,
      packagesMatched: packageMatches.length,
      returned: limitedFiles.length + limitedPackages.length,
      truncated: limitedFiles.length < fileMatches.length || limitedPackages.length < packageMatches.length,
    },
    files: limitedFiles,
    packages: limitedPackages,
  };
}

export function createEvidenceLedger(index, selections) {
  validateProjectIndexForEvidence(index);
  if (!Array.isArray(selections) || selections.length === 0) {
    throw projectError('Evidence ledger requires at least one selected fact.', { code: 'evidence-ledger/fact-required' });
  }
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  const claimIds = new Set();
  const prepared = selections.map((selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)
      || !validClaimId(selection.claimId) || claimIds.has(selection.claimId)
      || !validRepositoryPath(selection.path)
      || (selection.summary !== undefined && typeof selection.summary !== 'string')) {
      throw projectError('Every evidence fact requires a unique claimId.', { code: 'evidence-ledger/claim-invalid' });
    }
    claimIds.add(selection.claimId);
    const file = byPath.get(selection.path);
    if (!file) throw projectError(`Evidence path ${JSON.stringify(selection.path)} is not present in the pinned index.`, {
      code: 'evidence-ledger/path-missing',
    });
    const line = selection.line ?? 1;
    const endLine = selection.endLine ?? line;
    if (!Number.isInteger(line) || line <= 0 || !Number.isInteger(endLine) || endLine < line) {
      throw projectError('Every evidence fact requires a valid positive line range.', {
        code: 'evidence-ledger/range-invalid',
      });
    }
    return { selection, file, line, endLine };
  });
  const blobs = batchBlobs(
    index.repository.root,
    prepared.map(({ file }) => file),
    index.repository.objectFormat,
  );
  const facts = prepared.map(({ selection, file, line, endLine }) => {
    const range = canonicalRange(blobs.get(file.blobOid), line, endLine);
    return {
      claimId: selection.claimId,
      path: selection.path,
      line,
      endLine,
      blobOid: file.blobOid,
      rangeSha256: createHash('sha256').update(range).digest('hex'),
      summary: selection.summary || '',
    };
  });
  const ledger = {
    schemaVersion: 1,
    repository: {
      origin: index.repository.origin,
      revision: index.repository.revision,
      objectFormat: index.repository.objectFormat,
      indexDigest: index.digest,
    },
    facts,
  };
  return validateEvidenceLedgerSchema({
    ...ledger,
    ledgerDigest: digestEvidenceLedger(ledger, index.repository.root),
  });
}

export function verifyEvidenceLedger(ledger, { repoRoot, projectIndex } = {}) {
  validateEvidenceLedgerSchema(ledger);
  if (!projectIndex) {
    throw projectError('Evidence verification requires the original ProjectIndex receipt.', {
      code: 'evidence-ledger/index-required',
    });
  }
  validateProjectIndexForEvidence(projectIndex);
  if (ledger.repository.indexDigest.toLowerCase() !== projectIndex.digest.toLowerCase()) {
    throw projectError('Evidence ledger index digest does not match the supplied ProjectIndex.', {
      code: 'evidence-ledger/index-digest-mismatch',
      ledgerIndexDigest: ledger.repository.indexDigest,
      projectIndexDigest: projectIndex.digest,
    });
  }
  const computedLedgerDigest = digestEvidenceLedger(ledger, projectIndex.repository.root);
  if (computedLedgerDigest !== ledger.ledgerDigest.toLowerCase()) {
    throw projectError('Evidence ledger digest does not match its repository and facts.', {
      code: 'evidence-ledger/digest-mismatch',
      ledgerDigest: ledger.ledgerDigest,
      computedLedgerDigest,
    });
  }
  if (repositoryIdentity(ledger.repository.origin, projectIndex.repository.root)
    !== repositoryIdentity(projectIndex.repository.origin, projectIndex.repository.root)) {
    throw projectError('Evidence ledger origin does not match the supplied ProjectIndex.', {
      code: 'evidence-ledger/index-origin-mismatch',
    });
  }
  if (ledger.repository.revision.toLowerCase() !== projectIndex.repository.revision.toLowerCase()) {
    throw projectError('Evidence ledger revision does not match the supplied ProjectIndex.', {
      code: 'evidence-ledger/index-revision-mismatch',
    });
  }
  if (ledger.repository.objectFormat !== projectIndex.repository.objectFormat) {
    throw projectError('Evidence ledger object format does not match the supplied ProjectIndex.', {
      code: 'evidence-ledger/index-object-format-mismatch',
    });
  }
  const repository = resolveRepository(repoRoot);
  if (repository.objectFormat !== ledger.repository.objectFormat) {
    throw projectError('Evidence repository object format does not match the ledger.', {
      code: 'evidence-ledger/object-format-mismatch',
      localObjectFormat: repository.objectFormat,
      ledgerObjectFormat: ledger.repository.objectFormat,
    });
  }
  if (repositoryIdentity(repository.origin, repository.root)
    !== repositoryIdentity(ledger.repository.origin, projectIndex.repository.root)) {
    throw projectError('Evidence repository origin does not match the ledger.', {
      code: 'evidence-ledger/origin-mismatch',
      localOrigin: repository.origin,
      ledgerOrigin: ledger.repository.origin,
    });
  }
  const revision = resolveRevision(repository.root, ledger.repository.revision, repository.objectFormat);
  const indexedFiles = new Map(projectIndex.files.map((file) => [file.path, file]));
  const requestedPaths = new Set();
  for (const fact of ledger.facts) {
    const indexedFile = indexedFiles.get(fact.path);
    if (!indexedFile || indexedFile.blobOid.toLowerCase() !== fact.blobOid.toLowerCase()) {
      throw projectError(`Evidence fact ${fact.claimId} is not attributed to the supplied ProjectIndex.`, {
        code: 'evidence-ledger/index-fact-mismatch',
      });
    }
    requestedPaths.add(fact.path);
  }
  const revisionEntries = treeEntriesAtPaths(
    repository.root,
    revision,
    [...requestedPaths],
    repository.objectFormat,
  );
  const revisionFiles = new Map(revisionEntries.map((file) => [file.path, file]));
  for (const filePath of requestedPaths) {
    const revisionFile = revisionFiles.get(filePath);
    const indexedFile = indexedFiles.get(filePath);
    if (!revisionFile || revisionFile.blobOid !== indexedFile.blobOid.toLowerCase()) {
      throw projectError(`Evidence blob for ${filePath} does not match the ledger.`, {
        code: 'evidence-ledger/blob-mismatch',
      });
    }
  }
  const blobs = batchBlobs(repository.root, revisionEntries, repository.objectFormat);
  for (const fact of ledger.facts) {
    const range = canonicalRange(blobs.get(fact.blobOid.toLowerCase()), fact.line, fact.endLine);
    const rangeSha256 = createHash('sha256').update(range).digest('hex');
    if (rangeSha256 !== fact.rangeSha256) {
      throw projectError(`Evidence range hash does not match for ${fact.claimId}.`, {
        code: 'evidence-ledger/range-mismatch',
      });
    }
  }
  return {
    schemaVersion: 1,
    verified: true,
    ledgerDigest: ledger.ledgerDigest.toLowerCase(),
    indexDigest: projectIndex.digest.toLowerCase(),
    origin: repositoryIdentity(projectIndex.repository.origin, projectIndex.repository.root),
    revision,
    objectFormat: repository.objectFormat,
    factCount: ledger.facts.length,
  };
}
