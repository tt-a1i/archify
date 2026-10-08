import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compactFinalizeReceipt } from '../archify/bin/finalize.mjs';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
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
  const spec = sequence();
  spec.meta.column_fit = 'fixed';
  const original = render(t, spec);
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
  spec.meta.column_fit = 'fixed';
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

test('an automatic six-column canvas spreads by default while explicit fixed keeps its geometry', t => {
  const spec = sequence();
  delete spec.meta.viewBox;
  const automatic = render(t, spec);
  const automaticCheck = check(automatic.output);
  assert.equal(automaticCheck.exitCode, 0);
  const space = automaticCheck.report.composition.sequenceColumnSpace;
  assert.equal(space.columnFit, 'spread');
  assert.equal(space.participantCount, 6);
  assert.equal(space.canvasWidth, 920);
  assert.equal(space.occupiedRight, 880);
  assert.equal(space.emptyRightPx, 40);
  assert.equal(space.reviewSuggested, false);
  spec.meta.column_fit = 'spread';
  assert.equal(render(t, spec).html, automatic.html, 'automatic default matches explicit spread');
  spec.meta.column_fit = 'fixed';
  const fixed = render(t, spec);
  const fixedCheck = check(fixed.output);
  assert.equal(fixedCheck.exitCode, 0);
  assert.equal(fixedCheck.report.composition.sequenceColumnSpace.occupiedRight, 645);
  assert.equal(fixedCheck.report.composition.sequenceColumnSpace.emptyRightPx, 275);
  assert.equal(fixedCheck.report.composition.sequenceColumnSpace.reviewSuggested, true);
  const nodes = html => [...html.matchAll(/<g id="node-([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(nodes(automatic.html), nodes(fixed.html));
  assert.ok(automatic.html.includes('>请求结果</text>'));
});

test('explicit fixed retains historical coordinates and advice preserves authored intent', t => {
  const spec = sequence();
  spec.meta.column_fit = 'fixed';
  const explicit = render(t, spec);
  assert.match(explicit.html, /<rect x="19" y="72" width="86"/);
  assert.equal(check(explicit.output).report.composition.sequenceColumnSpace.occupiedRight, 645);
  const compact = summary(check(explicit.output).report);
  assert.match(compact.layoutReviewRecommendation.repair, /Retain intentional fixed layouts/);
  assert.equal(JSON.parse(fs.readFileSync(explicit.input)).meta.column_fit, 'fixed');
});

test('participant brand marks retain width advice while unrelated transforms remain unmeasured', t => {
  const spec = sequence();
  spec.meta.column_fit = 'fixed';
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
  compact.meta.column_fit = 'fixed';
  assert.equal(check(render(t, compact).output).report.composition.sequenceColumnSpace.reviewSuggested, false);
});

test('meaningful CJK message labels and notes occupy the right-hand region', t => {
  for (const field of ['label', 'note']) {
    const spec = sequence();
    spec.meta.column_fit = 'fixed';
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
  spec.meta.column_fit = 'fixed';
  spec.segments = [{ label: 'Worker phase', from: 170, to: 260 }];
  const { report } = check(render(t, spec).output);
  assert.equal(report.composition.sequenceColumnSpace.reviewSuggested, true);
});

test('unknown, transformed and unmarked artifacts do not invite a column repair', t => {
  const spec = sequence();
  spec.meta.column_fit = 'fixed';
  const { output, html } = render(t, spec);
  for (const changed of [
    html.replace(' data-sequence-column-fit="fixed"', ''),
    html.replace('data-sequence-column-fit="fixed"', 'data-sequence-column-fit="unknown"'),
    html.replace('<svg viewBox=', '<svg transform="translate(12 0)" viewBox='),
    html.replace('<g id="node-p5"', '<g transform="translate(300 0)" id="node-p5"'),
  ]) {
    assert.notEqual(changed, html, 'the unsupported marker or transform must be present');
    fs.writeFileSync(output, changed);
    const space = check(output).report.composition.sequenceColumnSpace;
    assert.notEqual(space?.reviewSuggested, true);
  }
});


test('an authored six-column canvas spreads by default without a width repair', t => {
  const spec = sequence();
  const original = render(t, spec);
  const { report, exitCode } = check(original.output);
  assert.equal(exitCode, 0);
  assert.equal(report.composition.sequenceColumnSpace.columnFit, 'spread');
  assert.equal(report.composition.sequenceColumnSpace.occupiedRight, 1040);
  assert.equal(report.composition.sequenceColumnSpace.reviewSuggested, false);
  assert.equal(summary(report).layoutReviewRecommendation, undefined);
  spec.meta.column_fit = 'spread';
  assert.equal(render(t, spec).html, original.html);
});


test('public finalize preserves a passing fixed candidate and publishes a reversible width-review recommendation', {
  skip: !process.env.ARCHIFY_CHROME ? 'Set ARCHIFY_CHROME for public finalize browser checks' : false,
}, t => {
  const spec = sequence();
  spec.meta.column_fit = 'fixed';
  const original = render(t, spec);
  const inputBytes = fs.readFileSync(original.input);
  const outDir = path.join(path.dirname(original.input), 'fixed-evidence');
  const result = spawnSync(process.execPath, [cli, 'finalize', 'sequence', original.input, original.output,
    '--quality', 'showcase', '--out-dir', outDir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const compact = JSON.parse(result.stdout);
  assert.equal(compact.status, 'pass');
  assert.equal(compact.gates['browser-check'], 'pass');
  assert.deepEqual(compact.diagnostics, []);
  const advice = compact.layoutReviewRecommendation;
  assert.equal(advice.action, 'inspect-sequence-width');
  assert.equal(advice.evidence.columnFit, 'fixed');
  assert.match(advice.repair, /Only when changing that geometry is authorized, save the passing fixed candidate/);
  assert.match(advice.repair, /set only meta.column_fit to "spread".*complete finalize once with --out-dir <folder>\/width-review/);
  assert.match(advice.repair, /If that attempt fails, restore the saved candidate and finalize it with --out-dir <folder>\/width-restore/);
  assert.match(advice.repair, /report the remaining suggestion instead of iterating/);
  assert.match(advice.repair, /participant order, every message, its y position, labels, notes, sources and canvas dimensions/);
  assert.deepEqual(JSON.parse(fs.readFileSync(compact.evidence.summaryReceipt, 'utf8')).layoutReviewRecommendation, advice,
    'persisted public summary carries the same recovery instructions as stdout');
  assert.deepEqual(fs.readFileSync(original.input), inputBytes, 'advice leaves the passing fixed candidate unchanged');
  assert.match(fs.readFileSync(original.output, 'utf8'), /data-sequence-column-fit="fixed"/);
});
