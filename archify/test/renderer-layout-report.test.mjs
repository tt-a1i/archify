import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-layout-report-'));

const CASES = {
  architecture: {
    example: 'web-app.architecture.json',
    entityKey: 'components',
    relationshipCount: (source) => source.connections.length,
    labelCount: (source) => source.connections.filter((connection) => connection.label).length,
    breakGeometry(source) {
      source.components[1].pos = [...source.components[0].pos];
    },
  },
  sequence: {
    example: 'cache-miss-request.sequence.json',
    entityKey: 'participants',
    relationshipCount: (source) => source.messages.length,
    labelCount: (source) => source.messages.length,
    breakGeometry(source) {
      source.messages[0].y = 9000;
    },
  },
  dataflow: {
    example: 'product-analytics.dataflow.json',
    entityKey: 'nodes',
    relationshipCount: (source) => source.flows.length,
    labelCount: (source) => source.flows.length,
    breakGeometry(source) {
      source.nodes.push({ ...source.nodes[0], id: 'overlapping-copy' });
    },
  },
  lifecycle: {
    example: 'agent-run.lifecycle.json',
    entityKey: 'states',
    relationshipCount: (source) => source.transitions.length,
    labelCount: (source) => source.transitions.filter((transition) => transition.label).length,
    prepare(source) {
      source.transitions[0].label = 'approval needed';
      source.transitions[0].labelAt = [402, 232];
    },
    breakGeometry(source) {
      source.meta.viewBox[1] = 566;
    },
  },
};

function load(example) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
}

function inspect(type, source, suffix) {
  const input = path.join(tmp, `${type}-${suffix}.json`);
  const output = path.join(tmp, `${type}-${suffix}.html`);
  const sentinel = `trusted-${type}-${suffix}\n`;
  fs.writeFileSync(input, JSON.stringify(source, null, 2));
  fs.writeFileSync(output, sentinel);
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', type, `render-${type}.mjs`),
    input,
    output,
    '--layout-json',
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(fs.readFileSync(output, 'utf8'), sentinel, `${type}: inspect must not write HTML`);
  assert.doesNotThrow(() => JSON.parse(result.stdout), `${type}: ${result.stdout || result.stderr}`);
  return { result, report: JSON.parse(result.stdout) };
}

function renderDiagnostics(type, source, suffix) {
  const input = path.join(tmp, `${type}-${suffix}.json`);
  const output = path.join(tmp, `${type}-${suffix}.html`);
  fs.writeFileSync(input, JSON.stringify(source, null, 2));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', type, `render-${type}.mjs`),
    input,
    output,
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.doesNotThrow(() => JSON.parse(result.stderr), `${type}: ${result.stderr}`);
  return JSON.parse(result.stderr);
}

test('renderer diagnostics emit one authoritative record for one geometry failure', () => {
  const source = {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Opaque data node crossing', quality_profile: 'standard' },
    stages: [{ label: 'Source' }, { label: 'Middle' }, { label: 'Sink' }],
    nodes: [
      { id: 'left', type: 'frontend', label: 'Left', stage: 0, row: 1 },
      { id: 'middle', type: 'security', label: 'Middle', stage: 1, row: 1 },
      { id: 'right', type: 'database', label: 'Right', stage: 2, row: 1 },
    ],
    flows: [{
      id: 'direct',
      from: 'left',
      to: 'right',
      label: 'payload',
      route: 'straight',
      labelAt: [315, 190],
    }],
  };
  const failure = renderDiagnostics('dataflow', source, 'deduplicated-diagnostic');
  const matching = failure.diagnostics.filter((entry) => (
    entry.message.includes('[clean-flow/edge-through-node] dataflow flows[0] id "direct"')
  ));

  assert.equal(matching.length, 1, JSON.stringify(matching, null, 2));
  assert.equal(matching[0].code, 'clean-flow/edge-through-node');
  assert.equal(matching[0].subject.path, '/flows/0');
  assert.equal(matching[0].evidence.obstacleId, 'middle');
});

