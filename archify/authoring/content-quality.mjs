import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { QUALITY_CONTRACT } from './quality-contract.mjs';

const EXAMPLES = Object.freeze({
  architecture: 'examples/web-app.architecture.json',
  workflow: 'examples/agent-tool-call.workflow.json',
  sequence: 'examples/cache-miss-request.sequence.json',
  dataflow: 'examples/product-analytics.dataflow.json',
  lifecycle: 'examples/agent-run.lifecycle.json',
});

const COLLECTIONS = Object.freeze({
  architecture: ['components', 'boundaries', 'connections'],
  workflow: ['lanes', 'phases', 'groups', 'nodes', 'edges'],
  sequence: ['participants', 'segments', 'messages'],
  dataflow: ['nodes', 'flows'],
  lifecycle: ['lanes', 'states', 'transitions'],
});

const DIRECTED_GRAPHS = Object.freeze({
  architecture: { entities: 'components', relationships: 'connections' },
  workflow: { entities: 'nodes', relationships: 'edges' },
  sequence: { entities: 'participants', relationships: 'messages' },
  dataflow: { entities: 'nodes', relationships: 'flows' },
  lifecycle: { entities: 'states', relationships: 'transitions' },
});

const EXPLICIT_DIAGRAM_TYPE_SUFFIXES = Object.freeze({
  architecture: /(?:架构(?:视图|图)|architecture\s+(?:view|diagram))\s*$/iu,
  workflow: /(?:工作流(?:视图|图)?|流程图|workflow\s+(?:view|diagram))\s*$/iu,
  sequence: /(?:时序图|序列图|sequence\s+diagram)\s*$/iu,
  dataflow: /(?:数据流(?:视图|图)?|data[ -]?flow\s+(?:view|diagram))\s*$/iu,
  lifecycle: /(?:生命周期(?:视图|图)?|状态图|(?:lifecycle|state)\s+diagram)\s*$/iu,
});

