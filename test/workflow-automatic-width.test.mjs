import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';
import { intrinsicWorkflow } from '../archify/renderers/workflow/workflow-migration-geometry.mjs';
import { migrateWorkflowDocument } from '../archify/migrations/workflow-v2.mjs';

function lendingWorkflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Library lending', locale: 'en', quality_profile: 'showcase', output: 'library-lending.html' },
    lanes: [{ id: 'desk', label: 'Library lending: verify the borrower record, confirm membership is current, check borrowing limits, and approve available books for loan' }],
    nodes: [
      { id: 'verify', lane: 'desk', col: 0, type: 'backend', label: 'Verify', sublabel: 'Review borrower records' },
      { id: 'lend', lane: 'desk', col: 1, type: 'backend', label: 'Lend' },
    ],
    edges: [{ id: 'eligible', from: 'verify', to: 'lend', label: 'eligible' }],
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const widthOf = (result, id) => result.receipt.nodes.find((node) => node.id === id).width;

function compileSuccessfully(workflow, qualityProfile) {
  const result = compileWorkflow({ workflow, qualityProfile });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}

function assertReadableSublabels(result) {
  // The desktop contract has a 930px diagram budget and a 6px projected floor.
  const minimum = Math.max(6, Math.ceil(6 * result.receipt.viewBox[0] / 930 * 10) / 10);
  const rows = [...result.svg.matchAll(/data-detail="context"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)<\/text>/g)];
  assert.ok(rows.length);
  for (const [, font] of rows) assert.ok(Number(font) >= minimum && Number(font) <= 8);
}

function cascadeWorkflow(labelLength = 21) {
  const workflow = lendingWorkflow();
  workflow.meta.legend = { mode: 'hidden' };
  workflow.lanes[0].label = 'Desk';
  workflow.nodes = Array.from({ length: 6 }, (_, col) => ({
    id: `n${col}`, lane: 'desk', col, type: 'backend',
    label: col < 2 ? 'Step' : 'A'.repeat(labelLength),
    ...(col === 0 ? { sublabel: 'Review borrower records' } : {}),
    ...(col === 1 ? { sublabel: 'Check borrower records' } : {}),
  }));
  workflow.edges = Array.from({ length: 5 }, (_, index) => ({ id: `e${index}`, from: `n${index}`, to: `n${index + 1}` }));
  return workflow;
}