test('dataflow: inspect exposes an infeasible readable-width range without changing renderer quality gates', () => {
  const source = load('product-analytics.dataflow.json');
  source.nodes[0].sublabel = 'x'.repeat(27);
  const { result, report } = inspect('dataflow', source, 'width-constraint-conflict');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(report.validation.status, 'pass');
  assert.equal(report.resolved.status, 'complete');
  assert.deepEqual(report.constraints.viewBox, {
    current: { width: 1080, height: 760 },
    minViewBoxWidth: 1068,
    maxReadableViewBoxWidth: 992,
    widthFeasible: false,
    limitingText: {
      path: '/nodes/0/sublabel',
      id: 'web',
      sourceFontPx: 6.4,
    },
  });
});

test('dataflow: a node with an invalid stage identifies the exact authored control and range', () => {
  const source = load('product-analytics.dataflow.json');
  source.nodes[0].stage = 99;
  const { result, report } = inspect('dataflow', source, 'invalid-stage-diagnostic');

  assert.notEqual(result.status, 0);
  assert.equal(report.resolved.status, 'partial');
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'layout/dataflow-node-stage'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.deepEqual(issue.subject, {
    diagramType: 'dataflow',
    path: '/nodes/0/stage',
    id: 'web',
  });
  assert.deepEqual(issue.evidence, {
    currentStage: 99,
    allowedStage: { min: 0, max: 4 },
  });
  assert.deepEqual(issue.supportedFixes, [
    'set /nodes/0/stage to an integer between 0 and 4',
  ]);
});

test('dataflow: overlapping nodes identify both authored entities and measured clearance', () => {
  const source = load('product-analytics.dataflow.json');
  source.nodes.push({ ...source.nodes[0], id: 'overlapping-copy' });
  const { result, report } = inspect('dataflow', source, 'node-overlap-diagnostic');

  assert.notEqual(result.status, 0);
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'layout/entity-overlap'
    && entry.subject?.id === 'overlapping-copy'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.deepEqual(issue.subject, {
    diagramType: 'dataflow',
    collection: 'nodes',
    index: 10,
    path: '/nodes/10',
    id: 'overlapping-copy',
  });
  assert.deepEqual(issue.evidence.otherEntity, {
    collection: 'nodes',
    index: 0,
    path: '/nodes/0',
    id: 'web',
  });
  assert.deepEqual(issue.evidence.entityRect, {
    x: 44,
    y: 128,
    width: 112,
    height: 58,
  });
  assert.deepEqual(issue.evidence.otherEntityRect, issue.evidence.entityRect);
  assert.equal(issue.evidence.clearancePx, 0);
  assert.equal(issue.evidence.minimumGapPx, 10);
  assert.ok(issue.supportedFixes.some((fix) => fix.includes('/nodes/10/stage')));
});

test('lifecycle: cross-lane state overlap identifies both authored states and shared geometry', () => {
  const source = load('agent-run.lifecycle.json');
  const approval = source.states.find((state) => state.id === 'approval');
  const failed = source.states.find((state) => state.id === 'failed');
  failed.col = approval.col;
  delete failed.yOffset;
  const { result, report } = inspect('lifecycle', source, 'state-overlap-diagnostic');

  assert.notEqual(result.status, 0);
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'layout/entity-overlap'
    && entry.subject?.id === 'failed'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.deepEqual(issue.subject, {
    diagramType: 'lifecycle',
    collection: 'states',
    index: 7,
    path: '/states/7',
    id: 'failed',
  });
  assert.deepEqual(issue.evidence.otherEntity, {
    collection: 'states',
    index: 5,
    path: '/states/5',
    id: 'approval',
  });
  assert.deepEqual(issue.evidence.entityRect, issue.evidence.otherEntityRect);
  assert.equal(issue.evidence.clearancePx, 0);
  assert.equal(issue.evidence.minimumGapPx, 10);
  assert.ok(issue.supportedFixes.some((fix) => fix.includes('/states/7/col')));
  assert.ok(issue.supportedFixes.some((fix) => fix.includes('/states/7/yOffset')));
});

