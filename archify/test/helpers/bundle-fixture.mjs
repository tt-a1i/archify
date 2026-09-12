import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const specsDir = path.join(skillRoot, 'test/fixtures/bundle-checkout');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const SPEC_FILES = ['checkout-platform.json', 'payments.json', 'ledger-flow.json'];

const staged = new Set();

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

export function stageBundleFixture({ prefix = 'archify-bundle-fixture-' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  staged.add(dir);
  for (const name of SPEC_FILES) {
    fs.copyFileSync(path.join(specsDir, name), path.join(dir, name));
  }
  for (const name of SPEC_FILES) {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const html = name.replace(/\.json$/, '.html');
    runCli(['render', spec.diagram_type, path.join(dir, name), path.join(dir, html)]);
  }
  runCli(['bundle', dir, '--json']);
  return dir;
}

export function disposeBundleFixture(dir) {
  if (!dir) return;
  staged.delete(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

process.on('exit', () => {
  for (const dir of staged) fs.rmSync(dir, { recursive: true, force: true });
});
