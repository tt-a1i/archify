import assert from 'node:assert/strict';
import test from 'node:test';

import { compileInternalStructures } from '../renderers/shared/cli.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

function source(id, role = 'definition') {
  return { id, role, path: `src/${id}.ts`, symbol: id };
}

function structure() {
  return {
    sources: [source('loop'), source('state'), source('read', 'callsite')],
    items: [
      { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: 'Runtime sources.' },
      { id: 'loop-file', domain: 'code', kind: 'file', label: 'loop.ts', parent: 'src', summary: 'Runs the loop.', source_refs: ['loop'] },
      { id: 'loop-function', domain: 'code', kind: 'function', label: 'agentLoop', parent: 'loop-file', signature: 'agentLoop(state)', summary: 'Coordinates one turn.', source_refs: ['loop'] },
      { id: 'session', domain: 'state', kind: 'group', label: 'Session', summary: 'Conversation state.' },
      { id: 'messages', domain: 'state', kind: 'field', label: 'messages', parent: 'session', value_type: 'AgentMessage[]', summary: 'Ordered messages.', source_refs: ['state'] },
    ],
    relations: [
      { id: 'loop-reads-messages', from: 'loop-function', to: 'messages', kind: 'reads', source_refs: ['read'] },
    ],
  };
}

function diagram(internalStructure = structure()) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Internal structure contract',
      output: 'internal-structure.html',
      repository: { url: 'https://github.com/example/internal-structure', revision: 'a'.repeat(40) },
    },
    components: [{ id: 'agent-loop', type: 'backend', label: 'Agent Loop', internal_structure: internalStructure }],
  };
}

function diagnosticsFrom(callback) {
  try { callback(); } catch (error) {
    assert.ok(Array.isArray(error.archifyDiagnostics), error.stack || error.message);
    return error.archifyDiagnostics;
  }
  assert.fail('expected Archify diagnostics');
}

