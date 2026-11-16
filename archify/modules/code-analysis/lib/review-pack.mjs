import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DiagnosticError } from '../core/index.mjs';
import { isWorkspacePath } from '../overlay/workspace.mjs';

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const VIEW_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const VIEW_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']);
const THEMES = ['light', 'dark'];
const MAX_JSON = 1024 * 1024;
const MAX_SVG = 5 * 1024 * 1024;
const MAX_IMAGES = 8 * 1024 * 1024;

function fail(code, message, supportedFixes) {
  throw new DiagnosticError(message, [{ code: 'analysis/pr-pack-' + code, severity: 'error',
    message, subject: { surface: 'pr-review' }, evidence: {}, supportedFixes: [supportedFixes] }]);
}

function readFile(file, maxBytes) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) {
    fail('size', 'A review pack file is empty, too large, or not a regular file.',
      'rebuild the pack with fewer views or smaller SVGs');
  }
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.length > maxBytes) {
    fail('size', 'A review pack file changed size while it was being read.', 'rebuild the pack and try again');
  }
  return bytes;
}

const readJson = file => JSON.parse(readFile(file, MAX_JSON).toString('utf8'));

function packFile(root, name) {
  // Build receipts record the originating machine's paths. A copied pack uses
  // the known output layout beside its receipt, never the paths in the receipt.
  const file = fs.realpathSync(path.join(root, 'views', name));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    fail('path', 'A review pack asset resolves outside its directory.', 'keep the build receipt and its generated views together');
  }
  return file;
}

function repoName(value) {
  if (typeof value !== 'string') return null;
  const bare = value.replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/i, '');
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(bare) ? bare.toLowerCase() : null;
}

function withinScope(file, scope) {
  if (!isWorkspacePath(file)) return null;
  if (scope === '.') return file;
  return file.startsWith(scope + '/') ? file.slice(scope.length + 1) : null;
}

function pathsBySide(changed) {
  const before = new Set();
  const after = new Set();
  for (const row of changed) {
    if (row.status !== 'added' && row.scopeBoundary !== 'entered') before.add(row.previousPath || row.path);
    if (row.status !== 'removed' && row.scopeBoundary !== 'left') after.add(row.path);
  }
  return { base: before, head: after };
}

function viewAnchors(diagram, scope, allowed) {
  const seen = new Set();
  const anchors = [];
  // Repository sources are attached to a diagram's top-level node collection.
  // Only anchors on the corresponding side of a captured Git change can act
  // as navigation controls in this report.
  for (const collection of Object.values(diagram)) {
    if (!Array.isArray(collection)) continue;
    for (const node of collection) {
      if (!Array.isArray(node?.sources)) continue;
      const side = node.change === 'removed' ? 'base' : 'head';
      for (const source of node.sources) {
        const file = withinScope(source?.path, scope);
        const line = source?.line == null ? null : source.line;
        if (!allowed[side].has(file) || (line !== null && (!Number.isSafeInteger(line) || line < 1))) continue;
        const key = JSON.stringify([side, file, line]);
        if (seen.has(key)) continue;
        seen.add(key);
        anchors.push({ side, file, line });
        if (anchors.length === 12) return anchors;
      }
    }
  }
  return anchors;
}

