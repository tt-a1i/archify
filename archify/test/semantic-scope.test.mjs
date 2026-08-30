import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSemanticRequirements,
  verifySemanticRequirements,
} from '../authoring/semantic-requirements.mjs';

function entity(key, role) {
  return {
    key,
    labels: [key],
    roles: [role],
    claimIds: [`claim-${key}`],
  };
}

function relationship(from, to, index) {
  return {
    from,
    to,
    labels: [`flow-${index}`],
    claimIds: [`claim-flow-${index}`],
  };
}

function factsFor(requirements, paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
  const claimIds = [
    ...requirements.entities.flatMap((entry) => entry.claimIds),
    ...requirements.relationships.flatMap((entry) => entry.claimIds),
  ];
  return [...new Set(claimIds)].map((claimId, index) => ({
    claimId,
    path: paths[index % paths.length],
  }));
}

test('project-overview rejects the three-node minimum that produced sparse project diagrams', () => {
  const requirements = {
    schemaVersion: 2,
    diagramType: 'architecture',
    scopeProfile: 'project-overview',
    entities: [
      entity('entry', 'entry'),
      entity('registry', 'control'),
      entity('executor', 'runtime'),
    ],
    relationships: [
      relationship('entry', 'registry', 1),
      relationship('registry', 'executor', 2),
    ],
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'architecture'),
    /project-overview.*at least 6 entities/i,
  );
});

test('focused scope preserves deliberately narrow repository diagrams', () => {
  const requirements = {
    schemaVersion: 2,
    diagramType: 'architecture',
    scopeProfile: 'focused',
    entities: [
      entity('entry', 'entry'),
      entity('executor', 'runtime'),
    ],
    relationships: [relationship('entry', 'executor', 1)],
  };

  const normalized = normalizeSemanticRequirements(requirements, 'architecture');
  assert.equal(normalized.scopeProfile, 'focused');
  assert.equal(normalized.entities.length, 2);
  assert.equal(normalized.relationships.length, 1);
});

test('semantic requirements reject a relationship without an accepted label', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [entity('entry', 'entry'), entity('executor', 'runtime')],
    relationships: [{
      from: 'entry',
      to: 'executor',
      claimIds: ['claim-flow-1'],
    }],
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'workflow'),
    /relationships\[0\].*declare labels or label/i,
  );
});

test('semantic requirements reject unsafe entity keys before building bindings', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [entity('__proto__', 'entry'), entity('executor', 'runtime')],
    relationships: [relationship('__proto__', 'executor', 1)],
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'workflow'),
    /entities\[0\].*safe identifier/i,
  );
});

test('semantic binding does not accept a shortened candidate label', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [
      { ...entity('entry', 'entry'), labels: ['Repository Entry'] },
      { ...entity('executor', 'runtime'), labels: ['Agent Runner'] },
    ],
    relationships: [relationship('entry', 'executor', 1)],
  };
  const candidate = {
    diagram_type: 'workflow',
    nodes: [
      { id: 'entry', label: 'Repository' },
      { id: 'executor', label: 'Agent Runner' },
    ],
    edges: [{ from: 'entry', to: 'executor', label: 'flow-1' }],
  };

  assert.throws(
    () => verifySemanticRequirements({
      requirements,
      candidate,
      evidenceFacts: factsFor(requirements, ['source.ts']),
    }),
    /semantic\/missing-entity.*Repository Entry/i,
  );
});

test('semantic binding does not reuse one candidate entity for two requirements', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [
      { ...entity('entry', 'entry'), labels: ['Repository'] },
      { ...entity('executor', 'runtime'), labels: ['Agent'] },
    ],
    relationships: [relationship('entry', 'executor', 1)],
  };
  const candidate = {
    diagram_type: 'workflow',
    nodes: [
      { id: 'combined', label: 'Repository Agent' },
      { id: 'decoy', label: 'Unrelated' },
    ],
    edges: [{ from: 'combined', to: 'combined', label: 'flow-1' }],
  };

  assert.throws(
    () => verifySemanticRequirements({
      requirements,
      candidate,
      evidenceFacts: factsFor(requirements, ['source.ts']),
    }),
    /semantic\/reused-entity.*entry.*executor.*combined/i,
  );
});

test('semantic binding does not reuse one candidate relationship for two requirements', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [entity('entry', 'entry'), entity('executor', 'runtime')],
    relationships: [
      relationship('entry', 'executor', 1),
      relationship('entry', 'executor', 1),
    ],
  };
  requirements.relationships[1].claimIds = ['claim-flow-2'];
  const candidate = {
    diagram_type: 'workflow',
    nodes: [
      { id: 'entry', label: 'entry' },
      { id: 'executor', label: 'executor' },
    ],
    edges: [
      { id: 'only-flow', from: 'entry', to: 'executor', label: 'flow-1' },
      { id: 'decoy-flow', from: 'executor', to: 'entry', label: 'unrelated' },
    ],
  };

  assert.throws(
    () => verifySemanticRequirements({
      requirements,
      candidate,
      evidenceFacts: factsFor(requirements, ['source.ts']),
    }),
    /semantic\/reused-relationship.*entry.*executor/i,
  );
});

