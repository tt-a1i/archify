// Showcase-gated boundary frame clearance (issue #74, U2 / R3-R5).
//
// Under the effective showcase profile, a strictly-nested boundary frame (one
// `wraps` set is a strict subset of the other's) must sit at least 8px inside
// its containing frame wherever the frames' spans overlap. A flush, coincident,
// or crossing edge fails with `composition/boundary-frame-clearance`.
// Cross-cutting memberships (set semantics, e.g. runtime vs compliance) are
// never flagged, and standard/absent profiles keep today's behavior.
//
//   node --test test/boundary-composition.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-composition-'));

function validateCli(mode, doc, quality = 'showcase') {
  const input = path.join(tmp, `validate-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const stdout = execFileSync('node', [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'validate',
      mode,
      input,
      '--quality',
      quality,
      '--json',
    ], { encoding: 'utf8' });
    return { code: 0, result: JSON.parse(stdout) };
  } catch (err) {
    return {
      code: err.status ?? 1,
      result: JSON.parse(String(err.stdout || '{}')),
    };
  }
}

function render(mode, doc) {
  const input = path.join(tmp, `render-${Math.random().toString(16).slice(2)}.json`);
  const output = path.join(tmp, `render-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || '') };
  }
}

function boundaryClearanceDiagnostics(result) {
  return (result?.diagnostics || []).filter(
    (item) => item.code === 'composition/boundary-frame-clearance',
  );
}

// The issue #74 boundary repro shape: a region wraps [gateway, runtime, store,
// archive]; a security-group wraps only [gateway, runtime]; both use pad 20 and
// share the gateway/runtime extremes, so the nested frame is flush with the
// containing frame's left and right edges. The region-only store/archive sit
// above and below the security-group, so top and bottom stay clear.
function flushRepro({ gutter = false } = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary flush repro' },
    components: [
      { id: 'store', type: 'database', label: 'Store', pos: [300, 80], size: [120, 60] },
      { id: 'gateway', type: 'security', label: 'Gateway', pos: [100, 200], size: [120, 60] },
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [600, 200], size: [120, 60] },
      { id: 'archive', type: 'cloud', label: 'Archive', pos: [300, 380], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Platform region', wraps: ['gateway', 'runtime', 'store', 'archive'], pad: 20 },
      { kind: 'security-group', label: 'Trust zone', wraps: ['gateway', 'runtime'], pad: gutter ? 12 : 20 },
    ],
    connections: [],
  };
}

// Two disjoint boundary scopes that share no membership; nothing nested.
function disjointDoc() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Disjoint boundaries' },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [100, 100], size: [120, 60] },
      { id: 'b', type: 'database', label: 'B', pos: [600, 100], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Left region', wraps: ['a'], pad: 20 },
      { kind: 'region', label: 'Right region', wraps: ['b'], pad: 20 },
    ],
    connections: [],
  };
}

test('architecture: showcase rejects a nested frame flush with its containing frame (issue repro)', () => {
  const doc = flushRepro();
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 1, JSON.stringify(result, null, 2));
  assert.equal(result.ok, false);
  const diagnostics = boundaryClearanceDiagnostics(result);
  assert.ok(diagnostics.length > 0, `expected composition/boundary-frame-clearance diagnostics`);
  const leftRight = diagnostics.filter((item) => ['left', 'right'].includes(item.evidence.edge));
  assert.ok(leftRight.length >= 2, `expected flush left/right edges to be reported`);
  for (const issue of leftRight) {
    assert.equal(issue.severity, 'error');
    assert.ok(issue.message.includes('Platform region'), issue.message);
    assert.ok(issue.message.includes('Trust zone'), issue.message);
    assert.ok(Array.isArray(issue.supportedFixes) && issue.supportedFixes.length > 0);
    assert.match(issue.supportedFixes.join(' '), /boundary pad/);
    assert.equal(issue.evidence.insetPx, 0);
    assert.equal(issue.evidence.minimumPx, 8);
    assert.ok(Number.isFinite(issue.evidence.insets.left));
    assert.ok(Number.isFinite(issue.evidence.insets.right));
  }
});

test('architecture: the flush repro passes showcase once the coincident edges gain an 8px gutter', () => {
  const doc = flushRepro({ gutter: true });
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
  assert.equal(boundaryClearanceDiagnostics(result).length, 0);
});

test('architecture: cross-cutting overlapping memberships (set semantics) stay valid in showcase', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Orthogonal scopes' },
    components: [
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [100, 100], size: [120, 60] },
      { id: 'compliance', type: 'cloud', label: 'Compliance', pos: [100, 300], size: [120, 60] },
      { id: 'shared-a', type: 'database', label: 'Shared A', pos: [500, 100], size: [120, 60] },
      { id: 'shared-b', type: 'database', label: 'Shared B', pos: [500, 300], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Runtime scope', wraps: ['runtime', 'shared-a', 'shared-b'], pad: 20 },
      { kind: 'security-group', label: 'Compliance scope', wraps: ['compliance', 'shared-a', 'shared-b'], pad: 20 },
    ],
    connections: [],
  };
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
});

