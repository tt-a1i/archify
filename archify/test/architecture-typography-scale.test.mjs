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

    const scaledTextY = (text) => Number(scaledHtml.match(new RegExp(`<text[^>]* y="([^"]+)"[^>]*>${text}<\\/text>`))?.[1]);
    assert.equal(scaledTextY('Gateway'), 163.5, 'scaled primary label must retain a proportional upper baseline');
    assert.equal(scaledTextY('request broker'), 183.5, 'scaled sublabel must gain proportional separation from its label');
    assert.equal(scaledTextY('edge'), 195.75, 'scaled tag must retain bottom clearance for its larger font');

    for (const [role, source, scaled] of [
      ['node', /data-node-label=""[^>]*font-size="([\d.]+)"[^>]*>Gateway<\//, /data-node-label=""[^>]*font-size="([\d.]+)"[^>]*>Gateway<\//],
      ['sublabel', /data-detail="context"[^>]*font-size="([\d.]+)"[^>]*>request broker<\//, /data-detail="context"[^>]*font-size="([\d.]+)"[^>]*>request broker<\//],
      ['tag', /data-detail="fine"[^>]*font-size="([\d.]+)"[^>]*>edge<\//, /data-detail="fine"[^>]*font-size="([\d.]+)"[^>]*>edge<\//],
      ['relation', /class="[^"]+" font-size="([\d.]+)" text-anchor="middle">writes records<\//, /class="[^"]+" font-size="([\d.]+)" text-anchor="middle">writes records<\//],
      ['boundary', /data-boundary-label=""[^>]*font-size="([\d.]+)"[^>]*>Application zone<\//, /data-boundary-label=""[^>]*font-size="([\d.]+)"[^>]*>Application zone<\//],
      ['legend', /class="t-primary" font-size="([\d.]+)" font-weight="650">Legend<\//, /class="t-primary" font-size="([\d.]+)" font-weight="650">Legend<\//],
      ['legend entry', /class="t-muted" font-size="([\d.]+)" font-weight="500">Backend<\//, /class="t-muted" font-size="([\d.]+)" font-weight="500">Backend<\//],
    ]) {
      const before = Number(defaultHtml.match(source)?.[1]);
      const after = Number(scaledHtml.match(scaled)?.[1]);
      assert.ok(Number.isFinite(before), `missing ${role} source font`);
      const expected = ['node', 'sublabel', 'tag'].includes(role) ? Math.floor(before * 1.25 * 10) / 10 : before * 1.25;
      assert.equal(after, expected, `${role} font must use the same scale`);
    }
    const defaultMask = defaultHtml.match(/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" rx="3" class="c-mask"\/>\s*<text[^>]*>writes records<\//);
    const scaledMask = scaledHtml.match(/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" rx="3" class="c-mask"\/>\s*<text[^>]*>writes records<\//);
    assert.ok(defaultMask && scaledMask, 'relation label masks must be emitted');
    assert.equal(Number(scaledMask[1]), (Number(defaultMask[1]) - 10) * 1.25 + 10, 'relation mask width must use the typography scale');
    assert.equal(Number(scaledMask[2]), Math.ceil(8 * 1.25 + 6), 'relation mask height must use the scaled label font');
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

test('architecture typography scale accepts labels that can shrink to the scaled legible minimum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-label-fit-'));
  try {
    const input = path.join(dir, 'label-fit.json');
    const output = path.join(dir, 'label-fit.html');
    const diagram = specimen(1.25);
    diagram.components = [{
      id: 'fitted', type: 'backend', label: 'abcdefghijklmnop',
      pos: [80, 130], size: [120, 72],
    }];
    diagram.boundaries = [];
    diagram.connections = [];
    fs.writeFileSync(input, JSON.stringify(diagram));
    const result = render(input, output);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-node-label=""[^>]*font-size="11\.6"[^>]*>abcdefghijklmnop<\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('architecture typography scale fits tag-only rows at their legible minimum and rejects shorter nodes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-tag-only-'));
  try {
    const fittingInput = path.join(dir, 'fitting.json');
    const tooShortInput = path.join(dir, 'too-short.json');
    const output = path.join(dir, 'fitting.html');
    const diagram = specimen(1.25);
    diagram.components = [{
      id: 'tagged', type: 'backend', label: 'Core', tag: 'hot',
      pos: [80, 130], size: [150, 41],
    }];
    diagram.boundaries = [];
    diagram.connections = [];
    fs.writeFileSync(fittingInput, JSON.stringify(diagram));
    const fitting = render(fittingInput, output);
    assert.equal(fitting.status, 0, fitting.stderr);
    const html = fs.readFileSync(output, 'utf8');
    const label = html.match(/data-node-label=""[^>]* y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>Core<\//);
    const tag = html.match(/data-detail="fine"[^>]* y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>hot<\//);
    assert.ok(label && tag, 'tag-only node must render both text rows');
    assert.equal(Number(label[2]), 10, 'label must shrink to its scaled legible minimum');
    assert.equal(Number(tag[2]), 7.5, 'tag must shrink to its scaled legible minimum');
    assert.ok(Number(tag[1]) - Number(tag[2]) * 0.8 >= Number(label[1]) + Number(label[2]) * 0.2 + 3,
      'tag-only rows must preserve vertical clearance');

    diagram.components[0].size = [150, 40];
    fs.writeFileSync(tooShortInput, JSON.stringify(diagram));
    const tooShort = render(tooShortInput, path.join(dir, 'too-short.html'));
    assert.equal(tooShort.status, 1);
    assert.match(tooShort.stderr, /too short for its scaled label and tag at their legible minimums/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('architecture typography scale measures long legend entries at their rendered size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-legend-'));
  try {
    const input = path.join(dir, 'legend.json');
    const output = path.join(dir, 'legend.html');
    const diagram = specimen(1.25);
    diagram.meta.legend = {
      mode: 'all',
      entries: { backend: { label: 'Backend service with a deliberately long legend label' } },
    };
    fs.writeFileSync(input, JSON.stringify(diagram));
    const result = render(input, output);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(output, 'utf8');
    const viewBox = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const entry = html.match(/data-legend-semantic-kind="backend"[^>]*data-legend-x="([\d.]+)"[^>]*data-legend-baseline="[^"]+"[^>]*data-legend-width="([\d.]+)"/);
    assert.ok(viewBox && entry, 'scaled legend must expose its measured geometry');
    assert.ok(Number(entry[1]) + Number(entry[2]) <= Number(viewBox[1]) - 40, 'auto viewBox must contain the rendered legend entry');
    assert.match(html, /class="t-muted" font-size="12\.5" font-weight="500">Backend service with a deliberately long legend label<\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
