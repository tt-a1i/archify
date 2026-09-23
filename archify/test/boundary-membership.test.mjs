import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-membership-'));

function checkHtml(name, svgBody, profile = 'standard', viewBox = '0 0 480 420') {
  const htmlPath = path.join(tmp, `${name}.html`);
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><body><svg viewBox="${viewBox}" data-quality-profile="${profile}">${svgBody}</svg></body></html>`,
  );
  try {
    return { code: 0, result: JSON.parse(execFileSync('node', [checker, htmlPath], { encoding: 'utf8' })) };
  } catch (err) {
    return { code: err.status ?? 1, result: JSON.parse(String(err.stdout || '{}')) };
  }
}

function frame({ id = '0', label = 'our private network', members, scope, x = 230, y = 10, width = 210, height = 390 }) {
  const memberAttr = members === undefined ? '' : ` data-composition-frame-members="${members}"`;
  const scopeAttr = scope === undefined ? '' : ` data-composition-scope="${scope}"`;
  return `<rect data-graph-role="structural-frame" data-composition-frame-kind="region" `
    + `data-composition-frame-id="${id}" data-composition-frame-label="${label}"${memberAttr}${scopeAttr} `
    + `x="${x}" y="${y}" width="${width}" height="${height}" rx="12"/>`;
}

function node(id, x, y, { width = 150, height = 60, scope } = {}) {
  const scopeAttr = scope === undefined ? '' : ` data-composition-scope="${scope}"`;
  return `<g data-node-id="${id}" data-node-label="${id}" data-node-kind="backend"${scopeAttr}>`
    + `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" class="c-mask"/></g>`;
}

// The reproduction from issue #395: third_party is absent from wraps but is
// positioned between the two members, so the frame closes around it.
const REPRO = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Boundary membership repro', quality_profile: 'showcase' },
  components: [
    { id: 'app_a', type: 'backend', label: 'App A', pos: [260, 40], size: [150, 60] },
    { id: 'app_b', type: 'backend', label: 'App B', pos: [260, 320], size: [150, 60] },
    { id: 'third_party', type: 'external', label: 'Third-party API', sublabel: 'NOT in the boundary', pos: [260, 180], size: [150, 60] },
  ],
  boundaries: [{ kind: 'region', label: 'our private network', wraps: ['app_a', 'app_b'] }],
  connections: [
    { id: 'a-b', from: 'app_a', to: 'app_b', label: 'internal call', fromSide: 'left', toSide: 'left', via: [[180, 70], [180, 350]] },
    { id: 'a-third', from: 'app_a', to: 'third_party', label: 'outbound', variant: 'dashed', fromSide: 'right', toSide: 'right', via: [[490, 70], [490, 210]] },
  ],
};

test('validate: a non-member rendered inside a boundary frame fails showcase (#395)', () => {
  const input = path.join(tmp, 'repro.architecture.json');
  fs.writeFileSync(input, JSON.stringify(REPRO));
  const result = spawnSync('node', [cli, 'validate', 'architecture', input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'a frame that encloses a non-member must not pass showcase');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.checker.composition.summary.errors, 1);
  assert.equal(receipt.checker.checks.length, 9, 'the artifact check count is a published contract');

  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'composition/boundary-membership');
  assert.ok(diagnostic, 'receipt must carry a composition/boundary-membership diagnostic');
  assert.equal(diagnostic.severity, 'error');
  assert.equal(diagnostic.evidence.containment, 'inside');
  assert.equal(diagnostic.evidence.node.id, 'third_party');
  assert.equal(diagnostic.evidence.frame.label, 'our private network');
  assert.deepEqual(diagnostic.evidence.nodeRect, { x: 260, y: 180, width: 150, height: 60 });
  assert.deepEqual(diagnostic.evidence.frameRect, { x: 230, y: 10, width: 210, height: 390 });
  assert.ok(
    diagnostic.supportedFixes.some((fix) => /wraps/.test(fix))
      && diagnostic.supportedFixes.some((fix) => /move/i.test(fix)),
    'both repairs stay available: move the node out, or correct wraps',
  );
});

