import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-passport-explanation-'));

const CASES = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  lifecycle: ['agent-run.lifecycle.json', 'states'],
};

const PROSE = 'Zebra-quartz sentinel phrase that must stay out of the SVG.\n\nSecond paragraph, separated by a blank line.';

function example(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode][0]), 'utf8'));
}

function withExplanation(mode, value = PROSE) {
  const diagram = example(mode);
  const collection = diagram[CASES[mode][1]];
  collection[0].explanation = value;
  return { diagram, id: collection[0].id };
}

function write(mode, diagram, name) {
  const input = path.join(tmp, `${mode}-${name}.json`);
  fs.writeFileSync(input, JSON.stringify(diagram));
  return input;
}

function validate(mode, input) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'validate', mode, input, '--json'], { encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout || '{}') };
}

function render(mode, input) {
  const output = path.join(tmp, `${path.basename(input, '.json')}.html`);
  execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('every semantic node collection accepts one optional plain-text explanation', () => {
  for (const mode of Object.keys(CASES)) {
    const { diagram } = withExplanation(mode);
    const ok = validate(mode, write(mode, diagram, 'ok'));
    assert.equal(ok.status, 0, `${mode}: ${JSON.stringify(ok.receipt).slice(0, 300)}`);
    assert.equal(ok.receipt.ok, true, mode);

    const wrongType = withExplanation(mode, 123).diagram;
    assert.notEqual(validate(mode, write(mode, wrongType, 'wrong-type')).status, 0, `${mode}: non-string explanation must fail`);

    const tooLong = withExplanation(mode, 'x'.repeat(1201)).diagram;
    assert.notEqual(validate(mode, write(mode, tooLong, 'too-long')).status, 0, `${mode}: over-long explanation must fail`);

    const empty = withExplanation(mode, '').diagram;
    assert.notEqual(validate(mode, write(mode, empty, 'empty')).status, 0, `${mode}: empty explanation must fail`);
  }
});

test('explanations ride in one JSON block outside the SVG and never enter the canonical diagram', () => {
  for (const mode of Object.keys(CASES)) {
    const { diagram, id } = withExplanation(mode);
    const html = render(mode, write(mode, diagram, 'render'));
    const block = html.match(/<script id="archify-explanations-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(block, `${mode}: explanations block missing`);
    const payload = JSON.parse(block[1]);
    assert.deepEqual(payload, { [id]: PROSE }, mode);
    assert.doesNotMatch(svg(html), /Zebra-quartz/, `${mode}: prose leaked into the SVG`);
    assert.match(html, /<button id="btn-focus-explain" type="button" hidden aria-label="Show the explanation for this node">Explain<\/button>/, mode);
    assert.match(html, /<div class="semantic-passport-explanation" id="focus-explanation" hidden tabindex="-1" role="button">/, mode);
    assert.match(html, /Archify\.explanations = \(function \(\) \{/, mode);
    assert.match(html, /explain: toggleExplanation,/, mode);
  }
});

test('documents without explanations emit no data block and keep the Explain action hidden', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode, write(mode, example(mode), 'plain'));
    assert.doesNotMatch(html, /<script id="archify-explanations-data"/, mode);
    assert.doesNotMatch(html, /ARCHIFY:EXPLANATIONS_DATA/, `${mode}: placeholder must be consumed`);
    assert.match(html, /id="btn-focus-explain" type="button" hidden/, mode);
  }
});

test('the whitespace-only explanation is dropped by the renderer rather than shipped', () => {
  const { diagram } = withExplanation('architecture', '   \n\n  ');
  // Schema minLength admits a padded string; the renderer must still not ship blank prose.
  const html = render('architecture', write('architecture', diagram, 'blank'));
  assert.doesNotMatch(html, /<script id="archify-explanations-data"/);
});

test('zh-CN localizes the Explain action without translating authored prose', () => {
  const { diagram } = withExplanation('sequence');
  diagram.meta.locale = 'zh-CN';
  const html = render('sequence', write('sequence', diagram, 'zh'));
  assert.match(html, /id="btn-focus-explain"[^>]+aria-label="显示此节点的解释">解释<\/button>/);
  assert.match(html, /"viewer\.passport\.explanation\.back":"\{label\} 的解释。激活以返回语义护照"/);
  assert.ok(html.includes(JSON.stringify(PROSE).replaceAll('<', '\\u003c')), 'authored prose must be shipped verbatim');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
