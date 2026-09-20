import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Vertical-extent failures used to recommend raising meta.viewBox[1] and
// nothing else, and carried an empty supportedFixes list. The raise does clear
// the layout check, but the canvas is also the reader's printed page, so it can
// push the delivered artifact past the target viewport and fail visual-check
// one command later (#468). These regressions pin the conflict, the ordering,
// and the rule that every offered fix clears the bound it is attached to.

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');

const lifecycleSpec = {
  schema_version: 1,
  diagram_type: 'lifecycle',
  meta: {
    title: 'Vertical extent regression',
    output: 'regression.html',
    viewBox: [900, 585],
    quality_profile: 'standard',
  },
  lanes: [{ id: 'main', label: 'Pipeline' }, { id: 'side', label: 'Recovery' }],
  states: [
    { id: 'ingest', lane: 'main', col: 2, label: 'Ingest', type: 'start', sublabel: 'Accepted' },
    { id: 'store', lane: 'main', col: 3, label: 'Store', type: 'active', sublabel: 'Durable' },
    { id: 'replay', lane: 'side', col: 1, label: 'Replay', type: 'waiting', sublabel: 'Backoff', yOffset: 200 },
  ],
  transitions: [
    { id: 'ingest-store', from: 'ingest', to: 'store', route: 'straight', label: 'write', labelDy: -30 },
    { id: 'store-replay', from: 'store', to: 'replay', route: 'straight', label: 'requeue', labelAt: [680, 345] },
  ],
  cards: [{ dot: 'cyan', title: 'Notes', items: ['Ingest accepts one document', 'Replay runs on failure'] }],
};

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

// A state or node can cross both bounds at once, so this returns every
// vertical-extent diagnostic rather than one. A receipt that passes carries no
// diagnostics at all.
function extentDiagnostics(receipt) {
  return (receipt.diagnostics || [])
    .filter(entry => /vertical lifecycle area|readable diagram area/.test(entry.message));
}

function onlyExtent(receipt) {
  const found = extentDiagnostics(receipt);
  assert.equal(found.length, 1, JSON.stringify(receipt.diagnostics, null, 2));
  return found[0];
}

test('lifecycle: a state below the area names the page conflict and offers verified fixes', t => {
  const cwd = workspace(t);
  const input = writeSpec(cwd, 'overflow.lifecycle.json', lifecycleSpec);
  const receipt = validate('lifecycle', input);

  assert.equal(receipt.ok, false);
  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'layout/constraint');
  assert.deepEqual(diagnostic.subject, { diagramType: 'lifecycle', state: 'replay' });
  assert.equal(diagnostic.severity, 'error');

  // The conflict is named in the message instead of being discovered later,
  // and the bound is stated for y rather than for y + height, so following it
  // cannot still fail.
  assert.match(diagnostic.message, /keep y within \[64, 405\] so that y \+ height does not pass 463/);
  assert.match(diagnostic.message, /Raising meta\.viewBox\[1\] to at least 658/);
  assert.match(diagnostic.message, /page still fits the target viewport/);

  // This state's top edge is already past the bottom bound, so reducing its
  // height cannot bring it back: only the two offered moves can.
  assert.equal(diagnostic.evidence.y, 478);
  assert.equal(diagnostic.evidence.areaBottom, 463);
  assert.equal(diagnostic.supportedFixes.length, 2);
  assert.match(diagnostic.supportedFixes[0], /lower yOffset on state "replay"/);
  assert.match(diagnostic.supportedFixes[1], /target viewport/);
  assert.match(diagnostic.supportedFixes[1], /visual-check/);

  // The reported height is the documented reserve above the state's bottom
  // edge, and it is exactly sufficient: one unit less still fails.
  const required = diagnostic.evidence.requiredViewBoxHeight;
  assert.equal(required, 658);
  assert.equal(required, diagnostic.evidence.y + diagnostic.evidence.height + 122);
  assert.equal(validate('lifecycle', writeSpec(cwd, 'short.lifecycle.json', edited(lifecycleSpec, spec => {
    spec.meta.viewBox = [900, required - 1];
  }))).ok, false, 'the offered height must be minimal, not merely generous');

  // Every offered fix clears the diagnostic on its own.
  assert.equal(validate('lifecycle', writeSpec(cwd, 'raised.lifecycle.json', edited(lifecycleSpec, spec => {
    spec.meta.viewBox = [900, required];
  }))).ok, true);
  assert.equal(validate('lifecycle', writeSpec(cwd, 'lowered.lifecycle.json', edited(lifecycleSpec, spec => {
    spec.states.at(-1).yOffset = 0;
  }))).ok, true);
});

