#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCliSync } from './resolve-cli.mjs';
import { DEFAULT_SKILL_SOURCE, stageCleanSkill } from '../../../scripts/stage-clean-skill.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const archifySource = DEFAULT_SKILL_SOURCE;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function stageCleanArchify(dest) {
  stageCleanSkill(archifySource, dest);
}

function copyIntegrationFile(relative, dest = relative) {
  const source = path.join(integrationRoot, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`refusing to package non-regular integration file: ${relative}`);
  }
  const target = path.join(stage, dest);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const json = process.argv.includes('--json');
const out = argValue('--out');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-pack-'));

try {
  stageCleanArchify(path.join(stage, 'skills', 'archify'));
  for (const relative of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'README.md']) {
    copyIntegrationFile(relative);
  }
  fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(stage, 'LICENSE'));

  const packed = spawnCliSync('npm', ['pack', '--json', '--pack-destination', stage], {
    cwd: stage,
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed: ${packed.stderr || packed.stdout || packed.error?.message}`);
  }
  const produced = fs.readdirSync(stage).find((name) => name.endsWith('.tgz'));
  if (!produced) {
    throw new Error(`npm pack produced no tarball\n${packed.stdout}\n${packed.stderr}`);
  }
  let packMeta = {};
  try {
    const jsonStart = Math.min(
      ...['{', '['].map((token) => {
        const index = packed.stdout.indexOf(token);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    const parsed = JSON.parse(packed.stdout.slice(jsonStart));
    if (Array.isArray(parsed)) {
      packMeta = parsed[0] || {};
    } else if (parsed?.name) {
      packMeta = parsed;
    } else {
      packMeta = Object.values(parsed || {}).find((entry) => entry?.name === '@tt-a1i/archify-dsh') || {};
    }
  } catch {
    packMeta = {};
  }
  if (!Array.isArray(packMeta.files)) {
    throw new Error(`npm pack metadata did not include a file list\n${packed.stdout}`);
  }
  const files = packMeta.files.map((file) => ({ path: file.path }));
  const destination = path.resolve(out || path.join(process.cwd(), produced));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(stage, produced), destination);
  const result = {
    name: packMeta.name || '@tt-a1i/archify-dsh',
    version: packMeta.version || '0.1.0',
    filename: path.basename(destination),
    destination,
    files,
  };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${destination}\n`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
