#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCliSync } from './resolve-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const DSH_RELEASE_REF = 'archify-dsh-v0.1.0';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function excludeFromCleanSkill(relative) {
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

function releaseSnapshot(destination) {
  const archive = spawnCliSync('git', ['archive', '--format=tar', DSH_RELEASE_REF], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    throw new Error(`unable to read immutable DSH source ${DSH_RELEASE_REF}: ${archive.stderr?.toString('utf8') || archive.error?.message}`);
  }
  const extracted = spawnCliSync('tar', ['-xf', '-', '-C', destination], {
    cwd: repoRoot,
    input: archive.stdout,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (extracted.status !== 0) {
    throw new Error(`unable to extract immutable DSH source ${DSH_RELEASE_REF}: ${extracted.stderr || extracted.error?.message}`);
  }
}

function regularFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...regularFiles(root, source));
    } else if (entry.isFile()) {
      files.push({ source, relative: path.relative(root, source) });
    } else {
      throw new Error(`immutable DSH source contains unsupported entry: ${path.relative(root, source)}`);
    }
  }
  return files;
}

function stageCleanArchify(sourceRoot, dest) {
  const validators = path.join(sourceRoot, 'renderers/shared/generated-validators.mjs');
  if (!fs.existsSync(validators)) {
    throw new Error(`generated validators are missing from ${DSH_RELEASE_REF}`);
  }
  for (const { source, relative } of regularFiles(sourceRoot)) {
    if (excludeFromCleanSkill(relative)) continue;
    const destination = path.join(dest, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
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
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-source-'));

try {
  releaseSnapshot(snapshot);
  const releaseIntegration = path.join(snapshot, 'integrations', 'deepseek-harness');
  stageCleanArchify(path.join(snapshot, 'archify'), path.join(stage, 'skills', 'archify'));
  fs.copyFileSync(path.join(releaseIntegration, 'package.json'), path.join(stage, 'package.json'));
  fs.copyFileSync(path.join(releaseIntegration, 'cordis.patch.yml'), path.join(stage, 'cordis.patch.yml'));
  fs.cpSync(path.join(releaseIntegration, 'lib'), path.join(stage, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(releaseIntegration, 'README.md'), path.join(stage, 'README.md'));
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
  fs.rmSync(snapshot, { recursive: true, force: true });
}
