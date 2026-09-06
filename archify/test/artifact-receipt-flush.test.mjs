import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-receipt-flush-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  });
}

for (const profile of ['standard', 'showcase']) {
  test(`artifact checker flushes a large ${profile} receipt to a pipe`, () => {
    // Distinct relationships sharing one corridor produce a real, large
    // composition receipt: warnings in standard, errors in showcase.
    const count = 24;
    const arrows = Array.from({ length: count }, (_, index) => (
      `<path data-edge-id="edge-${index}" data-edge-from="source-${index}" data-edge-to="target-${index}" d="M 20 40 L 220 40" class="a-default" marker-end="url(#arrowhead)"/>`
    )).join('\n');
    const html = path.join(tmp, `${profile}.html`);
    fs.writeFileSync(html, `<svg viewBox="0 0 240 160" data-quality-profile="${profile}">${arrows}</svg>`);

    // A regular file is the synchronous-output control. The pipe must carry
    // exactly the same bytes, including the final diagnostic and closing JSON.
    const reference = path.join(tmp, `${profile}.json`);
    const descriptor = fs.openSync(reference, 'w');
    let fileRun;
    try {
      fileRun = run(checker, [html], { stdio: ['ignore', descriptor, 'pipe'] });
    } finally {
      fs.closeSync(descriptor);
    }
    const expectedCode = profile === 'standard' ? 0 : 1;
    assert.equal(fileRun.status, expectedCode, fileRun.stderr);
    const expected = fs.readFileSync(reference, 'utf8');
    assert.ok(Buffer.byteLength(expected) > 64 * 1024, 'fixture must exceed a 64 KiB pipe buffer');
    const receipt = JSON.parse(expected);
    assert.equal(receipt.ok, profile === 'standard');
    assert.equal(receipt.composition.issues.length, count * (count - 1) / 2);
    assert.ok(receipt.composition.issues.every((issue) => (
      issue.code === 'composition/ambiguous-corridor'
      && issue.severity === (profile === 'standard' ? 'warning' : 'error')
    )));

    const piped = run(checker, [html]);
    assert.equal(piped.status, expectedCode, piped.stderr);
    assert.equal(piped.stderr, '');
    assert.equal(Buffer.byteLength(piped.stdout), Buffer.byteLength(expected), 'pipe must not truncate the receipt');
    assert.equal(piped.stdout, expected);
    assert.deepEqual(JSON.parse(piped.stdout), receipt);
  });
}

function denseArchitecture() {
  const count = 20;
  const components = [];
  const connections = [];
  for (let index = 0; index < count; index += 1) {
    const sourceX = 40 + index * 160;
    const targetX = 40 + (count - 1 - index) * 160;
    components.push(
      { id: `source-${index}`, type: 'backend', label: `Source ${index}`, pos: [sourceX, 40], size: [120, 60] },
      { id: `target-${index}`, type: 'database', label: `Target ${index}`, pos: [targetX, 400], size: [120, 60] },
    );
    connections.push({
      id: `edge-${index}`,
      from: `source-${index}`,
      to: `target-${index}`,
      fromSide: 'bottom',
      toSide: 'top',
      via: [[sourceX + 60, 240], [targetX + 60, 240]],
    });
  }
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Large receipt regression', quality_profile: 'standard' },
    components,
    connections,
  };
}

for (const command of ['validate', 'deliver', 'compare']) {
  test(`${command} consumes a complete artifact receipt larger than 64 KiB`, () => {
    const source = denseArchitecture();
    const input = path.join(tmp, `${command}.architecture.json`);
    const output = path.join(tmp, `${command}.html`);
    fs.writeFileSync(input, JSON.stringify(source));
    const args = command === 'validate' ? [input]
      : command === 'deliver' ? [input, output]
        : [input, input, output];
    const result = run(cli, [command, 'architecture', ...args, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.command, command);
    if (command === 'validate') {
      assert.ok(Buffer.byteLength(result.stdout) > 64 * 1024);
      assert.ok(receipt.checks.every((check) => check.ok));
      assert.ok(receipt.composition.issues.length > 100);
    } else {
      const artifact = fs.readFileSync(output);
      assert.ok(artifact.length > 0);
      if (command === 'deliver') {
        assert.equal(receipt.artifact.sha256, createHash('sha256').update(artifact).digest('hex'));
      } else {
        assert.equal(receipt.completeness, 'complete');
        assert.equal(receipt.proofLevel, 'authored');
      }
    }
  });
}
