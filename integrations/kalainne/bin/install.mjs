#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const templateSkill = path.join(packageRoot, 'skill', 'SKILL.md');
const templateRule = path.join(packageRoot, 'skill', 'rule.mdc');
const archifyBinRelative = path.join('archify', 'bin', 'archify.mjs');
const skillName = 'kalainne-archify';

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const command = argv[0] ?? '';
  const options = { json: false, scope: null, target: null, home: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--scope') {
      options.scope = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--target') {
      options.target = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--home') {
      options.home = argv[index + 1] ?? '';
      index += 1;
    } else {
      fail(`Argumento desconhecido: ${arg}`, 2);
    }
  }
  return { command, options };
}

function existingDir(label, value) {
  if (!value) fail(`Falta ${label}.`, 2);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail(`${label} não é um diretório: ${resolved}`, 2);
  }
  return resolved;
}

function workspaceBin(target) {
  return path.join(target, archifyBinRelative);
}

function rootRecord(target) {
  if (fs.existsSync(workspaceBin(target))) {
    return {
      schema_version: 1,
      resolution: 'workspace',
      archifyBin: 'archify/bin/archify.mjs',
    };
  }
  return {
    schema_version: 1,
    resolution: 'recorded-root',
    archifyRoot: repoRoot,
    archifyBin: 'archify/bin/archify.mjs',
  };
}

function writeSkill(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(templateSkill, path.join(dir, 'SKILL.md'));
  fs.writeFileSync(path.join(dir, 'archify-root.json'), `${JSON.stringify(record, null, 2)}\n`);
}

function installProject(target) {
  const record = rootRecord(target);
  const skillDir = path.join(target, '.agents', 'skills', skillName);
  writeSkill(skillDir, record);
  const rulePath = path.join(target, '.cursor', 'rules', `${skillName}.mdc`);
  fs.mkdirSync(path.dirname(rulePath), { recursive: true });
  fs.copyFileSync(templateRule, rulePath);
  return { scope: 'project', skillDir, rulePath, record };
}

function installUser(home) {
  const record = {
    schema_version: 1,
    resolution: 'recorded-root',
    archifyRoot: repoRoot,
    archifyBin: 'archify/bin/archify.mjs',
  };
  const skillDirs = [
    path.join(home, '.agents', 'skills', skillName),
    path.join(home, '.cursor', 'skills', skillName),
  ];
  for (const dir of skillDirs) writeSkill(dir, record);
  return { scope: 'user', skillDirs, record };
}

function recordedRoot(file) {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.resolution !== 'recorded-root' || !data.archifyRoot || !data.archifyBin) return null;
  return {
    resolution: 'recorded-root',
    root: data.archifyRoot,
    bin: path.join(data.archifyRoot, data.archifyBin),
    skill: path.dirname(file),
  };
}

function locate(target, home) {
  const bin = workspaceBin(target);
  if (fs.existsSync(bin)) {
    return {
      resolution: 'workspace',
      root: target,
      bin,
      skill: path.join(target, '.agents', 'skills', skillName),
    };
  }
  const project = recordedRoot(path.join(target, '.agents', 'skills', skillName, 'archify-root.json'));
  if (project) return project;
  if (!home) return null;
  return recordedRoot(path.join(home, '.agents', 'skills', skillName, 'archify-root.json'));
}

function emit(asJson, payload) {
  process.stdout.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : `scope=${payload.scope}\n`);
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'install' && options.scope === 'project') {
    emit(options.json, installProject(existingDir('--target', options.target)));
    return;
  }
  if (command === 'install' && options.scope === 'user') {
    emit(options.json, installUser(existingDir('--home', options.home)));
    return;
  }
  if (command === 'doctor') {
    const target = existingDir('--target', options.target ?? process.cwd());
    const home = options.home ? existingDir('--home', options.home) : null;
    const found = locate(target, home);
    if (!found || !fs.existsSync(found.bin)) {
      const payload = { ok: false, resolution: null, bin: found ? found.bin : null, skill: found ? found.skill : null };
      if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      else process.stderr.write('CLI do Archify não encontrado.\n');
      process.exit(1);
    }
    const child = spawnSync(process.execPath, [found.bin, 'doctor'], { encoding: 'utf8' });
    const payload = {
      ok: child.status === 0,
      resolution: found.resolution,
      bin: found.bin,
      skill: found.skill,
      archifyDoctor: { exitCode: child.status },
    };
    if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stdout.write(`resolution=${found.resolution}\nbin=${found.bin}\n`);
    process.exit(payload.ok ? 0 : 1);
  }
  fail('Uso: install --scope project --target <dir> | install --scope user --home <dir> | doctor --target <dir>', 2);
}

main();
