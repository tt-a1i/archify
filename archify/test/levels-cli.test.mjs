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
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');
const levelsExample = path.join(skillRoot, 'examples/web-platform.levels.json');

let caseCounter = 0;
function workspace() {
  caseCounter += 1;
  return fs.mkdtempSync(path.join(os.tmpdir(), `archify-levels-cli-${caseCounter}-`));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

function runChecker(htmlPath) {
  const result = spawnSync(process.execPath, [checker, htmlPath], { encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

function checkNames(receipt) {
  return receipt.checks.map((check) => check.name);
}

test('validate levels runs the full artifact check suite on every level', () => {
  const result = run(['validate', 'levels', levelsExample, '--quality', 'showcase', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);

  const names = checkNames(receipt);
  assert.ok(names.includes('levels_identified'));
  assert.ok(names.includes('levels_single_active'));

  // Every per-SVG check must run once per level, not once for the document.
  for (const base of ['finite_svg', 'orthogonal_arrows', 'label_route_clearance', 'relationship_crossings',
    'relationship_corridors', 'container_border_runs', 'route_rhythm', 'legend_clearance']) {
    assert.ok(names.includes(`${base}_level_context`), `${base} missing for context`);
    assert.ok(names.includes(`${base}_level_containers`), `${base} missing for containers`);
  }
  assert.ok(!names.includes('single_svg'), 'a levels artifact must not claim the single-svg contract');
});

test('validate architecture keeps its historical check names exactly', () => {
  const result = run(['validate', 'architecture', path.join(skillRoot, 'examples/web-app.architecture.json'),
    '--quality', 'showcase', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  assert.deepEqual(checkNames(JSON.parse(result.stdout)), [
    'single_svg', 'finite_svg', 'orthogonal_arrows', 'label_route_clearance', 'relationship_crossings',
    'relationship_corridors', 'container_border_runs', 'route_rhythm', 'legend_clearance',
  ]);
});

test('composition merges per-level totals and keeps a per-level breakdown', () => {
  const result = run(['validate', 'levels', levelsExample, '--quality', 'showcase', '--json']);
  const receipt = JSON.parse(result.stdout);
  const composition = receipt.composition;

  assert.equal(composition.status, 'pass');
  assert.equal(composition.summary.errors, 0);
  assert.deepEqual(composition.levels.map((entry) => entry.level), ['context', 'containers']);
  for (const entry of composition.levels) {
    assert.equal(entry.status, 'pass');
  }
});

test('the checker rejects a levels artifact with more than one active level', () => {
  const dir = workspace();
  const outPath = path.join(dir, 'doc.html');
  assert.equal(run(['render', 'levels', levelsExample, outPath]).status, 0);

  // Target the SVG tag itself: `hidden aria-hidden="true"` also appears in the
  // viewer chrome earlier in the document.
  const tampered = path.join(dir, 'two-active.html');
  fs.writeFileSync(tampered, fs.readFileSync(outPath, 'utf8')
    .replace('<svg data-level="containers" data-level-label="Containers" hidden="hidden" aria-hidden="true"',
      '<svg data-level="containers" data-level-label="Containers" data-level-active="true"'));

  const { status, receipt } = runChecker(tampered);
  assert.notEqual(status, 0);
  const active = receipt.checks.find((check) => check.name === 'levels_single_active');
  assert.equal(active.ok, false);
  assert.match(active.details[0], /found 2 active level/);
});

test('the checker rejects a levels SVG that lost its level identity', () => {
  const dir = workspace();
  const outPath = path.join(dir, 'doc.html');
  assert.equal(run(['render', 'levels', levelsExample, outPath]).status, 0);

  const tampered = path.join(dir, 'no-id.html');
  fs.writeFileSync(tampered, fs.readFileSync(outPath, 'utf8')
    .replace('<svg data-level="containers" ', '<svg '));

  const { status, receipt } = runChecker(tampered);
  assert.notEqual(status, 0);
  assert.equal(receipt.checks.find((check) => check.name === 'levels_identified').ok, false);
});

test('deliver levels freezes the level sources beside the manifest snapshot', () => {
  const dir = workspace();
  const outPath = path.join(dir, 'delivered.html');

  const result = run(['deliver', 'levels', levelsExample, outPath, '--quality', 'showcase', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.match(receipt.specification.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(outPath));

  // Delivery must leave no staging directory behind.
  assert.deepEqual(fs.readdirSync(dir).sort(), ['delivered.delivery.json', 'delivered.html']);
});

test('deliver levels reports a broken document without writing an artifact', () => {
  const dir = workspace();
  fs.writeFileSync(path.join(dir, 'doc.levels.json'), JSON.stringify({
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Missing source', output: 'out.html' },
    levels: [{ id: 'root', label: 'Root', source: 'absent.architecture.json' }],
  }));
  const outPath = path.join(dir, 'out.html');

  const result = run(['deliver', 'levels', path.join(dir, 'doc.levels.json'), outPath,
    '--quality', 'showcase', '--json']);

  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'levels/source-missing'),
    JSON.stringify(receipt.diagnostics));
  assert.ok(!fs.existsSync(outPath));
});

test('doctor reports the levels renderer, schema, and example', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /\[ok\] levels renderer, schema, and example/);
});
