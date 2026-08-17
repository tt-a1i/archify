#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCliSync } from './resolve-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const archifySource = path.join(repoRoot, 'archify');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function excludeFromCleanSkill(sourceRoot, src) {
  const relative = path.relative(sourceRoot, src);
  if (!relative || relative === '.') return false;
  const parts = relative.split(path.sep);
  if (parts.includes('node_modules')) return true;
  if (parts.includes('test')) return true;
  if (parts.includes('.DS_Store')) return true;
  if (parts.includes('.hive')) return true;
  if (parts.includes('.workbuddy')) return true;
  if (parts.some((part) => part.startsWith('.validator-check-'))) return true;
  if (parts.join('/') === 'scripts/generate-brand-marks.mjs') return true;
  if (parts.join('/') === 'scripts/generate-validators.mjs') return true;
  return false;
}

function trackedArchifyFiles() {
  const tracked = spawnCliSync('git', ['ls-files', '-z', '--', 'archify'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (tracked.status !== 0) {
    throw new Error(`unable to enumerate tracked Archify files: ${tracked.stderr || tracked.error?.message}`);
  }
  return tracked.stdout.split('\0').filter(Boolean);
}

function stageCleanArchify(dest) {
  const validators = path.join(archifySource, 'renderers/shared/generated-validators.mjs');
  if (!fs.existsSync(validators)) {
    throw new Error('generated validators are missing — run npm run generate:validators in archify/');
  }
  for (const repoRelative of trackedArchifyFiles()) {
    const src = path.join(repoRoot, ...repoRelative.split('/'));
    if (excludeFromCleanSkill(archifySource, src)) continue;
    const destination = path.join(dest, path.relative(archifySource, src));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(src, destination);
  }
  const packagePath = path.join(dest, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.rmSync(path.join(dest, 'package-lock.json'), { force: true });
}

const json = process.argv.includes('--json');
const out = argValue('--out');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-pack-'));

try {
  stageCleanArchify(path.join(stage, 'skills', 'archify'));
  fs.copyFileSync(path.join(integrationRoot, 'package.json'), path.join(stage, 'package.json'));
  fs.copyFileSync(path.join(integrationRoot, 'cordis.patch.yml'), path.join(stage, 'cordis.patch.yml'));
  fs.cpSync(path.join(integrationRoot, 'lib'), path.join(stage, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(integrationRoot, 'README.md'), path.join(stage, 'README.md'));
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