test('internal structure schema and compiler expose one deterministic node-local tree', () => {
  const authored = diagram();
  validateSchema('architecture', authored);
  const compiled = compileInternalStructures('architecture', authored);
  assert.deepEqual(JSON.parse(JSON.stringify(compiled.data)), {
    schemaVersion: 1,
    nodes: {
      'agent-loop': {
        sources: [
          { id: 'loop', role: 'definition', path: 'src/loop.ts', symbol: 'loop' },
          { id: 'state', role: 'definition', path: 'src/state.ts', symbol: 'state' },
          { id: 'read', role: 'callsite', path: 'src/read.ts', symbol: 'read' },
        ],
        items: [
          { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: 'Runtime sources.' },
          { id: 'loop-file', domain: 'code', kind: 'file', label: 'loop.ts', parent: 'src', summary: 'Runs the loop.', sourceRefs: ['loop'] },
          { id: 'loop-function', domain: 'code', kind: 'function', label: 'agentLoop', parent: 'loop-file', signature: 'agentLoop(state)', summary: 'Coordinates one turn.', sourceRefs: ['loop'] },
          { id: 'session', domain: 'state', kind: 'group', label: 'Session', summary: 'Conversation state.' },
          { id: 'messages', domain: 'state', kind: 'field', label: 'messages', parent: 'session', valueType: 'AgentMessage[]', summary: 'Ordered messages.', sourceRefs: ['state'] },
        ],
        relations: [
          { id: 'loop-reads-messages', from: 'loop-function', to: 'messages', kind: 'reads', sourceRefs: ['read'] },
        ],
      },
    },
  });
  assert.equal(compiled.receipt.nodeCount, 1);
  assert.equal(compiled.receipt.itemCount, 5);
  assert.equal(compiled.receipt.relationCount, 1);
  assert.match(compiled.receipt.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(compileInternalStructures('architecture', authored), compiled);
});

test('old experimental developer_guide field is rejected by the public Architecture schema', () => {
  const authored = diagram();
  delete authored.components[0].internal_structure;
  authored.components[0].developer_guide = { implementation_scope: 'repository', summary: {}, sections: [] };
  const diagnostics = diagnosticsFrom(() => validateSchema('architecture', authored));
  assert.ok(diagnostics.some((entry) => entry.code === 'schema/additionalProperties'
    && entry.subject.path === '/components/0' && entry.evidence.additionalProperty === 'developer_guide'));
});

test('internal structure rejects duplicate ids, invalid trees, dangling refs, and unsupported relation evidence at exact paths', async (t) => {
  const cases = [
    ['duplicate item', value => value.items.push({ ...value.items[0] }), 'duplicate-item-id', '/components/0/internal_structure/items/5/id'],
    ['cross-domain parent', value => { value.items[4].parent = 'src'; }, 'cross-domain-parent', '/components/0/internal_structure/items/4/parent'],
    ['cycle', value => { value.items[0].parent = 'loop-file'; }, 'parent-cycle', '/components/0/internal_structure/items/0/parent'],
    ['unknown source', value => { value.items[1].source_refs = ['missing']; }, 'unknown-source-ref', '/components/0/internal_structure/items/1/source_refs/0'],
    ['unknown endpoint', value => { value.relations[0].to = 'missing'; }, 'unknown-relation-endpoint', '/components/0/internal_structure/relations/0/to'],
    ['reversed read', value => { value.relations[0].from = 'messages'; value.relations[0].to = 'loop-function'; }, 'relation-domain', '/components/0/internal_structure/relations/0/kind'],
    ['cross-domain call', value => { value.relations[0].kind = 'calls'; }, 'relation-domain', '/components/0/internal_structure/relations/0/kind'],
    ['reads without semantic evidence', value => { value.sources[1].role = 'documentation'; value.relations[0].source_refs = ['state']; }, 'relation-evidence', '/components/0/internal_structure/relations/0/source_refs'],
  ];
  for (const [name, mutate, code, path] of cases) {
    await t.test(name, () => {
      const value = structure();
      mutate(value);
      const diagnostics = diagnosticsFrom(() => compileInternalStructures('architecture', diagram(value)));
      assert.ok(diagnostics.some((entry) => entry.code === `internal-structure/${code}` && entry.subject.path === path), JSON.stringify(diagnostics, null, 2));
    });
  }
});

test('other diagram types and Architecture documents without internal structure emit no payload', () => {
  assert.equal(compileInternalStructures('workflow', {}), null);
  const authored = diagram();
  delete authored.components[0].internal_structure;
  delete authored.meta.repository;
  assert.equal(compileInternalStructures('architecture', authored), null);
});

test('internal structure source ids are local and may match component source ids', () => {
  const authored = diagram();
  authored.components[0].sources = [{ id: 'loop', path: 'src/component-loop.ts' }];
  assert.doesNotThrow(() => compileInternalStructures('architecture', authored));
});

test('code-only, state-only, and combined structures compile without inventing an empty domain', () => {
  const codeOnly = structure();
  codeOnly.items = codeOnly.items.filter((item) => item.domain === 'code');
  codeOnly.sources = [source('loop')];
  codeOnly.relations = [];
  const stateOnly = structure();
  stateOnly.items = stateOnly.items.filter((item) => item.domain === 'state');
  stateOnly.sources = [source('state')];
  stateOnly.relations = [];
  for (const [value, domains] of [[codeOnly, ['code']], [stateOnly, ['state']], [structure(), ['code', 'state']]]) {
    validateSchema('architecture', diagram(value));
    const compiled = compileInternalStructures('architecture', diagram(value));
    assert.deepEqual([...new Set(compiled.data.nodes['agent-loop'].items.map((item) => item.domain))], domains);
  }
});

test('tree depth eight is accepted and depth nine fails at the offending parent path', () => {
  const chain = (count) => ({
    sources: [source('loop')],
    items: Array.from({ length: count }, (_, index) => ({
      id: `level-${index}`,
      domain: 'code',
      kind: index === 0 ? 'directory' : 'file',
      label: `level-${index}`,
      ...(index ? { parent: `level-${index - 1}`, source_refs: ['loop'] } : {}),
      summary: `Tree level ${index}.`,
    })),
    relations: [],
  });
  assert.doesNotThrow(() => compileInternalStructures('architecture', diagram(chain(9))));
  const diagnostics = diagnosticsFrom(() => compileInternalStructures('architecture', diagram(chain(10))));
  assert.ok(diagnostics.some((entry) => entry.code === 'internal-structure/tree-depth'
    && entry.subject.path === '/components/0/internal_structure/items/9/parent'));
});

test('a long parent cycle is diagnosed as a cycle before a depth suggestion', () => {
  const value = {
    sources: [source('loop')],
    items: Array.from({ length: 10 }, (_, index) => ({
      id: `cycle-${index}`,
      domain: 'code',
      kind: 'file',
      label: `cycle-${index}`,
      parent: `cycle-${(index + 1) % 10}`,
      summary: `Cycle item ${index}.`,
      source_refs: ['loop'],
    })),
    relations: [],
  };
  const diagnostics = diagnosticsFrom(() => compileInternalStructures('architecture', diagram(value)));
  assert.ok(diagnostics.some((entry) => entry.code === 'internal-structure/parent-cycle'));
});

test('member byte budget points at the first component whose payload crosses the limit', () => {
  const authored = diagram();
  authored.components = Array.from({ length: 10 }, (_, componentIndex) => ({
    id: `component-${componentIndex}`,
    type: 'backend',
    label: `Component ${componentIndex}`,
    internal_structure: {
      sources: [source(`source-${componentIndex}`)],
      items: Array.from({ length: 64 }, (_, itemIndex) => ({
        id: `item-${itemIndex}`,
        domain: 'code',
        kind: 'function',
        label: `item-${itemIndex}`.padEnd(80, 'l'),
        summary: `component-${componentIndex}-item-${itemIndex}`.padEnd(240, 's'),
        signature: `item${itemIndex}()`.padEnd(200, 'x'),
        source_refs: [`source-${componentIndex}`],
      })),
      relations: [],
    },
  }));
  const diagnostics = diagnosticsFrom(() => compileInternalStructures('architecture', authored));
  const budget = diagnostics.find((entry) => entry.code === 'internal-structure/member-budget');
  assert.ok(budget, JSON.stringify(diagnostics, null, 2));
  assert.notEqual(budget.subject.path, '/components/9/internal_structure');
  const crossedAt = Number(budget.subject.path.match(/^\/components\/(\d+)\//)?.[1]);
  assert.ok(Number.isInteger(crossedAt) && crossedAt > 0 && crossedAt < 9, budget.subject.path);
});

test('schema accepts collection and text maxima and rejects the first item beyond each bound', () => {
  const bounded = {
    sources: Array.from({ length: 64 }, (_, index) => ({
      id: `source-${index}`, role: 'definition', path: `src/${index}.ts`, symbol: 's'.repeat(200),
    })),
    items: Array.from({ length: 64 }, (_, index) => ({
      id: `item-${index}`, domain: 'code', kind: index === 0 ? 'directory' : 'function',
      label: 'l'.repeat(80), summary: 's'.repeat(240),
      ...(index ? { signature: 'f'.repeat(200), source_refs: ['source-0'] } : {}),
    })),
    relations: Array.from({ length: 96 }, (_, index) => ({
      id: `relation-${index}`, from: 'item-1', to: 'item-2', kind: 'uses', label: 'r'.repeat(80), source_refs: ['source-0'],
    })),
  };
  assert.doesNotThrow(() => validateSchema('architecture', diagram(bounded)));
  for (const [collection, extra] of [
    ['sources', { id: 'source-64', role: 'definition', path: 'src/64.ts' }],
    ['items', { id: 'item-64', domain: 'code', kind: 'directory', label: 'extra', summary: 'extra' }],
    ['relations', { id: 'relation-96', from: 'item-1', to: 'item-2', kind: 'uses', source_refs: ['source-0'] }],
  ]) {
    const value = structuredClone(bounded);
    value[collection].push(extra);
    const diagnostics = diagnosticsFrom(() => validateSchema('architecture', diagram(value)));
    assert.ok(diagnostics.some((entry) => entry.code === 'schema/maxItems'
      && entry.subject.path === `/components/0/internal_structure/${collection}`), JSON.stringify(diagnostics, null, 2));
  }
});

test('state fields require a value type and structure text rejects overflow at an exact path', () => {
  const missingType = structure();
  delete missingType.items.find((item) => item.kind === 'field').value_type;
  let diagnostics = diagnosticsFrom(() => validateSchema('architecture', diagram(missingType)));
  assert.ok(diagnostics.some((entry) => entry.code === 'schema/required'
    && entry.subject.path === '/components/0/internal_structure/items/4'));
  const longLabel = structure();
  longLabel.items[0].label = 'x'.repeat(81);
  diagnostics = diagnosticsFrom(() => validateSchema('architecture', diagram(longLabel)));
  assert.ok(diagnostics.some((entry) => entry.code === 'schema/maxLength'
    && entry.subject.path === '/components/0/internal_structure/items/0/label'));
});
