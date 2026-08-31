function edgeKey(from, to) {
  return `${from}\u0000${to}`;
}

function omissionIndex(omissions = []) {
  const components = new Set();
  const edges = new Set();
  const paths = new Set();
  const externalLabels = new Set();

  for (const omission of omissions) {
    if (omission.kind === 'component') components.add(omission.id);
    if (omission.kind === 'edge') edges.add(edgeKey(omission.from, omission.to));
    if (omission.kind === 'path') paths.add(edgeKey(omission.from, omission.to));
    if (omission.kind === 'external-label') externalLabels.add(edgeKey(omission.from, omission.to));
  }

  return { components, edges, paths, externalLabels };
}

function hasDirectedPath(adjacency, from, to) {
  if (from === to) return true;
  const visited = new Set([from]);
  const pending = [from];

  while (pending.length) {
    const current = pending.shift();
    for (const next of adjacency.get(current) || []) {
      if (next === to) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  return false;
}

function diagnostic(code, message, subject) {
  return { severity: 'warning', code, message, subject };
}

// Architecture coverage is an explicit authoring contract, not repository
// inference. It checks only facts named by the author and remains non-blocking
// so incomplete drafts can still render and be inspected.
export function evaluateArchitectureSemanticCoverage(architecture) {
  const checks = architecture.semanticChecks;
  if (!checks) return null;

  const components = new Map((architecture.components || []).map((component) => [component.id, component]));
  const connections = architecture.connections || [];
  const authoredEdges = new Set(connections.map((connection) => edgeKey(connection.from, connection.to)));
  const adjacency = new Map();
  for (const connection of connections) {
    if (!adjacency.has(connection.from)) adjacency.set(connection.from, new Set());
    adjacency.get(connection.from).add(connection.to);
  }
  const omitted = omissionIndex(checks.omissions);
  const diagnostics = [];

  for (const id of checks.requiredComponents || []) {
    if (components.has(id) || omitted.components.has(id)) continue;
    diagnostics.push(diagnostic(
      'architecture/semantic-required-component',
      `Required component ${JSON.stringify(id)} is not authored. Add it or record a reasoned component omission.`,
      { kind: 'component', id },
    ));
  }

  for (const required of checks.requiredEdges || []) {
    const key = edgeKey(required.from, required.to);
    if (authoredEdges.has(key) || omitted.edges.has(key)) continue;
    diagnostics.push(diagnostic(
      'architecture/semantic-required-edge',
      `Required connection ${JSON.stringify(required.from)} -> ${JSON.stringify(required.to)} is not authored. Add the exact directed edge or record a reasoned edge omission.`,
      { kind: 'edge', from: required.from, to: required.to },
    ));
  }

  for (const required of checks.requiredPaths || []) {
    const key = edgeKey(required.from, required.to);
    if (hasDirectedPath(adjacency, required.from, required.to) || omitted.paths.has(key)) continue;
    diagnostics.push(diagnostic(
      'architecture/semantic-required-path',
      `No directed path exists from ${JSON.stringify(required.from)} to ${JSON.stringify(required.to)}. Add the missing workflow relationships or record a reasoned path omission.`,
      { kind: 'path', from: required.from, to: required.to },
    ));
  }

  if (checks.requireExternalLabels) {
    for (const connection of connections) {
      const touchesExternal = components.get(connection.from)?.type === 'external'
        || components.get(connection.to)?.type === 'external';
      const hasLabel = typeof connection.label === 'string' && connection.label.trim().length > 0;
      const key = edgeKey(connection.from, connection.to);
      if (!touchesExternal || hasLabel || omitted.externalLabels.has(key)) continue;
      diagnostics.push(diagnostic(
        'architecture/semantic-external-label',
        `External-system connection ${JSON.stringify(connection.from)} -> ${JSON.stringify(connection.to)} has no operation label. Name the protocol or action, or record a reasoned external-label omission.`,
        { kind: 'external-label', from: connection.from, to: connection.to },
      ));
    }
  }

  return {
    schemaVersion: 1,
    status: diagnostics.length ? 'warn' : 'pass',
    summary: { warnings: diagnostics.length },
    diagnostics,
    omissions: checks.omissions || [],
  };
}
