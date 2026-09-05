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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-edge-label-color-'));

const PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];
const VARIANTS = ['default', 'emphasis', 'security', 'dashed'];
const CASES = {
  architecture: {
    input: 'examples/brand-aware-delivery.architecture.json',
    relations: 'connections',
    relationIndexes: [1, 0, 2, 6],
  },
  workflow: {
    input: 'examples/release-delivery.workflow.json',
    relations: 'edges',
    relationIndexes: [1, 6, 7, 9],
  },
  dataflow: {
    input: 'examples/event-stream.dataflow.json',
    relations: 'flows',
    relationIndexes: [5, 0, 8, 11],
  },
  lifecycle: {
    input: 'examples/deployment-release.lifecycle.json',
    relations: 'transitions',
    relationIndexes: [0, 5, 1, 4],
    labelPoints: [[850, 80], [850, 100], [850, 120], [850, 140]],
  },
};

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function render(type, config, preset) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, config.input), 'utf8'));
  source.meta.visual_preset = preset;
  source.meta.quality_profile = 'standard';
  for (const [index, variant] of VARIANTS.entries()) {
    const relation = source[config.relations][config.relationIndexes[index]];
    relation.id = `edge-label-${variant}`;
    relation.variant = variant;
    relation.label = `L${index}`;
    if (config.labelPoints) relation.labelAt = config.labelPoints[index];
  }

  const input = path.join(tmp, `${type}-${preset}.json`);
  const output = path.join(tmp, `${type}-${preset}.html`);
  fs.writeFileSync(input, JSON.stringify(source));
  const result = spawnSync(process.execPath, [cli, 'render', type, input, output], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${type}/${preset}: ${result.stderr || result.stdout}`);
  return fs.readFileSync(output, 'utf8');
}

function classForEdge(html, id) {
  const escaped = escapePattern(id);
  const match = html.match(new RegExp(`<path[^>]*data-edge-id="${escaped}"[^>]*class="([^"]+)"`));
  assert.ok(match, `missing rendered edge ${id}`);
  return match[1];
}

function classForLabel(html, id, label) {
  const escapedId = escapePattern(id);
  const escapedLabel = escapePattern(label);
  const match = html.match(new RegExp(
    `<g[^>]*data-edge-id="${escapedId}"[^>]*>[\\s\\S]*?<text[^>]*class="([^"]+)"[^>]*>${escapedLabel}<\\/text>`,
  ));
  assert.ok(match, `missing rendered label for ${id}`);
  return match[1];
}

test('edge labels use the same variant color contract as their paths in every shared renderer and preset', () => {
  for (const [type, config] of Object.entries(CASES)) {
    for (const preset of PRESETS) {
      const html = render(type, config, preset);
      for (const variant of VARIANTS) {
        const id = `edge-label-${variant}`;
        assert.equal(classForEdge(html, id), `a-${variant}`, `${type}/${preset}/${variant} path`);
        assert.equal(
          classForLabel(html, id, `L${VARIANTS.indexOf(variant)}`),
          `t-edge-${variant}`,
          `${type}/${preset}/${variant} label`,
        );
      }
    }
  }
});

test('edge path and label classes resolve to the same theme token', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  for (const variant of VARIANTS) {
    const pathMatch = template.match(new RegExp(`\\.a-${variant}\\s*\\{[^}]*stroke:\\s*var\\((--[^)]+)\\)`));
    const labelMatch = template.match(new RegExp(`\\.t-edge-${variant}\\s*\\{[^}]*fill:\\s*var\\((--[^)]+)\\)`));
    assert.ok(pathMatch, `missing path token for ${variant}`);
    assert.ok(labelMatch, `missing label token for ${variant}`);
    assert.equal(labelMatch[1], pathMatch[1], variant);
  }
});
