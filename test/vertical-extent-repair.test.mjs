import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The data-flow vertical bounds used to fail with one generic layout/constraint
// diagnostic whose only guidance was the parenthetical inside the message —
// `(adjust row/yOffset or increase meta.viewBox[1])` — and whose
// supportedFixes was empty (#468). The two bounds are now reported
// independently with measured evidence and an ordered repair list, and the
// canvas raise is offered only while the raised page still fits the target
// viewport: a data-flow canvas with an authored meta.viewBox gets no
// readable-scroll exception, so a raise that cannot fit would fail
// visual-check one command later. The raise also names the height range that
// fits, and a bound that no single change clears says so rather than offering
// a change that does not clear it. These regressions pin the contract, the
// ordering, the bounded range, and the rule that every offered fix clears the
// bound it is attached to.

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-vertical-extent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeSpec(directory, name, spec) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  return file;
}

function validate(type, input) {
  const result = spawnSync(process.execPath, [cli, 'validate', type, input, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function edited(spec, mutate) {
  const copy = JSON.parse(JSON.stringify(spec));
  mutate(copy);
  return copy;
}

// A node can cross both bounds at once, so this returns every vertical-extent
// diagnostic rather than one. A receipt that passes carries no diagnostics at
// all.
function extentDiagnostics(receipt) {
  return (receipt.diagnostics || [])
    .filter(entry => /readable diagram area/.test(entry.message));
}

function onlyExtent(receipt) {
  const found = extentDiagnostics(receipt);
  assert.equal(found.length, 1, JSON.stringify(receipt.diagnostics, null, 2));
  return found[0];
}

function exampleDataflow() {
  const example = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/product-analytics.dataflow.json'), 'utf8'));
  delete example.meta.views;
  return example;
}

test('dataflow: a node below the area reports the repair contract and the raise fits', t => {
  const cwd = workspace(t);
  // Row 3 starts at y = 470; the node's 58px height crosses the 446px area
  // bottom. Raising the canvas to 602 keeps the canvas at ratio 1.79, and the
  // largest height the page still accepts at this width is 696, so the raise is
  // offered as a bounded range on its own.
  const example = exampleDataflow();
  example.meta.viewBox = [1080, 520];
  example.nodes.find(node => node.id === 'mobile').row = 3;
  const receipt = validate('dataflow', writeSpec(cwd, 'overflow.dataflow.json', example));

  assert.equal(receipt.ok, false);
  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'dataflow/node-below-area');
  assert.deepEqual(diagnostic.subject, { diagramType: 'dataflow', node: 'mobile' });
  assert.match(diagnostic.message, /keep y within \[104, 388\] so that y \+ height does not pass 446/);
  assert.match(diagnostic.message, /Raising meta\.viewBox\[1\] to at least 602 and at most 696 also fits it and still fits the target viewport/);

  assert.equal(diagnostic.evidence.y, 470);
  assert.equal(diagnostic.evidence.height, 58);
  assert.equal(diagnostic.evidence.areaBottom, 446);
  assert.equal(diagnostic.evidence.requiredViewBoxHeight, 602);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, true);
  assert.equal(diagnostic.evidence.maximumViewBoxHeight, 696);
  assert.equal('requiredViewBoxPageHeightPx' in diagnostic.evidence, false);
  assert.equal(diagnostic.evidence.viewBoxHeight, 520);
  assert.equal(diagnostic.supportedFixes.length, 2);
  assert.match(diagnostic.supportedFixes[0], /lower yOffset on node "mobile"/);
  assert.match(diagnostic.supportedFixes[1], /raise meta\.viewBox\[1\] to at least 602 and at most 696, then rerun deliver and visual-check/);

  // The offered canvas height and the offered yOffset move each clear this
  // diagnostic. Relocating the node also reroutes its flows, so the repaired
  // spec is not expected to be fully green.
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'raised.dataflow.json', edited(example, copy => {
    copy.meta.viewBox = [1080, 602];
  })))), [], 'the offered canvas height must clear the diagnostic');
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'lowered.dataflow.json', edited(example, copy => {
    copy.nodes.find(node => node.id === 'mobile').yOffset = -82;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: the canvas raise is dropped when the raised page cannot fit the viewport', t => {
  const cwd = workspace(t);
  // Same canvas as the case above, but the node is 156px tall, so the raise
  // needed to fit it is 700 — above the 696 ceiling at this width, ratio 1.54,
  // below the wide threshold, with a predicted 998px page at 1440x900. The
  // raise cannot stand on its own, so only the compaction repairs are offered.
  const example = exampleDataflow();
  example.meta.viewBox = [1080, 520];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 3;
  node.height = 156;
  const receipt = validate('dataflow', writeSpec(cwd, 'overflow-tall.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'dataflow/node-below-area');
  assert.equal(diagnostic.evidence.requiredViewBoxHeight, 700);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, false);
  assert.equal(diagnostic.evidence.maximumViewBoxHeight, 696);
  assert.equal(diagnostic.evidence.requiredViewBoxPageHeightPx, 998);
  assert.match(diagnostic.message, /keep y within \[104, 290\] so that y \+ height does not pass 446/);
  assert.match(diagnostic.message, /Raising meta\.viewBox\[1\] to 700 would fit the node, but the page then reaches at least ~998px in the 1440x900 viewport, so the raise cannot stand on its own — compact the node instead/);
  // Moving the node up is the repair that reaches this bound; the height
  // shrink that alone would clear it needs a height below the 36px schema
  // minimum, so it is not offered either.
  assert.deepEqual(diagnostic.supportedFixes, ['lower yOffset on node "mobile"']);

  // The offered yOffset move clears the diagnostic.
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'compacted.dataflow.json', edited(example, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').yOffset = -180;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: a node above the area offers only the yOffset move', t => {
  const cwd = workspace(t);
  const example = exampleDataflow();
  example.nodes.find(node => node.id === 'mobile').yOffset = -300;
  const receipt = validate('dataflow', writeSpec(cwd, 'above.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'dataflow/node-above-area');
  assert.deepEqual(diagnostic.subject, { diagramType: 'dataflow', node: 'mobile' });
  assert.match(diagnostic.message, /starts above the readable diagram area/);
  assert.equal(diagnostic.evidence.areaTop, 104);
  assert.equal(diagnostic.evidence.y, 56);
  assert.equal(diagnostic.evidence.yOffset, -300);
  assert.equal(diagnostic.supportedFixes.length, 1);
  assert.match(diagnostic.supportedFixes[0], /negative yOffset on node "mobile"/);
  assert.doesNotMatch(diagnostic.supportedFixes.join(' '), /height|viewBox/);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'repaired.dataflow.json', edited(example, copy => {
    copy.nodes.find(node => node.id === 'mobile').yOffset = 0;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: a node taller than the area drops the yOffset move and reports both bounds', t => {
  const cwd = workspace(t);
  const example = exampleDataflow();
  example.meta.viewBox = [940, 720];
  // Row 4 starts at y = 584, so this node spans [60, 660]: past the top bound
  // (104) and past the bottom bound (646) at once, and taller than the 542px
  // between them, so no yOffset can fit it.
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 4;
  node.height = 600;
  node.yOffset = -524;
  const receipt = validate('dataflow', writeSpec(cwd, 'both.dataflow.json', example));

  const found = extentDiagnostics(receipt);
  assert.equal(found.length, 2, JSON.stringify(receipt.diagnostics, null, 2));
  const [above, below] = found;
  assert.equal(above.code, 'dataflow/node-above-area');
  assert.equal(above.evidence.y, 60);
  assert.equal(below.code, 'dataflow/node-below-area');
  // A node that cannot fit between the bounds is told so, rather than given an
  // inverted y range.
  assert.match(below.message, /it is taller than the area from y = 104 to y = 646, so no yOffset can fit it — reduce node height to at most 542 and keep y within \[104, 104\] so that y \+ height does not pass 646/);
  assert.equal(below.evidence.requiredViewBoxHeight, 734);
  assert.equal(below.evidence.requiredViewBoxFitsViewport, false);

  // No yOffset can fit a node taller than the area, so the below-area
  // diagnostic does not offer the move; reducing height is what reaches it,
  // and the offered shrink clears the below bound while the above bound (which
  // height cannot repair) remains.
  assert.deepEqual(below.supportedFixes, ['reduce node "mobile" height to at most 542']);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'fixed.dataflow.json', edited(example, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').height = 542;
  })))).map(entry => entry.message), [above.message]);
});

test('dataflow: a repair that would need an illegal height is not offered', t => {
  const cwd = workspace(t);
  // Row 4 plus a +27 yOffset puts the node top at 611; the height shrink that
  // would clear the 646 bottom bound needs a height of 35, below the schema
  // minimum of 36, so only the yOffset move is offered. The raise would not
  // fit the page either.
  const example = exampleDataflow();
  example.meta.viewBox = [940, 720];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 4;
  node.height = 36;
  node.yOffset = 27;
  const receipt = validate('dataflow', writeSpec(cwd, 'illegal-height.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.evidence.areaBottom, 646);
  assert.equal(diagnostic.evidence.y, 611);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, false);
  assert.match(diagnostic.message, /keep y within \[104, 610\] so that y \+ height does not pass 646/);
  assert.equal(diagnostic.supportedFixes.length, 1);
  assert.match(diagnostic.supportedFixes[0], /lower yOffset on node "mobile"/);
  assert.doesNotMatch(diagnostic.supportedFixes.join(' '), /height|viewBox/);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'legal.dataflow.json', edited(example, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').yOffset = 0;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: a bound no single change clears says so and names the pair', t => {
  const cwd = workspace(t);
  // Row 4 (y = 584) plus a +30 yOffset puts the node top at 614 with a 600px
  // height: taller than the 542px area, and at y = 614 even the 36px schema
  // minimum would cross the 646 bottom bound, so shrinking to any legal height
  // still fails and no yOffset can fit it. The raise is dropped too (the
  // required 1288 is far above the 606 ceiling at this width).
  const example = exampleDataflow();
  example.meta.viewBox = [940, 720];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 4;
  node.height = 600;
  node.yOffset = 30;
  const receipt = validate('dataflow', writeSpec(cwd, 'no-single-fix.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'dataflow/node-below-area');
  assert.equal(diagnostic.evidence.y, 614);
  assert.equal(diagnostic.evidence.areaBottom, 646);
  assert.equal(diagnostic.evidence.requiredViewBoxHeight, 1288);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, false);
  assert.equal(diagnostic.evidence.maximumViewBoxHeight, 606);
  assert.match(diagnostic.message, /sits too low for any legal height, so no single change clears this bound — reduce node height to at most 542 and move it up so that y \+ height does not pass 646/);
  // No single repair reaches the bound, so none is offered; the message names
  // the pair that does. Applying both clears it, and the node parks exactly on
  // the top bound (y = 104).
  assert.deepEqual(diagnostic.supportedFixes, []);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'paired.dataflow.json', edited(example, copy => {
    const fixed = copy.nodes.find(entry => entry.id === 'mobile');
    fixed.height = 542;
    fixed.yOffset = -480;
  })))), [], 'the paired changes must clear the diagnostic');
});

test('dataflow: the repair list keeps yOffset, then the height cap, then the bounded raise', t => {
  const cwd = workspace(t);
  // Row 2 (y = 356) plus a +44 yOffset puts the node top at 400 with a 60px
  // height: all three repairs clear the 446 bound — the yOffset move, the 46px
  // height cap at this y, and a canvas raise whose range ends at the 696
  // ceiling.
  const example = exampleDataflow();
  example.meta.viewBox = [1080, 520];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 2;
  node.height = 60;
  node.yOffset = 44;
  const receipt = validate('dataflow', writeSpec(cwd, 'three-fixes.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.evidence.requiredViewBoxHeight, 534);
  assert.equal(diagnostic.evidence.maximumViewBoxHeight, 696);
  assert.deepEqual(diagnostic.supportedFixes, [
    'lower yOffset on node "mobile"',
    'reduce node "mobile" height to at most 46',
    'raise meta.viewBox[1] to at least 534 and at most 696, then rerun deliver and visual-check',
  ]);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'capped.dataflow.json', edited(example, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').height = 46;
  })))), [], 'the offered height cap must clear the diagnostic');
});

