import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const architectureRenderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const levelsRenderer = path.join(skillRoot, 'renderers/levels/render-levels.mjs');

let caseCounter = 0;
function workspace() {
  caseCounter += 1;
  return fs.mkdtempSync(path.join(os.tmpdir(), `archify-levels-render-${caseCounter}-`));
}

function architecture(title, ids, { viewBox = [900, 500], cards = true } = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title, viewBox, output: 'level.html' },
    components: ids.map((id, index) => ({
      id,
      type: index % 2 === 0 ? 'backend' : 'database',
      label: id,
      sublabel: `${id} detail`,
      pos: [80 + index * 480, 200],
      size: [220, 64],
    })),
    connections: ids.length > 1 ? [{ from: ids[0], to: ids[1], label: 'writes' }] : [],
    ...(cards ? { cards: [{ dot: 'cyan', title: `${title} card`, items: [`${title} item`] }] } : {}),
  };
}

function writeJson(dir, name, value) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
}

function emitSvg(inputPath) {
  const result = spawnSync(process.execPath, [architectureRenderer, inputPath, '--emit-svg'], { encoding: 'utf8' });
  return result;
}

function renderLevels(manifestPath, outPath) {
  return spawnSync(process.execPath, [levelsRenderer, manifestPath, outPath], {
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });
}

function svgRoots(html) {
  return html.match(/<svg [\s\S]*?<\/svg>/g) || [];
}

function levelsData(html) {
  const match = html.match(/<script id="archify-levels-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'levels data script should be present');
  const json = match[1].replaceAll('\\u003c', '<').replaceAll('\\u003e', '>').replaceAll('\\u0026', '&');
  return JSON.parse(json);
}

// A two-level document used by most cases below.
function twoLevelFixture() {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['alpha', 'beta']));
  writeJson(dir, 'child.architecture.json', architecture('Child', ['gamma', 'delta']));
  const manifestPath = writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Two Level Doc', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'child', label: 'Child', source: 'child.architecture.json', parent: { level: 'root', node: 'beta' } },
    ],
  });
  return { dir, manifestPath };
}

test('emit-svg returns rendered SVG and cards without writing an artifact', () => {
  const dir = workspace();
  const input = writeJson(dir, 'one.architecture.json', architecture('One', ['alpha', 'beta']));
  const before = fs.readdirSync(dir);

  const result = emitSvg(input);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.diagramType, 'architecture');
  assert.match(payload.svg, /^\s*<svg /);
  assert.equal(payload.cards.length, 1);
  assert.equal(payload.meta.title, 'One');
  assert.deepEqual(fs.readdirSync(dir), before, 'emit-svg must not write files');
});

test('emit-svg still fails when the level fails its own layout validation', () => {
  const dir = workspace();
  const overlapping = architecture('Bad', ['alpha', 'beta']);
  // Put the second component exactly on top of the first.
  overlapping.components[1].pos = overlapping.components[0].pos;
  const input = writeJson(dir, 'bad.architecture.json', overlapping);

  const result = emitSvg(input);

  assert.notEqual(result.status, 0, 'a failing level must not emit SVG');
  assert.equal(result.stdout.trim(), '');
});

test('levels: every level SVG is byte-identical to its standalone render', () => {
  const { dir, manifestPath } = twoLevelFixture();
  const outPath = path.join(dir, 'doc.html');

  const result = renderLevels(manifestPath, outPath);
  assert.equal(result.status, 0, result.stderr);

  const composed = svgRoots(fs.readFileSync(outPath, 'utf8'));
  assert.equal(composed.length, 2);

  for (const [index, source] of ['root.architecture.json', 'child.architecture.json'].entries()) {
    const standalone = svgRoots(JSON.parse(emitSvg(path.join(dir, source)).stdout).svg)[0];
    // The composed copy carries the level attributes; strip them before
    // comparing so the geometry itself is what is being asserted.
    const stripped = composed[index].replace(/^<svg data-level="[^"]*" data-level-label="[^"]*" (?:data-level-active="true" |hidden="hidden" aria-hidden="true" )/, '<svg ');
    assert.equal(stripped, standalone, `level ${index} geometry must be unchanged`);
  }
});

test('levels: SVGs are direct children of the diagram container', () => {
  const { dir, manifestPath } = twoLevelFixture();
  const outPath = path.join(dir, 'doc.html');
  assert.equal(renderLevels(manifestPath, outPath).status, 0);
  const html = fs.readFileSync(outPath, 'utf8');

  // Existing CSS and viewer probes select `.diagram-container > svg`. A
  // wrapper element between them silently detaches the diagram stage from
  // the chrome that measures it, so assert the direct relationship.
  const container = html.slice(html.indexOf('<div class="diagram-container'));
  const firstTagAfterContainer = container.slice(container.indexOf('>') + 1).trimStart();
  assert.ok(firstTagAfterContainer.startsWith('<svg '), firstTagAfterContainer.slice(0, 80));
});

