import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
const benchmark = path.join(repoRoot, 'benchmarks/ordinary-model-floor/benchmark.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ordinary-model-floor-'));

function writeJson(name, value) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function run(args) {
  return spawnSync(process.execPath, [benchmark, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function renameCandidateIds(candidate, mapping) {
  for (const collection of ['components', 'nodes', 'participants', 'states']) {
    for (const node of candidate[collection] || []) {
      node.id = mapping.get(node.id) || node.id;
    }
  }
  for (const collection of ['connections', 'edges', 'messages', 'flows', 'transitions']) {
    for (const relationship of candidate[collection] || []) {
      relationship.from = mapping.get(relationship.from) || relationship.from;
      relationship.to = mapping.get(relationship.to) || relationship.to;
    }
  }
  for (const activation of candidate.activations || []) {
    activation.participant = mapping.get(activation.participant) || activation.participant;
  }
  if (Array.isArray(candidate.mainPath)) {
    candidate.mainPath = candidate.mainPath.map((id) => mapping.get(id) || id);
  }
  for (const boundary of candidate.boundaries || []) {
    boundary.wraps = boundary.wraps.map((id) => mapping.get(id) || id);
  }
  for (const view of candidate.meta?.views || []) {
    view.focus = view.focus.map((id) => mapping.get(id) || id);
  }
  return candidate;
}

test('benchmark verifies one first-pass architecture candidate through semantic, renderer, and visual-review gates', () => {
  const caseFile = writeJson('web-runtime.case.json', {
    schema_version: 1,
    id: 'web-runtime-architecture',
    diagram_type: 'architecture',
    quality_profile: 'showcase',
    requirements: {
      node_ids: ['users', 'cdn', 'lb', 'api', 'db'],
      relationships: [
        { from: 'users', to: 'cdn' },
        { from: 'cdn', to: 'lb' },
        { from: 'lb', to: 'api' },
        { from: 'api', to: 'db' },
      ],
    },
  });
  const runFile = writeJson('web-runtime.run.json', {
    schema_version: 1,
    case_id: 'web-runtime-architecture',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: {
      status: 'passed',
      reviewer: 'fixture-reviewer',
      defects: [],
    },
  });
  const candidate = path.join(skillRoot, 'examples/web-app.architecture.json');

  const result = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', runFile]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.benchmark, 'ordinary-model-floor');
  assert.equal(receipt.caseId, 'web-runtime-architecture');
  assert.deepEqual(receipt.run, {
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
  });
  assert.equal(receipt.gates.semantic.ok, true);
  assert.deepEqual(receipt.gates.semantic.missingNodeIds, []);
  assert.deepEqual(receipt.gates.semantic.missingRelationships, []);
  assert.equal(receipt.gates.validation.ok, true);
  assert.equal(receipt.gates.validation.checksPassed, 9);
  assert.deepEqual(receipt.gates.validation.composition, { errors: 0, warnings: 0 });
  assert.deepEqual(receipt.gates.visualReview, {
    status: 'passed',
    reviewer: 'fixture-reviewer',
    defects: [],
  });
  assert.equal(receipt.firstPassUsable, true);
});

test('benchmark rejects a renderer-valid candidate that changes required technical roles or relationship labels', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.components.find((component) => component.id === 'cache').type = 'frontend';
  source.connections.find((connection) => connection.from === 'api' && connection.to === 'db').label = 'HTTP';
  const candidate = writeJson('semantic-drift.architecture.json', source);
  const caseFile = writeJson('semantic-drift.case.json', {
    schema_version: 1,
    id: 'semantic-drift-architecture',
    diagram_type: 'architecture',
    quality_profile: 'showcase',
    requirements: {
      nodes: [
        { id: 'cache', type: 'database' },
        { id: 'db', type: 'database' },
      ],
      relationships: [
        { from: 'api', to: 'cache', label: 'read-through' },
        { from: 'api', to: 'db', label: 'SQL' },
      ],
    },
  });
  const runFile = writeJson('semantic-drift.run.json', {
    schema_version: 1,
    case_id: 'semantic-drift-architecture',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: {
      status: 'passed',
      reviewer: 'fixture-reviewer',
      defects: [],
    },
  });

  const result = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', runFile]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.gates.validation.ok, true, 'the deterministic renderer should still accept this controlled drift');
  assert.equal(receipt.gates.semantic.ok, false);
  assert.deepEqual(receipt.gates.semantic.mismatchedNodes, [
    { id: 'cache', field: 'type', expected: 'database', actual: 'frontend' },
  ]);
  assert.deepEqual(receipt.gates.semantic.missingRelationships, [
    { from: 'api', to: 'db', label: 'SQL' },
  ]);
  assert.equal(receipt.firstPassUsable, false);
});

test('benchmark never accepts a visual pass without an identified reviewer', () => {
  const caseFile = writeJson('unreviewed.case.json', {
    schema_version: 1,
    id: 'unreviewed-architecture',
    diagram_type: 'architecture',
    quality_profile: 'showcase',
    requirements: {
      node_ids: ['users', 'api', 'db'],
      relationships: [{ from: 'api', to: 'db' }],
    },
  });
  const runFile = writeJson('unreviewed.run.json', {
    schema_version: 1,
    case_id: 'unreviewed-architecture',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: {
      status: 'passed',
      reviewer: '',
      defects: [],
    },
  });
  const candidate = path.join(skillRoot, 'examples/web-app.architecture.json');

  const result = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', runFile]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.gates.semantic.ok, true);
  assert.equal(receipt.gates.validation.ok, true);
  assert.deepEqual(receipt.gates.visualReview, {
    status: 'invalid',
    reviewer: null,
    defects: [],
    reason: 'passed visual review requires a non-empty reviewer identity',
  });
  assert.equal(receipt.firstPassUsable, false);
});

test('benchmark applies the same semantic and delivery seam to workflow, sequence, data-flow, and lifecycle candidates', () => {
  const cases = [
    {
      type: 'workflow',
      example: 'agent-tool-call.workflow.json',
      nodes: [{ id: 'approval', type: 'security' }, { id: 'tool', type: 'messagebus' }],
      relationships: [{ from: 'router', to: 'approval', label: 'needs approval?' }],
    },
    {
      type: 'sequence',
      example: 'cache-miss-request.sequence.json',
      nodes: [{ id: 'redis', type: 'database' }, { id: 'db', type: 'database' }],
      relationships: [{ from: 'redis', to: 'api', label: 'miss' }],
    },
    {
      type: 'dataflow',
      example: 'product-analytics.dataflow.json',
      nodes: [{ id: 'consent', type: 'security' }, { id: 'pii', type: 'security' }],
      relationships: [{ from: 'consent', to: 'pii', label: 'identity map' }],
    },
    {
      type: 'lifecycle',
      example: 'agent-run.lifecycle.json',
      nodes: [{ id: 'approval', type: 'waiting' }, { id: 'cancelled', type: 'failure' }],
      relationships: [{ from: 'approval', to: 'cancelled', variant: 'security' }],
    },
  ];

  for (const item of cases) {
    const caseId = `${item.type}-representative`;
    const caseFile = writeJson(`${caseId}.case.json`, {
      schema_version: 1,
      id: caseId,
      diagram_type: item.type,
      quality_profile: 'showcase',
      requirements: {
        nodes: item.nodes,
        relationships: item.relationships,
      },
    });
    const runFile = writeJson(`${caseId}.run.json`, {
      schema_version: 1,
      case_id: caseId,
      agent: 'fixture-agent',
      model: 'fixture-model',
      attempt: 1,
      visual_review: {
        status: 'passed',
        reviewer: 'fixture-reviewer',
        defects: [],
      },
    });
    const candidate = path.join(skillRoot, 'examples', item.example);

    const result = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', runFile]);

    assert.equal(result.status, 0, `${item.type}: ${result.stderr || result.stdout}`);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.gates.semantic.ok, true, item.type);
    assert.equal(receipt.gates.validation.ok, true, item.type);
    assert.equal(receipt.firstPassUsable, true, item.type);
  }
});

test('benchmark report separates first-pass usable rate from semantic, validation, and visual-review failures by configuration', () => {
  const resultsFile = path.join(tmp, 'benchmark-results.jsonl');
  const rows = [
    {
      schemaVersion: 1,
      benchmark: 'ordinary-model-floor',
      caseId: 'architecture-runtime',
      run: { agent: 'codex', model: 'strong', attempt: 1 },
      gates: {
        semantic: { ok: true },
        validation: { ok: true },
        visualReview: { status: 'passed', reviewer: 'reviewer', defects: [] },
      },
      firstPassUsable: true,
    },
    {
      schemaVersion: 1,
      benchmark: 'ordinary-model-floor',
      caseId: 'sequence-cache-miss',
      run: { agent: 'codex', model: 'strong', attempt: 1 },
      gates: {
        semantic: { ok: true },
        validation: { ok: true },
        visualReview: { status: 'passed', reviewer: 'reviewer', defects: [] },
      },
      firstPassUsable: true,
    },
    {
      schemaVersion: 1,
      benchmark: 'ordinary-model-floor',
      caseId: 'architecture-runtime',
      run: { agent: 'opencode', model: 'ordinary', attempt: 1 },
      gates: {
        semantic: { ok: false },
        validation: { ok: true },
        visualReview: { status: 'passed', reviewer: 'reviewer', defects: [] },
      },
      firstPassUsable: false,
    },
    {
      schemaVersion: 1,
      benchmark: 'ordinary-model-floor',
      caseId: 'sequence-cache-miss',
      run: { agent: 'opencode', model: 'ordinary', attempt: 1 },
      gates: {
        semantic: { ok: true },
        validation: { ok: false },
        visualReview: { status: 'skipped', reviewer: null, defects: [] },
      },
      firstPassUsable: false,
    },
  ];
  fs.writeFileSync(resultsFile, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const result = run(['report', '--results', resultsFile]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.benchmark, 'ordinary-model-floor');
  assert.deepEqual(report.overall, {
    runs: 4,
    firstPassUsable: 2,
    firstPassUsableRate: 0.5,
    failureClusters: {
      semantic: 1,
      validation: 1,
      visualReview: 1,
      operational: 0,
    },
  });
  assert.deepEqual(report.byConfiguration, [
    {
      agent: 'codex',
      model: 'strong',
      runs: 2,
      firstPassUsable: 2,
      firstPassUsableRate: 1,
      failureClusters: { semantic: 0, validation: 0, visualReview: 0, operational: 0 },
    },
    {
      agent: 'opencode',
      model: 'ordinary',
      runs: 2,
      firstPassUsable: 0,
      firstPassUsableRate: 0,
      failureClusters: { semantic: 1, validation: 1, visualReview: 1, operational: 0 },
    },
  ]);
});

test('benchmark records a timeout without a candidate as a complete first-pass failure', () => {
  const caseFile = writeJson('timeout.case.json', {
    schema_version: 1,
    id: 'timeout-architecture',
    diagram_type: 'architecture',
    requirements: { nodes: [] },
  });
  const runFile = writeJson('timeout.run.json', {
    schema_version: 1,
    case_id: 'timeout-architecture',
    agent: 'pi',
    model: 'glm-5.2-low',
    attempt: 1,
  });

  const recorded = run([
    'record-failure',
    '--case', caseFile,
    '--run', runFile,
    '--failure', 'timeout',
  ]);

  assert.equal(recorded.status, 1, recorded.stderr || recorded.stdout);
  assert.equal(recorded.stderr, '');
  const failureReceipt = JSON.parse(recorded.stdout);
  assert.deepEqual(failureReceipt.operational, { status: 'failed', reason: 'timeout' });
  assert.equal(failureReceipt.gates.semantic.status, 'not_run');
  assert.equal(failureReceipt.gates.validation.status, 'not_run');
  assert.equal(failureReceipt.gates.visualReview.status, 'skipped');
  assert.equal(failureReceipt.firstPassUsable, false);

  const resultsFile = path.join(tmp, 'timeout-results.jsonl');
  fs.writeFileSync(resultsFile, `${JSON.stringify(failureReceipt)}\n`);
  const manifestFile = writeJson('timeout.manifest.json', {
    id: 'timeout-suite',
    cases: [{ case: caseFile }],
  });
  const reported = run(['report', '--results', resultsFile, '--manifest', manifestFile]);

  assert.equal(reported.status, 0, reported.stderr || reported.stdout);
  const report = JSON.parse(reported.stdout);
  assert.equal(report.evidenceEligible, true);
  assert.deepEqual(report.overall.failureClusters, {
    semantic: 0,
    validation: 0,
    visualReview: 0,
    operational: 1,
  });
  assert.equal(report.overall.firstPassUsableRate, 0);
});

test('benchmark semantic requirements bind by accepted technical labels instead of forcing model-authored internal IDs', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.components.find((component) => component.id === 'users').label = 'Browser Users';
  const rename = new Map([
    ['users', 'browser-users-v1'],
    ['api', 'service-api-v1'],
    ['cache', 'redis-cache-v1'],
  ]);
  for (const component of source.components) component.id = rename.get(component.id) || component.id;
  for (const connection of source.connections) {
    connection.from = rename.get(connection.from) || connection.from;
    connection.to = rename.get(connection.to) || connection.to;
  }
  source.connections.find(
    (connection) => connection.from === 'service-api-v1' && connection.to === 'redis-cache-v1',
  ).label = 'cache read-through GET / SET';
  for (const view of source.meta.views || []) {
    view.focus = view.focus.map((id) => rename.get(id) || id);
  }
  for (const boundary of source.boundaries || []) {
    boundary.wraps = boundary.wraps.map((id) => rename.get(id) || id);
  }
  const candidate = writeJson('semantic-aliases.architecture.json', source);
  const caseFile = writeJson('semantic-aliases.case.json', {
    schema_version: 1,
    id: 'semantic-aliases-architecture',
    diagram_type: 'architecture',
    quality_profile: 'showcase',
    requirements: {
      nodes: [
        { key: 'users', labels: ['Users'], type: 'external' },
        { key: 'api', labels: ['API', 'API Server'], type: 'backend' },
        { key: 'cache', labels: ['Redis', 'Redis Cache'], type: 'database' },
      ],
      relationships: [
        { from: 'api', to: 'cache', labels: ['read-through', 'cache read'] },
      ],
    },
  });
  const runFile = writeJson('semantic-aliases.run.json', {
    schema_version: 1,
    case_id: 'semantic-aliases-architecture',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: {
      status: 'passed',
      reviewer: 'fixture-reviewer',
      defects: [],
    },
  });

  const result = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', runFile]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.gates.semantic.ok, true);
  assert.deepEqual(receipt.gates.semantic.bindings, {
    users: 'browser-users-v1',
    api: 'service-api-v1',
    cache: 'redis-cache-v1',
  });
  assert.equal(receipt.firstPassUsable, true);
});

test('checked-in cases accept equivalent ordinary-model vocabulary without weakening required topology', () => {
  const suiteRoot = path.join(repoRoot, 'benchmarks/ordinary-model-floor');
  const fixtures = [
    {
      type: 'architecture',
      example: 'web-app.architecture.json',
      caseFile: 'web-runtime.architecture.case.json',
      mapping: new Map([
        ['users', 'browser-clients'], ['cdn', 'cdn-edge'], ['api', 'app-api'],
        ['cache', 'redis-store'], ['db', 'postgres-primary'],
      ]),
      mutate(candidate) {
        candidate.components.find((node) => node.id === 'browser-clients').label = 'Browser Clients';
        candidate.components.find((node) => node.id === 'cdn-edge').label = 'CDN Edge';
        candidate.components.find((node) => node.id === 'app-api').label = 'App API';
      },
    },
    {
      type: 'workflow',
      example: 'agent-tool-call.workflow.json',
      caseFile: 'agent-tool-call.workflow.case.json',
      mapping: new Map([
        ['planner', 'task-planner'], ['router', 'risk-router'], ['approval', 'consent-check'],
        ['tool', 'tool-runner'], ['blocked', 'request-blocked'], ['external', 'service-provider'],
      ]),
      mutate(candidate) {
        candidate.nodes.find((node) => node.id === 'task-planner').label = 'Intent Planner';
        Object.assign(candidate.nodes.find((node) => node.id === 'risk-router'), { label: 'Route Decision', type: 'security' });
        candidate.nodes.find((node) => node.id === 'consent-check').label = 'Approval';
        candidate.nodes.find((node) => node.id === 'tool-runner').label = 'Tool Dispatch';
        candidate.nodes.find((node) => node.id === 'request-blocked').label = 'Held';
        candidate.nodes.find((node) => node.id === 'service-provider').label = 'Remote API';
        candidate.edges.find((edge) => edge.from === 'risk-router' && edge.to === 'consent-check').label = 'requires approval?';
      },
    },
    {
      type: 'sequence',
      example: 'cache-miss-request.sequence.json',
      caseFile: 'cache-miss.sequence.case.json',
      mapping: new Map([
        ['web', 'browser-tab'], ['api', 'dashboard-api'], ['auth', 'token-guard'],
        ['redis', 'response-cache'], ['db', 'account-store'],
      ]),
      mutate(candidate) {
        Object.assign(candidate.participants.find((node) => node.id === 'browser-tab'), { label: 'Browser', type: 'external' });
        candidate.participants.find((node) => node.id === 'dashboard-api').label = 'Dashboard API';
        candidate.participants.find((node) => node.id === 'token-guard').label = 'JWT Guard';
        candidate.messages.find((message) => message.id === 'verify-jwt').label = 'verify Bearer JWT';
        candidate.messages.find((message) => message.id === 'cache-read').label = 'GET dashboard key';
        candidate.messages.find((message) => message.id === 'profile-query').label = 'SELECT profile + metrics';
        candidate.messages.find((message) => message.id === 'cache-write').label = 'SETEX profile 300';
      },
    },
    {
      type: 'dataflow',
      example: 'product-analytics.dataflow.json',
      caseFile: 'product-analytics.dataflow.case.json',
      mapping: new Map([
        ['edge', 'edge-collector'], ['consent', 'consent-policy'], ['stream', 'event-stream'],
        ['pii', 'identity-vault'], ['warehouse', 'facts-warehouse'], ['dashboard', 'metric-dashboards'],
      ]),
      mutate(candidate) {
        candidate.nodes.find((node) => node.id === 'edge-collector').label = 'Edge Ingestion';
        candidate.nodes.find((node) => node.id === 'consent-policy').label = 'Consent Policy';
        candidate.nodes.find((node) => node.id === 'identity-vault').label = 'Identity Vault';
        candidate.nodes.find((node) => node.id === 'facts-warehouse').label = 'Analytics Warehouse';
        candidate.nodes.find((node) => node.id === 'metric-dashboards').label = 'Analytics UI';
        candidate.flows.find((flow) => flow.id === 'consent-enrichment').label = 'identity context';
        candidate.flows.find((flow) => flow.id === 'accepted-events').label = 'telemetry';
        candidate.flows.find((flow) => flow.id === 'identity-map').label = 'encrypted identity';
        candidate.flows.find((flow) => flow.id === 'metrics-query').label = 'metrics query';
      },
    },
    {
      type: 'lifecycle',
      example: 'agent-run.lifecycle.json',
      caseFile: 'agent-run.lifecycle.case.json',
      mapping: new Map([
        ['queued', 'run-queued'], ['executing', 'run-executing'], ['reviewing', 'run-reviewing'],
        ['approval', 'approval-wait'], ['blocked', 'input-wait'], ['cancelled', 'user-cancelled'],
        ['expired', 'run-expired'],
      ]),
      mutate(candidate) {
        candidate.states.find((node) => node.id === 'approval-wait').label = 'Approval Pending';
        candidate.states.find((node) => node.id === 'input-wait').label = 'Pending Input';
        candidate.states.push({
          id: 'fatal-failure',
          type: 'failure',
          label: 'Failed',
          sublabel: 'budget exhausted',
          lane: 'terminal',
          col: 2,
          tag: 'terminal',
        });
      },
    },
  ];

  for (const fixture of fixtures) {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', fixture.example), 'utf8'));
    const candidate = renameCandidateIds(source, fixture.mapping);
    fixture.mutate(candidate);
    const candidateFile = writeJson(`calibrated-${fixture.type}.json`, candidate);
    const benchmarkCase = JSON.parse(fs.readFileSync(
      path.join(suiteRoot, 'cases', fixture.caseFile),
      'utf8',
    ));
    const runFile = writeJson(`calibrated-${fixture.type}.run.json`, {
      schema_version: 1,
      case_id: benchmarkCase.id,
      agent: 'ordinary-agent',
      model: 'ordinary-model',
      attempt: 1,
      visual_review: { status: 'passed', reviewer: 'fixture-reviewer', defects: [] },
    });

    const result = run([
      'verify', '--case', path.join(suiteRoot, 'cases', fixture.caseFile),
      '--candidate', candidateFile, '--run', runFile,
    ]);

    assert.equal(result.status, 0, `${fixture.type}: ${result.stderr || result.stdout}`);
    assert.equal(JSON.parse(result.stdout).gates.semantic.ok, true, fixture.type);

    if (fixture.type === 'workflow') {
      const wrongRoleCandidate = structuredClone(candidate);
      wrongRoleCandidate.nodes.find((node) => node.id === 'risk-router').type = 'external';
      const wrongRoleFile = writeJson('calibrated-workflow-wrong-role.json', wrongRoleCandidate);
      const wrongRole = run([
        'verify', '--case', path.join(suiteRoot, 'cases', fixture.caseFile),
        '--candidate', wrongRoleFile, '--run', runFile,
      ]);
      assert.equal(wrongRole.status, 1, wrongRole.stderr || wrongRole.stdout);
      assert.deepEqual(JSON.parse(wrongRole.stdout).gates.semantic.mismatchedNodes, [{
        id: 'router',
        field: 'type',
        expected: ['backend', 'security'],
        actual: 'external',
      }]);

      candidate.edges = candidate.edges.filter(
        (edge) => !(edge.from === 'consent-check' && edge.to === 'tool-runner'),
      );
      const brokenCandidate = writeJson('calibrated-workflow-missing-route.json', candidate);
      const broken = run([
        'verify', '--case', path.join(suiteRoot, 'cases', fixture.caseFile),
        '--candidate', brokenCandidate, '--run', runFile,
      ]);
      assert.equal(broken.status, 1, broken.stderr || broken.stdout);
      assert.equal(JSON.parse(broken.stdout).gates.semantic.missingRelationships.length, 1);
    }
  }
});

test('checked-in benchmark suite covers all five diagram types without presenting reference fixtures as model evidence', () => {
  const manifest = path.join(repoRoot, 'benchmarks/ordinary-model-floor/manifest.json');

  const result = run(['check', '--manifest', manifest]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.benchmark, 'ordinary-model-floor');
  assert.equal(receipt.suiteId, 'ordinary-model-floor-v1');
  assert.equal(receipt.purpose, 'suite-integrity');
  assert.equal(receipt.evidenceEligible, false);
  assert.equal(receipt.caseCount, 5);
  assert.deepEqual(receipt.diagramTypes, [
    'architecture',
    'dataflow',
    'lifecycle',
    'sequence',
    'workflow',
  ]);
  assert.equal(receipt.cases.length, 5);
  for (const item of receipt.cases) {
    assert.equal(item.promptOk, true, item.caseId);
    assert.equal(item.semanticOk, true, item.caseId);
    assert.equal(item.validationOk, true, item.caseId);
  }
});

test('checked-in prompts permit bundled CLI repair while retaining external validation authority', () => {
  const suiteRoot = path.join(repoRoot, 'benchmarks/ordinary-model-floor');
  const manifest = JSON.parse(fs.readFileSync(path.join(suiteRoot, 'manifest.json'), 'utf8'));

  for (const entry of manifest.cases) {
    const prompt = fs.readFileSync(path.join(suiteRoot, entry.prompt), 'utf8');
    assert.match(
      prompt,
      /Use the bundled Archify CLI to validate and repair the candidate when shell access is available\./,
      entry.prompt,
    );
    assert.match(
      prompt,
      /The external harness will independently validate the frozen candidate\./,
      entry.prompt,
    );
  }
});

test('suite integrity rejects a long prompt that omits the attempt-1 file contract', () => {
  const sourceSuite = path.join(repoRoot, 'benchmarks/ordinary-model-floor');
  const incompletePrompt = path.join(tmp, 'incomplete-benchmark-prompt.md');
  fs.writeFileSync(
    incompletePrompt,
    `# Plausible but incomplete prompt\n\n${'Describe the requested system accurately. '.repeat(12)}`,
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceSuite, 'manifest.json'), 'utf8'));
  manifest.cases = manifest.cases.map((entry, index) => ({
    ...entry,
    case: path.resolve(sourceSuite, entry.case),
    prompt: index === 0 ? incompletePrompt : path.resolve(sourceSuite, entry.prompt),
    reference_fixture: path.resolve(sourceSuite, entry.reference_fixture),
  }));
  const manifestFile = writeJson('prompt-contract.manifest.json', manifest);

  const result = run(['check', '--manifest', manifestFile]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.cases.find((item) => item.caseId === 'web-runtime-architecture').promptOk, false);
});

