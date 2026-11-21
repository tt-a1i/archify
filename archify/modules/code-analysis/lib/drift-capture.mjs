import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../core/index.mjs';

const MAX_FILES = 50_000;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_BLOB = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha = /^[a-f0-9]{40}$/;
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));

function runGit(root, args, { maxBuffer = MAX_BLOB, input } = {}) {
  const run = spawnSync('git', ['--no-replace-objects', '-C', root, ...args], {
    env: { ...gitEnv, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0' },
    input, maxBuffer, timeout: 60_000, windowsHide: true,
  });
  if (run.status !== 0 || run.error) fail('drift/git-read', 'Could not read the pinned local Git objects.', {
    subject: { operation: args[0] },
    supportedFixes: ['use a complete local Git repository containing both pinned commits'],
  });
  return run.stdout;
}

export function driftRepository(directory) {
  return fs.realpathSync(runGit(directory, ['rev-parse', '--show-toplevel']).toString('utf8').trimEnd());
}

export function assertDriftPin(repo, oid, side) {
  const type = sha.test(oid) && runGit(repo, ['cat-file', '--batch-check'], { input: oid + '\n' })
    .toString('utf8').trim();
  if (!type || !type.startsWith(oid + ' commit ') || !/ commit \d+$/.test(type)) fail('drift/invalid-pin', 'Select a full local commit SHA for each side.', {
    subject: { side }, supportedFixes: ['use git rev-parse to resolve the intended base and head commits'],
  });
}

const skippedDirectory = segments => segments.slice(0, -1).some(s => s === 'node_modules');
function portableParts(name) {
  const parts = name.split('/');
  // Materialize regular blobs only, into a private staging directory. Reject
  // aliases even on platforms that would accept them so captures are portable.
  if (parts.some(part => !part || part === '.' || part === '..' || /^\.git$/i.test(part) ||
    /[\\:<>"|?*\u0000-\u001f\u007f]/u.test(part) || /[. ]$/.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) || /~\d/.test(part))) {
    fail('drift/unsupported-path', 'A tracked path cannot be captured without creating filesystem aliases.', {
      supportedFixes: ['choose commits with portable tracked paths'],
    });
  }
  return parts;
}

function assertUniquePath(seen, parts) {
  for (let i = 1; i <= parts.length; i++) {
    const component = parts.slice(0, i).join('/');
    const key = component.normalize('NFC').toLowerCase();
    if (seen.has(key) && seen.get(key) !== component) fail('drift/path-collision', 'The pinned tree contains case or normalization aliases.');
    seen.set(key, component);
  }
}

function writeBlobs(repo, target, batch) {
  const input = batch.map(entry => entry.hash).join('\n') + '\n';
  const buf = runGit(repo, ['cat-file', '--batch'], {
    input, maxBuffer: batch.reduce((sum, e) => sum + e.size + 100, 1024),
  });
  let offset = 0;
  for (const entry of batch) {
    const next = buf.indexOf(10, offset);
    if (next < offset || buf.toString('ascii', offset, next) !== [entry.hash, 'blob', entry.size].join(' ') ||
        buf[next + 1 + entry.size] !== 10) fail('drift/blob-invalid', 'Git blob data did not match the pinned tree entry.');
    const bytes = buf.subarray(next + 1, next + 1 + entry.size);
    const verified = createHash('sha1').update('blob ' + entry.size + '\0').update(bytes).digest('hex');
    if (verified !== entry.hash) fail('drift/blob-invalid', 'The source blob digest did not match the pinned tree entry.');
    const file = path.join(target, ...entry.parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    offset = next + 2 + entry.size;
  }
  if (offset !== buf.length) fail('drift/blob-invalid', 'Git returned unexpected data after the requested blobs.');
}

export function captureDriftTree(repo, oid, target) {
  const tree = decoder.decode(runGit(repo, ['ls-tree', '-rlz', '--full-tree', oid]));
  const seen = new Map();
  const omitted = new Map();
  const entries = [];
  let bytes = 0;
  for (const record of tree.slice(0, -1).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, hash, sizeText] = record.slice(0, tab).trim().split(/ +/);
    const name = record.slice(tab + 1);
    const parts = portableParts(name);
    if (skippedDirectory(parts)) continue;
    assertUniquePath(seen, parts);
    if (mode === '120000' || mode === '160000') {
      omitted.set(name, hash);
      continue;
    }
    const size = Number(sizeText);
    if (type !== 'blob' || !sha.test(hash) || !Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB ||
        (bytes += size) > MAX_BYTES || entries.length >= MAX_FILES) {
      fail('drift/capture-limit', 'The pinned tree exceeds a capture limit.', {
        evidence: { maxFiles: MAX_FILES, maxBlobBytes: MAX_BLOB, maxTotalBytes: MAX_BYTES },
        supportedFixes: ['try a smaller pinned repository without oversized tracked artifacts'],
      });
    }
    entries.push({ hash, size, parts });
  }
  fs.mkdirSync(target);
  let batch = [], batchBytes = 0;
  for (const entry of entries) {
    if (batch.length && (batch.length >= 512 || batchBytes + entry.size > MAX_BLOB)) {
      writeBlobs(repo, target, batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entry.size;
  }
  if (batch.length) writeBlobs(repo, target, batch);
  return omitted;
}