test('project-overview requires type-specific semantic roles', () => {
  const roles = ['source', 'transform', 'control-store', 'runtime-sink', 'transform', 'source', 'runtime-sink'];
  const entities = roles.map((role, index) => entity(`node-${index}`, role));
  const requirements = {
    schemaVersion: 2,
    diagramType: 'dataflow',
    scopeProfile: 'project-overview',
    entities,
    relationships: entities.slice(1).map((entry, index) => relationship(entities[index].key, entry.key, index)),
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'dataflow'),
    /missing required semantic roles.*observability-consumer/i,
  );
});

test('project-overview requires at least one role on every entity', () => {
  const roles = ['entry', 'configuration', 'control', 'runtime', 'observability', 'integration'];
  const entities = [
    ...roles.map((role, index) => entity(`node-${index}`, role)),
    { key: 'unclassified', labels: ['unclassified'], claimIds: ['claim-unclassified'] },
  ];
  const requirements = {
    schemaVersion: 2,
    diagramType: 'architecture',
    scopeProfile: 'project-overview',
    entities,
    relationships: entities.slice(1).map(
      (entry, index) => relationship(entities[index].key, entry.key, index),
    ),
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'architecture'),
    /entities\[6\].*at least one role/i,
  );
});

test('project-overview rejects roles outside the diagram contract', () => {
  const roles = ['entry', 'configuration', 'control', 'runtime', 'observability', 'integration'];
  const entities = roles.map((role, index) => entity(`node-${index}`, role));
  entities[0].roles.push('database');
  const requirements = {
    schemaVersion: 2,
    diagramType: 'architecture',
    scopeProfile: 'project-overview',
    entities,
    relationships: entities.slice(1).map(
      (entry, index) => relationship(entities[index].key, entry.key, index),
    ),
  };

  assert.throws(
    () => normalizeSemanticRequirements(requirements, 'architecture'),
    /entities\[0\].*unsupported semantic roles: database/i,
  );
});

test('project-overview verifies density, role coverage, and evidence breadth', () => {
  const roles = [
    'source',
    'transform',
    'control-store',
    'runtime-sink',
    'observability-consumer',
    'transform',
    'runtime-sink',
  ];
  const entities = roles.map((role, index) => entity(`node-${index}`, role));
  const relationships = entities.slice(1).map(
    (entry, index) => relationship(entities[index].key, entry.key, index),
  );
  const requirements = {
    schemaVersion: 2,
    diagramType: 'dataflow',
    scopeProfile: 'project-overview',
    entities,
    relationships,
  };
  const candidate = {
    diagram_type: 'dataflow',
    nodes: entities.map((entry, index) => ({
      id: `candidate-${index}`,
      label: entry.labels[0],
    })),
    flows: relationships.map((entry, index) => ({
      id: `candidate-flow-${index}`,
      from: `candidate-${index}`,
      to: `candidate-${index + 1}`,
      label: entry.labels[0],
    })),
  };

  const receipt = verifySemanticRequirements({
    requirements,
    candidate,
    evidenceFacts: factsFor(requirements),
  });

  assert.equal(receipt.scopeProfile, 'project-overview');
  assert.deepEqual(receipt.roleCoverage.missing, []);
  assert.equal(receipt.density.entities, 7);
  assert.equal(receipt.density.relationships, 6);
  assert.deepEqual(receipt.density.required, { entities: 7, relationships: 6 });
  assert.deepEqual(receipt.density.actual, { entities: 7, relationships: 6 });
  assert.equal(receipt.evidenceBreadth.distinctSourceFiles, 4);
  assert.equal(receipt.evidenceBreadth.minimumDistinctSourceFiles, 4);
});

test('semantic verification rejects a candidate below the required primary counts', () => {
  const requirements = {
    schemaVersion: 1,
    diagramType: 'workflow',
    entities: [entity('entry', 'entry'), entity('executor', 'runtime')],
    relationships: [relationship('entry', 'executor', 1)],
  };

  assert.throws(
    () => verifySemanticRequirements({
      requirements,
      candidate: {
        diagram_type: 'workflow',
        nodes: [{ id: 'entry', label: 'entry' }],
        edges: [],
      },
      evidenceFacts: factsFor(requirements, ['source.ts']),
    }),
    /semantic\/insufficient-candidate-entities.*1.*2/i,
  );
});

test('project-overview rejects requirements whose claims come from too little source breadth', () => {
  const roles = [
    'source',
    'transform',
    'control-store',
    'runtime-sink',
    'observability-consumer',
    'transform',
    'runtime-sink',
  ];
  const entities = roles.map((role, index) => entity(`node-${index}`, role));
  const relationships = entities.slice(1).map(
    (entry, index) => relationship(entities[index].key, entry.key, index),
  );
  const requirements = {
    schemaVersion: 2,
    diagramType: 'dataflow',
    scopeProfile: 'project-overview',
    entities,
    relationships,
  };
  const candidate = {
    diagram_type: 'dataflow',
    nodes: entities.map((entry, index) => ({ id: `candidate-${index}`, label: entry.labels[0] })),
    flows: relationships.map((entry, index) => ({
      id: `candidate-flow-${index}`,
      from: `candidate-${index}`,
      to: `candidate-${index + 1}`,
      label: entry.labels[0],
    })),
  };

  assert.throws(
    () => verifySemanticRequirements({
      requirements,
      candidate,
      evidenceFacts: factsFor(requirements, ['only-one-file.ts']),
    }),
    /semantic\/insufficient-evidence-breadth.*at least 4 distinct source files/i,
  );
});