function validLabel(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function readPrReviewPack(receiptFile, { pr, scope, changedFiles }) {
  try {
    const file = fs.realpathSync(receiptFile);
    const root = path.dirname(file);
    const receipt = readJson(file);
    const revisions = receipt?.revisions;
    if (receipt?.kind !== 'pr-pack-receipt' || receipt.schemaVersion !== 1 || receipt.ok !== true ||
        revisions?.verified !== true || !SHA.test(revisions.baseSha) || !SHA.test(revisions.headSha)) {
      fail('receipt', 'A verified output receipt from archify pr build is required.',
        'build the diagram pack with --repo-root and pass the resulting pr-pack.receipt.json');
    }
    if (revisions.baseSha !== pr.mergeBaseSHA || revisions.headSha !== pr.headSHA ||
        !repoName(receipt.repository) || repoName(receipt.repository) !== repoName(pr.repository)) {
      fail('revision', 'The diagram pack repository or revisions do not match the captured pull request.',
        'set the manifest repository and rebuild against the displayed merge-base and head commits');
    }
    if (!validLabel(receipt.title, 200) || !Array.isArray(receipt.views) ||
        receipt.views.length < 1 || receipt.views.length > 12 || !Array.isArray(receipt.assets) || receipt.assets.length > 24) {
      fail('manifest', 'The build receipt has an invalid title, view list or asset list.', 'rebuild the diagram pack');
    }
    const allowed = pathsBySide(changedFiles);
    const views = new Set();
    let total = 0;
    return { title: receipt.title, views: receipt.views.map(view => {
      if (!view || typeof view.id !== 'string' || !VIEW_ID.test(view.id) || views.has(view.id) || !VIEW_TYPES.has(view.type) ||
          !validLabel(view.title, 160) || (view.caption && !validLabel(view.caption, 600))) {
        fail('view', 'The build receipt has a malformed or duplicate diagram view.', 'rebuild the diagram pack');
      }
      views.add(view.id);
      const diagram = readJson(packFile(root, view.id + '.json'));
      if (!diagram || typeof diagram !== 'object' || Array.isArray(diagram)) {
        fail('view', 'A generated diagram snapshot is invalid.', 'rebuild the diagram pack');
      }
      const evidence = diagram.meta?.repository;
      if (evidence && (repoName(evidence.url) !== repoName(pr.repository) || evidence.revision !== pr.headSHA ||
          (evidence.base_revision && evidence.base_revision !== pr.mergeBaseSHA))) {
        fail('revision', 'A generated diagram snapshot cites a different repository or revision.',
          'align the diagram sources with the pull request and rebuild the pack');
      }
      const images = {};
      for (const theme of THEMES) {
        const assets = receipt.assets.filter(asset => asset?.view === view.id && asset.theme === theme);
        if (!assets.length) continue;
        const [asset] = assets;
        if (assets.length !== 1 || asset.id !== view.id + '-' + theme ||
            !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_SVG || !DIGEST.test(asset.sha256 || '')) {
          fail('asset', 'A generated SVG is missing its unique checksum or valid size.', 'rebuild the diagram pack');
        }
        total += asset.bytes;
        if (total > MAX_IMAGES) fail('size', 'The review diagrams exceed the 8 MiB SVG budget.', 'build a smaller set of views');
        const bytes = readFile(packFile(root, asset.id + '.svg'), asset.bytes);
        if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256 ||
            !/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/.test(bytes.toString('utf8'))) {
          fail('asset', 'A diagram asset does not match the SVG recorded in the build receipt.', 'restore the generated SVG or rebuild the pack');
        }
        // Treat native SVG as an image. Never insert SVG markup into the reader.
        images[theme] = 'data:image/svg+xml;base64,' + bytes.toString('base64');
      }
      if (!Object.keys(images).length) fail('asset', 'A diagram view has no recorded SVG assets.', 'rebuild the diagram pack');
      return { id: view.id, type: view.type, title: view.title, caption: view.caption || null, images,
        anchors: evidence ? viewAnchors(diagram, scope, allowed) : [] };
    }) };
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    fail('read', 'Could not read the native diagram pack: ' + error.message,
      'provide the pack receipt and its generated views in the same directory');
  }
}

export function prFileCounts(files) {
  const counts = { total: files.length, added: 0, modified: 0, removed: 0, renamed: 0, copied: 0, other: 0 };
  for (const file of files) {
    const key = file.status;
    if (Object.hasOwn(counts, key) && key !== 'total') counts[key]++;
    else counts.other++;
  }
  return counts;
}

export function changesUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* diagnosed below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || /[<>\s]/.test(url.href)) {
    fail('url', 'The review URL must be an absolute HTTPS URL without credentials.',
      'pass the published offline report URL with --review-url');
  }
  url.hash = 'changes';
  return url.href;
}