test('lifecycle: a state above the area offers only the fix that can repair it', t => {
  const cwd = workspace(t);
  const spec = edited(lifecycleSpec, copy => { copy.states.at(-1).yOffset = -260; });
  const receipt = validate('lifecycle', writeSpec(cwd, 'above.lifecycle.json', spec));

  assert.equal(receipt.ok, false);
  const diagnostic = onlyExtent(receipt);
  assert.match(diagnostic.message, /starts above the vertical lifecycle area/);
  assert.deepEqual(diagnostic.subject, { diagramType: 'lifecycle', state: 'replay' });

  // y is the top edge: neither height nor meta.viewBox[1] moves this bound, so
  // offering either would be a repair instruction that cannot work.
  assert.equal(diagnostic.supportedFixes.length, 1);
  assert.match(diagnostic.supportedFixes[0], /negative yOffset on state "replay"/);
  assert.doesNotMatch(diagnostic.supportedFixes.join(' '), /height|viewBox/);

  // Reducing height changes nothing here, which is why it is not offered.
  assert.equal(onlyExtent(validate('lifecycle', writeSpec(cwd, 'shorter.lifecycle.json', edited(spec, copy => {
    copy.states.at(-1).height = 36;
  })))).message, diagnostic.message);

  assert.equal(validate('lifecycle', writeSpec(cwd, 'repaired.lifecycle.json', edited(spec, copy => {
    copy.states.at(-1).yOffset = 0;
  }))).ok, true);
});

test('lifecycle: a state taller than the area drops the yOffset move and reports both bounds', t => {
  const cwd = workspace(t);
  const spec = edited(lifecycleSpec, copy => {
    const state = copy.states.at(-1);
    state.yOffset = -260;
    state.height = 480;
  });
  const receipt = validate('lifecycle', writeSpec(cwd, 'both.lifecycle.json', spec));

  const found = extentDiagnostics(receipt);
  assert.equal(found.length, 2, JSON.stringify(receipt.diagnostics, null, 2));
  const [above, below] = found;
  assert.match(above.message, /starts above the vertical lifecycle area/);
  assert.match(below.message, /exceeds the vertical lifecycle area/);
  // A state that cannot fit between the bounds is told so, rather than given
  // an inverted y range.
  assert.match(below.message, /taller than the area from y = 64 to y = 463, so no yOffset can fit it — reduce state height to at most 399/);

  // No yOffset can fit a state taller than the area, so the below-area
  // diagnostic does not offer the move; reducing height is what reaches it.
  assert.equal(below.supportedFixes.length, 2);
  assert.doesNotMatch(below.supportedFixes.join(' '), /yOffset/);
  assert.match(below.supportedFixes[0], /reduce state "replay" height/);
  assert.deepEqual(extentDiagnostics(validate('lifecycle', writeSpec(cwd, 'fixed.lifecycle.json', edited(spec, copy => {
    copy.states.at(-1).height = 440;
  })))).map(entry => entry.message), [above.message]);
});