test('architecture: a strictly nested pair with comfortable insets passes with no diagnostics', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Comfortable nesting' },
    components: [
      { id: 'edge', type: 'cloud', label: 'Edge', pos: [600, 100], size: [120, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [600, 260], size: [120, 60] },
      { id: 'sink', type: 'database', label: 'Sink', pos: [600, 420], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Platform region', wraps: ['edge', 'api', 'sink'], pad: 20 },
      { kind: 'security-group', label: 'Inner scope', wraps: ['api'], pad: 8 },
    ],
    connections: [],
  };
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
  assert.equal(boundaryClearanceDiagnostics(result).length, 0);
});

test('architecture: standard and absent profiles keep the flush repro renderable', () => {
  const absent = flushRepro();
  const asStandard = flushRepro();
  asStandard.meta.quality_profile = 'standard';

  const standard = validateCli('architecture', asStandard, 'standard');
  assert.equal(standard.code, 0, JSON.stringify(standard.result, null, 2));
  assert.equal(standard.result.ok, true);

  const absentStandard = validateCli('architecture', absent, 'standard');
  assert.equal(absentStandard.code, 0, JSON.stringify(absentStandard.result, null, 2));
  assert.equal(absentStandard.result.ok, true);

  const rendered = render('architecture', absent);
  assert.equal(rendered.code, 0, rendered.stderr);
});

test('architecture: forced showcase triggers the rule on an unauthored doc; forced standard does not', () => {
  const doc = flushRepro();
  const forcedShowcase = validateCli('architecture', doc, 'showcase');
  assert.equal(forcedShowcase.code, 1, JSON.stringify(forcedShowcase.result, null, 2));
  assert.ok(boundaryClearanceDiagnostics(forcedShowcase.result).length > 0);

  const forcedStandard = validateCli('architecture', doc, 'standard');
  assert.equal(forcedStandard.code, 0, JSON.stringify(forcedStandard.result, null, 2));
  assert.equal(forcedStandard.result.ok, true);
});

test('architecture: authored standard still renders the flush geometry when validated without an override', () => {
  const doc = flushRepro();
  doc.meta.quality_profile = 'standard';
  const rendered = render('architecture', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
});

test('architecture: a nested pair flush on pad-independent edges carries member-movement guidance', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Shared vertical extremes' },
    components: [
      { id: 'gateway', type: 'security', label: 'Gateway', pos: [300, 100], size: [120, 60] },
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [300, 400], size: [120, 60] },
      { id: 'store', type: 'database', label: 'Store', pos: [60, 240], size: [120, 60] },
      { id: 'archive', type: 'cloud', label: 'Archive', pos: [540, 240], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Platform region', wraps: ['gateway', 'runtime', 'store', 'archive'], pad: 20 },
      { kind: 'security-group', label: 'Trust zone', wraps: ['gateway', 'runtime'], pad: 20 },
    ],
    connections: [],
  };
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 1, JSON.stringify(result, null, 2));
  const vertical = boundaryClearanceDiagnostics(result).filter(
    (item) => ['top', 'bottom'].includes(item.evidence.edge),
  );
  assert.ok(vertical.length >= 2, `expected flush top/bottom edges to be reported`);
  for (const issue of vertical) {
    assert.ok(issue.message.includes('Platform region'), issue.message);
    assert.ok(issue.message.includes('Trust zone'), issue.message);
    assert.equal(issue.evidence.insetPx, 0);
    assert.ok(Array.isArray(issue.supportedFixes) && issue.supportedFixes.length > 0);
    assert.match(
      issue.supportedFixes.join(' '),
      /move the extreme wrapped member or spread the containing boundary's members/,
      `pad-independent edges must not promise a pad-only fix:\n${JSON.stringify(issue)}`,
    );
    assert.doesNotMatch(issue.supportedFixes.join(' '), /adjust the nested or containing boundary pad/);
  }
});

test('architecture: moving the shared extreme members apart clears the pad-independent flush', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Members moved apart' },
    components: [
      { id: 'gateway', type: 'security', label: 'Gateway', pos: [300, 220], size: [120, 60] },
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [300, 320], size: [120, 60] },
      { id: 'store', type: 'database', label: 'Store', pos: [60, 80], size: [120, 60] },
      { id: 'archive', type: 'cloud', label: 'Archive', pos: [540, 420], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Platform region', wraps: ['gateway', 'runtime', 'store', 'archive'], pad: 20 },
      { kind: 'security-group', label: 'Trust zone', wraps: ['gateway', 'runtime'], pad: 20 },
    ],
    connections: [],
  };
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
});

test('architecture: disjoint far-apart boundaries pass showcase with no frame-clearance diagnostic', () => {
  const { code, result } = validateCli('architecture', disjointDoc());
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
  assert.equal(boundaryClearanceDiagnostics(result).length, 0);
});

test('architecture: identical memberships (not a strict subset) are never flagged', () => {
  const doc = flushRepro();
  // Make the security-group wrap exactly the region's members: equal sets.
  doc.boundaries[1].wraps = ['gateway', 'runtime', 'store', 'archive'];
  doc.boundaries[1].pad = 8;
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
