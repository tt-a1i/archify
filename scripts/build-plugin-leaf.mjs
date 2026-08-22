#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SKILL_SOURCE,
  assertNoSymlinks,
  diffTrees,
  stageCleanSkill,
} from './stage-clean-skill.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'archify');
const leafRoot = path.join(pluginRoot, 'skills', 'archify');
const openaiYaml = path.join(pluginRoot, '.codex-plugin', 'openai.yaml');

function installHostExtras(dest) {
  const stat = fs.lstatSync(openaiYaml);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`refusing to follow source symlink: ${openaiYaml}`);
  }
  const agentsDir = path.join(dest, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.copyFileSync(openaiYaml, path.join(agentsDir, 'openai.yaml'));
}

function materialize(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  stageCleanSkill(DEFAULT_SKILL_SOURCE, dest);
  installHostExtras(dest);
  assertNoSymlinks(dest);
}

const check = process.argv.includes('--check');

if (!fs.existsSync(openaiYaml)) {
  throw new Error(`missing Codex agent card: ${openaiYaml}`);
}

if (check) {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-plugin-leaf-'));
  try {
    const expected = path.join(staged, 'archify');
    materialize(expected);
    if (!fs.existsSync(leafRoot)) {
      throw new Error('plugins/archify/skills/archify is missing — run node scripts/build-plugin-leaf.mjs');
    }
    assertNoSymlinks(leafRoot);
    const { missing, extra, changed } = diffTrees(expected, leafRoot);
    if (missing.length || extra.length || changed.length) {
      const lines = [
        'plugin leaf is stale — run node scripts/build-plugin-leaf.mjs',
        missing.length ? `missing:\n  ${missing.join('\n  ')}` : '',
        extra.length ? `extra:\n  ${extra.join('\n  ')}` : '',
        changed.length ? `changed:\n  ${changed.join('\n  ')}` : '',
      ].filter(Boolean);
      throw new Error(lines.join('\n'));
    }
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
  process.stdout.write('plugin leaf is fresh\n');
} else {
  materialize(leafRoot);
  process.stdout.write(`wrote ${leafRoot}\n`);
}
