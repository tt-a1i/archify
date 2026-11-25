#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containedBy } from '../archify/renderers/shared/path-semantics.mjs';
import { validatePortablePathSet } from '../archify/renderers/shared/portable-path.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION_PREFIX = 'archify-pr/';
const REQUIRED_FILES = Object.freeze([
  'archify-pr/SKILL.md',
  'archify-pr/LICENSE',
  'archify-pr/bin/archify-pr.mjs',
  'archify-pr/references/pr-workflow.md',
]);


function decodeGitOutput(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('tracked archify-pr paths must be valid UTF-8');
  }
}

function gitFailureDetail(result) {
  if (result.stderr?.length) return decodeGitOutput(result.stderr).trim();
  if (result.error?.message) return result.error.message;
  return `exit status ${result.status ?? 'unknown'}`;
}

function trackedEntries(repoRoot) {
  const result = spawnSync('git', ['ls-files', '--stage', '-z', '--', 'archify-pr'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (result.status !== 0) {
    throw new Error(`unable to enumerate tracked archify-pr files: ${gitFailureDetail(result)}`);
  }
  return decodeGitOutput(result.stdout).split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    const metadata = separator === -1 ? [] : record.slice(0, separator).split(' ');
    const relative = separator === -1 ? '' : record.slice(separator + 1);
    if (metadata.length !== 3 || !relative.startsWith(COMPANION_PREFIX)) {
      throw new Error(`unexpected git ls-files record for archify-pr: ${record}`);
    }
    const [mode, , stage] = metadata;
    return { mode, stage, relative };
  });
}

export function stageCleanCompanionSkill({ repoRoot = scriptRoot, destination, modeManifest = null }) {
  if (!destination) throw new Error('clean companion Skill staging requires a destination');
  const resolvedRoot = fs.realpathSync(path.resolve(repoRoot));
  const resolvedDestination = path.resolve(destination);
  const resolvedModeManifest = modeManifest === null ? null : path.resolve(modeManifest);
  if (resolvedModeManifest !== null && fs.existsSync(resolvedModeManifest)) {
    throw new Error(`mode manifest path already exists: ${resolvedModeManifest}`);
  }
  if (resolvedModeManifest !== null) {
    const containment = containedBy(resolvedDestination, resolvedModeManifest);
    if (containment.status === 'match') {
      throw new Error(`mode manifest must be written outside the staged Skill tree: ${resolvedModeManifest}`);
    }
    if (containment.status === 'unknown') {
      throw new Error(`mode manifest location could not be verified safely (${containment.reason.code}): ${resolvedModeManifest}`);
    }
  }

  const entries = trackedEntries(resolvedRoot);
  for (const entry of entries) {
    if (entry.stage !== '0') {
      throw new Error(`refusing to package unmerged index entry (stage ${entry.stage}): ${entry.relative}`);
    }
  }
  const tracked = new Set(entries.map((entry) => entry.relative));
  for (const required of REQUIRED_FILES) {
    if (!tracked.has(required)) {
      throw new Error(`required companion package input is not tracked by Git: ${required}`);
    }
  }

  const relativeInside = entries.map((entry) => entry.relative.slice(COMPANION_PREFIX.length));
  validatePortablePathSet(relativeInside, { profile: 'archive' });

  fs.mkdirSync(resolvedDestination, { recursive: true, mode: 0o755 });
  const modes = {};
  let fileCount = 0;
  for (const entry of entries) {
    const inside = entry.relative.slice(COMPANION_PREFIX.length);
    const source = path.join(resolvedRoot, ...entry.relative.split('/'));
    const target = path.join(resolvedDestination, ...inside.split('/'));
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`companion package entry must be a regular file: ${entry.relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, entry.mode === '100755' ? 0o755 : 0o644);
    modes[inside] = entry.mode;
    fileCount += 1;
  }
  if (resolvedModeManifest !== null) {
    const sorted = Object.fromEntries(Object.entries(modes).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )));
    fs.writeFileSync(resolvedModeManifest, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return { destination: resolvedDestination, fileCount, modes };
}