test('benchmark fails closed with machine-readable errors for malformed JSON and mismatched run identity', () => {
  const caseFile = writeJson('identity.case.json', {
    schema_version: 1,
    id: 'identity-case',
    diagram_type: 'architecture',
    requirements: { node_ids: ['api'] },
  });
  const candidate = path.join(skillRoot, 'examples/web-app.architecture.json');
  const mismatchedRun = writeJson('identity.run.json', {
    schema_version: 1,
    case_id: 'different-case',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: { status: 'skipped', reviewer: null, defects: [] },
  });

  const mismatch = run(['verify', '--case', caseFile, '--candidate', candidate, '--run', mismatchedRun]);

  assert.equal(mismatch.status, 2, mismatch.stderr || mismatch.stdout);
  assert.equal(mismatch.stderr, '');
  assert.deepEqual(JSON.parse(mismatch.stdout), {
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    error: {
      code: 'RUN_CASE_MISMATCH',
      message: 'run case_id "different-case" does not match benchmark case "identity-case"',
    },
  });

  const malformedCandidate = path.join(tmp, 'malformed.architecture.json');
  fs.writeFileSync(malformedCandidate, '{ definitely not JSON\n');
  const validRun = writeJson('valid-identity.run.json', {
    schema_version: 1,
    case_id: 'identity-case',
    agent: 'fixture-agent',
    model: 'fixture-model',
    attempt: 1,
    visual_review: { status: 'skipped', reviewer: null, defects: [] },
  });

  const malformed = run(['verify', '--case', caseFile, '--candidate', malformedCandidate, '--run', validRun]);

  assert.equal(malformed.status, 2, malformed.stderr || malformed.stdout);
  assert.equal(malformed.stderr, '');
  const malformedReceipt = JSON.parse(malformed.stdout);
  assert.equal(malformedReceipt.error.code, 'INVALID_JSON');
  assert.match(malformedReceipt.error.message, /malformed\.architecture\.json/);
  assert.doesNotMatch(malformed.stdout, /SyntaxError|at JSON\.parse/);
});

