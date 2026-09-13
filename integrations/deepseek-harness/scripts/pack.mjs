#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnCliSync } from './resolve-cli.mjs';

import { stageCleanSkill } from '../../../scripts/stage-clean-skill.mjs';
import { adapterCommit, manifest, release, releaseSnapshot, stageAdapter } from './release-source.mjs';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const json = process.argv.includes('--json');
const out = argValue('--out');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-pack-'));
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-source-'));

try {
  stageAdapter(stage);
  releaseSnapshot(snapshot);
  stageCleanSkill({ repoRoot: snapshot, destination: path.join(stage, 'skills', 'archify') });
  fs.copyFileSync(path.join(snapshot, 'LICENSE'), path.join(stage, 'LICENSE'));

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
  const packagedPaths = new Set(files.map(({ path: filePath }) => filePath.replace(/^package\//, '')));
  for (const required of ['package.json', 'release.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib/index.js', 'skills/archify/SKILL.md']) {
    if (!packagedPaths.has(required)) throw new Error(`DSH tarball is missing required file: ${required}`);
  }
  const destination = path.resolve(out || path.join(process.cwd(), produced));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(stage, produced), destination);
  const result = {
    name: packMeta.name || '@tt-a1i/archify-dsh',
    version: packMeta.version || manifest.version,
    adapterCommit,
    sourceCommit: release.sourceCommit,
    skillVersion: release.skillVersion,
    filename: path.basename(destination),
    destination,
    files,
  };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${destination}\n`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(snapshot, { recursive: true, force: true });
}