test('a repair that would need an illegal height is not offered', t => {
  const cwd = workspace(t);

  // Lifecycle: the state's top edge sits one pixel above the bottom bound and
  // it is already at the schema minimum height, so no legal height can clear
  // the bound — the height entry must be dropped.
  const lifecycle = edited(lifecycleSpec, copy => {
    copy.meta.viewBox = [900, 660];
    const state = copy.states.at(-1);
    state.height = 36;
    state.yOffset = 259;
  });
  const lifecycleReceipt = validate('lifecycle', writeSpec(cwd, 'illegal-height.lifecycle.json', lifecycle));
  const lifecycleDiagnostic = onlyExtent(lifecycleReceipt);
  assert.equal(lifecycleDiagnostic.evidence.areaBottom, 538);
  assert.equal(lifecycleDiagnostic.evidence.y, 537);
  assert.match(lifecycleDiagnostic.message, /keep y within \[64, 502\] so that y \+ height does not pass 538/);
  assert.equal(lifecycleDiagnostic.supportedFixes.length, 2);
  assert.match(lifecycleDiagnostic.supportedFixes[0], /lower yOffset/);
  assert.doesNotMatch(lifecycleDiagnostic.supportedFixes.join(' '), /height/);
  assert.deepEqual(extentDiagnostics(validate('lifecycle', writeSpec(cwd, 'legal.lifecycle.json', edited(lifecycle, copy => {
    copy.states.at(-1).yOffset = 200;
  })))), [], 'the offered yOffset move must clear the diagnostic');

  // Dataflow: same geometry on the last row.
  const flow = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/product-analytics.dataflow.json'), 'utf8'));
  delete flow.meta.views;
  flow.meta.viewBox = [940, 720];
  const node = flow.nodes.find(entry => entry.id === 'mobile');
  node.row = 4;
  node.height = 36;
  node.yOffset = 27;
  const flowReceipt = validate('dataflow', writeSpec(cwd, 'illegal-height.dataflow.json', flow));
  const flowDiagnostic = onlyExtent(flowReceipt);
  assert.equal(flowDiagnostic.evidence.areaBottom, 646);
  assert.equal(flowDiagnostic.evidence.y, 611);
  assert.match(flowDiagnostic.message, /keep y within \[104, 610\] so that y \+ height does not pass 646/);
  assert.equal(flowDiagnostic.supportedFixes.length, 2);
  assert.match(flowDiagnostic.supportedFixes[0], /lower yOffset/);
  assert.doesNotMatch(flowDiagnostic.supportedFixes.join(' '), /height/);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'legal.dataflow.json', edited(flow, copy => {
    copy.nodes.find(entry => entry.id === 'mobile').yOffset = 0;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: a node below the readable area reports the same repair contract', t => {
  const cwd = workspace(t);
  const example = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/product-analytics.dataflow.json'), 'utf8'));
  delete example.meta.views;
  example.meta.viewBox = [1080, 520];
  example.nodes.find(node => node.id === 'mobile').row = 3;
  const receipt = validate('dataflow', writeSpec(cwd, 'overflow.dataflow.json', example));

  assert.equal(receipt.ok, false);
  const diagnostic = onlyExtent(receipt);
  assert.equal(diagnostic.code, 'layout/constraint');
  assert.deepEqual(diagnostic.subject, { diagramType: 'dataflow', node: 'mobile' });
  assert.match(diagnostic.message, /keep y within \[104, 388\] so that y \+ height does not pass 446/);
  assert.match(diagnostic.message, /page still fits the target viewport/);

  // The node's top edge is already past the bottom bound, so reducing its
  // height cannot bring it back.
  assert.equal(diagnostic.evidence.y, 470);
  assert.equal(diagnostic.evidence.areaBottom, 446);
  const required = diagnostic.evidence.requiredViewBoxHeight;
  assert.equal(required, diagnostic.evidence.y + diagnostic.evidence.height + 74);
  assert.equal(diagnostic.supportedFixes.length, 2);
  assert.match(diagnostic.supportedFixes[0], /lower yOffset on node "mobile"/);
  assert.match(diagnostic.supportedFixes[1], /target viewport/);
  assert.match(diagnostic.supportedFixes[1], /visual-check/);

  // The offered height and the offered yOffset move each clear this diagnostic.
  // Relocating the node also reroutes its flows, so the repaired spec is not
  // expected to be fully green.
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'raised.dataflow.json', edited(example, copy => {
    copy.meta.viewBox = [1080, required];
  })))), [], 'the offered canvas height must clear the diagnostic');
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'lowered.dataflow.json', edited(example, copy => {
    copy.nodes.find(node => node.id === 'mobile').yOffset = -82;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});

test('dataflow: a node above the area offers only the yOffset move', t => {
  const cwd = workspace(t);
  const example = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/product-analytics.dataflow.json'), 'utf8'));
  delete example.meta.views;
  example.nodes.find(node => node.id === 'mobile').yOffset = -300;
  const receipt = validate('dataflow', writeSpec(cwd, 'above.dataflow.json', example));

  const diagnostic = onlyExtent(receipt);
  assert.match(diagnostic.message, /starts above the readable diagram area/);
  assert.equal(diagnostic.evidence.areaTop, 104);
  assert.equal(diagnostic.evidence.y, 56);
  assert.equal(diagnostic.supportedFixes.length, 1);
  assert.match(diagnostic.supportedFixes[0], /negative yOffset on node "mobile"/);
  assert.doesNotMatch(diagnostic.supportedFixes.join(' '), /height|viewBox/);
  assert.deepEqual(extentDiagnostics(validate('dataflow', writeSpec(cwd, 'repaired.dataflow.json', edited(example, copy => {
    copy.nodes.find(node => node.id === 'mobile').yOffset = 0;
  })))), [], 'the offered yOffset move must clear the diagnostic');
});