test('benchmark report marks only a complete first-pass matrix as evidence and rejects duplicate runs', () => {
  const manifestFile = path.join(repoRoot, 'benchmarks/ordinary-model-floor/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const rows = manifest.cases.map((entry) => {
    const benchmarkCase = JSON.parse(fs.readFileSync(
      path.resolve(path.dirname(manifestFile), entry.case),
      'utf8',
    ));
    return {
      schemaVersion: 1,
      benchmark: 'ordinary-model-floor',
      caseId: benchmarkCase.id,
      run: { agent: 'fixture-agent', model: 'ordinary-model', attempt: 1 },
      gates: {
        semantic: { ok: true },
        validation: { ok: true },
        visualReview: { status: 'passed', reviewer: 'human-reviewer', defects: [] },
      },
      firstPassUsable: true,
    };
  });
  const completeResults = path.join(tmp, 'complete-results.jsonl');
  fs.writeFileSync(completeResults, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const complete = run(['report', '--results', completeResults, '--manifest', manifestFile]);

  assert.equal(complete.status, 0, complete.stderr || complete.stdout);
  const report = JSON.parse(complete.stdout);
  assert.equal(report.suiteId, 'ordinary-model-floor-v1');
  assert.equal(report.evidenceEligible, true);
  assert.deepEqual(report.coverage, [{
    agent: 'fixture-agent',
    model: 'ordinary-model',
    expected: 5,
    present: 5,
    missingCaseIds: [],
    unexpectedCaseIds: [],
    complete: true,
  }]);

  const duplicateResults = path.join(tmp, 'duplicate-results.jsonl');
  fs.writeFileSync(
    duplicateResults,
    `${[...rows, rows[0]].map((row) => JSON.stringify(row)).join('\n')}\n`,
  );

  const duplicate = run(['report', '--results', duplicateResults, '--manifest', manifestFile]);

  assert.equal(duplicate.status, 2, duplicate.stderr || duplicate.stdout);
  assert.equal(duplicate.stderr, '');
  assert.equal(JSON.parse(duplicate.stdout).error.code, 'DUPLICATE_RESULT');
});