test('lifecycle: a label-state collision returns exact evidence and obstacle-free labelAt candidates', () => {
  const source = load('agent-run.lifecycle.json');
  source.transitions[0].label = 'approval needed';
  source.transitions[0].labelAt = [248, 157];
  const { result, report } = inspect('lifecycle', source, 'label-obstacle-diagnostic');

  assert.notEqual(result.status, 0);
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'composition/relationship-label-obstacle'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.deepEqual(issue.subject, {
    diagramType: 'lifecycle',
    collection: 'transitions',
    index: 0,
    path: '/transitions/0/labelAt',
    id: 'approval-needed',
    from: 'executing',
    to: 'approval',
  });
  assert.deepEqual(issue.evidence.obstacle, {
    collection: 'states',
    index: 1,
    path: '/states/1',
    id: 'planning',
  });
  assert.deepEqual(issue.evidence.labelRect, {
    x: 205.25,
    y: 146,
    width: 85.5,
    height: 16,
  });
  assert.deepEqual(issue.evidence.obstacleRect, {
    x: 189,
    y: 126,
    width: 118,
    height: 62,
  });
  assert.equal(issue.evidence.minimumGapPx, 4);
  assert.deepEqual(issue.evidence.obstacleFreeLabelAt, [
    [248, 117],
    [248, 203],
  ]);
  assert.ok(issue.supportedFixes.every((fix) => fix.includes('/transitions/0/labelAt')));
  assert.doesNotMatch(issue.supportedFixes.join('\n'), /delete|remove|font|shorten/i);
});

test('dataflow: a label-node collision uses the same deterministic repair contract', () => {
  const source = load('product-analytics.dataflow.json');
  source.flows[0].labelAt = [100, 385];
  const { result, report } = inspect('dataflow', source, 'label-obstacle-diagnostic');

  assert.notEqual(result.status, 0);
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'composition/relationship-label-obstacle'
    && entry.subject?.path === '/flows/0/labelAt'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.equal(issue.subject.id, 'web-clickstream');
  assert.deepEqual(issue.evidence.obstacle, {
    collection: 'nodes',
    index: 1,
    path: '/nodes/1',
    id: 'mobile',
  });
  assert.ok(issue.evidence.obstacleFreeLabelAt.length > 0);
  assert.ok(issue.supportedFixes.every((fix) => fix.includes('/flows/0/labelAt')));
});

test('lifecycle: overlapping labels return one exact movable relationship without semantic deletion', () => {
  const source = load('agent-run.lifecycle.json');
  source.transitions[0].label = 'approval needed';
  source.transitions[0].labelAt = [500, 240];
  source.transitions[1].label = 'blocked';
  source.transitions[1].labelAt = [500, 240];
  const { result, report } = inspect('lifecycle', source, 'label-pair-diagnostic');

  assert.notEqual(result.status, 0);
  const issue = report.validation.diagnostics.find((entry) => (
    entry.code === 'composition/relationship-label-overlap'
  ));
  assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
  assert.deepEqual(issue.subject, {
    diagramType: 'lifecycle',
    collection: 'transitions',
    index: 1,
    path: '/transitions/1/labelAt',
    id: 'review-blocked',
    from: 'reviewing',
    to: 'blocked',
  });
  assert.deepEqual(issue.evidence.otherRelationship, {
    diagramType: 'lifecycle',
    collection: 'transitions',
    index: 0,
    path: '/transitions/0/labelAt',
    id: 'approval-needed',
    from: 'executing',
    to: 'approval',
  });
  assert.equal(issue.evidence.minimumGapPx, 4);
  assert.ok(issue.evidence.obstacleFreeLabelAt.length > 0);
  assert.ok(issue.supportedFixes.every((fix) => fix.includes('/transitions/1/labelAt')));
  assert.doesNotMatch(issue.supportedFixes.join('\n'), /delete|remove|font|shorten/i);
});

