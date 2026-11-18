import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LIMIT = 64 * 1024 * 1024;
function git(root, args, input) {
  return spawnSync('git', ['--no-replace-objects', '-C', root, ...args], {
    input, maxBuffer: LIMIT, timeout: 10000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
}
const normalize = text => text.replace(/\r\n/g, '\n');
const empty = status => ({ status, added: [], modified: [], deleted: [] });
const diffArgs = ['diff', '--no-index', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=0', '--src-prefix=a/', '--dst-prefix=b/', '--'];
const diffSucceeded = diff => !diff.error && (diff.status === 0 || diff.status === 1);

function markers(report, before, after, strict = false) {
  const changes = empty('modified');
  const beforeLines = before.split('\n'), afterLines = after.split('\n');
  const hunks = [...report.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)];
  if (strict && !hunks.length && !/^Binary files .+ differ$/m.test(report)) return null;
  for (const [index, hunk] of hunks.entries()) {
    const oldStart = Number(hunk[1]), removed = Number(hunk[2] ?? 1), start = Number(hunk[3]), added = Number(hunk[4] ?? 1);
    if (strict) {
      if ((removed && oldStart < 1) || (added && start < 1) || oldStart + removed - 1 > beforeLines.length || start + added - 1 > afterLines.length) return null;
      const bodyStart = report.indexOf('\n', hunk.index);
      if (bodyStart < 0) return null;
      let oldCount = 0, newCount = 0;
      for (const line of report.slice(bodyStart + 1, hunks[index + 1]?.index).split('\n')) {
        if (line.startsWith('-') || line.startsWith(' ')) oldCount++;
        if (line.startsWith('+') || line.startsWith(' ')) newCount++;
      }
      if (oldCount !== removed || newCount !== added) return null;
    }
    for (let i = 0; i < added; i++) {
      // Filling an empty or whitespace-only line adds content rather than replacing it.
      const fillsBlank = i < removed && !beforeLines[oldStart + i - 1].trim() && Boolean(afterLines[start + i - 1].trim());
      changes[i >= removed || fillsBlank ? 'added' : 'modified'].push(start + i);
    }
    if (removed > added) changes.deleted.push({ after: added ? start + added - 1 : start, count: removed - added });
  }
  return changes;
}

function batchMarkers(report, changed) {
  const sections = report.split(/^diff --git /m);
  if (sections.shift() !== '' || sections.length !== changed.size) return null;
  const values = new Map();
  for (const section of sections) {
    const header = /^a\/before\/(\d+) b\/after\/\1\n/.exec(section);
    const entry = header && changed.get(header[1]);
    if (!entry || values.has(entry.file)) return null;
    const value = markers(section, entry.before, entry.after, true);
    if (!value) return null;
    values.set(entry.file, value);
  }
  return values;
}

// Compare captured source text, never the current index or mutable working files.
// Batch-read literal Git objects so a large diagram does not spawn Git per file.
export function sourceChanges(root, repository, sources) {
  const result = new Map([...sources.keys()].map(file => [file, empty('unavailable')]));
  if (!['working-tree', 'git-tree'].includes(repository?.sourceKind) || !/^[a-f0-9]{40}$/.test(repository.baseRevision || '')) return result;
  const tree = git(root, ['ls-tree', '-rz', '--full-tree', repository.baseRevision]);
  if (tree.error || tree.status !== 0) return result;
  const entries = new Map();
  for (const record of tree.stdout.toString('utf8').split('\0')) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    if (match) entries.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
  }
  const wanted = [];
  for (const [file, text] of sources) {
    const fullPath = repository.root && repository.root !== '.' ? `${repository.root}/${file}` : file;
    const entry = entries.get(fullPath);
    if (!entry) {
      const lines = normalize(text).split('\n');
      if (lines.at(-1) === '') lines.pop();
      result.set(file, { ...empty('added'), added: lines.map((_, i) => i + 1) });
    } else if (entry.type === 'blob' && /^100/.test(entry.mode)) wanted.push({ file, text, oid: entry.oid });
  }
  if (!wanted.length) return result;
  const blobs = git(root, ['cat-file', '--batch'], wanted.map(entry => entry.oid).join('\n') + '\n');
  if (blobs.error || blobs.status !== 0) return result;
  let offset = 0, scratch;
  const changed = new Map();
  try {
    for (const entry of wanted) {
      const end = blobs.stdout.indexOf(10, offset);
      if (end < 0) break;
      const header = blobs.stdout.subarray(offset, end).toString('ascii');
      const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
      if (!match || match[1] !== entry.oid) break;
      const size = Number(match[2]);
      offset = end + 1;
      if (offset + size >= blobs.stdout.length) break;
      const raw = blobs.stdout.subarray(offset, offset + size);
      offset += size + 1;
      // Match the Python adapter's fallback; JS/TS sources are normally UTF-8.
      let before;
      try { before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
      catch { if (repository.language !== 'py') continue; before = raw.toString('latin1'); }
      before = normalize(before);
      const after = normalize(entry.text);
      if (before === after) { result.set(entry.file, empty('unchanged')); continue; }
      if (!scratch) {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-source-diff-'));
        fs.mkdirSync(path.join(scratch, 'before'));
        fs.mkdirSync(path.join(scratch, 'after'));
      }
      // User paths never enter the diff protocol (including Unicode/newline names).
      const index = String(changed.size);
      const left = path.join(scratch, 'before', index), right = path.join(scratch, 'after', index);
      fs.writeFileSync(left, before); fs.writeFileSync(right, after);
      changed.set(index, { file: entry.file, before, after });
    }
    if (changed.size) {
      const diff = git(scratch, [...diffArgs, 'before', 'after']);
      const values = diffSucceeded(diff) && batchMarkers(diff.stdout.toString('utf8'), changed);
      if (values) {
        for (const [file, value] of values) result.set(file, value);
      } else {
        // A failed, oversized or incomplete batch must not hide valid file markers.
        for (const [index, entry] of changed) {
          const single = git(scratch, [...diffArgs, path.join('before', index), path.join('after', index)]);
          // Preserve the original permissive single-file handling, including localized binary reports.
          const value = diffSucceeded(single) && markers(single.stdout.toString('utf8'), entry.before, entry.after);
          if (value) result.set(entry.file, value);
        }
      }
    }
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
  return result;
}
