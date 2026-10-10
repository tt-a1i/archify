import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
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

test('all ten diagram modes enable motion without an authoring switch', () => {
  const examples = { ...CASES, erd: 'orders.erd.json', class: 'payments.class.json',
    tree: 'payment-platform.tree.json', timeline: 'payment-incident.timeline.json',
    waterfall: 'checkout-request.waterfall.json' };
  for (const [mode, example] of Object.entries(examples)) {
    const defaultSvg = svgBlock(render(mode, example, null, null));
    assert.match(defaultSvg, /data-animation="trace"/, mode);
    assert.match(defaultSvg, /data-animate="node"/, mode);
    assert.equal(defaultSvg, svgBlock(render(mode, example, 'trace', null)), `${mode}: unchanged geometry`);
    assert.equal(defaultSvg, svgBlock(render(mode, example, 'none', null)), `${mode}: legacy input remains accepted`);
  }
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
  assert.match(html, /content: attr\(data-preset-badge-signal-flow\)/);
  assert.match(html, /data-preset-badge-signal-flow="SIGNAL FLOW"/);
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
  assert.match(html, /content: attr\(data-preset-badge-blueprint\)/);
  assert.match(html, /data-preset-badge-blueprint="BLUEPRINT \/ REV 01"/);
  assert.match(html, /\[data-preset="blueprint"\]\[data-theme="dark"\]/);
  assert.match(html, /svg\[data-preset="blueprint"\] \.c-grid/);
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
    assert.match(html, /content: attr\(data-preset-badge-editorial\)/, mode);
    assert.match(html, /data-preset-badge-editorial="EDITORIAL \/ FIELD NOTE"/, mode);
    assert.match(html, /content: attr\(data-preset-badge-editorial-plate\)/, mode);
    assert.match(html, /data-preset-badge-editorial-plate="ARCHIFY \/ PLATE 04"/, mode);
    assert.match(html, /\[data-preset="editorial"\]\[data-theme="dark"\]/, mode);
    assert.match(html, /html\[data-preset="editorial"\] \.diagram-container/, mode);
  }
});

test('all five renderers add one geometry-neutral semantic sigil per sigil-bearing node', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    // Lifecycle start, active and neutral states have no default sigil unless final.
    const outgoing = new Set((source.transitions || []).map((transition) => transition.from));
    const expected = source[NODE_COLLECTION[mode]].filter((node) => mode !== 'lifecycle' || node.icon
      || !['start', 'active', 'neutral'].includes(node.type) || !outgoing.has(node.id)).length;
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

test('Live cascade ships layered comet choreography instead of marching dashes', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /@keyframes archify-flow-wake/);
  assert.match(html, /@keyframes archify-cascade-halo/);
  assert.match(html, /@keyframes archify-cascade-tail/);
  assert.match(html, /@keyframes archify-cascade-head/);
  assert.match(html, /@keyframes archify-flow-ripple/);
  assert.match(html, /@keyframes archify-flow-ripple-echo/);
  assert.match(html, /@keyframes archify-node-receive/);
  assert.match(html, /@keyframes archify-node-enter/);
  assert.match(html, /\.ambient-flow-wake \{/);
  assert.match(html, /\.ambient-flow-halo \{/);
  assert.match(html, /\.ambient-flow-tail \{/);
  assert.match(html, /\.ambient-flow-head \{/);
  assert.match(html, /\.ambient-flow-ripple \{/);
  assert.match(html, /\.ambient-flow-ripple-echo \{/);
  assert.match(html, /--flow-cycle: 6\.4s/);
  assert.match(html, /--flow-step-delay: 0\.2s/);
  assert.match(html, /--flow-wake-peak: 0\.08/);
  assert.match(html, /--flow-ripple-peak: 0\.55/);
  assert.match(html, /--flow-ripple-echo-peak: 0\.22/);
  // On light canvases the cascade reads by saturation: ink-mixed head and
  // ripple with raised peaks.
  assert.match(html, /html\[data-theme="light"\] svg\[data-animation="trace"\] \{/);
  assert.match(html, /--flow-tail-peak: 0\.5/);
  assert.match(html, /html\[data-theme="light"\] \.ambient-flow-head \{/);
  assert.match(html, /html\[data-theme="light"\] \.ambient-flow-ripple \{/);
  // The Governor derives each edge's phase from the authored step order, eases
  // the comet's velocity, disintegrates its tail into sparkle fragments with
  // absolute caps, gives long edges an echo comet, and lands a sonar pair
  // where the comet arrives. The cascade starts playing immediately — no
  // load-time trace layer doubles the authored edge.
  assert.match(html, /addPath\('wake'\)/);
  assert.match(html, /addPath\('tail echo'\)/);
  assert.match(html, /getPointAtLength/);
  assert.match(html, /'ripple', 'ripple-echo'/);
  assert.match(html, /'2\.5 2 4 3 5\.5 4\.5 8 ' \+ \(len - 30\)\.toFixed\(1\)/);
  assert.match(html, /cfg\.flow\.style\.setProperty\('--flow-dasharray', cfg\.dasharray\)/);
  assert.match(html, /event\.animationName && !\/node-pulse\/\.test\(event\.animationName\)/);
  // Dashed authored lines keep their dash language through the wake.
  assert.match(html, /wake\.style\.setProperty\('--flow-dasharray', authoredDash\)/);
  assert.match(html, /nodeStep\(shape\.getAttribute\('data-edge-from'\)\)/);
  assert.match(html, /readSecondsVar\('--flow-step-delay', 0\.2\)/);
  assert.match(html, /\) \* 0\.88\)/);
  assert.doesNotMatch(html, /archify-ambient-flow|--ambient-flow-duration/);
  assert.doesNotMatch(html, /ambient-flow-trace|archify-trace-in|archify-trace-fade/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