function structuralTokens(document, type) {
  const tokens = new Set();
  for (const collection of COLLECTIONS[type] || []) {
    for (const entry of document?.[collection] || []) {
      if (typeof entry?.id === 'string') tokens.add(`id:${entry.id}`);
      if (typeof entry?.from === 'string' && typeof entry?.to === 'string') {
        tokens.add(`edge:${entry.from}->${entry.to}`);
      }
    }
  }
  return tokens;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function directedTopologyFingerprint(document, type) {
  const graph = DIRECTED_GRAPHS[type];
  if (!graph) return null;
  const entities = Array.isArray(document?.[graph.entities]) ? document[graph.entities] : [];
  const relationships = Array.isArray(document?.[graph.relationships])
    ? document[graph.relationships]
    : [];
  const entityById = new Map();
  for (const entity of entities) {
    if (typeof entity?.id !== 'string' || !entity.id || entityById.has(entity.id)) return null;
    entityById.set(entity.id, entity);
  }
  const edges = relationships.filter((relationship) => (
    typeof relationship?.from === 'string'
    && typeof relationship?.to === 'string'
    && entityById.has(relationship.from)
    && entityById.has(relationship.to)
  ));
  if (entityById.size < 5 || edges.length < 4) return null;

  let colors = new Map([...entityById].map(([id, entity]) => [
    id,
    fingerprint({ type: entity.type || null }),
  ]));
  for (let round = 0; round < entityById.size; round += 1) {
    colors = new Map([...entityById.keys()].map((id) => {
      const incoming = [];
      const outgoing = [];
      for (const edge of edges) {
        const edgeKind = fingerprint({ variant: edge.variant || null, route: edge.route || null });
        if (edge.to === id) incoming.push(`${edgeKind}:${colors.get(edge.from)}`);
        if (edge.from === id) outgoing.push(`${edgeKind}:${colors.get(edge.to)}`);
      }
      return [id, fingerprint({
        self: colors.get(id),
        incoming: incoming.sort(),
        outgoing: outgoing.sort(),
      })];
    }));
  }
  return fingerprint({
    entities: entityById.size,
    relationships: edges.length,
    colors: [...colors.values()].sort(),
  });
}

function nonIdentifierStructuralTokens(document, type) {
  const graph = DIRECTED_GRAPHS[type];
  if (!graph) return new Set();
  const tokens = new Set();
  for (const [kind, collection, fields] of [
    ['entity', graph.entities, ['type', 'label', 'sublabel', 'tag']],
    ['relationship', graph.relationships, ['label', 'variant', 'note', 'classification']],
  ]) {
    for (const entry of document?.[collection] || []) {
      for (const field of fields) {
        const value = entry?.[field];
        if (typeof value === 'string' && value.trim()) {
          tokens.add(`${kind}:${field}:${value.normalize('NFKC').trim().toLowerCase()}`);
        }
      }
    }
  }
  return tokens;
}

export function exampleContaminationAssessment(candidate, type, { skillRoot } = {}) {
  const examplePath = EXAMPLES[type];
  if (!examplePath || typeof skillRoot !== 'string') {
    return { diagnostics: [], receipt: { status: 'not-applicable' } };
  }
  const example = JSON.parse(fs.readFileSync(path.join(skillRoot, examplePath), 'utf8'));
  const candidateTokens = structuralTokens(candidate, type);
  const exampleTokens = structuralTokens(example, type);
  const comparable = Math.min(candidateTokens.size, exampleTokens.size);
  const overlap = [...candidateTokens].filter((token) => exampleTokens.has(token)).length;
  const identifierOverlapRatio = comparable === 0 ? 0 : overlap / comparable;
  const candidateTopology = directedTopologyFingerprint(candidate, type);
  const exampleTopology = directedTopologyFingerprint(example, type);
  const topologyMatches = candidateTopology !== null && candidateTopology === exampleTopology;
  const candidateContentTokens = nonIdentifierStructuralTokens(candidate, type);
  const exampleContentTokens = nonIdentifierStructuralTokens(example, type);
  const comparableContentTokens = Math.min(
    candidateContentTokens.size,
    exampleContentTokens.size,
  );
  const overlappingContentTokens = [...candidateContentTokens]
    .filter((token) => exampleContentTokens.has(token)).length;
  const contentOverlapRatio = comparableContentTokens === 0
    ? 0
    : overlappingContentTokens / comparableContentTokens;
  const identifierContamination = comparable >= 5
    && identifierOverlapRatio >= QUALITY_CONTRACT.guards.maximumExampleStructuralOverlapRatio;
  const renamedTopologyContamination = topologyMatches
    && comparableContentTokens >= 5
    && contentOverlapRatio >= QUALITY_CONTRACT.guards.maximumExampleStructuralOverlapRatio;
  const contaminated = identifierContamination || renamedTopologyContamination;
  const ratio = Math.max(
    identifierOverlapRatio,
    topologyMatches ? contentOverlapRatio : 0,
  );
  const receipt = {
    status: contaminated ? 'failed' : 'passed',
    example: examplePath,
    detection: identifierContamination
      ? 'identifier-overlap'
      : renamedTopologyContamination
        ? 'renamed-directed-topology'
        : null,
    candidateTokens: candidateTokens.size,
    exampleTokens: exampleTokens.size,
    comparableTokens: comparable,
    overlappingTokens: overlap,
    overlapRatio: Number(ratio.toFixed(3)),
    identifierOverlapRatio: Number(identifierOverlapRatio.toFixed(3)),
    directedTopology: {
      candidate: candidateTopology,
      example: exampleTopology,
      matches: topologyMatches,
    },
    nonIdentifierContent: {
      candidateTokens: candidateContentTokens.size,
      exampleTokens: exampleContentTokens.size,
      comparableTokens: comparableContentTokens,
      overlappingTokens: overlappingContentTokens,
      overlapRatio: Number(contentOverlapRatio.toFixed(3)),
    },
  };
  return {
    receipt,
    diagnostics: contaminated ? [{
      code: 'content/example-contamination',
      message: `content/example-contamination: candidate reuses ${Math.round(ratio * 100)}% of the bundled example structural tokens; fresh repository authoring must use source-specific IDs and topology.`,
      evidence: receipt,
    }] : [],
  };
}

function readerFacingStrings(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => readerFacingStrings(entry, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, entry] of Object.entries(value)) {
    if (['title', 'subtitle', 'label', 'sublabel', 'tag', 'note', 'classification'].includes(key)
      && typeof entry === 'string') {
      output.push(entry.trim().replace(/\s+/gu, ' '));
    } else if (key === 'items' && Array.isArray(entry)) {
      entry.filter((item) => typeof item === 'string')
        .forEach((item) => output.push(item.trim().replace(/\s+/gu, ' ')));
    } else {
      readerFacingStrings(entry, output);
    }
  }
  return output;
}

export function lowInformationRepetitionAssessment(candidate) {
  const counts = new Map();
  for (const text of readerFacingStrings(candidate)) {
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([text, count]) => count > QUALITY_CONTRACT.guards.maximumLowInformationExactRepeats
      && /(?:^|[\s:_-])(?:模块(?:\s*\d+)?|核心能力|服务层|模块视图|架构视图)$/u.test(text))
    .map(([text, count]) => ({ text, count }));
  const receipt = { status: repeated.length ? 'failed' : 'passed', repeated };
  return {
    receipt,
    diagnostics: repeated.length ? [{
      code: 'content/low-information-repetition',
      message: `content/low-information-repetition: repeated generic content ${repeated.map(({ text, count }) => `"${text}"×${count}`).join(', ')} must be replaced with source-specific semantics.`,
      evidence: receipt,
    }] : [],
  };
}

export function titleTypeConsistencyAssessment(candidate, diagramType) {
  const title = typeof candidate?.meta?.title === 'string' ? candidate.meta.title.trim() : '';
  const declaredAs = Object.entries(EXPLICIT_DIAGRAM_TYPE_SUFFIXES)
    .find(([type, pattern]) => type !== diagramType && pattern.test(title))?.[0] || null;
  const receipt = {
    status: declaredAs ? 'failed' : 'passed',
    title,
    expectedType: diagramType,
    declaredAs,
  };
  return {
    receipt,
    diagnostics: declaredAs ? [{
      code: 'content/diagram-type-title',
      message: `content/diagram-type-title: title explicitly declares ${declaredAs}, but the candidate diagram type is ${diagramType}.`,
      evidence: receipt,
    }] : [],
  };
}
