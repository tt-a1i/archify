import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compactFinalizeReceipt } from '../bin/finalize.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
const checker = path.join(root, 'scripts/check-render-output.mjs');

function sequence(count = 6) {
  return {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Background task request', viewBox: [1080, 690], quality_profile: 'showcase', output: 'diagram.html' },
    participants: ['Caller', 'Session', 'Host', 'Sandbox', 'Worker', 'Files'].slice(0, count)
      .map((label, i) => ({ id: `p${i}`, type: 'backend', label })),
    messages: [{ from: 'p0', to: `p${count - 1}`, y: 200, label: '请求结果', variant: 'emphasis' }],
  };
}

function render(t, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-width-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'candidate.json');
  const output = path.join(dir, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [cli, 'render', 'sequence', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { input, output, html: fs.readFileSync(output, 'utf8') };
}

function check(output) {
  const result = spawnSync(process.execPath, [checker, output], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  return { report, exitCode: result.status };
}

function summary(report, type = 'sequence', ok = true) {
  return compactFinalizeReceipt({ ok, type, status: ok ? 'pass' : 'fail', diagnostics: [],
    stages: { check: { status: ok ? 'pass' : 'fail', receipt: report } } });
}

test('six fixed columns on a 1080px canvas disclose unused width without failing or rewriting the artifact', t => {
  const original = render(t, sequence());
  const { report, exitCode } = check(original.output);
  const space = report.composition.sequenceColumnSpace;
  assert.equal(exitCode, 0);
  assert.equal(space.measured, true);
  assert.equal(space.participantCount, 6);
  assert.equal(space.occupiedRight, 645);
  assert.equal(space.emptyRightPx, 435);
  assert.equal(space.emptyRightRatio, 0.403);
  assert.equal(space.reviewSuggested, true);
  assert.deepEqual(report.composition.summary, { errors: 0, warnings: 0 });
  const compact = summary(report);
  assert.equal(compact.status, 'pass');
  assert.equal(compact.gates.check, 'pass');
  assert.deepEqual(compact.diagnostics, []);
  assert.equal(compact.visualReview, 'not-requested');
  assert.equal(compact.layoutReviewRecommendation.action, 'inspect-sequence-width');
  assert.deepEqual(compact.layoutReviewRecommendation.evidence, space);
  assert.equal(summary(report, 'architecture').layoutReviewRecommendation, undefined);
  assert.equal(summary(report, 'sequence', false).layoutReviewRecommendation, undefined);
  assert.equal(fs.readFileSync(original.output, 'utf8'), original.html);
});

test('the suggested one-field spread edit clears the advice and retains message wording and order', t => {
  const spec = sequence();
  const original = render(t, spec);
  spec.meta.column_fit = 'spread';
  const repaired = render(t, spec);
  const { report, exitCode } = check(repaired.output);
  assert.equal(exitCode, 0);
  assert.equal(report.composition.sequenceColumnSpace.columnFit, 'spread');
  assert.equal(report.composition.sequenceColumnSpace.occupiedRight, 1040);
  assert.equal(report.composition.sequenceColumnSpace.reviewSuggested, false);
  assert.equal(summary(report).layoutReviewRecommendation, undefined);
  const nodes = html => [...html.matchAll(/<g id="node-([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(nodes(repaired.html), nodes(original.html));
  assert.ok(repaired.html.includes('>请求结果</text>'));
  assert.ok(repaired.html.includes(' L 965.5 200'));
});

test('explicit fixed remains byte-identical to the legacy default and advice preserves authored intent', t => {
  const spec = sequence();
  const original = render(t, spec);
  spec.meta.column_fit = 'fixed';
  const explicit = render(t, spec);
  assert.equal(explicit.html, original.html);
  const compact = summary(check(explicit.output).report);
  assert.match(compact.layoutReviewRecommendation.repair, /Retain explicit fixed layouts and legacy inputs/);
  assert.equal(JSON.parse(fs.readFileSync(explicit.input)).meta.column_fit, 'fixed');
});

test('participant brand marks retain width advice while unrelated transforms remain unmeasured', t => {
  const spec = sequence();
  spec.participants[0].brand = 'github';
  const { output, html } = render(t, spec);
  assert.match(html, /data-brand-mark="github"/);
  const { report, exitCode } = check(output);
  const space = report.composition.sequenceColumnSpace;
  assert.equal(exitCode, 0);
  assert.equal(space.measured, true);
  assert.equal(space.participantCount, 6);
  assert.equal(space.occupiedRight, 645);
  assert.equal(space.emptyRightPx, 435);
  assert.equal(space.emptyRightRatio, 0.403);
  assert.equal(summary(report).layoutReviewRecommendation.action, 'inspect-sequence-width');
  assert.equal(fs.readFileSync(output, 'utf8'), html);

  for (const changed of [
    html.replace('<g id="node-p5"', '<g transform="translate(300 0)" id="node-p5"'),
    html.replace('class="a-emphasis"', 'class="a-emphasis" transform="translate(300 0)"'),
  ]) {
    assert.notEqual(changed, html, 'the unsupported transform must be present');
    fs.writeFileSync(output, changed);
    assert.equal(check(output).report.composition.sequenceColumnSpace.measured, false);
  }
});

test('small conversations and a compact fixed canvas are not advised to stretch', t => {
  for (const count of [2, 3]) {
    const { output } = render(t, sequence(count));
    const space = check(output).report.composition.sequenceColumnSpace;
    assert.equal(space.measured, true);
    assert.equal(space.reviewSuggested, false);
  }
  const compact = sequence();
  compact.meta.viewBox = [700, 690];
  assert.equal(check(render(t, compact).output).report.composition.sequenceColumnSpace.reviewSuggested, false);
});

test('meaningful CJK message labels and notes occupy the right-hand region', t => {
  for (const field of ['label', 'note']) {
    const spec = sequence();
    spec.messages = [{ from: 'p4', to: 'p5', y: 200, label: '结果', [field]: '这是需要保留的中文说明'.repeat(field === 'label' ? 4 : 3) }];
    const { report } = check(render(t, spec).output);
    const space = report.composition.sequenceColumnSpace;
    assert.equal(space.measured, true);
    assert.ok(space.occupiedRight > 810);
    assert.equal(space.reviewSuggested, false, `${field} reserves the apparent blank area`);
  }
});

test('segment frames are structural but their text still reserves width', t => {
  const spec = sequence();
  spec.segments = [{ label: 'Worker phase', from: 170, to: 260 }];
  const { report } = check(render(t, spec).output);
  assert.equal(report.composition.sequenceColumnSpace.reviewSuggested, true);
});

test('unknown, transformed and unmarked artifacts do not invite a column repair', t => {
  const { output, html } = render(t, sequence());
  for (const changed of [
    html.replace(' data-sequence-column-fit="fixed"', ''),
    html.replace('data-sequence-column-fit="fixed"', 'data-sequence-column-fit="unknown"'),
    html.replace('<svg viewBox=', '<svg transform="translate(12 0)" viewBox='),
    html.replace('<g id="node-p5"', '<g transform="translate(300 0)" id="node-p5"'),
  ]) {
    fs.writeFileSync(output, changed);
    const space = check(output).report.composition.sequenceColumnSpace;
    assert.notEqual(space?.reviewSuggested, true);
  }
});