test('levels: only the root level is visible, and hidden levels have a display rule', () => {
  const { dir, manifestPath } = twoLevelFixture();
  const outPath = path.join(dir, 'doc.html');
  assert.equal(renderLevels(manifestPath, outPath).status, 0);
  const html = fs.readFileSync(outPath, 'utf8');

  const roots = svgRoots(html);
  assert.match(roots[0], /^<svg data-level="root" [^>]*data-level-active="true"/);
  assert.match(roots[1], /^<svg data-level="child" [^>]*hidden="hidden" aria-hidden="true"/);

  const cards = html.match(/<div class="cards"[^>]*>/g) || [];
  assert.equal(cards.length, 2);
  assert.match(cards[0], /data-level="root" data-level-active="true"/);
  assert.match(cards[1], /data-level="child" hidden aria-hidden="true"/);

  // Author display rules outrank the user-agent [hidden] rule, so every
  // element that is laid out by one and hidden by attribute needs an explicit
  // override, or it keeps costing invisible page height.
  const hiddenRule = html.match(/([^}]*)\{\s*display:\s*none;\s*\}/g) || [];
  const overrides = hiddenRule.join('\n');
  for (const selector of ['.diagram-container > svg[hidden]', '.cards[hidden]',
    '.level-rail[hidden]', '.level-children[hidden]']) {
    assert.ok(overrides.includes(selector), `missing display:none override for ${selector}`);
  }
});

test('levels: the viewer manifest inverts the authored parent into a drill target', () => {
  const { dir, manifestPath } = twoLevelFixture();
  const outPath = path.join(dir, 'doc.html');
  assert.equal(renderLevels(manifestPath, outPath).status, 0);

  const data = levelsData(fs.readFileSync(outPath, 'utf8'));
  assert.equal(data.root, 'root');
  assert.equal(data.active, 'root');
  assert.deepEqual(data.levels.map((l) => l.id), ['root', 'child']);
  assert.equal(data.levels[0].drillFrom, null);
  assert.deepEqual(data.levels[0].children, ['child']);
  assert.deepEqual(data.levels[1].drillFrom, { level: 'root', node: 'beta' });
  assert.deepEqual(data.levels[1].nodes, ['gamma', 'delta']);
  assert.deepEqual(data.levels[1].viewBox, [900, 500]);
});

test('levels: per-level views travel in the levels manifest', () => {
  const dir = workspace();
  const root = architecture('Root', ['alpha', 'beta']);
  root.meta.views = [{ id: 'rootview', label: 'Root view', focus: ['alpha'] }];
  const child = architecture('Child', ['gamma', 'delta']);
  child.meta.views = [{ id: 'childview', label: 'Child view', focus: ['gamma'] }];
  writeJson(dir, 'root.architecture.json', root);
  writeJson(dir, 'child.architecture.json', child);
  const manifestPath = writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Views', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'child', label: 'Child', source: 'child.architecture.json', parent: { level: 'root', node: 'beta' } },
    ],
  });
  const outPath = path.join(dir, 'doc.html');
  assert.equal(renderLevels(manifestPath, outPath).status, 0);
  const html = fs.readFileSync(outPath, 'utf8');

  const data = levelsData(html);
  assert.deepEqual(data.levels[0].views.map((v) => v.id), ['rootview']);
  assert.deepEqual(data.levels[1].views.map((v) => v.id), ['childview']);
});

test('levels: a level that fails layout fails the whole document with its own diagnostic', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['alpha', 'beta']));
  const broken = architecture('Broken', ['gamma', 'delta']);
  broken.components[1].pos = broken.components[0].pos;
  writeJson(dir, 'broken.architecture.json', broken);
  const manifestPath = writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Broken', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'broken', label: 'Broken', source: 'broken.architecture.json', parent: { level: 'root', node: 'beta' } },
    ],
  });
  const outPath = path.join(dir, 'doc.html');

  const result = renderLevels(manifestPath, outPath);

  assert.notEqual(result.status, 0);
  assert.ok(!fs.existsSync(outPath), 'a failing level must not leave a partial artifact');
  assert.match(result.stderr, /broken/);
});

test('levels: cross-level document problems are reported before any rendering', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['alpha', 'beta']));
  writeJson(dir, 'child.architecture.json', architecture('Child', ['gamma', 'delta']));
  const manifestPath = writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Bad parent', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'child', label: 'Child', source: 'child.architecture.json', parent: { level: 'root', node: 'nonexistent' } },
    ],
  });
  const outPath = path.join(dir, 'doc.html');

  const result = renderLevels(manifestPath, outPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /parent-unknown-node|nonexistent/);
  assert.ok(!fs.existsSync(outPath));
});

test('levels: a level without cards contributes no card block', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['alpha', 'beta']));
  writeJson(dir, 'child.architecture.json', architecture('Child', ['gamma', 'delta'], { cards: false }));
  const manifestPath = writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Sparse cards', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'child', label: 'Child', source: 'child.architecture.json', parent: { level: 'root', node: 'beta' } },
    ],
  });
  const outPath = path.join(dir, 'doc.html');
  assert.equal(renderLevels(manifestPath, outPath).status, 0);

  const cards = (fs.readFileSync(outPath, 'utf8').match(/<div class="cards"[^>]*>/g) || []);
  assert.equal(cards.length, 1);
  assert.match(cards[0], /data-level="root"/);
});

test('levels: one artifact is far smaller than the separate per-level artifacts', () => {
  const { dir, manifestPath } = twoLevelFixture();
  const combinedPath = path.join(dir, 'combined.html');
  assert.equal(renderLevels(manifestPath, combinedPath).status, 0);

  let separateTotal = 0;
  for (const source of ['root.architecture.json', 'child.architecture.json']) {
    const out = path.join(dir, `${source}.html`);
    const result = spawnSync(process.execPath, [architectureRenderer, path.join(dir, source), out], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    separateTotal += fs.statSync(out).size;
  }

  // The ~775KB viewer template dominates each artifact, so binding levels into
  // one document should cost far less than shipping them separately.
  const combined = fs.statSync(combinedPath).size;
  assert.ok(combined < separateTotal * 0.7, `combined ${combined} vs separate ${separateTotal}`);
});