for (const [type, definition] of Object.entries(CASES)) {
  test(`${type}: --layout-json emits one unified passing resolved-layout report without writing HTML`, () => {
    const source = load(definition.example);
    definition.prepare?.(source);
    const { result, report } = inspect(type, source, 'pass');

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.ok, true);
    assert.equal(report.type, type);
    assert.equal(report.diagram_type, type);
    assert.ok(Array.isArray(report.viewBox));
    assert.equal(report.viewBox.length, 2);
    assert.deepEqual(report.validation, { status: 'pass', diagnostics: [] });
    assert.equal(report.resolved.status, 'complete');
    assert.ok(Array.isArray(report.resolved[definition.entityKey]));
    assert.ok(report.resolved[definition.entityKey].length > 0);
    assert.equal(report.resolved.relationships.length, definition.relationshipCount(source));
    assert.ok(report.resolved.relationships.every((relationship) => (
      Array.isArray(relationship.points)
      && relationship.points.length >= 2
      && relationship.points.flat().every(Number.isFinite)
    )));
    assert.ok(Array.isArray(report.resolved.labels));
    assert.equal(report.resolved.labels.length, definition.labelCount(source));
    assert.ok(report.resolved.labels.every((label) => (
      [label.x, label.y, label.width, label.height].every(Number.isFinite)
    )));
  });

  test(`${type}: --layout-json preserves partial resolved geometry when validation fails`, () => {
    const source = load(definition.example);
    definition.prepare?.(source);
    definition.breakGeometry(source);
    const { result, report } = inspect(type, source, 'fail');

    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.ok, false);
    assert.equal(report.type, type);
    assert.equal(report.validation.status, 'fail');
    assert.ok(report.validation.error);
    assert.ok(report.validation.diagnostics.length > 0);
    assert.ok(report.validation.diagnostics.every((diagnostic) => (
      diagnostic.code
      && diagnostic.message
      && diagnostic.subject
      && diagnostic.evidence
      && Array.isArray(diagnostic.supportedFixes)
    )));
    assert.equal(report.resolved.status, 'partial');
    assert.ok(report.resolved[definition.entityKey].length > 0);
    assert.ok(Array.isArray(report.resolved.relationships));
    assert.ok(Array.isArray(report.resolved.labels));
  });
}

test('lifecycle: inspect summarizes the feasible viewBox range including terminal-state reserve', () => {
  const source = load('agent-run.lifecycle.json');
  const { result, report } = inspect('lifecycle', source, 'layout-constraints');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(report.constraints.viewBox, {
    current: { width: 980, height: 660 },
    minViewBoxWidth: 801,
    maxReadableViewBoxWidth: 1085,
    widthFeasible: true,
    minViewBoxHeight: 630,
  });
});

test('architecture: legacy inspect aliases preserve their original rounded shape', () => {
  const source = load('web-app.architecture.json');
  source.components[0].pos = [40.4, 300.4];
  source.components[0].size = [120.25, 60.5];
  const { result, report } = inspect('architecture', source, 'legacy-aliases');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(report.components[0], {
    id: 'users',
    type: 'external',
    label: 'Users',
    x: 40,
    y: 300,
    width: 120.25,
    height: 60.5,
    pos: [40, 300],
  });
  assert.equal(report.resolved.components[0].x, 40.4);
  assert.equal(report.resolved.components[0].y, 300.4);
  assert.ok(report.resolved.relationships[0].id);
  assert.ok(Number.isInteger(report.resolved.relationships[0].collectionIndex));
  assert.equal('id' in report.connections[0], false);
  assert.equal('collectionIndex' in report.connections[0], false);
  assert.ok(report.connections[0].points.flat().every(Number.isInteger));
  assert.deepEqual(Object.keys(report.labels[0]).sort(), [
    'height',
    'labelAt',
    'text',
    'width',
    'x',
    'y',
  ]);
  assert.ok(report.boundaries.every((boundary) => (
    [boundary.x, boundary.y, boundary.width, boundary.height].every(Number.isInteger)
  )));
});

