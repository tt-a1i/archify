import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { verifyRepositoryEvidence } from '../renderers/shared/repository-evidence.mjs';
import { parseRepositoryRemote } from '../renderers/shared/repository-location.mjs';
import { chartFromData, compileExplainerChart } from './charts.mjs';

const MAX_CODE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const SECRET_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.(?:ssh|aws|gnupg|kube)|(?:id_(?:rsa|dsa|ecdsa|ed25519))(?:\..*)?|(?:credentials?|secrets?)(?:[._-].*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i;
const SECRET_CONTENT = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/i;
const CREDENTIAL_ASSIGNMENT = /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?[ \t]*[:=][ \t]*([^\r\n]*)/gi;
const ENVIRONMENT_REFERENCE = /^(?:\$(?:[A-Za-z_][\w]*|\{[A-Za-z_][\w]*\})|(?:process\.env|os\.environ|env)(?:\.[A-Za-z_][\w]*|\[['"][A-Za-z_][\w]*['"]\])|(?:os\.getenv|getenv|env)\(\s*['"][A-Za-z_][\w]*['"]\s*\))$/;

export function containsExplainerSecret(text, sourcePath = '') {
  if (SECRET_CONTENT.test(text)) return true;
  const configuration = /\.(?:ya?ml|toml|ini|conf|config|properties|cfg|sh|bash)$/i.test(sourcePath);
  for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const value = match[1].trim().replace(/\s+(?:#|\/\/).*$/, '').replace(/[;,]\s*$/, '').trim();
    if (!value || /^(?:null|nil|none|undefined|~)$/i.test(value) || ENVIRONMENT_REFERENCE.test(value)) continue;
    const quoted = value.match(/^(['"`])([\s\S]*?)\1/);
    if (quoted) {
      if (quoted[2].length >= 4 && !ENVIRONMENT_REFERENCE.test(quoted[2])) return true;
    } else if (configuration) {
      // Configuration scalars are values, whereas an unquoted JS/Python identifier can be a code reference.
      return true;
    }
  }
  return false;
}

function location(document, pointer, component) {
  const map = document?.sourceMap;
  const entry = map instanceof Map ? map.get(pointer) : map?.[pointer];
  return { path: pointer, component, ...(document?.sourcePath ? { input: document.sourcePath } : {}), line: Number.isInteger(entry?.line) && entry.line > 0 ? entry.line : 1,
    ...(Number.isInteger(entry?.column) ? { column: entry.column } : {}) };
}

function fail(document, pointer, component, reason, message, fix, example) {
  const examples = {
    source: '{"id":"router","title":"Router","path":"src/router.js","lines":[1,3]}',
    code: '{"id":"code","type":"code","source":"router"}',
    image: '{"id":"image","type":"image","path":"images/figure.png","alt":"Figure"}',
  };
  throwDiagnosticError(message, [{ code: `explainer/${reason}`, severity: 'error', message,
    subject: location(document, pointer, component),
    evidence: { reason, example: example || examples[component] || examples.source }, supportedFixes: [fix] }]);
}

function safePath(document, value, pointer, component) {
  if (typeof value !== 'string' || !value || /^[\/\\]/.test(value)
      || /[\\:\u0000-\u001f\u007f?#]/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    fail(document, pointer, component, 'source-path', 'Resource paths must stay inside their root directory.',
      'Use a relative path with forward slashes and no dot segments.', 'src/router.js');
  }
  if (value.split('/').some(part => SECRET_NAME.test(part))) {
    fail(document, pointer, component, 'secret-path', 'This resource belongs to a sensitive file class.',
      'Reference a public source file or remove this resource.');
  }
  return value;
}

function gitBytes(document, repoRoot, args, pointer, limit = MAX_CODE_BYTES) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], { maxBuffer: limit });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length > limit) {
    fail(document, pointer, 'source', 'source-read', 'The pinned repository resource could not be read within the size limit.',
      'Use an available, readable source file smaller than 16 MiB.');
  }
  return result.stdout;
}

function deriveRepository(document, repoRoot) {
  if (!repoRoot) fail(document, '/meta/repository', 'source', 'repository-root', 'Repository sources require a local repository.',
    'Pass --repo-root with the matching local Git checkout.', '--repo-root /absolute/path/to/repository');
  const raw = gitBytes(document, repoRoot, ['remote', 'get-url', 'origin'], '/meta/repository').toString('utf8').trim();
  const remote = parseRepositoryRemote(raw);
  if (!remote) fail(document, '/meta/repository', 'source', 'repository-origin', 'The repository origin cannot be represented safely.',
    'Configure a credential-free repository origin without query or fragment.');
  const revision = gitBytes(document, repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], '/meta/repository').toString('utf8').trim();
  return { url: remote.url, revision,
    ...(remote.provider && remote.protocol === 'https:' && remote.endpoint === 'standard' ? {} : { link_mode: 'local-only' }) };
}

function resources(document) {
  const result = [];
  for (const [panelIndex, panel] of (document.panels || []).entries()) {
    for (const [index, block] of (panel.blocks || []).entries()) result.push({ block, pointer: `/panels/${panelIndex}/blocks/${index}` });
  }
  return result;
}

function digest(bytes) {
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    contentBase64: bytes.toString('base64') };
}

function imageMime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 13 && /^(GIF87a|GIF89a)$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function readImage(document, baseDir, authoredPath, pointer) {
  if (!baseDir) fail(document, pointer, 'image', 'asset-root', 'Local images require an input directory.',
    'Provide the original input directory as baseDir.');
  const relative = safePath(document, authoredPath, `${pointer}/path`, 'image');
  const expected = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(relative).toLowerCase()];
  if (!expected) fail(document, `${pointer}/path`, 'image', 'asset-format', 'Only local PNG, JPEG, WebP and GIF images are supported.',
    'Use a PNG, JPEG, WebP or GIF image.');
  const bytes = readContained(document, baseDir, relative, pointer, 'image', MAX_IMAGE_BYTES, '8 MiB');
  const mime = imageMime(bytes);
  if (mime !== expected) fail(document, pointer, 'image', 'asset-format', 'The image bytes do not match a supported image format.',
    'Use a correctly encoded image whose extension matches its bytes.');
  return { path: relative, mime, ...digest(bytes), dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
}

// Read a regular file inside baseDir without following links, and confirm it did not change meanwhile.
function readContained(document, baseDir, relative, pointer, component, limit, limitText) {
  const noun = component === 'image' ? 'image' : 'data file', Noun = noun[0].toUpperCase() + noun.slice(1);
  let fd;
  try {
    const root = fs.realpathSync(baseDir);
    const ancestors = [[root, fs.lstatSync(root)]];
    let candidate = root;
    for (const part of relative.split('/')) {
      candidate = path.join(candidate, part);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail(document, `${pointer}/path`, component, 'asset-symlink', `${Noun} paths may not traverse symbolic links.`,
        `Copy the ${noun} into the input directory as a regular file.`);
      ancestors.push([candidate, stat]);
    }
    if (!ancestors.at(-1)[1].isFile()) fail(document, pointer, component, 'asset-file', `The ${noun} must be a regular file.`, `Use a regular ${noun}.`);
    fd = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    if (!sameFile(before, ancestors.at(-1)[1]) || before.size > limit) fail(document, pointer, component, 'asset-size',
      `The ${noun} changed or exceeds the ${limitText} size limit.`, `Use a stable ${noun} smaller than ${limitText}.`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const unchanged = offset === bytes.length && sameFile(before, fs.fstatSync(fd))
      && ancestors.every(([file, stat]) => { const current = fs.lstatSync(file); return !current.isSymbolicLink() && sameFile(current, stat); });
    if (!unchanged) fail(document, pointer, component, 'asset-changed', `The ${noun} path or bytes changed while being frozen.`,
      `Finish ${noun} updates before rendering again.`);
    return bytes;
  } catch (error) {
    if (error.archifyDiagnostics) throw error;
    fail(document, pointer, component, 'asset-read', `The ${noun} cannot be read safely inside the input directory.`,
      `Use an accessible regular ${noun} inside the input directory.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Prepare source locations and freeze code/image bytes; never mutate author input. */
export async function resolveExplainerSources(document, { repoRoot, baseDir, sourceMap, sourcePath } = {}) {
  const context = { sourceMap, sourcePath };
  const sources = Object.create(null);
  const assets = Object.create(null);
  const dependencies = [];
  const entries = document.sources || [];
  const blocks = resources(document);
  const codeIds = new Set();
  const blockIds = new Set();
  for (const { block, pointer } of blocks) {
    if (!['code', 'image'].includes(block.type)) continue;
    if (typeof block.id !== 'string' || !block.id || blockIds.has(block.id)) fail(context, pointer, block.type, 'resource-id',
      'Resource blocks require a unique stable id.', 'Give each code or image block its own id.');
    blockIds.add(block.id);
    if (block.type === 'code') codeIds.add(block.source);
  }
  const repositorySources = [];
  for (const [index, entry] of entries.entries()) {
    const pointer = `/sources/${index}`;
    if (typeof entry.id !== 'string' || !entry.id || Object.hasOwn(sources, entry.id)) fail(context, pointer, 'source', 'source-id',
      'Sources require unique ids.', 'Give each source a unique id.');
    sources[entry.id] = null;
    if (entry.path) {
      safePath(context, entry.path, `${pointer}/path`, 'source');
      if (entry.lines && (!Array.isArray(entry.lines) || entry.lines.length !== 2 || !entry.lines.every(Number.isSafeInteger)
          || entry.lines[0] < 1 || entry.lines[1] < entry.lines[0])) fail(context, `${pointer}/lines`, 'source', 'source-lines',
        'Repository line ranges must be ordered and positive.', 'Use lines: [start, end].', '[1, 3]');
    }
    if (entry.url) {
      let url; try { url = new URL(entry.url); } catch {}
      if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(entry.url)) fail(context, `${pointer}/url`, 'source', 'source-url',
        'Source links require credential-free HTTP(S) URLs.', 'Use https://example.com/article.');
    }
    sources[entry.id] = Object.freeze({id:entry.id,title:entry.title,...(entry.url?{url:entry.url}:{}),...(entry.path?{path:entry.path}:{}),...(entry.lines?{lines:[...entry.lines]}:{}),...(entry.revision?{revision:entry.revision}:{})});
    if (codeIds.has(entry.id)) {
      if (!entry.path || !entry.lines) fail(context,pointer,'code','code-source','Code requires a Git file and line range.','Add path and lines to the source.');
      repositorySources.push({entry,index});
    }
  }

  let repository = null;
  if (repositorySources.length) {
    const metadata = document.meta?.repository ? { ...document.meta.repository } : deriveRepository(context, repoRoot);
    for (const { entry, index } of repositorySources) {
      if (entry.revision !== undefined && String(entry.revision).toLowerCase() !== String(metadata.revision).toLowerCase()) fail(context, `/sources/${index}/revision`, 'source', 'source-revision',
        'All repository sources must use the document’s pinned revision.', 'Use the document repository revision or omit the source revision.');
    }
    let verified;
    try {
      verified = verifyRepositoryEvidence('architecture', { meta: { repository: metadata }, components: repositorySources.map(({ entry }) => ({
        id: entry.id, sources: [{ path: entry.path, line: entry.lines[0], end_line: entry.lines[1] }],
      })) }, repoRoot);
    } catch (error) {
      const original = error.archifyDiagnostics?.[0];
      const match = original?.subject?.path?.match(/^\/components\/(\d+)/);
      const index = match ? repositorySources[Number(match[1])]?.index : undefined;
      const examples = {
        'repository-evidence/root-required': '--repo-root /absolute/path/to/repository',
        'repository-evidence/root-not-top-level': '--repo-root /absolute/path/to/repository',
        'repository-evidence/root-unreadable': '--repo-root /absolute/path/to/repository',
        'repository-evidence/revision-invalid': 'git rev-parse HEAD',
        'repository-evidence/revision-unavailable': 'git rev-parse HEAD',
        'repository-evidence/url-invalid': '{"url":"https://github.com/owner/repository"}',
        'repository-evidence/origin-mismatch': 'git remote get-url origin',
        'repository-evidence/line-out-of-range': '{"path":"src/router.js","lines":[1,3]}',
        'repository-evidence/file-missing': '{"path":"src/router.js","lines":[1,3]}',
      };
      fail(context, index === undefined ? '/meta/repository' : `/sources/${index}`, 'source', 'repository-location',
        'The declared repository location could not be verified.', 'Correct the repository origin, pinned commit, file path and line range.',
        examples[original?.code]);
    }
    repository = Object.freeze({ ...verified.repository });
    for (const { entry, index } of repositorySources) {
      const reference = verified.nodes[entry.id][0];
      const result = { id: entry.id, ...(entry.title === undefined ? {} : { title: entry.title }),
        revision: repository.revision, path: reference.path, lines: Object.freeze([...entry.lines]),
        ...(reference.href ? { url: reference.href } : {}) };
      if (codeIds.has(entry.id)) {
        const bytes = gitBytes(context, repoRoot, ['show', `${repository.revision}:${entry.path}`], `/sources/${index}`);
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
          fail(context, `/sources/${index}`, 'code', 'source-encoding', 'Code sources must contain UTF-8 text.', 'Use a UTF-8 text source file.');
        }
        if (text.includes('\0') || containsExplainerSecret(text, entry.path)) fail(context, `/sources/${index}`, 'code', 'secret-content',
          'This source cannot be displayed because it contains sensitive or binary content.', 'Use a public source file without secrets.');
        result.text = text.split(/\r\n|\n|\r/).slice(entry.lines[0] - 1, entry.lines[1]).join('\n');
        const frozen = digest(bytes);
        Object.assign(result, { sha256: frozen.sha256, bytes: frozen.bytes });
        dependencies.push(Object.freeze({ kind: 'repository', id: entry.id, path: entry.path, revision: repository.revision, ...frozen }));
      }
      sources[entry.id] = Object.freeze(result);
    }
  }
  // A cited repository file also carries its excerpt when the repository is at hand, so a reader can
  // check the claim in place. A citation that cannot be verified or read stays a plain reference.
  const cited = document.sources.map((entry,index)=>({entry,index})).filter(({entry})=>entry.path && entry.lines && !codeIds.has(entry.id));
  if (cited.length && repoRoot) {
    let metadata = null;
    try { metadata = document.meta?.repository ? { ...document.meta.repository } : deriveRepository(context, repoRoot); } catch {}
    for (const { entry, index } of metadata ? cited : []) {
      try {
        const verified = verifyRepositoryEvidence('architecture', { meta: { repository: metadata }, components: [{ id: entry.id, sources: [{ path: entry.path, line: entry.lines[0], end_line: entry.lines[1] }] }] }, repoRoot);
        const reference = verified.nodes[entry.id][0];
        const bytes = gitBytes(context, repoRoot, ['show', `${verified.repository.revision}:${entry.path}`], `/sources/${index}`);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0') || containsExplainerSecret(text, entry.path)) continue;
        const frozen = digest(bytes);
        sources[entry.id] = Object.freeze({ id: entry.id, ...(entry.title === undefined ? {} : { title: entry.title }), revision: verified.repository.revision, path: reference.path,
          lines: Object.freeze([...entry.lines]), ...(reference.href ? { url: reference.href } : {}), text: text.split(/\r\n|\n|\r/).slice(entry.lines[0] - 1, entry.lines[1]).join('\n'), sha256: frozen.sha256, bytes: frozen.bytes });
        dependencies.push(Object.freeze({ kind: 'repository', id: entry.id, path: entry.path, revision: verified.repository.revision, ...frozen }));
        repository ||= Object.freeze({ ...verified.repository });
      } catch {}
    }
  }
  for (const { block, pointer } of blocks) {
    if (block.type === 'code') {
      const source = sources[block.source];
      if (!source || !source.path || typeof source.text !== 'string') fail(context, `${pointer}/source`, 'code', 'code-source',
        'Code blocks require a Git code excerpt.', 'Reference a repository source id with a valid line range.');
    }
  }
  let assetBytes = 0;
  for (const { block, pointer } of blocks) {
    if (block.type !== 'image') continue;
    const asset = readImage(context, baseDir, block.path, pointer);
    assetBytes += asset.bytes;
    if (assetBytes > MAX_ASSET_BYTES) fail(context, pointer, 'image', 'asset-budget', 'Embedded images exceed the 32 MiB document limit.',
      'Reduce the total embedded image bytes below 32 MiB.');
    assets[block.id] = Object.freeze({ id: block.id, alt: block.alt, ...asset });
    dependencies.push(Object.freeze({ kind: 'image', id: block.id, path: asset.path, sha256: asset.sha256, bytes: asset.bytes, contentBase64: asset.contentBase64 }));
  }
  // A data chart reads its CSV or JSON once, freezes the bytes and keeps the chart text built from them.
  const charts = Object.create(null);
  for (const { block, pointer } of blocks) {
    if (block.type !== 'chart' || !block.data) continue;
    if (!baseDir) fail(context, pointer, 'chart', 'asset-root', 'A data chart requires an input directory.', 'Run finalize on the draft file next to its data.');
    const relative = safePath(context, block.data.path, `${pointer}/data/path`, 'chart');
    if (!/\.(?:csv|json)$/iu.test(relative)) fail(context, `${pointer}/data/path`, 'chart', 'chart-data-format', 'Chart data is a .csv or .json file.', 'data=latency.csv');
    const bytes = readContained(context, baseDir, relative, pointer, 'chart', MAX_DATA_BYTES, '2 MiB');
    let built;
    try { built = chartFromData(bytes, relative, block.data); } catch { built = { error: 'The data file is not UTF-8 text.' }; }
    const chart = built.error ? built : compileExplainerChart(built.text);
    if (chart.error) fail(context, pointer, 'chart', 'chart-data', chart.error, '@chart type=bar data=latency.csv x=day y=p50,p99');
    charts[block.id] = built.text;
    dependencies.push(Object.freeze({ kind: 'data', id: block.id, path: relative, ...digest(bytes) }));
  }
  return { sources: Object.freeze(sources), assets: Object.freeze(assets), charts: Object.freeze(charts), dependencies: Object.freeze(dependencies), repository };
}