test('render output check: full containment is an error under showcase', () => {
  const { code, result } = checkHtml('containment-showcase', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('third_party', 260, 180)}
  `, 'showcase');

  assert.notEqual(code, 0);
  assert.equal(result.composition.summary.errors, 1);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.severity, 'error');
  assert.equal(issue.containment, 'inside');
});

test('render output check: full containment is only a warning under standard', () => {
  const { code, result } = checkHtml('containment-standard', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('third_party', 260, 180)}
  `);

  assert.equal(code, 0, 'standard must stay compatible');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 1 });
  assert.equal(
    result.composition.issues.find((item) => item.code === 'composition/boundary-membership').severity,
    'warning',
  );
});

test('render output check: a straddling non-member warns even under showcase', () => {
  const { code, result } = checkHtml('straddle-showcase', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('audit', 380, 370)}
  `, 'showcase');

  assert.equal(code, 0, 'a straddle starts as a warning, never a showcase error');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 1 });
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.containment, 'straddling');
});

test('render output check: legitimate nested membership stays clean', () => {
  const { code, result } = checkHtml('nested-membership', `
    ${frame({ id: '0', label: 'region', members: 'app_a app_b secret' })}
    ${frame({ id: '1', label: 'security group', members: 'secret', x: 250, y: 170, width: 170, height: 80 })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('secret', 260, 180)}
  `, 'showcase');

  assert.equal(code, 0);
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
});

test('render output check: a sparse membership is judged like any other', () => {
  // Two members at opposite corners make the frame the bounding box of a set
  // that is mostly empty space. That explains how the enclosure happens; it
  // does not make the enclosure any less false, so there is no exemption.
  const { code, result } = checkHtml('sparse-membership', `
    ${frame({ label: 'trust boundary', members: 'north south', x: 230, y: 10, width: 210, height: 390 })}
    ${node('north', 260, 40)}
    ${node('south', 260, 320)}
    ${node('unrelated', 260, 180)}
  `, 'showcase');

  assert.notEqual(code, 0, 'a frame is judged on what it encloses, not on how its members are spread');
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.node.id, 'unrelated');
  assert.equal(issue.containment, 'inside');
});

test('render output check: a frame that declares no membership is skipped', () => {
  const { code, result } = checkHtml('no-membership-attribute', `
    ${frame({ members: undefined })}
    ${node('app_a', 260, 40)}
    ${node('third_party', 260, 180)}
  `, 'showcase');

  assert.equal(code, 0, 'frames from other diagram types carry no membership and must not be judged');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 0 });
});

// Regressions for the parsing holes found in review: the collector must read
// real elements, not text that happens to look like markup.

test('render output check: node text that looks like an attribute cannot hide a violation', () => {
  const { code, result } = checkHtml('title-text-decoy', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id="third_party" data-node-label="odd"><title>data-node-id=example</title>
      <rect x="260" y="180" width="150" height="60" rx="6" class="c-mask"/></g>
  `, 'showcase');

  assert.notEqual(code, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
});

test('render output check: single-quoted attributes are read like any other', () => {
  const { code, result } = checkHtml('single-quoted', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id='third_party'><rect x='260' y='180' width='150' height='60'/></g>
  `, 'showcase');

  assert.notEqual(code, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
});

test('render output check: commented-out markup is not a component', () => {
  const { code, result } = checkHtml('commented-node', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <!-- ${node('third_party', 260, 180)} -->
  `, 'showcase');

  assert.equal(code, 0);
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 0 });
});

