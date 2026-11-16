#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const installer = path.join(here, 'install.mjs');

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    json: false,
    targets: null,
    withUser: false,
    home: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--targets') {
      options.targets = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--with-user') {
      options.withUser = true;
    } else if (arg === '--home') {
      options.home = argv[index + 1] ?? '';
      index += 1;
    } else {
      fail(`Argumento desconhecido: ${arg}`, 2);
    }
  }
  return options;
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function runInstall(args) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function loadTargets(file) {
  if (!file) fail('Uso: bootstrap --targets <arquivo.json> [--with-user] [--home <dir>] [--json]', 2);
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    fail(`Arquivo de targets não encontrado: ${resolved}`, 2);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(`targets inválido: ${error.message}`, 2);
  }
  if (data.schema_version !== 1) fail('targets.schema_version deve ser 1', 2);
  if (!data.archifyCheckout || typeof data.archifyCheckout !== 'string') {
    fail('targets.archifyCheckout é obrigatório', 2);
  }
  if (!Array.isArray(data.projects)) fail('targets.projects deve ser um array', 2);
  return data;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = loadTargets(options.targets);

  if (!samePath(targets.archifyCheckout, repoRoot)) {
    const payload = {
      ok: false,
      error: 'archifyCheckout',
      expected: repoRoot,
      received: path.resolve(targets.archifyCheckout),
      user: null,
      projects: [],
      doctor: null,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stderr.write(`archifyCheckout deve ser ${repoRoot}\n`);
    process.exit(1);
  }

  const doctor = runInstall(['doctor', '--target', repoRoot, '--json']);
  let doctorPayload = null;
  try {
    doctorPayload = JSON.parse(doctor.stdout || '{}');
  } catch {
    doctorPayload = { ok: false };
  }
  if (doctor.status !== 0 || !doctorPayload.ok) {
    const payload = {
      ok: false,
      error: 'doctor',
      user: null,
      projects: [],
      doctor: doctorPayload,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stderr.write('doctor falhou no checkout Archify.\n');
    process.exit(1);
  }

  let user = null;
  if (options.withUser) {
    const home = options.home || process.env.HOME;
    if (!home) fail('--with-user exige --home ou a variável HOME', 2);
    const result = runInstall(['install', '--scope', 'user', '--home', home, '--json']);
    user = {
      status: result.status === 0 ? 'ok' : 'failed',
      home: path.resolve(home),
      detail: result.status === 0 ? JSON.parse(result.stdout) : { stderr: result.stderr },
    };
  }

  const projects = [];
  for (const entry of targets.projects) {
    const id = entry?.id ?? '';
    const projectPath = entry?.path ?? '';
    if (!id || !projectPath) {
      projects.push({ id: id || null, path: projectPath || null, status: 'failed', reason: 'missing-id-or-path' });
      continue;
    }
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      projects.push({ id, path: resolved, status: 'failed', reason: 'missing-path' });
      continue;
    }
    const result = runInstall(['install', '--scope', 'project', '--target', resolved, '--json']);
    if (result.status === 0) {
      projects.push({
        id,
        path: resolved,
        status: 'ok',
        detail: JSON.parse(result.stdout),
      });
    } else {
      projects.push({
        id,
        path: resolved,
        status: 'failed',
        reason: 'install',
        detail: { stderr: result.stderr, stdout: result.stdout },
      });
    }
  }

  const ok = (!user || user.status === 'ok') && projects.every((row) => row.status === 'ok');
  const payload = {
    ok,
    user,
    projects,
    doctor: doctorPayload,
  };
  if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    process.stdout.write(`ok=${ok}\n`);
    for (const row of projects) process.stdout.write(`${row.id}:${row.status}\n`);
  }
  process.exit(ok ? 0 : 1);
}

main();
