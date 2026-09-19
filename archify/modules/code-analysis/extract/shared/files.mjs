import fs from 'node:fs';
import path from 'node:path';
import { matcher } from './glob.mjs';
import { fail } from './diagnostics.mjs';

const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function listFiles(root, config) {
  return collectFiles(root, config).map(entry => entry.rel);
}

// Capture bytes through a checked descriptor, then give adapters immutable
// input. They must never reopen the enumerated names to obtain source text.
export function snapshotFiles(root, config, accept = () => true) {
  return captureEntries(collectFiles(root, config).filter(entry => accept(entry.rel)));
}

// Resolution needs a frozen inventory even for files excluded from analysis.
// Capture content only for selected sources and configuration/metadata inputs.
export function snapshotTree(root, accept) {
  const entries = collectFiles(root, { include: ['**/*'], exclude: [] });
  const selected = entries.filter(entry => accept(entry.rel));
  const contents = captureEntries(selected);
  for (const entry of selected) validatePath(entry);
  const byName = new Map(entries.map(entry => [entry.rel, entry]));
  return {
    contents, names: [...byName.keys()],
    assertFileUnchanged(name) { if (byName.has(name)) validatePath(byName.get(name)); },
  };
}

function captureEntries(entries) {
  return new Map(entries.map(entry => {
    let fd;
    try {
      validatePath(entry);
      fd = fs.openSync(entry.abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile() || !sameState(before, entry.metadata)) changed(entry.rel);
      validatePath(entry);
      const bytes = fs.readFileSync(fd);
      if (!sameState(before, fs.fstatSync(fd, { bigint: true }))) changed(entry.rel);
      validatePath(entry);
      return [entry.rel, bytes];
    } catch (error) {
      if (error.diagnostics) throw error;
      changed(entry.rel);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }));
}

function sameState(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function changed(rel) {
  fail('extract/source-changed', 'A source path changed or escaped the analyzed root during extraction.', {
    subject: { file: rel }, supportedFixes: ['stop concurrent source changes and retry analysis'],
  });
}

function validatePath(entry) {
  try {
    for (const item of entry.chain) {
      const current = fs.lstatSync(item.abs, { bigint: true });
      if (current.isSymbolicLink() || !sameState(current, item.metadata)) changed(entry.rel);
    }
    const relative = path.relative(entry.root, fs.realpathSync(entry.abs));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) changed(entry.rel);
  } catch (error) {
    if (error.diagnostics) throw error;
    changed(entry.rel);
  }
}

function collectFiles(root, config) {
  root = fs.realpathSync(root);
  const include = matcher(config.include);
  const exclude = matcher(config.exclude);
  const out = [];
  const rootEntry = { abs: root, metadata: fs.lstatSync(root, { bigint: true }) };
  (function walk(dir, chain) {
    const parent = { root, abs: dir, chain, rel: toPosix(path.relative(root, dir)) };
    validatePath(parent);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      validatePath(parent);
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const metadata = fs.lstatSync(abs, { bigint: true });
      if (metadata.isSymbolicLink() || entry.isDirectory() !== metadata.isDirectory() || entry.isFile() !== metadata.isFile()) changed(rel);
      const next = [...chain, { abs, metadata }];
      if (entry.isDirectory()) { if (!exclude(`${rel}/`)) walk(abs, next); continue; }
      if (!entry.isFile()) continue;
      if (include(rel) && !exclude(rel)) out.push({ rel, root, abs, metadata, chain: next });
    }
    validatePath(parent);
  })(root, [rootEntry]);
  return out.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}

// Precedence: test > generated > source. A generated file that lives under a
// test directory is test infrastructure, not product code.
export function classifyRole(rel, roles) {
  if (matcher(roles.test)(rel)) return 'test';
  if (matcher(roles.generated)(rel)) return 'generated';
  return 'source';
}

export function lineCount(content) {
  if (!content.length) return 0;
  const lines = content.split(/\r\n|\n|\r/);
  return lines.length - (/(?:\r\n|\n|\r)$/.test(content) ? 1 : 0);
}