const LABEL_CONTAINMENT_CASES = {
  dataflow: {
    example: 'product-analytics.dataflow.json',
    path: '/flows/0/labelAt',
    mutate(source) {
      source.flows[0].labelAt = [10000, 190];
    },
  },
  lifecycle: {
    example: 'agent-run.lifecycle.json',
    path: '/transitions/0/labelAt',
    mutate(source) {
      source.transitions[0].label = 'approval needed';
      source.transitions[0].labelAt = [10000, 200];
    },
  },
  sequence: {
    example: 'cache-miss-request.sequence.json',
    path: '/messages/0/label',
    mutate(source) {
      source.messages = [{ ...source.messages[0], label: 'X'.repeat(400) }];
    },
  },
};

for (const [type, definition] of Object.entries(LABEL_CONTAINMENT_CASES)) {
  test(`${type}: inspect rejects an out-of-viewBox relationship label at the real authored control`, () => {
    const source = load(definition.example);
    definition.mutate(source);
    const { result, report } = inspect(type, source, 'label-containment');

    assert.notEqual(result.status, 0);
    assert.equal(report.validation.status, 'fail');
    const issue = report.validation.diagnostics.find((entry) => (
      entry.code === 'composition/relationship-label-containment'
      && entry.subject?.path === definition.path
    ));
    assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
    assert.ok(Object.values(issue.evidence.overflow).some((value) => value > 0));
    assert.ok(issue.supportedFixes.length > 0);
    assert.doesNotMatch(issue.supportedFixes.join('\n'), /\/relationships\//);
    if (type === 'sequence') {
      assert.ok(issue.supportedFixes.some((fix) => fix.includes('/meta/column_fit')));
      assert.ok(issue.supportedFixes.some((fix) => fix.includes('preserving its meaning')));
      assert.doesNotMatch(issue.supportedFixes.join('\n'), /labelAt/);
    } else {
      assert.ok(issue.evidence.allowedLabelAt);
    }
  });
}

const OVERSIZED_RELATIONSHIP_LABEL_CASES = {
  architecture: { collection: 'connections' },
  dataflow: { collection: 'flows' },
  lifecycle: { collection: 'transitions' },
};

for (const [type, definition] of Object.entries(OVERSIZED_RELATIONSHIP_LABEL_CASES)) {
  test(`${type}: an oversized relationship label recommends text/viewBox repair, not impossible labelAt coordinates`, () => {
    const source = load(CASES[type].example);
    source[definition.collection][0].label = '界'.repeat(200);
    const { result, report } = inspect(type, source, 'oversized-label');

    assert.notEqual(result.status, 0);
    const issue = report.validation.diagnostics.find((entry) => (
      entry.code === 'composition/relationship-label-containment'
      && entry.subject?.path === `/${definition.collection}/0/label`
    ));
    assert.ok(issue, JSON.stringify(report.validation.diagnostics, null, 2));
    assert.equal(issue.evidence.translationFeasible.x, false);
    assert.equal(issue.evidence.allowedLabelAt, undefined);
    assert.ok(issue.evidence.minimumViewBox.width > issue.evidence.viewBox.width);
    assert.match(issue.supportedFixes.join('\n'), new RegExp(`shorten /${definition.collection}/0/label`));
    assert.match(issue.supportedFixes.join('\n'), /increase \/meta\/viewBox\/0 to at least/);
    assert.doesNotMatch(issue.supportedFixes.join('\n'), /inside x .*\.\./);
  });
}

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