test('benchmark documentation locks the fair-run and truthful-evidence contract', () => {
  const readme = fs.readFileSync(
    path.join(repoRoot, 'benchmarks/ordinary-model-floor/README.md'),
    'utf8',
  );

  for (const required of [
    'firstPassUsable',
    'same prompt',
    'same repository commit',
    'packaged skill root',
    'model-visible working tree',
    'bundled Archify CLI',
    'independently revalidates',
    'attempt 1',
    'no post-hoc edits',
    'Reference fixtures are not benchmark evidence',
    '`record-failure`',
    '`timeout`',
    '`no_candidate`',
    '`provider_error`',
    '`passed`',
    '`failed`',
    '`skipped`',
    'check --manifest',
    'verify --case',
    'report --results',
  ]) {
    assert.match(readme, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
});

test('packaged skill puts a bounded ordinary-model path before progressive feature references', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const authoring = fs.readFileSync(path.join(skillRoot, 'references', 'authoring-contract.md'), 'utf8');
  const viewer = fs.readFileSync(path.join(skillRoot, 'references', 'viewer-runtime.md'), 'utf8');
  const fastPath = skill.indexOf('## Fast authoring path');
  const progressiveReferences = skill.indexOf('references/authoring-contract.md');

  assert.ok(fastPath > 0, 'fast authoring path must exist');
  assert.ok(fastPath < progressiveReferences, 'fast authoring path must precede progressive references');
  assert.ok(skill.trimEnd().split('\n').length <= 160, 'ordinary authors must not ingest the viewer catalogue');
  for (const required of [
    'authoring-kit <type> --json',
    'parsed type schema, common schema, bounded shape-only exemplar',
    'after freezing repository requirements, the next tool action must write the candidate',
    'Do not plan exact coordinates in prose',
    'Fresh authorship means new stable IDs, domain wording, topology, and layout',
    'Write the candidate before inspecting renderer internals',
    'Start with automatic routes and labels',
    'Do not add `via`, `channelX`, `channelY`, or `labelAt` before a diagnostic',
    'Set `meta.quality_profile` to `"showcase"`',
    'A recoverable state uses `type: "failure"` plus a real transition back to the active state',
    'after every candidate edit',
    'A passing final validation freezes the candidate: never edit it afterward',
    'A receipt with only 4 artifact checks is basic validation, never showcase acceptance',
    'a showcase pass must report all 9 artifact checks with 0 composition errors and 0 warnings',
    'If the candidate omits or misspells the exact `meta.quality_profile` field',
    '`deliver` is the final acceptance command',
    'deliver <type> <candidate.json> <output.html> --quality showcase --require-authored-language <en|zh-CN> --json',
    'A non-zero exit can never be described as success',
    'Continue focused correction while the objective error count reaches a new minimum',
    'A plateau requests semantics-preserving structural reflow before bounded stop',
    'Do not read `renderers/shared/geometry.mjs`',
    'validate <type>',
    'supportedFixes',
  ]) {
    assert.match(
      skill.slice(fastPath, progressiveReferences),
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    );
  }
  assert.match(authoring, /componentType/);
  assert.match(authoring, /clear gap between boxes, not center distance/i);
  assert.match(viewer, /Direct Relationship Pin/);
});

test('dated three-model evidence retains every frozen attempt-1 candidate and truthful gate result', () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(
    repoRoot,
    'benchmarks/ordinary-model-floor/results/2026-07-26-pi-three-models.json',
  ), 'utf8'));

  assert.equal(evidence.generation.repositoryCommit, '66414c7d2366d16a70c9e7282836e416b7917d51');
  assert.equal(evidence.generation.packageSha256, '1f32354a466ec10c21f56346634ce66e170b6e0d23306cc2e9a9cbb68283f05a');
  assert.equal(evidence.generation.attempt, 1);
  assert.equal(evidence.report.evidenceEligible, true);
  assert.deepEqual(evidence.report.overall, {
    runs: 15,
    firstPassUsable: 10,
    firstPassUsableRate: 2 / 3,
    failureClusters: { semantic: 0, validation: 5, visualReview: 5, operational: 0 },
  });
  assert.equal(evidence.runs.length, 15);

  const identities = new Set();
  for (const entry of evidence.runs) {
    identities.add(`${entry.agent}\0${entry.model}\0${entry.caseId}`);
    assert.equal(entry.run.attempt, 1, entry.caseId);
    assert.equal(entry.run.case_id, entry.caseId, entry.caseId);
    assert.equal(entry.receipt.caseId, entry.caseId, entry.caseId);
    assert.equal(entry.receipt.gates.semantic.ok, true, entry.caseId);
    assert.equal(entry.candidate.schema_version, 1, entry.caseId);
    assert.ok(entry.candidate.diagram_type, entry.caseId);
  }
  assert.equal(identities.size, 15);
});

