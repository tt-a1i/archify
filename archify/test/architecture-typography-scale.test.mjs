import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'archify.mjs');

function specimen(typographyScale) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Typography scale',
      output: 'typography.html',
      quality_profile: 'showcase',
      ...(typographyScale === undefined ? {} : { typography_scale: typographyScale }),
    },
    components: [
      { id: 'gateway', type: 'backend', label: 'Gateway', sublabel: 'request broker', tag: 'edge', pos: [80, 130], size: [150, 72] },
      { id: 'store', type: 'database', label: 'Store', sublabel: 'durable records', tag: 'primary', pos: [390, 130], size: [150, 72] },
    ],
    boundaries: [{ kind: 'region', label: 'Application zone', wraps: ['gateway', 'store'] }],
    connections: [{ from: 'gateway', to: 'store', label: 'writes records' }],
  };
}

function render(input, output) {
  return spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('architecture typography scale preserves default bytes and synchronizes rendered text geometry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-scale-'));
  try {
    const defaultInput = path.join(dir, 'default.json');
    const explicitInput = path.join(dir, 'explicit.json');
    const scaledInput = path.join(dir, 'scaled.json');
    const defaultOutput = path.join(dir, 'default.html');
    const explicitOutput = path.join(dir, 'explicit.html');
    const scaledOutput = path.join(dir, 'scaled.html');
    const scaledAgainOutput = path.join(dir, 'scaled-again.html');
    fs.writeFileSync(defaultInput, JSON.stringify(specimen()));
    fs.writeFileSync(explicitInput, JSON.stringify(specimen(1)));
    fs.writeFileSync(scaledInput, JSON.stringify(specimen(1.25)));

    for (const [input, output] of [[defaultInput, defaultOutput], [explicitInput, explicitOutput], [scaledInput, scaledOutput], [scaledInput, scaledAgainOutput]]) {
      const result = render(input, output);
      assert.equal(result.status, 0, result.stderr);
    }

    const defaultHtml = fs.readFileSync(defaultOutput, 'utf8');
    const explicitHtml = fs.readFileSync(explicitOutput, 'utf8');
    const scaledHtml = fs.readFileSync(scaledOutput, 'utf8');
    assert.equal(explicitHtml, defaultHtml, 'explicit default must preserve existing artifacts byte-for-byte');
    assert.equal(fs.readFileSync(scaledAgainOutput, 'utf8'), scaledHtml, 'scaled artifacts must remain deterministic');

    for (const [role, source, scaled] of [
      ['node', /data-node-label=""[^>]*font-size="([\d.]+)"[^>]*>Gateway<\//, /data-node-label=""[^>]*font-size="([\d.]+)"[^>]*>Gateway<\//],
      ['relation', /class="[^"]+" font-size="([\d.]+)" text-anchor="middle">writes records<\//, /class="[^"]+" font-size="([\d.]+)" text-anchor="middle">writes records<\//],
      ['boundary', /data-boundary-label=""[^>]*font-size="([\d.]+)"[^>]*>Application zone<\//, /data-boundary-label=""[^>]*font-size="([\d.]+)"[^>]*>Application zone<\//],
      ['legend', /class="t-primary" font-size="([\d.]+)" font-weight="650">Legend<\//, /class="t-primary" font-size="([\d.]+)" font-weight="650">Legend<\//],
      ['legend entry', /class="t-muted" font-size="([\d.]+)" font-weight="500">Backend<\//, /class="t-muted" font-size="([\d.]+)" font-weight="500">Backend<\//],
    ]) {
      const before = Number(defaultHtml.match(source)?.[1]);
      const after = Number(scaledHtml.match(scaled)?.[1]);
      assert.ok(Number.isFinite(before), `missing ${role} source font`);
      const expected = role === 'node' ? Math.floor(before * 1.25 * 10) / 10 : before * 1.25;
      assert.equal(after, expected, `${role} font must use the same scale`);
    }
    const defaultMask = defaultHtml.match(/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" rx="3" class="c-mask"\/>\s*<text[^>]*>writes records<\//);
    const scaledMask = scaledHtml.match(/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" rx="3" class="c-mask"\/>\s*<text[^>]*>writes records<\//);
    assert.ok(defaultMask && scaledMask, 'relation label masks must be emitted');
    assert.ok(Number(scaledMask[1]) > Number(defaultMask[1]), 'relation mask width must grow with text');
    assert.ok(Number(scaledMask[2]) > Number(defaultMask[2]), 'relation mask height must grow with text');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('architecture typography scale is schema-bounded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-scale-schema-'));
  try {
    const input = path.join(dir, 'invalid.json');
    fs.writeFileSync(input, JSON.stringify(specimen(1.26)));
    const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /typography_scale/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
