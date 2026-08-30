import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHorizontalRankMapper,
  migrateWorkflowDocument,
} from '../migrations/workflow-v2.mjs';
import {
  createMappedWorkflowCandidate,
  intrinsicWorkflow,
  planningWorkflow,
} from '../renderers/workflow/workflow-migration-geometry.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixture = path.join(
  __dirname,
  'fixtures',
  'v1-workflow-explicit-coordinates.workflow.json',
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-migration-'));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runMigration(source, destination, { importModule, env } = {}) {
  return spawnSync(process.execPath, [
    ...(importModule ? ['--import', importModule] : []),
    cli,
    'migrate',
    'workflow',
    source,
    destination,
    '--to-schema',
    '2',
    '--json',
  ], {
    encoding: 'utf8',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

function runValidation(source) {
  return spawnSync(process.execPath, [cli, 'validate', 'workflow', source, '--json'], {
    encoding: 'utf8',
  });
}

function parseJsonOutput(result) {
  assert.doesNotThrow(
    () => JSON.parse(result.stdout),
    `expected JSON stdout, received:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

function copyFixture(name, mutate = (value) => value) {
  const source = path.join(tmp, name);
  const value = mutate(JSON.parse(fs.readFileSync(fixture, 'utf8')));
  fs.writeFileSync(source, `${JSON.stringify(value, null, 2)}\n`);
  return source;
}

function explicitPinConflictWorkflow() {
  return {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Unmappable explicit label pin',
      viewBox: [900, 420],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 5, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      label: 'outside',
      labelAt: [365, -20],
    }],
  };
}

function heightConstrainedWorkflow() {
  return {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Legacy height capacity',
      viewBox: [720, 240],
      legend: { mode: 'hidden' },
    },
    lanes: [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
    ],
    nodes: [
      { id: 'a', lane: 'first', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'second', col: 2, type: 'database', label: 'B' },
    ],
    edges: [],
  };
}

function profileDivergenceWorkflow() {
  return {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'profile divergence',
      quality_profile: 'showcase',
      legend: { mode: 'hidden' },
    },
    lanes: [
      { id: 'top', label: 'Top' },
      { id: 'middle', label: 'Middle' },
      { id: 'bottom', label: 'Bottom' },
      { id: 'issue', label: 'Issue' },
    ],
    nodes: [
      { id: 'left', lane: 'middle', col: 0, type: 'backend', label: 'Left' },
      { id: 'right', lane: 'middle', col: 4, type: 'backend', label: 'Right' },
      { id: 'above', lane: 'top', col: 2, type: 'backend', label: 'Above' },
      { id: 'below', lane: 'bottom', col: 2, type: 'backend', label: 'Below' },
      { id: 'a', lane: 'issue', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'issue', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'horizontal', from: 'left', to: 'right', via: [[244, 243]] },
      { id: 'vertical', from: 'above', to: 'below', via: [[300, 200]] },
    ],
  };
}

test('migration geometry helpers construct mapped v2 candidates without mutating the source', () => {
  const source = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Pure migration geometry', viewBox: [720, 400], legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    mainPath: ['a', 'b'],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      label: 'pin',
      fromSide: 'top',
      toSide: 'top',
      via: [[220, 60], [260, 60], [300, 60]],
      labelAt: [260, 42],
      channelX: 260,
    }],
  };
  const sourceBefore = JSON.parse(JSON.stringify(source));

  const intrinsic = intrinsicWorkflow(source);
  assert.equal(intrinsic.schema_version, 2);
  assert.equal('viewBox' in intrinsic.meta, false);
  assert.deepEqual(intrinsic.edges, source.edges);

  const planning = planningWorkflow(source);
  assert.deepEqual(planning.edges, []);
  assert.equal('mainPath' in planning, false);

  const mapX = createHorizontalRankMapper([88, 220, 300], [94, 214, 334]);
  assert.equal(mapX(260), 274, 'the migration module must preserve the mapper re-export');

  const mapped = createMappedWorkflowCandidate(
    source,
    [88, 220, 300],
    [94, 214, 334],
  );
  assert.equal(mapped.document.schema_version, 2);
  assert.deepEqual(mapped.document.meta.viewBox, [720, 400]);
  assert.deepEqual(mapped.document.edges[0].via, [[214, 60], [274, 60], [334, 60]]);
  assert.deepEqual(mapped.document.edges[0].labelAt, [274, 42]);
  assert.equal(mapped.document.edges[0].channelX, 274);
  assert.deepEqual(mapped.changedCoordinates, [
    { path: '/edges/0/via/0/0', from: 220, to: 214 },
    { path: '/edges/0/via/1/0', from: 260, to: 274 },
    { path: '/edges/0/via/2/0', from: 300, to: 334 },
    { path: '/edges/0/labelAt/0', from: 260, to: 274 },
    { path: '/edges/0/channelX', from: 260, to: 274 },
  ]);
  assert.deepEqual(source, sourceBefore);
});

test('document migration treats a legacy explicit viewBox as capacity and expands it monotonically', () => {
  const source = heightConstrainedWorkflow();
  const sourceBefore = JSON.parse(JSON.stringify(source));

  const migration = migrateWorkflowDocument(source);

  assert.equal(migration.ok, true, JSON.stringify(migration, null, 2));
  assert.deepEqual(source, sourceBefore, 'the document migration must not mutate its input');
  assert.deepEqual(migration.document.meta.viewBox, [768, 404]);
  assert.deepEqual(migration.document.meta.viewBox, migration.newRequiredViewBox);
  assert.ok(migration.document.meta.viewBox[0] >= source.meta.viewBox[0]);
  assert.ok(migration.document.meta.viewBox[1] >= source.meta.viewBox[1]);
  assert.ok(migration.preExistingDiagnostics.some(({ message }) => (
    /viewBox height 240/.test(message)
  )), JSON.stringify(migration.preExistingDiagnostics, null, 2));
  assert.deepEqual(migration.migrationDiagnostics, []);
  assert.deepEqual(migration.newSchemaDiagnostics, []);
});

test('CLI atomically commits a capacity-expanded migration and preserves source bytes', () => {
  const source = path.join(tmp, 'height-capacity-source.workflow.json');
  const destination = path.join(tmp, 'height-capacity-destination.workflow.json');
  const sourceBytes = Buffer.from(`${JSON.stringify(heightConstrainedWorkflow(), null, 2)}\n`);
  fs.writeFileSync(source, sourceBytes);
  fs.writeFileSync(destination, 'destination sentinel\n');

  const result = runMigration(source, destination);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(source), sourceBytes, 'the CLI must preserve source bytes');
  const destinationBytes = fs.readFileSync(destination);
  const migrated = JSON.parse(destinationBytes);
  const report = parseJsonOutput(result);
  assert.equal(report.ok, true);
  assert.equal(migrated.schema_version, 2);
  assert.deepEqual(migrated.meta.viewBox, [768, 404]);
  assert.deepEqual(migrated.meta.viewBox, report.newRequiredViewBox);
  assert.ok(migrated.meta.viewBox[0] >= 720);
  assert.ok(migrated.meta.viewBox[1] >= 240);
  assert.deepEqual(report.destination, {
    path: path.resolve(destination),
    sha256: sha256(destinationBytes),
    bytes: destinationBytes.length,
  });
  assert.deepEqual(report.migrationDiagnostics, []);
  assert.deepEqual(report.newSchemaDiagnostics, []);
});

test('column-capacity diagnostics do not advertise migration across a quality-profile divergence', () => {
  const document = profileDivergenceWorkflow();
  const standard = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(standard.ok, false);
  const capacity = standard.diagnostics.find(({ code }) => code === 'workflow/column-capacity');
  assert.ok(capacity, JSON.stringify(standard.diagnostics, null, 2));

  const migration = migrateWorkflowDocument(document);
  assert.equal(migration.ok, false, 'the authored showcase migration must reject its pinned crossing');
  assert.ok(migration.newSchemaDiagnostics.some(({ code, evidence }) => (
    code === 'workflow/explicit-pin-conflict'
    && evidence?.invariant === 'explicit route-route crossing'
  )), JSON.stringify(migration, null, 2));
  assert.ok(
    capacity.supportedFixes.every((fix) => !/migrate this workflow/i.test(fix)),
    `a standard-only verification must not advertise the failing authored showcase migration: ${capacity.supportedFixes}`,
  );
});

test('document migration uses the authored profile and returns an independently compilable document', () => {
  const document = profileDivergenceWorkflow();
  document.meta.quality_profile = 'standard';

  const migration = migrateWorkflowDocument(document);

  assert.equal(migration.ok, true, JSON.stringify(migration, null, 2));
  assert.deepEqual(migration.migrationDiagnostics, []);
  assert.deepEqual(migration.newSchemaDiagnostics, []);
  const standalone = compileWorkflow({ workflow: migration.document });
  assert.equal(standalone.ok, true, JSON.stringify(standalone.diagnostics, null, 2));
});

test('document migration defaults an omitted profile to standard', () => {
  const document = profileDivergenceWorkflow();
  delete document.meta.quality_profile;

  const migration = migrateWorkflowDocument(document);

  assert.equal(migration.ok, true, JSON.stringify(migration, null, 2));
  const standalone = compileWorkflow({ workflow: migration.document });
  assert.equal(standalone.ok, true, JSON.stringify(standalone.diagnostics, null, 2));
});

test('CLI migration ignores ambient standard for an authored showcase workflow', () => {
  const source = path.join(tmp, 'authored-showcase-source.workflow.json');
  const destination = path.join(tmp, 'authored-showcase-destination.workflow.json');
  const sourceBytes = Buffer.from(`${JSON.stringify(profileDivergenceWorkflow(), null, 2)}\n`);
  fs.writeFileSync(source, sourceBytes);

  const migration = runMigration(source, destination, {
    env: { ARCHIFY_QUALITY_PROFILE: 'standard' },
  });

  assert.notEqual(migration.status, 0);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.equal(fs.existsSync(destination), false);
  const report = parseJsonOutput(migration);
  assert.equal(report.ok, false);
  assert.ok(report.newSchemaDiagnostics.some(({ code, evidence }) => (
    code === 'workflow/explicit-pin-conflict'
    && evidence?.invariant === 'explicit route-route crossing'
  )), JSON.stringify(report, null, 2));
});

test('CLI migration ignores ambient showcase for an authored standard workflow', () => {
  const source = path.join(tmp, 'authored-standard-source.workflow.json');
  const destination = path.join(tmp, 'authored-standard-destination.workflow.json');
  const document = profileDivergenceWorkflow();
  document.meta.quality_profile = 'standard';
  const sourceBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  fs.writeFileSync(source, sourceBytes);

  const migration = runMigration(source, destination, {
    env: { ARCHIFY_QUALITY_PROFILE: 'showcase' },
  });

  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.equal(fs.existsSync(destination), true);
  const report = parseJsonOutput(migration);
  assert.equal(report.ok, true);
  const migrated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  const standalone = compileWorkflow({ workflow: migrated });
  assert.equal(standalone.ok, true, JSON.stringify(standalone.diagnostics, null, 2));
});

test('CLI migration makes the blocking new-schema diagnostic primary over pre-existing findings', () => {
  const source = path.join(tmp, 'blocking-diagnostic-source.workflow.json');
  const destination = path.join(tmp, 'blocking-diagnostic-destination.workflow.json');
  fs.writeFileSync(source, `${JSON.stringify(profileDivergenceWorkflow(), null, 2)}\n`);

  const migration = runMigration(source, destination, {
    env: { ARCHIFY_QUALITY_PROFILE: 'showcase' },
  });

  assert.notEqual(migration.status, 0);
  assert.equal(fs.existsSync(destination), false);
  const report = parseJsonOutput(migration);
  assert.equal(report.ok, false);
  assert.equal(report.preExistingDiagnostics[0].code, 'workflow/column-capacity');
  const blocker = report.newSchemaDiagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.ok(blocker, JSON.stringify(report, null, 2));
  assert.equal(report.error, blocker.message);
  assert.deepEqual(report.diagnostics[0], blocker);
  assert.ok(report.diagnostics.some(({ code }) => code === 'workflow/column-capacity'));
});

test('workflow migration remaps absolute x coordinates, expands only the constrained viewBox axis, and reports hashes', () => {
  const source = copyFixture('pinned-source.workflow.json');
  const destination = path.join(tmp, 'pinned-destination.workflow.json');
  const sourceBefore = fs.readFileSync(source);

  const result = runMigration(source, destination);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(source), sourceBefore, 'migration must not mutate its source bytes');
  assert.equal(fs.existsSync(destination), true);

  const migratedBytes = fs.readFileSync(destination);
  const migrated = JSON.parse(migratedBytes);
  assert.equal(migrated.schema_version, 2);
  assert.deepEqual(migrated.meta.viewBox, [768, 700], 'width grows to fit v2 while sufficient height is preserved');
  assert.deepEqual(migrated.edges[0].via, [[214, 119]]);
  assert.deepEqual(migrated.edges[1].labelAt, [394, 203]);
  assert.equal(migrated.edges[2].channelX, 574);

  const report = parseJsonOutput(result);
  assert.equal(report.ok, true);
  assert.equal(report.command, 'migrate');
  assert.equal(report.type, 'workflow');
  assert.equal(report.fromSchemaVersion, 1);
  assert.equal(report.toSchemaVersion, 2);
  assert.deepEqual(report.source, {
    path: path.resolve(source),
    sha256: sha256(sourceBefore),
    bytes: sourceBefore.length,
  });
  assert.deepEqual(report.destination, {
    path: path.resolve(destination),
    sha256: sha256(migratedBytes),
    bytes: migratedBytes.length,
  });
  assert.deepEqual(report.preExistingDiagnostics, []);
  assert.ok(Array.isArray(report.migrationDiagnostics));
  assert.deepEqual(report.newSchemaDiagnostics, []);
  assert.deepEqual(report.changedCoordinates, [
    { path: '/edges/0/via/0/0', from: 220, to: 214 },
    { path: '/edges/1/labelAt/0', from: 365, to: 394 },
    { path: '/edges/2/channelX', from: 500, to: 574 },
  ]);
  assert.deepEqual(report.oldRequiredViewBox, [720, 652]);
  assert.deepEqual(report.newRequiredViewBox, [768, 652]);
});

test('workflow migration never shrinks an already spacious explicit viewBox', () => {
  const source = copyFixture('spacious-source.workflow.json', (workflow) => {
    workflow.meta.viewBox = [1600, 900];
    return workflow;
  });
  const destination = path.join(tmp, 'spacious-destination.workflow.json');

  const result = runMigration(source, destination);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const migrated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.deepEqual(migrated.meta.viewBox, [1600, 900]);
  assert.equal(parseJsonOutput(result).destination.sha256, sha256(fs.readFileSync(destination)));
});

test('workflow migration reports the measured legacy requirement separately from authored capacity', () => {
  const source = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Spacious legacy capacity',
      viewBox: [1600, 900],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'only', lane: 'main', col: 0, type: 'backend', label: 'Only' }],
    edges: [],
  };

  const migration = migrateWorkflowDocument(source);

  assert.equal(migration.ok, true, JSON.stringify(migration, null, 2));
  assert.deepEqual(migration.oldRequiredViewBox, [720, 280]);
  assert.deepEqual(migration.document.meta.viewBox, [1600, 900]);
  assert.deepEqual(migration.newRequiredViewBox, [768, 280]);
});

test('workflow migration staging never aliases a destination named like its verification artifact', () => {
  const source = copyFixture('artifact-name-source.workflow.json');
  const destination = path.join(tmp, 'migration-check.html');

  const result = runMigration(source, destination);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).schema_version, 2);
  assert.equal(parseJsonOutput(result).destination.path, path.resolve(destination));
});

test('workflow migration cleanup failure warns without reversing a successful commit', () => {
  const source = copyFixture('cleanup-warning-source.workflow.json');
  const destination = path.join(tmp, 'cleanup-warning-destination.workflow.json');
  const importModule = path.join(__dirname, 'fixtures', 'fail-migration-cleanup.mjs');

  const result = runMigration(source, destination, { importModule });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).schema_version, 2);
  assert.equal(parseJsonOutput(result).ok, true);
  assert.match(result.stderr, /Warning: could not remove workflow migration staging directory/);
  assert.match(result.stderr, /simulated migration cleanup failure/);
});

test('workflow migration is idempotent when its v2 destination is migrated again', () => {
  const source = copyFixture('idempotent-source.workflow.json');
  const firstDestination = path.join(tmp, 'idempotent-first.workflow.json');
  const secondDestination = path.join(tmp, 'idempotent-second.workflow.json');

  const first = runMigration(source, firstDestination);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = runMigration(firstDestination, secondDestination);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const firstBytes = fs.readFileSync(firstDestination);
  const secondBytes = fs.readFileSync(secondDestination);
  assert.deepEqual(secondBytes, firstBytes);

  const report = parseJsonOutput(second);
  assert.equal(report.fromSchemaVersion, 2);
  assert.equal(report.toSchemaVersion, 2);
  assert.deepEqual(report.changedCoordinates, []);
  assert.deepEqual(report.preExistingDiagnostics, []);
  assert.deepEqual(report.migrationDiagnostics, []);
  assert.deepEqual(report.newSchemaDiagnostics, []);
  assert.equal(report.destination.sha256, report.source.sha256);
  assert.deepEqual(report.newRequiredViewBox, report.oldRequiredViewBox);
});

test('fallback planning preserves straight-edge rank constraints when mapping absolute pins', () => {
  const source = path.join(tmp, 'fallback-rank-source.workflow.json');
  const destination = path.join(tmp, 'fallback-rank-destination.workflow.json');
  const document = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Fallback rank mapping', viewBox: [720, 520], legend: { mode: 'hidden' } },
    lanes: [
      { id: 'pin', label: 'Pinned label' },
      { id: 'straight', label: 'Straight constraint' },
      { id: 'blocker', label: 'Blocker' },
    ],
    nodes: [
      { id: 'a', lane: 'pin', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'pin', col: 1, type: 'backend', label: 'B' },
      { id: 'c', lane: 'straight', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'straight', col: 1, type: 'backend', label: 'D' },
      { id: 'obstacle', lane: 'blocker', col: 4, type: 'database', label: 'Obstacle' },
    ],
    mainPath: ['a', 'b'],
    edges: [
      {
        id: 'pin-edge',
        from: 'a',
        to: 'b',
        label: 'p',
        labelAt: [562, 367],
        route: 'bottom-channel',
        fromSide: 'bottom',
        toSide: 'bottom',
      },
      { id: 'straight-edge', from: 'c', to: 'd', label: 'x', route: 'straight' },
    ],
  };
  fs.writeFileSync(source, `${JSON.stringify(document, null, 2)}\n`);

  const result = runMigration(source, destination);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const migrated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.deepEqual(migrated.edges[0].labelAt, [643.52, 367]);
  const report = parseJsonOutput(result);
  assert.deepEqual(report.changedCoordinates, [{
    path: '/edges/0/labelAt/0',
    from: 562,
    to: 643.52,
  }]);
  assert.deepEqual(report.newSchemaDiagnostics, []);
});

for (const { example, expectedEdge } of [
  { example: 'incident-response.workflow.json', expectedEdge: ['alert', 'page'] },
  { example: 'release-delivery.workflow.json', expectedEdge: ['pull_request', 'build'] },
]) {
  test(`workflow migration preserves causal route diagnostics for packaged ${example}`, () => {
    const source = path.join(skillRoot, 'examples', example);
    const destination = path.join(tmp, `migrated-${example}`);
    const sourceBefore = fs.readFileSync(source);

    const validation = runValidation(source);
    assert.equal(validation.status, 0, validation.stderr || validation.stdout);
    const result = runMigration(source, destination);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readFileSync(source), sourceBefore);

    const failure = parseJsonOutput(result);
    assert.equal(failure.diagnostics.length, 1, JSON.stringify(failure.diagnostics, null, 2));
    assert.ok(failure.diagnostics.every(({ message }) => !/mainPath step .* no matching edge/.test(message)));
    const [diagnostic] = failure.diagnostics;
    assert.equal(diagnostic.code, 'workflow/route-preset-conflict');
    assert.deepEqual([diagnostic.subject?.from, diagnostic.subject?.to], expectedEdge);
    assert.equal(diagnostic.subject?.route, 'drop');
  });
}

test('workflow migration rejects the source path as its destination without changing the file', () => {
  const source = copyFixture('same-path.workflow.json');
  const sourceBefore = fs.readFileSync(source);

  const result = runMigration(source, source);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(source), sourceBefore);

  const failure = parseJsonOutput(result);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'migrate');
  assert.ok(Array.isArray(failure.diagnostics));
  assert.equal(failure.diagnostics.length, 1);
  assert.equal(failure.diagnostics[0].code, 'migration/source-destination');
  assert.match(failure.error, /source|destination/i);
  assert.ok(failure.diagnostics[0].supportedFixes.some((fix) => /different.*destination/i.test(fix)));
});

test('workflow migration reports a cyclic-symlink destination as structured JSON', () => {
  const source = copyFixture('symlink-cycle-source.workflow.json');
  const destination = path.join(tmp, 'migration-cycle-a.workflow.json');
  const otherLink = path.join(tmp, 'migration-cycle-b.workflow.json');
  fs.symlinkSync(otherLink, destination, 'file');
  fs.symlinkSync(destination, otherLink, 'file');

  const result = runMigration(source, destination);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, '');
  const failure = parseJsonOutput(result);
  assert.equal(failure.ok, false);
  assert.equal(failure.diagnostics[0].code, 'output/symlink-cycle');
  assert.equal(failure.diagnostics[0].subject.output, path.resolve(destination));
});

test('failed workflow migration emits diagnostics and never writes its destination', () => {
  const source = path.join(tmp, 'pin-conflict-source.workflow.json');
  const destination = path.join(tmp, 'pin-conflict-destination.workflow.json');
  fs.writeFileSync(source, `${JSON.stringify(explicitPinConflictWorkflow(), null, 2)}\n`);
  assert.equal(fs.existsSync(destination), false);

  const result = runMigration(source, destination);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(destination), false, 'a failed migration must not leave a partial destination');

  const failure = parseJsonOutput(result);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'migrate');
  assert.ok(Array.isArray(failure.diagnostics));
  assert.ok(
    failure.diagnostics.some(({ code }) => code === 'workflow/explicit-pin-conflict'),
    JSON.stringify(failure.diagnostics, null, 2),
  );
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