test('post-fix evidence keeps the complete matrix and reports the no-uplift comparison truthfully', () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(
    repoRoot,
    'benchmarks/ordinary-model-floor/results/2026-07-26-pi-three-models-postfix.json',
  ), 'utf8'));

  assert.equal(evidence.generation.repositoryCommit, '2dce766ab19ff5871020828eb85d770745f1069d');
  assert.equal(evidence.generation.packageSha256, 'cc34ab9484ca84e43fce9fce3de612b11c525c6dd5c797646645c6f35954b24e');
  assert.equal(evidence.report.evidenceEligible, true);
  assert.deepEqual(evidence.report.overall, {
    runs: 15,
    firstPassUsable: 8,
    firstPassUsableRate: 8 / 15,
    failureClusters: { semantic: 2, validation: 6, visualReview: 7, operational: 0 },
  });
  assert.equal(evidence.comparison.baselineReverified.firstPassUsable, 8);
  assert.equal(evidence.comparison.postFix.firstPassUsable, 8);
  assert.match(evidence.comparison.outcome, /no measured overall uplift/i);

  const identities = new Set();
  for (const entry of evidence.runs) {
    identities.add(`${entry.agent}\0${entry.model}\0${entry.caseId}`);
    assert.equal(entry.run.attempt, 1, entry.caseId);
    assert.equal(entry.receipt.caseId, entry.caseId, entry.caseId);
    assert.equal(entry.candidate.schema_version, 1, entry.caseId);
    assert.ok(entry.transcript.length > 0, entry.caseId);
  }
  assert.equal(identities.size, 15);

  const qwenArchitecture = evidence.runs.find(
    (entry) => entry.model === 'codewiz-anthropic/qwen3.7-plus'
      && entry.caseId === 'web-runtime-architecture',
  );
  assert.equal(qwenArchitecture.receipt.firstPassUsable, true);
  assert.equal(qwenArchitecture.run.visual_review.reviewer, 'codex-browser-visual-audit-2026-07-26-route-fix');

  const minimaxLifecycle = evidence.runs.find(
    (entry) => entry.model === 'codewiz-anthropic/minimax-m3'
      && entry.caseId === 'agent-run-lifecycle',
  );
  assert.equal(minimaxLifecycle.receipt.gates.semantic.ok, false);
  assert.equal(minimaxLifecycle.receipt.gates.visualReview.status, 'failed');
  assert.ok(minimaxLifecycle.receipt.gates.visualReview.defects.includes(
    'recoverable-failure-has-no-retry-transition-to-execution',
  ));
});

