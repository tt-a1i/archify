import assert from 'node:assert/strict';
import { test } from 'node:test';

import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

const CHILD_TYPES = [
  'frontend',
  'backend',
  'database',
  'cloud',
  'security',
  'messagebus',
  'external',
];

function child(id, type = 'backend', extra = {}) {
  return {
    id,
    type,
    label: `${type} ${id}`,
    ...extra,
  };
}

function parent(id, subarchitecture) {
  return {
    id,
    type: 'backend',
    label: `Parent ${id}`,
    ...(subarchitecture ? { subarchitecture } : {}),
  };
}

function documentWith(...components) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'One-level subarchitecture schema' },
    components,
  };
}

function validSubarchitecture(overrides = {}) {
  return {
    title: 'Transformer Layer',
    components: [
      child('input', 'external', { pos: [20, 140], size: [100, 56] }),
      child('norm', 'backend', { pos: [170, 140], size: [110, 56] }),
    ],
    ...overrides,
  };
}

function assertValid(document) {
  assert.equal(validateArchitecture(document), true, JSON.stringify(validateArchitecture.errors));
}

function assertInvalidAt(document, { instancePath, keyword, property }) {
  assert.equal(validateArchitecture(document), false, 'expected Architecture schema rejection');
  const error = validateArchitecture.errors?.find((entry) => (
    entry.instancePath === instancePath
    && entry.keyword === keyword
    && (property == null || (
      entry.params?.additionalProperty === property
      || entry.params?.unevaluatedProperty === property
      || entry.params?.missingProperty === property
    ))
  ));
  assert.ok(error, JSON.stringify(validateArchitecture.errors, null, 2));
}

test('subarchitecture schema accepts all seven child kinds and complete local topology', () => {
  const components = CHILD_TYPES.map((type, index) => child(
    `node_${index + 1}`,
    type,
    { pos: [40 + index * 140, 160], size: [112, 58] },
  ));
  const subarchitecture = {
    title: 'All Architecture component kinds',
    components,
    boundaries: [
      { kind: 'region', label: 'Compute region', wraps: ['node_1', 'node_2', 'node_3'], pad: 18 },
      { kind: 'security-group', label: 'Trust boundary', wraps: ['node_4', 'node_5'], pad: 12 },
    ],
    connections: [
      { id: 'sequential', from: 'node_1', to: 'node_2' },
      { id: 'branch', from: 'node_1', to: 'node_3', route: 'straight' },
      { id: 'merge_left', from: 'node_2', to: 'node_4' },
      { id: 'merge_right', from: 'node_3', to: 'node_4' },
      { id: 'self_loop', from: 'node_4', to: 'node_4', label: 'retry' },
      {
        id: 'residual_skip',
        from: 'node_1',
        to: 'node_4',
        label: 'residual',
        variant: 'dashed',
        fromSide: 'top',
        toSide: 'top',
        route: 'orthogonal-h',
        via: [[96, 70], [516, 70]],
        labelAt: [306, 52],
        labelDx: 4,
        labelDy: -2,
        labelSegment: 1,
        width: 1.5,
      },
    ],
  };

  assertValid(documentWith(parent('transformer', subarchitecture)));
});

test('subarchitecture schema accepts grid placement without free coordinates', () => {
  const subarchitecture = validSubarchitecture({
    layout: {
      mode: 'grid',
      origin: [24, 32],
      cols: 2,
      gapX: 28,
      gapY: 20,
      cellW: 140,
      cellH: 72,
    },
    components: [
      child('grid_a', 'frontend', { row: 0, col: 0 }),
      child('grid_b', 'database', { row: 0, col: 1 }),
    ],
  });

  assertValid(documentWith(parent('grid_parent', subarchitecture)));
});

test('subarchitecture schema permits identical child IDs in different parent scopes', () => {
  const first = validSubarchitecture({
    title: 'First scope',
    components: [child('shared', 'frontend')],
  });
  const second = validSubarchitecture({
    title: 'Second scope',
    components: [child('shared', 'database')],
  });

  assertValid(documentWith(parent('first', first), parent('second', second)));
});

test('subarchitecture schema preserves documents that omit local graphs', () => {
  assertValid(documentWith(parent('plain_parent')));
});

test('subarchitecture schema rejects a thirteenth child at the local collection path', () => {
  const subarchitecture = validSubarchitecture({
    components: Array.from({ length: 13 }, (_, index) => child(`child_${index + 1}`)),
  });
  const document = documentWith(parent('bounded', subarchitecture));

  assertInvalidAt(document, {
    instancePath: '/components/0/subarchitecture/components',
    keyword: 'maxItems',
  });
});

test('subarchitecture schema requires a non-empty title', () => {
  const missingTitle = validSubarchitecture();
  delete missingTitle.title;
  assertInvalidAt(documentWith(parent('missing_title', missingTitle)), {
    instancePath: '/components/0/subarchitecture',
    keyword: 'required',
    property: 'title',
  });
});

test('subarchitecture schema requires a non-empty components collection', () => {
  const missingComponents = validSubarchitecture();
  delete missingComponents.components;
  assertInvalidAt(documentWith(parent('missing_components', missingComponents)), {
    instancePath: '/components/0/subarchitecture',
    keyword: 'required',
    property: 'components',
  });

  assertInvalidAt(documentWith(parent('empty_components', validSubarchitecture({ components: [] }))), {
    instancePath: '/components/0/subarchitecture/components',
    keyword: 'minItems',
  });
});

test('subarchitecture schema rejects unsupported local component fields at the child path', () => {
  const subarchitecture = validSubarchitecture({
    components: [child('unexpected_child', 'backend', { unsupported: true })],
  });
  const document = documentWith(parent('strict_children', subarchitecture));

  assertInvalidAt(document, {
    instancePath: '/components/0/subarchitecture/components/0',
    keyword: 'unevaluatedProperties',
    property: 'unsupported',
  });

  assert.throws(
    () => validateSchema('architecture', document),
    (error) => {
      const diagnostic = error.archifyDiagnostics?.find((entry) => (
        entry.code === 'schema/additionalProperties'
        && entry.evidence.additionalProperty === 'unsupported'
      ));
      assert.ok(diagnostic, JSON.stringify(error.archifyDiagnostics, null, 2));
      assert.deepEqual(diagnostic.subject, {
        diagramType: 'architecture',
        path: '/components/0/subarchitecture/components/0',
        identity: 'unexpected_child',
      });
      assert.deepEqual(diagnostic.supportedFixes, ['remove unsupported property "unsupported"']);
      return true;
    },
  );
});

test('subarchitecture schema makes second-level nesting structurally impossible', () => {
  const subarchitecture = validSubarchitecture({
    components: [child('nested_child', 'backend', {
      subarchitecture: validSubarchitecture({
        title: 'Forbidden second level',
        components: [child('grandchild')],
      }),
    })],
  });
  const document = documentWith(parent('one_level_only', subarchitecture));

  assertInvalidAt(document, {
    instancePath: '/components/0/subarchitecture/components/0',
    keyword: 'unevaluatedProperties',
    property: 'subarchitecture',
  });
});
