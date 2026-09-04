import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');

const FONT_HOST_PATTERNS = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
];

function assertNoFontHosts(label, html) {
  for (const pattern of FONT_HOST_PATTERNS) {
    assert.doesNotMatch(html, pattern, `${label} must not request ${pattern}`);
  }
}

test('delivered HTML template does not request Google Fonts', () => {
  assertNoFontHosts('archify/assets/template.html', template);
  assert.match(template, /@font-face\s*\{[^}]*local\('JetBrains Mono'\)/);
});

test('deliver output does not request Google Fonts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-offline-fonts-'));
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const out = path.join(tmp, 'delivered.html');
  const result = spawnSync(process.execPath, [cli, 'deliver', 'architecture', input, out, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertNoFontHosts('deliver output', fs.readFileSync(out, 'utf8'));
});