test('dataflow: the height cap stays inside the area and names the y range at the cap', t => {
  const cwd = workspace(t);
  // Row 4 (y = 584) with a 600px height: taller than the 542px area, so no
  // yOffset fits it, and at y = 584 the clearing cap is 62 — the room below
  // the node, not the room between the bounds. The message names both the cap
  // and the y range that pairs with it, so following it cannot re-break the
  // bound from the other side.
  const example = exampleDataflow();
  example.meta.viewBox = [940, 720];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 4;
  node.height = 600;
  const receipt = validate('dataflow', writeSpec(cwd, 'tight-cap.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.evidence.y, 584);
  assert.equal(diagnostic.evidence.areaBottom, 646);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, false);
  assert.match(diagnostic.message, /reduce node height to at most 62 and keep y within \[104, 584\] so that y \+ height does not pass 646/);
  assert.deepEqual(diagnostic.supportedFixes, ['reduce node "mobile" height to at most 62']);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'capped-tight.dataflow.json', edited(example, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').height = 62;
  })))), [], 'the offered height cap must clear the diagnostic');
});

test('dataflow: a raise whose target equals the ceiling is stated as a single value', t => {
  const cwd = workspace(t);
  // Row 3 (y = 470) with a 62px height needs 532 + 74 = 606 — exactly the
  // ceiling at this width — so the raise is stated as one value instead of a
  // range, and the ceiling itself is still a fitting target.
  const example = exampleDataflow();
  example.meta.viewBox = [940, 520];
  const node = example.nodes.find(entry => entry.id === 'mobile');
  node.row = 3;
  node.height = 62;
  const receipt = validate('dataflow', writeSpec(cwd, 'at-ceiling.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.evidence.requiredViewBoxHeight, 606);
  assert.equal(diagnostic.evidence.maximumViewBoxHeight, 606);
  assert.equal(diagnostic.evidence.requiredViewBoxFitsViewport, true);
  assert.match(diagnostic.message, /Raising meta\.viewBox\[1\] to 606 also fits it and still fits the target viewport/);
  assert.doesNotMatch(diagnostic.message, /at most/);
  assert.deepEqual(diagnostic.supportedFixes, [
    'lower yOffset on node "mobile"',
    'raise meta.viewBox[1] to 606, then rerun deliver and visual-check',
  ]);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'at-ceiling-raised.dataflow.json', edited(example, copy => {
    copy.meta.viewBox = [940, 606];
  })))), [], 'the ceiling itself must clear the diagnostic');
});