test('omitted workflow widths fit sublabels at the final showcase canvas minimum', () => {
  const workflow = lendingWorkflow();
  const before = JSON.stringify(workflow);
  const result = compileWorkflow({ workflow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(JSON.stringify(workflow), before);
  const verify = result.receipt.nodes.find(({ id }) => id === 'verify');
  assert.ok(verify.width > 92 && verify.width <= 200);
  assert.match(result.svg, />Review borrower records<\/text>/);
  assert.equal(result.receipt.edges.length, 1);
  assert.equal(result.receipt.nodes.length, 2);
  assertReadableSublabels(result);
});

test('automatic width feedback handles a new sublabel failure caused by the first batch', () => {
  // Original canvas is 976px: n0 needs 6.3px, while n1 still fits. Growing n0
  // crosses the 6.4px boundary and requires n1 to grow in the next epoch.
  const workflow = cascadeWorkflow();
  const before = JSON.stringify(workflow);
  const result = compileSuccessfully(workflow);
  assert.ok(widthOf(result, 'n0') > 92);
  assert.ok(widthOf(result, 'n1') > 92);
  assert.ok(result.receipt.nodes.every(({ width }) => width <= 200));
  assertReadableSublabels(result);
  assert.equal(JSON.stringify(workflow), before);
});

test('a mixed document repairs automatic widths and preserves explicit widths and endpoint sides', () => {
  const workflow = lendingWorkflow();
  workflow.nodes[1].width = 108;
  Object.assign(workflow.edges[0], { fromSide: 'right', toSide: 'left' });
  const result = compileSuccessfully(workflow);
  assert.ok(widthOf(result, 'verify') > 92);
  assert.equal(widthOf(result, 'lend'), 108);
  assert.equal(workflow.nodes[0].width, undefined);
  assert.equal(workflow.nodes[1].width, 108);
  assertReadableSublabels(result);

  // Keep a real explicit failure after repairing the other node. The source
  // order differs from canonical rank order, so its JSON pointer must still
  // name the authored node rather than the sorted clone's index.
  workflow.nodes[1].width = 92;
  workflow.nodes[1].sublabel = 'Review borrower records';
  workflow.nodes.reverse();
  const before = JSON.stringify(workflow);
  const mixedFailure = compileWorkflow({ workflow });
  assert.equal(mixedFailure.ok, false);
  assert.ok(widthOf(mixedFailure, 'verify') > 92);
  assert.equal(widthOf(mixedFailure, 'lend'), 92);
  assert.deepEqual(mixedFailure.diagnostics.map(({ subject }) => [subject.node, subject.path]), [['lend', '/nodes/0/sublabel']]);
  assert.equal(JSON.stringify(workflow), before);
});

test('same-object edits and quality overrides agree with a fresh input after every compile', () => {
  const workflow = lendingWorkflow();
  const check = (qualityProfile) => {
    const before = JSON.stringify(workflow);
    const reused = compileWorkflow({ workflow, qualityProfile });
    assert.deepEqual(reused, compileWorkflow({ workflow: clone(workflow), qualityProfile }));
    assert.equal(JSON.stringify(workflow), before);
    return reused;
  };
  workflow.nodes[0].sublabel = 'Review';
  assert.equal(widthOf(check(), 'verify'), 92);
  workflow.nodes[0].sublabel = 'Review borrower records';
  assert.ok(widthOf(check(), 'verify') > 92);
  workflow.nodes[0].sublabel = 'Review';
  assert.equal(widthOf(check(), 'verify'), 92);
  workflow.nodes[0].sublabel = 'Review borrower records';
  workflow.meta.quality_profile = 'standard';
  assert.ok(widthOf(check('showcase'), 'verify') > 92);
  assert.equal(widthOf(check('standard'), 'verify'), 92);
  workflow.meta.quality_profile = 'showcase';
  workflow.nodes[0].width = 92;
  assert.equal(check().ok, false);
  delete workflow.nodes[0].width;
  assert.equal(check().ok, true);
  workflow.meta.viewBox = [1000, 420];
  assert.equal(widthOf(check(), 'verify'), 92);
  delete workflow.meta.viewBox;
  assert.equal(check().ok, true);
  for (const pin of [{ via: [[300, 100]] }, { labelAt: [200, 100] }, { channelX: 200 }, { channelY: 100 }]) {
    Object.assign(workflow.edges[0], pin);
    assert.equal(check().ok, false);
    for (const key of Object.keys(pin)) delete workflow.edges[0][key];
    assert.equal(check().ok, true);
  }
  workflow.schema_version = 1;
  check();
  workflow.schema_version = 2;
  assert.equal(check().ok, true);
});

test('migration absolute-geometry policy survives eligibility checks before cloning', () => {
  const original = lendingWorkflow();
  original.meta.viewBox = [1000, 420];
  const planned = intrinsicWorkflow(original);
  assert.equal(planned.meta.viewBox, undefined);
  const result = compileWorkflow({ workflow: planned });
  assert.equal(result.ok, false);
  assert.equal(widthOf(result, 'verify'), 92);
  assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/sublabel-readability'));
});

test('public migration verifies overlap advice under the original geometry policy', () => {
  const authored = lendingWorkflow();
  authored.schema_version = 1;
  authored.meta.viewBox = [1000, 420];
  authored.nodes[1].col = 0;
  const before = JSON.stringify(authored);
  const migration = migrateWorkflowDocument(authored);
  assert.equal(migration.ok, false);
  assert.equal(JSON.stringify(authored), before);
  const overlap = migration.newSchemaDiagnostics.find(({ code }) => code === 'workflow/node-overlap');
  assert.ok(overlap);

  // Applying the free-column edit still leaves the public migration blocked;
  // that edit alone must not be advertised as a verified repair.
  const edited = clone(authored);
  edited.nodes[1].col = 1;
  const editedBefore = JSON.stringify(edited);
  const appliedMigration = migrateWorkflowDocument(edited);
  assert.equal(appliedMigration.ok, false);
  assert.ok(appliedMigration.newSchemaDiagnostics.some(({ code }) => code === 'workflow/sublabel-readability'));
  assert.equal(JSON.stringify(edited), editedBefore);
  const applied = compileWorkflow({ workflow: intrinsicWorkflow(edited) });
  assert.equal(applied.ok, false);
  assert.equal(widthOf(applied, 'verify'), 92);
  assert.ok(applied.diagnostics.some(({ code }) => code === 'workflow/sublabel-readability'));
  assert.deepEqual(overlap.supportedFixes, []);
});

test('ordinary authored canvas removal advice can still verify an automatic-width repair', () => {
  const authored = lendingWorkflow();
  authored.meta.viewBox = [800, 420];
  const before = JSON.stringify(authored);
  const result = compileWorkflow({ workflow: authored });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(authored), before);
  const capacity = result.diagnostics.find(({ code }) => code === 'workflow/viewbox-capacity');
  assert.ok(capacity);
  assert.ok(capacity.supportedFixes.includes('omit meta.viewBox so the compiler can use its measured intrinsic canvas'));
  delete authored.meta.viewBox;
  const applied = compileSuccessfully(authored);
  assert.equal(widthOf(applied, 'verify'), 96);
});

test('explicit undersizing, automatic capacity and the fixed text-row ceiling remain failures', () => {
  const explicit = lendingWorkflow();
  explicit.nodes[0].width = 92;
  const explicitResult = compileWorkflow({ workflow: explicit });
  assert.equal(explicitResult.ok, false);
  assert.equal(widthOf(explicitResult, 'verify'), 92);
  assert.equal(explicitResult.diagnostics[0].code, 'workflow/sublabel-readability');

  const capacity = lendingWorkflow();
  capacity.nodes[0].sublabel = 'x'.repeat(53);
  const capResult = compileWorkflow({ workflow: capacity });
  assert.equal(capResult.ok, false);
  assert.equal(widthOf(capResult, 'verify'), 200);
  assert.ok(capResult.diagnostics.some(({ code, evidence }) => code === 'workflow/sublabel-readability'
    && evidence.requiredFontPx <= 8 && evidence.requiredTextWidthPx > evidence.availableTextWidthPx));

  const rowCeiling = cascadeWorkflow();
  for (const node of rowCeiling.nodes.slice(2)) node.width = 400;
  const rowResult = compileWorkflow({ workflow: rowCeiling });
  assert.equal(rowResult.ok, false);
  assert.equal(widthOf(rowResult, 'n0'), 92);
  assert.ok(rowResult.diagnostics.some(({ code, evidence }) => code === 'workflow/sublabel-readability' && evidence.requiredFontPx > 8));
});

test('already successful automatic and preserved-geometry output keeps exact baseline bytes', () => {
  // Captured from e80d489 / compiler 611550d1 before this repair. These bytes
  // protect the error-only compatibility promise, not a new automatic layout.
  const cases = [
    [(w) => { w.nodes[0].sublabel = 'Review'; }, 'b92b134384403165ea109af78c863c2a3e75fb5e77f9642f219aa69a158443ab', '534b97cba075f71755547834250d05b71a12c56b01c66dde92b39abced0cf540'],
    [(w) => { w.nodes[0].sublabel = 'Review borrower records and loan eligibility'; }, '989036d464c2f2e32d48efd3368fd74ffd55c0d54dd22f459d87bea3f24840d7', '87d8b7618a419fcb4947e1d48c7d8217e2e116de259e79bcc5b7e362b3ae7e61'],
    [(w) => { w.meta.quality_profile = 'standard'; }, 'b39439ec2a8e885ed645203f73525850b660757b87b6ed8b8af90c6e50730763', '534b97cba075f71755547834250d05b71a12c56b01c66dde92b39abced0cf540'],
    [(w) => { w.meta.viewBox = [1000, 420]; }, 'f92bddb54c34b69d0fc50a9dea7f2dd78570bb004c46d2e3cd9bbebbde3fde95', 'fbcb1e66f972c89f9f56bba923766b0adc3f11c3d300739c50f3ef7d7855d606'],
    [(w) => { w.nodes[0].width = 104; }, '2db4c04e21e24e2b995044fcc7039f55f0769561684ddcef508025fa87f29400', '974133d390cdfbaa38658000eb01dece4860fd98c242159c6ff0e9afc290f56e'],
  ];
  for (const [edit, svgHash, receiptHash] of cases) {
    const workflow = lendingWorkflow();
    edit(workflow);
    const result = compileSuccessfully(workflow);
    assert.equal(digest(result.svg), svgHash);
    assert.equal(digest(JSON.stringify(result.receipt)), receiptHash);
  }
});