test('quality-first evidence preserves the complete matrix and the measured lifecycle gain without overstating uplift', () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(
    repoRoot,
    'benchmarks/ordinary-model-floor/results/2026-07-26-pi-three-models-quality-first.json',
  ), 'utf8'));

  assert.equal(evidence.generation.repositoryCommit, '7eef4db36a97d04da74a9cb1d1bc3f735058c074');
  assert.equal(evidence.generation.packageSha256, '92135b360ee1502080dac8f2eea6258bb8fa0aa7f9a59cba119b02233f797593');
  assert.equal(evidence.generation.timeLimitSeconds, null);
  assert.match(evidence.generation.latencyPolicy, /not a quality failure/i);
  assert.equal(evidence.generation.processRecovery, undefined);
  assert.ok(evidence.verification.calibratedAliases.includes('Admitted'));
  assert.equal(evidence.report.evidenceEligible, true);
  assert.deepEqual(evidence.report.overall, {
    runs: 15,
    firstPassUsable: 8,
    firstPassUsableRate: 8 / 15,
    failureClusters: { semantic: 2, validation: 5, visualReview: 7, operational: 0 },
  });
  assert.equal(evidence.comparison.baselineReverified.firstPassUsable, 8);
  assert.equal(evidence.comparison.postFixReverified.firstPassUsable, 8);
  assert.equal(evidence.comparison.qualityFirst.firstPassUsable, 8);
  assert.equal(evidence.comparison.qualityFirst.firstPassUsableByCase['agent-run-lifecycle'], 1);
  assert.equal(evidence.comparison.qualityFirst.firstPassUsableByCase['web-runtime-architecture'], 3);
  assert.match(evidence.comparison.outcome, /no measured overall uplift/i);

  const identities = new Set();
  for (const entry of evidence.runs) {
    identities.add(`${entry.agent}\0${entry.model}\0${entry.caseId}`);
    assert.equal(entry.run.attempt, 1, entry.caseId);
    assert.equal(entry.receipt.caseId, entry.caseId, entry.caseId);
    assert.equal(entry.candidate.schema_version, 1, entry.caseId);
    assert.ok(entry.transcript.length > 0, entry.caseId);
  }
  assert.equal(identities.size, 15);

  const minimaxLifecycle = evidence.runs.find(
    (entry) => entry.model === 'codewiz-anthropic/minimax-m3'
      && entry.caseId === 'agent-run-lifecycle',
  );
  assert.equal(minimaxLifecycle.receipt.firstPassUsable, true);
  assert.equal(minimaxLifecycle.receipt.gates.validation.checksPassed, 9);
  assert.ok(minimaxLifecycle.candidate.states.some(
    (state) => state.id === 'admitted' && state.label === 'Admitted',
  ));
  assert.equal(
    minimaxLifecycle.run.visual_review.reviewer,
    'codex-browser-visual-audit-2026-07-27-quality-first-clean-rerun',
  );
  assert.equal(
    minimaxLifecycle.receipt.gates.visualReview.reviewer,
    minimaxLifecycle.run.visual_review.reviewer,
  );

  const deepseekWorkflow = evidence.runs.find(
    (entry) => entry.model === 'seal/deepseek-v4-flash'
      && entry.caseId === 'agent-tool-call-workflow',
  );
  assert.equal(deepseekWorkflow.receipt.firstPassUsable, false);
  assert.ok(deepseekWorkflow.receipt.gates.visualReview.defects.includes(
    'card-claims-retry-loop-without-authored-return-edge',
  ));
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
