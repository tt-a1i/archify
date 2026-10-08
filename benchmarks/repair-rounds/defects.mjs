// Defect catalog for the repair-rounds benchmark. Each class mutates a valid
// fixture deterministically, declares the diagnostic codes it is expected to
// surface, and carries an oracle repair that restores the fixture exactly.

export const COLLECTIONS = {
  architecture: { nodes: 'components', edges: 'connections' },
  workflow: { nodes: 'nodes', edges: 'edges' },
  sequence: { nodes: 'participants', edges: 'messages' },
  dataflow: { nodes: 'nodes', edges: 'flows' },
  lifecycle: { nodes: 'states', edges: 'transitions' },
};

const ALL_TYPES = Object.keys(COLLECTIONS);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nodeAt(doc, type, index) {
  const nodes = doc[COLLECTIONS[type].nodes] || [];
  const at = index ?? Math.min(1, nodes.length - 1);
  return nodes[at];
}

function edgeAt(doc, type, index) {
  const edges = doc[COLLECTIONS[type].edges] || [];
  return edges[index ?? 0];
}

function restore(record) {
  return (doc) => {
    for (const { pointer, value, absent } of record.restores) {
      const parts = pointer.split('/').filter(Boolean).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
      let target = doc;
      for (const part of parts.slice(0, -1)) target = target[part];
      const key = parts[parts.length - 1];
      if (absent) delete target[key];
      else target[key] = clone(value);
    }
  };
}

function capture(doc, pointer) {
  const parts = pointer.split('/').filter(Boolean).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let target = doc;
  for (const part of parts.slice(0, -1)) target = target?.[part];
  const key = parts[parts.length - 1];
  const absent = target === undefined || target === null || !(key in target);
  return { pointer, value: absent ? undefined : clone(target[key]), absent };
}

const LONG_LABEL = 'Quarterly Cross-Regional Compliance Reconciliation And Settlement Orchestration Service';
// Unbreakable strings: spaced prose wraps in the header and stays contained.
const LONG_TITLE = 'LongRunningComplianceReconciliationServiceDeploymentPipelineOverview'.repeat(6);
const LONG_SUBTITLE = 'QuarterlyCrossRegionalComplianceReconciliationAndSettlementOrchestrationReport'.repeat(5);

export const DEFECTS = {
  'meta-missing-output': {
    appliesTo: ALL_TYPES,
    // finalize checks meta.output at the deliver gate before validate runs.
    expectedCodes: { default: ['schema/required', 'output/meta-path-syntax', 'output/path-resolution'] },
    inject(doc) {
      const restores = [capture(doc, '/meta/output')];
      delete doc.meta.output;
      return { restores };
    },
  },
  'node-invalid-type': {
    appliesTo: ALL_TYPES,
    expectedCodes: { default: ['schema/enum', 'schema/const', 'schema/anyOf'] },
    inject(doc, { type, nodeIndex } = {}) {
      const node = nodeAt(doc, type, nodeIndex);
      const restores = [capture(doc, `/${COLLECTIONS[type].nodes}/${doc[COLLECTIONS[type].nodes].indexOf(node)}/type`)];
      node.type = 'benchmark-bogus-type';
      return { restores };
    },
  },
  'node-long-label': {
    appliesTo: ALL_TYPES,
    expectedCodes: { default: ['layout/constraint'] },
    inject(doc, { type, nodeIndex } = {}) {
      const nodes = doc[COLLECTIONS[type].nodes];
      const node = nodeAt(doc, type, nodeIndex);
      const restores = [capture(doc, `/${COLLECTIONS[type].nodes}/${nodes.indexOf(node)}/label`)];
      node.label = LONG_LABEL;
      return { restores };
    },
  },
  'node-duplicate-id': {
    appliesTo: ALL_TYPES,
    expectedCodes: {
      workflow: ['workflow/duplicate-node-id'],
      default: ['layout/constraint', 'clean-flow/edge-through-node', 'clean-flow/endpoint-side-direction', 'composition/proper-crossing', 'composition/label-route-clearance'],
    },
    inject(doc, { type, nodeIndex } = {}) {
      const nodes = doc[COLLECTIONS[type].nodes];
      const node = nodeAt(doc, type, nodeIndex);
      const restores = [capture(doc, `/${COLLECTIONS[type].nodes}/${nodes.indexOf(node)}/id`)];
      node.id = nodes[0].id;
      return { restores };
    },
  },
  'edge-dangling-target': {
    appliesTo: ALL_TYPES,
    expectedCodes: {
      workflow: ['workflow/unknown-edge-endpoint'],
      default: ['layout/constraint', 'sequence/unknown-endpoint', 'dataflow/unknown-endpoint', 'lifecycle/unknown-endpoint'],
    },
    inject(doc, { type, edgeIndex } = {}) {
      const edges = doc[COLLECTIONS[type].edges];
      const edge = edgeAt(doc, type, edgeIndex);
      const restores = [capture(doc, `/${COLLECTIONS[type].edges}/${edges.indexOf(edge)}/to`)];
      edge.to = 'benchmark-ghost-node';
      return { restores };
    },
  },
  // Same unknown id referenced from an edge endpoint and mainPath: a fix is
  // only complete when it repoints every reference, and the advertised edits
  // must match the set verification applied.
  'endpoint-shared-ghost': {
    appliesTo: ['workflow'],
    expectedCodes: { default: ['workflow/unknown-edge-endpoint'] },
    inject(doc) {
      const restores = [capture(doc, '/edges/0/from'), capture(doc, '/mainPath/0')];
      doc.edges[0].from = 'benchmark-ghost-node';
      doc.mainPath[0] = 'benchmark-ghost-node';
      return { restores };
    },
  },
  'viewbox-oversized': {
    appliesTo: ['architecture'],
    expectedCodes: { default: ['composition/desktop-readability'] },
    inject(doc) {
      const restores = [capture(doc, '/meta/viewBox')];
      doc.meta.viewBox = [2400, 1200];
      return { restores };
    },
  },
  'title-overflow': {
    appliesTo: ALL_TYPES,
    expectedCodes: { default: ['viewer/viewport-overflow'] },
    inject(doc) {
      const restores = [capture(doc, '/meta/title')];
      doc.meta.title = LONG_TITLE;
      return { restores };
    },
  },
  'subtitle-overflow': {
    appliesTo: ALL_TYPES,
    expectedCodes: { default: ['viewer/viewport-overflow'] },
    inject(doc) {
      const restores = [capture(doc, '/meta/subtitle')];
      doc.meta.subtitle = LONG_SUBTITLE;
      return { restores };
    },
  },
};

export function defectEntry(classId, type) {
  const entry = DEFECTS[classId];
  if (!entry) throw new Error(`unknown defect class "${classId}"`);
  if (!entry.appliesTo.includes(type)) {
    throw new Error(`defect class "${classId}" does not apply to ${type}`);
  }
  return {
    class: classId,
    expectedCodes: entry.expectedCodes[type] || entry.expectedCodes.default,
    inject: (doc, options) => entry.inject(doc, options),
    oracleRepair: (doc, record) => restore(record)(doc),
  };
}
