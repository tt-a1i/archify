import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCliSync } from './resolve-cli.mjs';

export const integrationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(integrationRoot, '..', '..');
const adapterPrefix = 'integrations/deepseek-harness/';
const requiredAdapterFiles = ['package.json', 'release.json', 'cordis.patch.yml', 'README.md', 'lib/index.js'];

function readGit(args) {
  const result = spawnCliSync('git', args, { cwd: repoRoot, encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`unable to read committed DSH adapter source: ${result.stderr?.toString('utf8') || result.error?.message}`);
  }
  return result.stdout;
}

export const adapterCommit = readGit(['rev-parse', '--verify', 'HEAD']).toString('utf8').trim();
const adapterEntries = new TextDecoder('utf-8', { fatal: true })
  .decode(readGit(['ls-tree', '-r', '-z', adapterCommit, '--', adapterPrefix]))
  .split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    const [mode, type, objectId] = record.slice(0, separator).split(' ');
    return { mode, type, objectId, relative: record.slice(separator + 1).slice(adapterPrefix.length) };
  }).filter(({ relative }) => requiredAdapterFiles.includes(relative) || relative.startsWith('lib/'));

for (const relative of requiredAdapterFiles) {
  if (!adapterEntries.some((entry) => entry.relative === relative)) {
    throw new Error(`required committed DSH adapter input is missing: ${relative}`);
  }
}

// Capture Git blobs, not working-tree paths: local edits and symlink swaps cannot
// change the package identified by adapterCommit.
const portablePaths = new Map();
const adapterFiles = new Map(adapterEntries.map((entry) => {
  const segments = entry.relative.split('/');
  for (const [index, segment] of segments.entries()) {
    if (!segment || /[\\:\x00-\x1f<>"|?*]/.test(segment) || /[. ]$/.test(segment)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) {
      throw new Error(`DSH adapter input has an unsupported path: ${entry.relative}`);
    }
    const prefix = segments.slice(0, index + 1).join('/');
    const key = prefix.normalize('NFC').toLowerCase();
    if (portablePaths.has(key) && portablePaths.get(key) !== prefix) {
      throw new Error(`DSH adapter paths collide across supported filesystems: ${portablePaths.get(key)} and ${prefix}`);
    }
    portablePaths.set(key, prefix);
  }
  if (entry.mode === '120000') {
    throw new Error(`refusing to package committed DSH adapter symlink: ${entry.relative}`);
  }
  if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
    throw new Error(`DSH adapter input must be a regular Git file: ${entry.relative} (${entry.mode})`);
  }
  return [entry.relative, { ...entry, content: readGit(['cat-file', 'blob', entry.objectId]) }];
}));

export const manifest = JSON.parse(adapterFiles.get('package.json').content.toString('utf8'));
export const release = JSON.parse(adapterFiles.get('release.json').content.toString('utf8'));

export function stageAdapter(destination) {
  for (const [relative, entry] of adapterFiles) {
    const target = path.join(destination, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.content, { mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }
}

if (!/^[a-f0-9]{40}$/.test(release.sourceCommit)) {
  throw new Error('DSH release sourceCommit must be a full immutable Git commit');
}

export function releaseSnapshot(destination) {
  // A separate checkout gives the canonical stager a real index, preserves Git
  // modes, and cannot include uncommitted or untracked files from the caller.
  for (const args of [
    ['clone', '--shared', '--no-checkout', '--', repoRoot, destination],
    ['-C', destination, '-c', 'core.autocrlf=false', 'checkout', '--detach', release.sourceCommit],
  ]) {
    const result = spawnCliSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      throw new Error(`unable to read DSH source ${release.sourceCommit}: ${result.stderr || result.error?.message}`);
    }
  }
  const skill = JSON.parse(fs.readFileSync(path.join(destination, 'archify', 'package.json'), 'utf8'));
  if (skill.version !== release.skillVersion) {
    throw new Error(`DSH Skill version mismatch: ${skill.version} != ${release.skillVersion}`);
  }
}
