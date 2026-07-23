import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-animation-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

const NODE_COLLECTION = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
};

function render(mode, example, animation = 'trace', visualPreset) {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  if (animation) doc.meta = { ...doc.meta, animation };
  else delete doc.meta.animation;
  if (visualPreset) doc.meta.visual_preset = visualPreset;
  else if (visualPreset === null) delete doc.meta.visual_preset;
  const suffix = `${animation || 'static'}-${visualPreset || 'default'}`;
  const input = path.join(tmp, `${mode}-${suffix}.json`);
  const output = path.join(tmp, `${mode}-${suffix}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync('node', [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return fs.readFileSync(output, 'utf8');
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('static output omits animation attributes', () => {
  const svg = svgBlock(render('workflow', CASES.workflow, null, null));
  assert.doesNotMatch(svg, /data-animation=/);
  assert.doesNotMatch(svg, /data-animate=/);
});

test('classic preset remains the default for existing diagrams', () => {
  const html = render('architecture', CASES.architecture, null, null);
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="classic">/);
  assert.match(svgBlock(html), /data-preset="classic"/);
});

test('signal-flow preset reaches the page, SVG, and motion export surface', () => {
  const html = render('workflow', CASES.workflow, 'trace', 'signal-flow');
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="signal-flow">/);
  assert.match(svgBlock(html), /data-preset="signal-flow"/);
  assert.match(html, /content: "SIGNAL FLOW"/);
  assert.match(html, /data-format="webm"/);
  assert.match(html, /data-last-motion-bytes/);
  assert.match(html, /Archify\.motion = \{ canRecord: canRecordMotion, recordWebm: recordWebm \}/);
  assert.match(html, /recorder\.requestData\(\)/);
  assert.match(html, /aria-label="Diagram view controls"/);
  assert.match(html, /Archify\.focus = \(function \(\)/);
  assert.match(html, /Archify\.view = \(function \(\)/);
  assert.match(html, /clone\.style\.removeProperty\('transform'\)/);
  assert.match(html, /clone\.removeAttribute\('data-view-scale'\)/);
  assert.match(html, /data-last-export-canonical/);
  assert.match(html, /data-last-export-error-format/);
  assert.match(html, /data-last-export-error/);
  assert.match(html, /WebM unavailable in this browser/);
  assert.match(html, /Motion capture unavailable in this browser/);
  assert.match(html, /canonicalStateClean: canonicalStateClean/);
  assert.match(html, /recordExportReceipt\('svg', blob, d\.canonicalStateClean\)/);
});

test('webm renders an explicit time-varying canvas scene instead of replaying one cached SVG bitmap', () => {
  const html = render('architecture', CASES.architecture, 'trace', 'signal-flow');
  const recordBlock = html.match(/function recordWebm\(options\) \{[\s\S]*?\n      var menu =/)?.[0] || '';

  assert.match(recordBlock, /var motionScene = createMotionScene\(svg\)/);
  assert.match(recordBlock, /drawMotionFrame\(ctx, backgroundImage, motionScene, elapsed\)/);
  assert.match(recordBlock, /getPointAtLength/);
  assert.match(recordBlock, /performance\.now\(\)/);
  assert.doesNotMatch(
    recordBlock,
    /function draw\(\) \{[\s\S]*?ctx\.drawImage\(img, 0, 0, canvas\.width, canvas\.height\);[\s\S]*?requestAnimationFrame\(draw\)/,
  );
});

test('blueprint preset reaches every visual surface without changing the default', () => {
  const html = render('architecture', CASES.architecture, null, 'blueprint');
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="blueprint">/);
  assert.match(svgBlock(html), /data-preset="blueprint"/);
  assert.match(html, /content: "BLUEPRINT \/ REV 01"/);
  assert.match(html, /\[data-preset="blueprint"\]\[data-theme="dark"\]/);
  assert.match(html, /svg\[data-preset="blueprint"\] \.c-grid/);
  assert.match(html, /html\[data-preset="blueprint"\] \.guided-views/);
  assert.match(html, /html\[data-preset="blueprint"\] \.card/);
});

test('blueprint preset is accepted by all five typed renderers', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example, null, 'blueprint');
    assert.match(html, /data-preset="blueprint"/, mode);
    assert.match(svgBlock(html), /data-preset="blueprint"/, mode);
  }
});

test('editorial preset reaches every visual surface and all five typed renderers', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example, null, 'editorial');
    assert.match(html, /<html lang="en" data-theme="dark" data-preset="editorial">/, mode);
    assert.match(svgBlock(html), /data-preset="editorial"/, mode);
    assert.match(html, /content: "EDITORIAL \/ FIELD NOTE"/, mode);
    assert.match(html, /\[data-preset="editorial"\]\[data-theme="dark"\]/, mode);
    assert.match(html, /html\[data-preset="editorial"\] \.diagram-container/, mode);
    assert.match(html, /svg\[data-preset="editorial"\] \.story-trail-flow/, mode);
  }
});

test('all five renderers add one geometry-neutral semantic sigil per primary node', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    const expected = source[NODE_COLLECTION[mode]].length;
    const staticHtml = render(mode, example, null, 'classic');
    const traceHtml = render(mode, example, 'trace', 'classic');
    const staticSvg = svgBlock(staticHtml);
    const traceSvg = svgBlock(traceHtml);
    const sigils = (svg) => [...svg.matchAll(/<g aria-hidden="true" data-semantic-sigil="[^"]+"[\s\S]*?<\/g>/g)].map((match) => match[0]);

    assert.equal(sigils(staticSvg).length, expected, mode);
    assert.deepEqual(sigils(traceSvg), sigils(staticSvg), `${mode} trace must not change sigil geometry`);
    assert.match(staticHtml, /svg \.semantic-sigil \{/i, mode);
    assert.match(staticHtml, /svg \.s-database\s+\{ color: var\(--database-stroke\); \}/, mode);
  }
});

test('unknown visual presets are rejected by schema validation', () => {
  assert.throws(
    () => render('architecture', CASES.architecture, null, 'hologram'),
    /visual_preset/,
  );
});

for (const [mode, example] of Object.entries(CASES)) {
  test(`${mode}: trace animation annotates svg, edges, and nodes`, () => {
    const svg = svgBlock(render(mode, example));
    assert.match(svg, /<svg[^>]+data-animation="trace"/);
    assert.match(svg, /data-animate="edge" style="--step:0"/);
    assert.match(svg, /data-animate="node" style="--step:0"/);
    assert.match(svg, /aria-labelledby="archify-diagram-title archify-diagram-description"/);
    assert.match(svg, /<title id="archify-diagram-title">[^<]+<\/title>/);
    assert.match(svg, /<desc id="archify-diagram-description">[^<]+<\/desc>/);
    assert.match(svg, /id="node-[^"]+" data-node-id="[^"]+"[^>]+role="button"[^>]+aria-pressed="false"/);
    assert.match(svg, /data-edge-from="[^"]+" data-edge-to="[^"]+"/);
  });
}

test('semantic SVG identity is deterministic for unchanged input', () => {
  const first = svgBlock(render('workflow', CASES.workflow));
  const second = svgBlock(render('workflow', CASES.workflow));
  const hooks = (svg) => [...svg.matchAll(/(?:id="node-|data-edge-from=")[^>]+/g)].map((match) => match[0]);
  assert.deepEqual(hooks(first), hooks(second));
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
