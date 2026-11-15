import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertCamoSafeSvg,
  bakeEmbeddedStylesheet,
  bakeSvg,
  collectSvgRules,
  compileColorMix,
  extractCanonicalSvg,
  loadViewerStyles,
  parseStylesheet,
  resolveThemeVariables,
  substituteVariables,
} from '../archify/renderers/shared/svg-bake.mjs';
import { exportOutputPaths, exportSvgArtifacts } from '../archify/renderers/shared/svg-export.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { parseXml } from './helpers/xml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-svg-bake-'));
const styles = loadViewerStyles();

const EXAMPLES = {
  architecture: 'brand-aware-delivery.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'drilldown-api.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  erd: 'orders.erd.json',
  tree: 'payment-platform.tree.json',
  class: 'payments.class.json',
  timeline: 'payment-incident.timeline.json',
  waterfall: 'checkout-request.waterfall.json',
};

const RISK_VERDICTS = ['SAFE', 'LOW RISK', 'MERGEABLE', 'NO IMPACT', 'VERIFIED PR'];

function renderHtml(type, name = EXAMPLES[type]) {
  const output = path.join(scratch, `${type}-${path.basename(name, '.json')}.html`);
  const result = spawnSync(process.execPath, [cli, 'render', type, path.join(skillRoot, 'examples', name), output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(output, 'utf8');
}

function rootAttributes(svg) {
  const open = svg.match(/<svg\b([^>]*)>/)[1];
  return Object.fromEntries([...open.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function styleText(svg) {
  return svg.match(/<style><!\[CDATA\[([\s\S]*?)\]\]><\/style>/)[1];
}

test('every standalone diagram type bakes into strict XML, Camo-safe SVG in both themes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const canonical = extractCanonicalSvg(renderHtml(type));
    for (const theme of ['light', 'dark']) {
      const svg = bakeSvg(canonical, { theme, diagramType: type, styles });
      assert.doesNotThrow(() => parseXml(svg), `${type}/${theme} must be strict XML`);
      const camo = assertCamoSafeSvg(svg, { assert: false });
      assert.deepEqual(camo.problems, [], `${type}/${theme} Camo problems`);
      const attributes = rootAttributes(svg);
      assert.equal(attributes.xmlns, 'http://www.w3.org/2000/svg');
      assert.equal(attributes['data-theme'], theme);
      assert.equal(attributes['data-archify-bake'], 'static');
      assert.equal(attributes['data-animation'], undefined);
      assert.equal(attributes.viewBox, rootAttributes(canonical).viewBox, 'viewBox is preserved');
      const [, , width, height] = attributes.viewBox.split(/\s+/);
      assert.equal(attributes.width, width);
      assert.equal(attributes.height, height);
      const css = styleText(svg);
      assert.match(css, /@font-face/, 'fonts are inlined');
      assert.doesNotMatch(svg, /color-mix\(/, 'color-mix is compiled away, including renderer styles and attributes');
      assert.doesNotMatch(svg, /var\(--/, 'no var() survives anywhere in the standalone SVG');
      assert.doesNotMatch(css, /\n\s*(animation|transition)\s*:/, 'no viewer animation/transition properties');
      assert.doesNotMatch(css, /:hover/, 'hover rules are stripped');
      assert.doesNotMatch(css, /\.diagram-container/, 'viewer canvas selectors are rescoped');
      assert.doesNotMatch(svg, /<animate\b/, 'default export is static');
      assert.match(svg, /<rect class="archify-bake-background"/);
      assert.match(svg, /<metadata id="archify-software-notices">/);
      assert.doesNotMatch(svg, /archify-payloads-data|SRC \d/, 'no reader-only payload or beacon markup');
      for (const verdict of RISK_VERDICTS) assert.ok(!svg.includes(verdict), `${verdict} must not appear`);
    }
  }
});

test('renderer-embedded stylesheets expand scoped custom properties per scope and drop unresolved declarations', () => {
  const variables = new Map([['--database-stroke', '#7c3aed'], ['--text-muted', '#64748b']]);
  const css = `
    svg .er-hue-database { --er-hue: var(--database-stroke); }
    svg .er-band { fill: color-mix(in srgb, var(--er-hue) 4%, transparent); stroke-dasharray: none; }
    svg .er-legend { stroke: var(--text-muted); opacity: var(--never-defined); }
  `;
  const baked = bakeEmbeddedStylesheet(css, variables);
  assert.doesNotMatch(baked, /var\(|color-mix\(/);
  assert.match(baked, /^svg \.er-band \{ stroke-dasharray: none; \}$/m, 'globally resolvable declarations stay on the original selector');
  assert.match(baked, /svg \.er-hue-database:is\(svg \.er-band\), svg \.er-hue-database :is\(svg \.er-band\) \{ fill: rgba\(124, 58, 237, 0\.04\); \}/);
  assert.match(baked, /^svg \.er-legend \{ stroke: #64748b; \}$/m, 'declarations no scope can resolve are dropped');

  const erd = bakeSvg(extractCanonicalSvg(renderHtml('erd')), { theme: 'light', diagramType: 'erd', styles });
  assert.match(erd, /\.er-hue-[a-z]+:is\([^)]*\.er-band\)/, 'ERD hue scopes are expanded in the baked output');
  assert.doesNotMatch(erd, /style="[^"]*var\(/, 'inline style attributes are resolved');
});

test('baked SVGs use the same stylesheet variables the Viewer resolves per theme and preset', () => {
  const light = resolveThemeVariables(styles.rules, { theme: 'light', preset: 'classic' });
  const dark = resolveThemeVariables(styles.rules, { theme: 'dark', preset: 'classic' });
  assert.notEqual(light.get('--bg'), dark.get('--bg'));
  assert.match(light.get('--bg'), /^(#[0-9a-f]{3,8}|rgba?\()/i);
  for (const value of [...light.values(), ...dark.values()]) {
    assert.doesNotMatch(value, /var\(|color-mix\(/, `resolved variable still references ${value}`);
  }
  const blueprint = resolveThemeVariables(styles.rules, { theme: 'dark', preset: 'blueprint' });
  assert.notEqual(blueprint.get('--bg'), dark.get('--bg'), 'preset overrides land on top of theme');
  const canonical = extractCanonicalSvg(renderHtml('sequence'));
  for (const preset of ['classic', 'signal-flow', 'blueprint', 'editorial']) {
    const svg = bakeSvg(canonical, { theme: 'dark', preset, diagramType: 'sequence', styles });
    assert.equal(rootAttributes(svg)['data-preset'], preset);
    assert.doesNotThrow(() => parseXml(svg));
    assert.match(styleText(svg), new RegExp(`svg\\[data-preset="${preset}"\\]`), 'preset rules are rescoped to the root');
  }
});

test('variable substitution honours nested fallbacks and color-mix compiles to flat colours', () => {
  const table = new Map([['--a', '#102030'], ['--b', 'rgb(0, 0, 0)']]);
  const lookup = (name) => table.get(name) ?? null;
  assert.equal(substituteVariables('var(--a)', lookup), '#102030');
  assert.equal(substituteVariables('var(--missing, var(--a))', lookup), '#102030');
  assert.equal(substituteVariables('var(--missing, 4px)', lookup), '4px');
  assert.equal(substituteVariables('var(--missing)', lookup), null);
  assert.equal(compileColorMix('color-mix(in srgb, #ffffff 50%, #000000)'), '#808080');
  assert.equal(compileColorMix('color-mix(in srgb, #ff0000 25%, transparent)'), 'rgba(255, 0, 0, 0.25)');
  assert.equal(compileColorMix('1px solid color-mix(in srgb, #ff0000, #0000ff)'), '1px solid #800080');
});

test('stylesheet collection rescopes canvas selectors, keeps per-type classes and resolves variables', () => {
  const rules = parseStylesheet(`
    :root, [data-theme="dark"] { --bg: #000; --stroke: color-mix(in srgb, #fff 50%, transparent); }
    [data-theme="light"] { --bg: #fff; }
    html[data-preset="classic"][data-theme="dark"] .diagram-container > svg .c-service { fill: var(--bg); stroke: var(--stroke); transition: fill 1s; }
    html[data-preset="editorial"] .diagram-container > svg .c-service { fill: red; }
    svg .semantic-sigil { opacity: .8; cursor: pointer; }
    svg .c-service:hover, svg .t-label { font-weight: 600; }
    @media (max-width: 600px) { svg .t-label { display: none; } }
  `);
  const variables = resolveThemeVariables(rules, { theme: 'dark', preset: 'classic' });
  assert.equal(variables.get('--bg'), '#000');
  assert.equal(variables.get('--stroke'), 'rgba(255, 255, 255, 0.5)');
  const collected = collectSvgRules(rules, { theme: 'dark', preset: 'classic', variables }).join('\n');
  assert.match(collected, /svg\[data-preset="classic"\]\[data-theme="dark"\] \.c-service \{ fill: #000; stroke: rgba\(255, 255, 255, 0\.5\); \}/);
  assert.doesNotMatch(collected, /editorial/, 'other presets are excluded');
  assert.doesNotMatch(collected, /:hover|cursor|transition/, 'interaction-only declarations are dropped');
  assert.match(collected, /svg \.t-label \{ font-weight: 600; \}/);
  assert.doesNotMatch(collected, /display: none/, 'media-scoped rules are skipped');
});

test('--animate-flow adds a finite, freezing pulse only for sequence and dataflow without touching the viewBox', () => {
  for (const type of ['sequence', 'dataflow']) {
    const canonical = extractCanonicalSvg(renderHtml(type));
    const svg = bakeSvg(canonical, { theme: 'light', diagramType: type, animateFlow: true, styles });
    assert.doesNotThrow(() => parseXml(svg));
    assert.deepEqual(assertCamoSafeSvg(svg, { assert: false }).problems, []);
    assert.equal(rootAttributes(svg)['data-archify-bake'], 'animate-flow');
    assert.equal(rootAttributes(svg).viewBox, rootAttributes(canonical).viewBox);
    const animates = [...svg.matchAll(/<animate\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(animates.length > 0);
    for (const animate of animates) {
      assert.match(animate, /repeatCount="\d+"/, 'every pulse is finite');
      assert.doesNotMatch(animate, /indefinite/);
    }
    assert.ok(animates.some((animate) => /fill="freeze"/.test(animate)), 'the pulse freezes back to invisible');
    const textBefore = canonical.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) || [];
    const textAfter = svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) || [];
    assert.deepEqual(textAfter, textBefore, 'text nodes are untouched');
    const statics = bakeSvg(canonical, { theme: 'light', diagramType: type, styles });
    assert.doesNotMatch(statics, /<animate\b/);
  }
  for (const type of ['architecture', 'erd']) {
    const canonical = extractCanonicalSvg(renderHtml(type));
    const svg = bakeSvg(canonical, { theme: 'light', diagramType: type, animateFlow: true, styles });
    assert.doesNotMatch(svg, /<animate\b/, `${type} never animates`);
    assert.equal(rootAttributes(svg)['data-archify-bake'], 'static');
  }
});

test('assertCamoSafeSvg rejects scripts, javascript URLs, handlers, external references and oversize files', () => {
  const base = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
  const cases = [
    ['svg/script', `${base}<script>alert(1)</script></svg>`],
    ['svg/javascript-url', `${base}<a href="javascript:alert(1)"><text>x</text></a></svg>`],
    ['svg/event-handler', `${base}<rect onclick="alert(1)"/></svg>`],
    ['svg/foreign-object', `${base}<foreignObject><div/></foreignObject></svg>`],
    ['svg/css-import', `${base}<style>@import url("https://example.com/x.css");</style></svg>`],
    ['svg/external-href', `${base}<image href="https://example.com/x.png"/></svg>`],
    ['svg/external-css-url', `${base}<style>svg { background: url(https://example.com/x.png); }</style></svg>`],
    ['svg/missing-xmlns', '<svg viewBox="0 0 10 10"></svg>'],
    ['svg/not-svg', '<html></html>'],
  ];
  for (const [code, svg] of cases) {
    const result = assertCamoSafeSvg(svg, { assert: false });
    assert.ok(result.problems.some((problem) => problem.code === code), `${code} expected, got ${JSON.stringify(result.problems)}`);
    assert.ok(result.problems.every((problem) => problem.fix), 'every problem names a fix');
    assert.throws(() => assertCamoSafeSvg(svg), (error) => error.camo && error.code === result.problems[0].code);
  }
  const safe = `${base}<image href="data:image/png;base64,AAAA"/><use href="#x"/><style>svg{fill:url(#grad)}</style></svg>`;
  assert.deepEqual(assertCamoSafeSvg(safe, { assert: false }).problems, []);
  const oversize = assertCamoSafeSvg(`${base}${'<g/>'.repeat(10)}</svg>`, { assert: false, maxBytes: 64 });
  assert.ok(oversize.problems.some((problem) => problem.code === 'svg/too-large'));
});

test('extractCanonicalSvg returns the diagram canvas, not viewer chrome', () => {
  const html = renderHtml('erd');
  const svg = extractCanonicalSvg(html);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /data-preset=/);
  assert.doesNotMatch(svg, /<button\b|<script\b/);
  assert.throws(() => extractCanonicalSvg('<html><body>nope</body></html>'), /canonical/i);
});

test('export-svg writes theme-named files atomically with a receipt the browser can trust', async () => {
  const input = path.join(skillRoot, 'examples', EXAMPLES.sequence);
  const stem = path.join(scratch, 'receipts', 'sequence');
  assert.deepEqual(exportOutputPaths(stem, ['light', 'dark']), { light: `${stem}-light.svg`, dark: `${stem}-dark.svg` });
  assert.deepEqual(exportOutputPaths(`${stem}.svg`, ['light', 'dark']), { light: `${stem}-light.svg`, dark: `${stem}-dark.svg` });
  assert.deepEqual(exportOutputPaths(`${stem}.svg`, ['dark']), { dark: `${stem}.svg` });
  assert.deepEqual(exportOutputPaths(stem, ['dark']), { dark: `${stem}.svg` });

  const result = spawnSync(process.execPath, [cli, 'export-svg', 'sequence', input, stem, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'export-svg');
  assert.equal(receipt.theme, 'both');
  assert.equal(receipt.animateFlow, false);
  assert.deepEqual(receipt.outputs.map((entry) => entry.theme), ['light', 'dark']);
  for (const entry of receipt.outputs) {
    const bytes = fs.readFileSync(entry.path);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.camo.ok, true);
    assert.deepEqual(entry.camo.problems, []);
    assert.doesNotThrow(() => parseXml(bytes.toString('utf8')));
  }
  assert.equal(fs.readdirSync(path.dirname(stem)).filter((name) => name.includes('.tmp') || name.startsWith('.')).length, 0, 'no staging leftovers');

  const single = spawnSync(process.execPath, [cli, 'export-svg', 'dataflow', path.join(skillRoot, 'examples', EXAMPLES.dataflow), path.join(scratch, 'flow.svg'), '--theme', 'dark', '--preset', 'blueprint', '--animate-flow', '--json'], { encoding: 'utf8' });
  assert.equal(single.status, 0, single.stderr);
  const singleReceipt = JSON.parse(single.stdout);
  assert.deepEqual(singleReceipt.outputs.map((entry) => [entry.theme, entry.path, entry.animated]), [['dark', path.join(scratch, 'flow.svg'), true]]);
  assert.equal(singleReceipt.preset, 'blueprint');
  assert.equal(rootAttributes(fs.readFileSync(path.join(scratch, 'flow.svg'), 'utf8'))['data-preset'], 'blueprint');

  const programmatic = await exportSvgArtifacts({ type: 'erd', input: path.join(skillRoot, 'examples', EXAMPLES.erd), output: path.join(scratch, 'erd'), theme: 'light' });
  assert.equal(programmatic.outputs.length, 1);
  assert.ok(fs.existsSync(path.join(scratch, 'erd.svg')));
});

test('export-svg rejects bad arguments and renderer failures with structured receipts', () => {
  const input = path.join(skillRoot, 'examples', EXAMPLES.sequence);
  const badTheme = spawnSync(process.execPath, [cli, 'export-svg', 'sequence', input, path.join(scratch, 'x'), '--theme', 'neon', '--json'], { encoding: 'utf8' });
  assert.equal(badTheme.status, 2);
  const themeReceipt = JSON.parse(badTheme.stdout);
  assert.equal(themeReceipt.ok, false);
  assert.equal(themeReceipt.stage, 'arguments');
  assert.equal(themeReceipt.diagnostics[0].code, 'cli/unsupported-option');

  const badType = spawnSync(process.execPath, [cli, 'export-svg', 'explainer', input, path.join(scratch, 'x'), '--json'], { encoding: 'utf8' });
  assert.equal(badType.status, 2);
  assert.equal(JSON.parse(badType.stdout).diagnostics[0].code, 'cli/unknown-diagram-type');

  const unknownOption = spawnSync(process.execPath, [cli, 'export-svg', 'sequence', input, path.join(scratch, 'x'), '--bogus'], { encoding: 'utf8' });
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /Unknown export-svg option "--bogus"/);

  const broken = path.join(scratch, 'broken.sequence.json');
  const document = JSON.parse(fs.readFileSync(input, 'utf8'));
  delete document.participants;
  fs.writeFileSync(broken, JSON.stringify(document));
  const failure = spawnSync(process.execPath, [cli, 'export-svg', 'sequence', broken, path.join(scratch, 'broken'), '--json'], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
  const failureReceipt = JSON.parse(failure.stdout);
  assert.equal(failureReceipt.ok, false);
  assert.equal(failureReceipt.stage, 'render');
  assert.equal(failureReceipt.diagnostics[0].code, 'schema/required');
  assert.ok(!fs.existsSync(path.join(scratch, 'broken-light.svg')), 'no partial output on failure');
});
