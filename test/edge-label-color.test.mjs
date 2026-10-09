import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
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

test('sequence message labels match their line color and lifelines stop above the legend', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/cache-miss-request.sequence.json'), 'utf8'));
  const variants = ['emphasis', 'security', 'dashed', 'default', 'return'];
  variants.forEach((variant, index) => {
    Object.assign(source.messages[index], { id: `message-${variant}`, variant, label: `M${index}` });
  });
  const input = path.join(tmp, 'sequence-labels.json');
  const output = path.join(tmp, 'sequence-labels.html');
  fs.writeFileSync(input, JSON.stringify(source));
  const result = spawnSync(process.execPath, [cli, 'render', 'sequence', input, output], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  variants.forEach((variant, index) => {
    // Colored lines share their color with the label; gray lines keep the
    // readable muted text color.
    const expected = ['default', 'return'].includes(variant) ? 't-muted' : `t-edge-${variant}`;
    assert.equal(classForLabel(html, `message-${variant}`, `M${index}`), expected, variant);
  });
  const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  const lifelineEnds = [...html.matchAll(/<path d="M ([\d.]+) 142 L \1 ([\d.]+)" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g)]
    .map((match) => Number(match[2]));
  assert.ok(lifelineEnds.length > 0, 'lifelines rendered');
  // Legend title glyphs start about 12px above their baseline.
  for (const end of lifelineEnds) assert.ok(end <= legendTitle - 12, `lifeline ends at ${end}, legend title at ${legendTitle}`);
});

test('sequence legend stays below a late message with a note', () => {
  const doc = (viewBox) => ({
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Late message', output: 'late.html', quality_profile: 'showcase', ...(viewBox ? { viewBox } : {}) },
    participants: [{ id: 'a', type: 'frontend', label: 'Client' }, { id: 'b', type: 'backend', label: 'Server' }],
    messages: [
      { from: 'a', to: 'b', y: 180, label: 'open' },
      { id: 'late', from: 'a', to: 'b', y: viewBox ? 477 : 690, label: 'request', note: 'completed', variant: 'emphasis' },
    ],
  });
  const run = (name, source, command) => {
    const input = path.join(tmp, `${name}.json`);
    const output = path.join(tmp, `${name}.html`);
    fs.writeFileSync(input, JSON.stringify(source));
    const result = spawnSync(process.execPath, [cli, command, 'sequence', input, ...(command === 'render' ? [output] : ['--json'])], { cwd: skillRoot, encoding: 'utf8' });
    return { result, output };
  };

  // An authored canvas that cannot hold content and legend fails with the
  // exact repair instead of drawing the legend over the late note.
  const authored = run('sequence-late-authored', doc([1080, 560]), 'validate');
  assert.notEqual(authored.result.status, 0);
  assert.match(authored.result.stdout, /set meta\.viewBox\[1\] to at least 597/);
  const repaired = run('sequence-late-repaired', doc([1080, 597]), 'render');
  assert.equal(repaired.result.status, 0, repaired.result.stderr);

  // A renderer-sized canvas grows so the legend clears the late note, and the
  // lifelines still reach the last message.
  const automatic = run('sequence-late-automatic', doc(null), 'render');
  assert.equal(automatic.result.status, 0, automatic.result.stderr);
  for (const output of [repaired.output, automatic.output]) {
    const html = fs.readFileSync(output, 'utf8');
    const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
    const lateY = Number(html.match(/data-edge-id="late"[\s\S]*?d="M [\d.]+ ([\d.]+) L/)[1]);
    const noteY = Number(html.match(/<text data-detail="fine"[^>]*>completed<\/text>/)[0].match(/ y="([\d.]+)"/)[1]);
    assert.ok(noteY + 2 < legendTitle - 12, `note at ${noteY} must stay above the legend title at ${legendTitle}`);
    for (const match of html.matchAll(/<path d="M ([\d.]+) 142 L \1 ([\d.]+)" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g)) {
      const end = Number(match[2]);
      assert.ok(end >= lateY && end <= legendTitle - 12, `lifeline end ${end}: last message ${lateY}, legend title ${legendTitle}`);
    }
  }
  // Few-participant automatic spread packs width (560); height still grows past
  // the old 760 floor so the legend clears the late note.
  const automaticViewBox = fs.readFileSync(automatic.output, 'utf8').match(/<svg viewBox="0 0 (\d+) (\d+)"/);
  assert.equal(Number(automaticViewBox[1]), 560);
  assert.ok(Number(automaticViewBox[2]) > 760, automaticViewBox[2]);
});

test('sequence repair height also holds a wrapped legend', () => {
  // A narrow canvas with all five variants wraps the legend to two rows; the
  // suggested height must make that legend actually render below the content.
  const variants = ['emphasis', 'return', 'security', 'dashed', 'default'];
  const doc = (height) => ({
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Wrapped legend', output: 'wrapped.html', quality_profile: 'showcase', viewBox: [480, height] },
    participants: [{ id: 'a', type: 'frontend', label: 'Client' }, { id: 'b', type: 'backend', label: 'Server' }],
    messages: variants.map((variant, index) => ({
      from: index % 2 ? 'b' : 'a', to: index % 2 ? 'a' : 'b', y: 180 + index * 60, label: variant, variant,
    })).concat([{ from: 'a', to: 'b', y: 477, label: 'late', note: 'completed' }]),
  });
  const write = (name, source) => {
    const input = path.join(tmp, `${name}.json`);
    fs.writeFileSync(input, JSON.stringify(source));
    return input;
  };
  const failed = spawnSync(process.execPath, [cli, 'validate', 'sequence', write('wrapped-short', doc(560)), '--json'], { cwd: skillRoot, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  const height = Number(failed.stdout.match(/set meta\.viewBox\[1\] to at least (\d+)/)?.[1]);
  assert.ok(height > 560, failed.stdout);
  const output = path.join(tmp, 'wrapped-repaired.html');
  const repaired = spawnSync(process.execPath, [cli, 'render', 'sequence', write('wrapped-repaired', doc(height)), output], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(repaired.status, 0, repaired.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const baselines = new Set([...html.matchAll(/data-legend-semantic-kind="[^"]+"[^>]*data-legend-baseline="([\d.]+)"/g)].map((match) => match[1]));
  assert.equal([...html.matchAll(/data-legend-semantic-kind="/g)].length, variants.length, 'every variant appears in the repaired legend');
  assert.ok(baselines.size >= 2, 'the fixture must exercise a wrapped legend');
  const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  const noteY = Number(html.match(/<text data-detail="fine"[^>]*>completed<\/text>/)[0].match(/ y="([\d.]+)"/)[1]);
  assert.ok(noteY + 2 < legendTitle - 12, `note at ${noteY}, legend title at ${legendTitle}`);
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


test('workflow phase and group accents keep their semantic colors', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const output = path.join(tmp, 'workflow-structure.html');
  const result = spawnSync(process.execPath, [cli, 'render', 'workflow', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  for (const label of ['Execute + report', 'Evidence path', 'Tool work']) {
    assert.match(html, new RegExp('<text[^>]*class="t-messagebus"[^>]*>' + escapePattern(label) + '</text>'));
  }
});
