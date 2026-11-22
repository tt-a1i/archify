import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(__dirname, '..', '..', 'archify');
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cli-'));
export const cli = path.join(skillRoot, 'bin/archify.mjs');

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
test.afterEach(() => {
  fs.rmSync(path.join(tmp, '.archify-delivery-lock.json'), { force: true });
});

export function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || skillRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: options.env || process.env,
  });
}

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function deliverySidecarPath(file, suffix) {
  let artifact = path.resolve(file);
  try {
    artifact = fs.realpathSync.native(artifact);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    try {
      artifact = path.join(fs.realpathSync.native(path.dirname(artifact)), path.basename(artifact));
    } catch (directoryError) {
      if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTDIR') throw directoryError;
    }
  }
  return artifact.replace(/\.html?$/i, suffix);
}

export function deliveryProvenancePath(file) {
  return deliverySidecarPath(file, '.delivery.json');
}

export function deliveryPendingPath(file) {
  return deliverySidecarPath(file, '.delivery-pending.json');
}

export function assertCheckFailureReceipt(receipt, file, codePattern) {
  assert.equal(receipt.ok, false);
  assert.equal(receipt.file, path.resolve(file));
  assert.ok(Array.isArray(receipt.diagnostics));
  assert.match(receipt.diagnostics[0].code, codePattern);
}

export function makeFakeOpeners(name, { exitCode = 0 } = {}) {
  const bin = path.join(tmp, name);
  const log = path.join(bin, 'open-log.json');
  fs.mkdirSync(bin, { recursive: true });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const target = process.argv[process.argv.length - 1];
fs.writeFileSync(process.env.ARCHIFY_TEST_OPEN_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  target,
  existed: fs.existsSync(target),
}));
process.exit(${exitCode});
`;
  for (const command of ['open', 'xdg-open']) {
    const executable = path.join(bin, command);
    fs.writeFileSync(executable, source);
    fs.chmodSync(executable, 0o755);
  }
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      ARCHIFY_TEST_OPEN_LOG: log,
    },
  };
}