test('render output check: a rectangle outside the node element is not its box', () => {
  const { code, result } = checkHtml('rect-outside-group', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id="third_party"><circle cx="50" cy="50" r="5"/></g>
    <rect x="260" y="180" width="150" height="60"/>
  `, 'showcase');

  assert.equal(code, 0, 'a stray rectangle after the closing tag must not become a component box');
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
});

test('render output check: a zero-area component draws nothing and cannot be enclosed', () => {
  const { code, result } = checkHtml('zero-area', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('third_party', 300, 200, { width: 0, height: 0 })}
  `, 'showcase');

  assert.equal(code, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
});

test('render output check: disjoint and edge-touching components are clean', () => {
  const { code, result } = checkHtml('disjoint-and-touching', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    ${node('touching', 440, 180)}
    ${node('far_away', 10, 180)}
  `, 'showcase');

  assert.equal(code, 0, 'sharing an edge is not overlapping');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 0 });
});

test('render output check: an explicitly empty membership is judged, an absent one is not', () => {
  const empty = checkHtml('empty-membership', `
    ${frame({ members: '' })}
    ${node('third_party', 260, 180)}
  `, 'showcase');
  assert.notEqual(empty.code, 0, 'a boundary that wraps nothing still encloses nothing');
  assert.equal(empty.result.composition.metrics.boundaryMembershipIssues, 1);

  const absent = checkHtml('absent-membership', `
    ${frame({ members: undefined })}
    ${node('third_party', 260, 180)}
  `, 'showcase');
  assert.equal(absent.code, 0);
  assert.equal(absent.result.composition.metrics.boundaryMembershipIssues, 0);
});

test('render output check: malformed nesting cannot move a rectangle between components', () => {
  // A childless node element can hold no rectangle, so the sibling that follows
  // it is not its box.
  const selfClosing = checkHtml('self-closing-node', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id="third_party"/>
    <rect x="260" y="180" width="150" height="60"/>
  `, 'showcase');
  assert.equal(selfClosing.code, 0);
  assert.equal(selfClosing.result.composition.metrics.boundaryMembershipIssues, 0);

  // An unclosed child must not carry the node past its own end tag.
  const unclosed = checkHtml('unclosed-child', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id="third_party"><title></g>
    <rect x="260" y="180" width="150" height="60"/>
  `, 'showcase');
  assert.equal(unclosed.code, 0);
  assert.equal(unclosed.result.composition.metrics.boundaryMembershipIssues, 0);

  // A stray close tag must not end the node early and hide its real rectangle.
  const stray = checkHtml('stray-close', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g data-node-id="third_party"></bogus><rect x="260" y="180" width="150" height="60"/></g>
  `, 'showcase');
  assert.notEqual(stray.code, 0, 'the rectangle is inside the node element and still counts');
  assert.equal(stray.result.composition.metrics.boundaryMembershipIssues, 1);
});

test('render output check: a compare artifact draws a moved node twice and both positions count', () => {
  // delta-base-* and delta-head-* groups share one data-node-id. Deduping by id
  // would hide whichever position is drawn second.
  const { code, result } = checkHtml('moved-node-both-positions', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
    <g id="delta-base-node-queue" data-node-id="queue"><rect x="10" y="180" width="150" height="60"/></g>
    <g id="delta-head-node-queue" data-node-id="queue"><rect x="260" y="180" width="150" height="60"/></g>
  `, 'showcase');

  assert.notEqual(code, 0, 'the head position sits inside a frame it does not belong to');
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.node.id, 'queue');
  assert.deepEqual(issue.nodeRect, { x: 260, y: 180, width: 150, height: 60 });
});

test('render output check: membership from one version is never applied to the other', () => {
  // Base and head share one coordinate space, so the same frame is drawn twice
  // with two memberships. "cache" is drawn by base only and "fraud" by head
  // only; each sits inside the other version's frame. Neither is a defect.
  const { code, result } = checkHtml('two-diagram-scopes', `
    ${frame({ id: '0', label: 'Production region', members: 'cache checkout', scope: 'base' })}
    ${frame({ id: '0', label: 'Production region', members: 'fraud checkout', scope: 'head' })}
    ${node('checkout', 260, 40)}
    ${node('cache', 260, 180, { scope: 'base' })}
    ${node('fraud', 260, 260, { scope: 'head' })}
  `, 'showcase');

  assert.equal(code, 0, 'a version must not be judged by the other version\'s membership');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
  assert.equal(
    result.composition.metrics.boundaryMembershipFramesChecked,
    2,
    'scoping must not silently disable the rule: both frames are still judged',
  );
});

test('render output check: a version-scoped frame still judges its own version', () => {
  // The scope narrows which components a frame governs. It does not excuse the
  // components that version does draw inside it.
  const { code, result } = checkHtml('scoped-frame-own-version', `
    ${frame({ id: '0', label: 'Production region', members: 'checkout', scope: 'head' })}
    ${node('checkout', 260, 40)}
    ${node('fraud', 260, 180, { scope: 'head' })}
  `, 'showcase');

  assert.notEqual(code, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.node.id, 'fraud');
  assert.equal(issue.scope, 'head');
});

test('render output check: a component both versions draw is judged by both frames', () => {
  // An unscoped component is drawn once because the versions agree on it, so it
  // is present in both and answers to whichever frame encloses it.
  const { code, result } = checkHtml('unscoped-node-both-versions', `
    ${frame({ id: '0', label: 'Production region', members: 'checkout', scope: 'base' })}
    ${frame({ id: '0', label: 'Production region', members: 'checkout', scope: 'head', x: 230, y: 10, width: 210, height: 200 })}
    ${node('checkout', 260, 300)}
    ${node('audit', 260, 40)}
  `, 'showcase');

  assert.notEqual(code, 0);
  assert.equal(
    result.composition.metrics.boundaryMembershipIssues,
    2,
    'the shared component is enclosed by the base frame and by the head frame',
  );
  assert.deepEqual(
    result.composition.issues
      .filter((item) => item.code === 'composition/boundary-membership')
      .map((item) => item.scope)
      .sort(),
    ['base', 'head'],
  );
});

test('render output check: evidence separates a frame that passed from one that was not read', () => {
  const judged = checkHtml('evidence-checked', `
    ${frame({ members: 'app_a app_b' })}
    ${node('app_a', 260, 40)}
    ${node('app_b', 260, 320)}
  `, 'showcase');
  assert.equal(judged.code, 0);
  assert.equal(judged.result.composition.metrics.boundaryMembershipIssues, 0);
  assert.equal(judged.result.composition.metrics.boundaryMembershipFramesChecked, 1);
  assert.equal(judged.result.composition.metrics.boundaryMembershipFramesUnknown, 0);

  const unread = checkHtml('evidence-unknown', `
    ${frame({ members: undefined })}
    ${node('app_a', 260, 40)}
    ${node('third_party', 260, 180)}
  `, 'showcase');
  assert.equal(unread.code, 0);
  assert.equal(unread.result.composition.metrics.boundaryMembershipIssues, 0);
  assert.equal(
    unread.result.composition.metrics.boundaryMembershipFramesChecked,
    0,
    'a clean count must not read as a clean artifact when nothing was judged',
  );
  assert.equal(unread.result.composition.metrics.boundaryMembershipFramesUnknown, 1);
});

// Generation-side regressions for the overlay. The scope an element carries has
// to come from what each version draws: the comparator reports no boundary
// change when a member moves, and no component change when a grid origin moves,
// yet both redraw the geometry this rule reads.

function compareArtifact(name, base, head) {
  const basePath = path.join(tmp, `${name}.base.architecture.json`);
  const headPath = path.join(tmp, `${name}.head.architecture.json`);
  const artifact = path.join(tmp, `${name}-delta.html`);
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(head));
  const compare = spawnSync('node', [cli, 'compare', 'architecture', basePath, headPath, artifact, '--receipt', path.join(tmp, `${name}-delta.receipt.json`), '--json'], { encoding: 'utf8' });
  assert.equal(compare.status, 0, compare.stdout || compare.stderr);
  try {
    return { code: 0, result: JSON.parse(execFileSync('node', [checker, artifact], { encoding: 'utf8' })) };
  } catch (err) {
    return { code: err.status ?? 1, result: JSON.parse(String(err.stdout || '{}')) };
  }
}

const movedMembers = (memberX, nonMemberX, title) => ({
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title },
  components: [
    { id: 'a', type: 'backend', label: 'A', pos: [memberX, 100], size: [120, 60] },
    { id: 'b', type: 'backend', label: 'B', pos: [memberX, 400], size: [120, 60] },
    { id: 'n', type: 'external', label: 'N', pos: [nonMemberX, 250], size: [120, 60] },
  ],
  boundaries: [{ kind: 'region', label: 'zone', wraps: ['a', 'b'] }],
  connections: [{ id: 'ab', from: 'a', to: 'b' }],
});

test('compare generation: a frame whose members moved does not judge the other version', () => {
  // wraps and pad are identical, so the comparator reports no boundary change,
  // but the rendered frame is 500px to the right in head. "n" is enclosed by
  // neither version and must not be reported by the overlay.
  const { code, result } = compareArtifact(
    'moved-members',
    movedMembers(100, 600, 'Moved base'),
    movedMembers(600, 900, 'Moved head'),
  );

  assert.equal(code, 0);
  assert.equal(
    result.composition.metrics.boundaryMembershipIssues,
    0,
    'a head frame must not enclose a component only base drew',
  );
  assert.ok(result.composition.metrics.boundaryMembershipFramesChecked > 0, 'the frame is still read');
});

test('compare generation: a moved grid origin does not judge the other version', () => {
  // Grid placement is authored as row/col, so every component is unchanged
  // while every rendered rectangle moves.
  const grid = (origin, title) => ({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title },
    layout: { mode: 'grid', origin, cols: 4, gapX: 60, gapY: 80, cellW: 120, cellH: 60 },
    components: [
      { id: 'a', type: 'backend', label: 'A', row: 0, col: 0 },
      { id: 'b', type: 'backend', label: 'B', row: 2, col: 0 },
      { id: 'n', type: 'external', label: 'N', row: 1, col: 2 },
    ],
    boundaries: [{ kind: 'region', label: 'zone', wraps: ['a', 'b'] }],
    connections: [{ id: 'ab', from: 'a', to: 'b' }],
  });

  const { code, result } = compareArtifact('moved-origin', grid([100, 100], 'Grid base'), grid([500, 100], 'Grid head'));

  assert.equal(code, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
});

test('compare generation: a version that really does enclose a non-member is reported', () => {
  // Scoping narrows which components a frame governs. It must not stop the
  // overlay reporting the version that actually draws the defect.
  const enclosing = (nonMemberX, title) => ({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [200, 100], size: [120, 60] },
      { id: 'b', type: 'backend', label: 'B', pos: [200, 400], size: [120, 60] },
      { id: 'c', type: 'backend', label: 'C', pos: [560, 100], size: [120, 60] },
      { id: 'n', type: 'external', label: 'N', pos: [nonMemberX, 400], size: [120, 60] },
    ],
    boundaries: [{ kind: 'region', label: 'zone', wraps: ['a', 'b', 'c'] }],
    connections: [
      { id: 'ab', from: 'a', to: 'b', fromSide: 'bottom', toSide: 'top' },
      { id: 'ac', from: 'a', to: 'c' },
    ],
  });

  const { code, result } = compareArtifact('head-encloses', enclosing(900, 'Clear base'), enclosing(560, 'Enclosing head'));

  assert.equal(code, 0, 'the inputs are standard, so this is a warning');
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 1);
  const issue = result.composition.issues.find((item) => item.code === 'composition/boundary-membership');
  assert.equal(issue.node.id, 'n');
  assert.equal(issue.containment, 'inside');
  assert.equal(issue.scope, 'head', 'only the version that draws the enclosure is named');
  assert.deepEqual(issue.nodeRect, { x: 560, y: 400, width: 120, height: 60 });
});

test('compare artifact: the shipped delta overlays two memberships and is judged under both', () => {
  // examples/checkout-platform-delta.html draws base and head in one coordinate
  // space. "cache" is drawn by base only and sits inside both head frames;
  // "fraud" is drawn by head only and sits inside the base region. Applying
  // either version's membership to the other manufactures four findings, so the
  // artifact is the regression: the frames are read, and nothing is reported.
  const artifact = path.resolve(skillRoot, '../examples/checkout-platform-delta.html');
  const result = JSON.parse(execFileSync('node', [checker, artifact], { encoding: 'utf8' }));

  const frames = [...fs.readFileSync(artifact, 'utf8').matchAll(
    /<rect data-graph-role="structural-frame"[^>]*data-composition-scope="(base|head)"[^>]*\/>/g,
  )].map((match) => ({
    scope: match[1],
    members: match[0].match(/data-composition-frame-members="([^"]*)"/)[1].split(' '),
    rect: ['x', 'y', 'width', 'height'].map((name) => Number(match[0].match(new RegExp(`\\b${name}="([\\d.-]+)"`))[1])),
  }));
  assert.equal(frames.filter((entry) => entry.scope === 'base').length, 2);
  assert.equal(frames.filter((entry) => entry.scope === 'head').length, 2);

  const encloses = ([x, y, width, height], [nx, ny, nw, nh]) => (
    nx >= x && ny >= y && nx + nw <= x + width && ny + nh <= y + height
  );
  const crossVersion = frames.filter((entry) => (
    entry.scope === 'base'
      ? !entry.members.includes('fraud') && encloses(entry.rect, [640, 100, 130, 60])
      : !entry.members.includes('cache') && encloses(entry.rect, [430, 100, 130, 60])
  ));
  assert.equal(crossVersion.length, 3, 'the overlay really does enclose each version inside the other');

  assert.equal(result.composition.metrics.boundaryMembershipFramesChecked, 4, 'every frame carries membership');
  assert.equal(result.composition.metrics.boundaryMembershipFramesUnknown, 0);
  assert.equal(result.composition.metrics.boundaryMembershipIssues, 0);
  assert.equal(result.ok, true);
});
