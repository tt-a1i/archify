function edgeKey(from, to) {
  return `${from}\u0000${to}`;
}

function omissionIndex(omissions = []) {
  const components = new Map();
  const edges = new Map();
  const paths = new Map();
  const externalLabels = new Map();

  for (const [index, omission] of omissions.entries()) {
    const record = { ...omission, index };
    if (omission.kind === 'component') components.set(omission.id, record);
    if (omission.kind === 'edge') edges.set(edgeKey(omission.from, omission.to), record);
    if (omission.kind === 'path') paths.set(edgeKey(omission.from, omission.to), record);
    if (omission.kind === 'external-label') externalLabels.set(edgeKey(omission.from, omission.to), record);
  }

  return { components, edges, paths, externalLabels };
}

function findDirectedPath(adjacency, componentIds, from, to) {
  if (!componentIds.has(from) || !componentIds.has(to)) return null;
  if (from === to) return [from];

  const previous = new Map([[from, null]]);
  const pending = [from];
  while (pending.length) {
    const current = pending.shift();
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let cursor = current;
        while (cursor !== null) {
          path.unshift(cursor);
          cursor = previous.get(cursor);
        }
        return path;
      }
      pending.push(next);
    }
  }
  return null;
}

function reachableNodes(adjacency, componentIds, from) {
  if (!componentIds.has(from)) return [];
  const visited = new Set([from]);
  const pending = [from];
  while (pending.length) {
    const current = pending.shift();
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  return [...visited];
}

function subject(kind, fields, path) {
  return { diagramType: 'architecture', kind, ...fields, path };
}

function represented(subjectValue, evidence) {
  return { status: 'represented', subject: subjectValue, evidence };
}

function omitted(subjectValue, omission) {
  return {
    status: 'omitted',
    subject: subjectValue,
    evidence: {
      omissionIndex: omission.index,
      reason: omission.reason,
    },
  };
}

function missing(subjectValue, evidence) {
  return { status: 'missing', subject: subjectValue, evidence };
}

function diagnostic(code, message, subjectValue, evidence, supportedFixes) {
  return {
    severity: 'warning',
    code,
    message,
    subject: subjectValue,
    evidence,
    supportedFixes,
  };
}

// Architecture coverage is an explicit authoring contract, not repository
// inference. It checks only facts named by the author and remains non-blocking
// so incomplete drafts can still render and be inspected.
export function evaluateArchitectureSemanticCoverage(architecture) {
  const checks = architecture.semanticChecks;
  if (!checks) return null;

  const componentList = architecture.components || [];
  const components = new Map(componentList.map((component, index) => [component.id, { component, index }]));
  const componentIds = new Set(components.keys());
  const connections = architecture.connections || [];
  const authoredEdges = new Map();
  const adjacency = new Map([...componentIds].map((id) => [id, new Set()]));
  for (const [index, connection] of connections.entries()) {
    const key = edgeKey(connection.from, connection.to);
    if (!authoredEdges.has(key)) authoredEdges.set(key, []);
    authoredEdges.get(key).push({ connection, index });
    if (componentIds.has(connection.from) && componentIds.has(connection.to)) {
      adjacency.get(connection.from).add(connection.to);
    }
  }

  const omittedFacts = omissionIndex(checks.omissions);
  const requirements = [];
  const diagnostics = [];

  for (const [index, id] of (checks.requiredComponents || []).entries()) {
    const subjectValue = subject('component', { id }, `/semanticChecks/requiredComponents/${index}`);
    const authored = components.get(id);
    const omission = omittedFacts.components.get(id);
    if (authored) {
      requirements.push(represented(subjectValue, {
        componentIndex: authored.index,
        type: authored.component.type,
        label: authored.component.label,
      }));
      continue;
    }
    if (omission) {
      requirements.push(omitted(subjectValue, omission));
      continue;
    }
    const evidence = { authoredComponentIds: [...componentIds], matchingComponentCount: 0 };
    requirements.push(missing(subjectValue, evidence));
    diagnostics.push(diagnostic(
      'architecture/semantic-required-component',
      `Required component ${JSON.stringify(id)} is not authored. Add it or record a reasoned component omission.`,
      subjectValue,
      evidence,
      [
        `add a component with id ${JSON.stringify(id)}`,
        `add a component omission for ${JSON.stringify(id)} with a non-whitespace reason if it is intentionally out of scope`,
      ],
    ));
  }

  for (const [index, required] of (checks.requiredEdges || []).entries()) {
    const key = edgeKey(required.from, required.to);
    const subjectValue = subject('edge', { from: required.from, to: required.to }, `/semanticChecks/requiredEdges/${index}`);
    const matches = authoredEdges.get(key) || [];
    const omission = omittedFacts.edges.get(key);
    if (matches.length) {
      requirements.push(represented(subjectValue, {
        matchingConnections: matches.map(({ connection, index: connectionIndex }) => ({
          connectionIndex,
          ...(connection.id ? { id: connection.id } : {}),
          ...(connection.label ? { label: connection.label } : {}),
        })),
      }));
      continue;
    }
    if (omission) {
      requirements.push(omitted(subjectValue, omission));
      continue;
    }
    const evidence = {
      authoredConnectionCount: connections.length,
      matchingConnectionCount: 0,
      fromExists: componentIds.has(required.from),
      toExists: componentIds.has(required.to),
    };
    requirements.push(missing(subjectValue, evidence));
    diagnostics.push(diagnostic(
      'architecture/semantic-required-edge',
      `Required connection ${JSON.stringify(required.from)} -> ${JSON.stringify(required.to)} is not authored. Add the exact directed edge or record a reasoned edge omission.`,
      subjectValue,
      evidence,
      [
        `add a connection from ${JSON.stringify(required.from)} to ${JSON.stringify(required.to)}`,
        `add an edge omission for ${JSON.stringify(required.from)} -> ${JSON.stringify(required.to)} with a non-whitespace reason if it is intentionally out of scope`,
      ],
    ));
  }

  for (const [index, required] of (checks.requiredPaths || []).entries()) {
    const key = edgeKey(required.from, required.to);
    const subjectValue = subject('path', { from: required.from, to: required.to }, `/semanticChecks/requiredPaths/${index}`);
    const directedPath = findDirectedPath(adjacency, componentIds, required.from, required.to);
    const omission = omittedFacts.paths.get(key);
    if (directedPath) {
      requirements.push(represented(subjectValue, {
        path: directedPath,
        hopCount: directedPath.length - 1,
      }));
      continue;
    }
    if (omission) {
      requirements.push(omitted(subjectValue, omission));
      continue;
    }
    const evidence = {
      fromExists: componentIds.has(required.from),
      toExists: componentIds.has(required.to),
      reachableNodes: reachableNodes(adjacency, componentIds, required.from),
    };
    requirements.push(missing(subjectValue, evidence));
    diagnostics.push(diagnostic(
      'architecture/semantic-required-path',
      `No directed path exists from ${JSON.stringify(required.from)} to ${JSON.stringify(required.to)}. Add the missing workflow relationships or record a reasoned path omission.`,
      subjectValue,
      evidence,
      [
        `add the missing component or directed connections needed for a path from ${JSON.stringify(required.from)} to ${JSON.stringify(required.to)}`,
        `add a path omission for ${JSON.stringify(required.from)} -> ${JSON.stringify(required.to)} with a non-whitespace reason if it is intentionally out of scope`,
      ],
    ));
  }

  if (checks.requireExternalLabels) {
    for (const [index, connection] of connections.entries()) {
      const fromType = components.get(connection.from)?.component.type;
      const toType = components.get(connection.to)?.component.type;
      const touchesExternal = fromType === 'external' || toType === 'external';
      if (!touchesExternal) continue;

      const key = edgeKey(connection.from, connection.to);
      const subjectValue = subject(
        'external-label',
        {
          from: connection.from,
          to: connection.to,
          connectionIndex: index,
          ...(connection.id ? { id: connection.id } : {}),
        },
        `/connections/${index}/label`,
      );
      const hasLabel = typeof connection.label === 'string' && connection.label.trim().length > 0;
      const omission = omittedFacts.externalLabels.get(key);
      if (hasLabel) {
        requirements.push(represented(subjectValue, {
          label: connection.label,
          fromType,
          toType,
        }));
        continue;
      }
      if (omission) {
        requirements.push(omitted(subjectValue, omission));
        continue;
      }
      const evidence = {
        label: connection.label ?? null,
        fromType,
        toType,
      };
      requirements.push(missing(subjectValue, evidence));
      diagnostics.push(diagnostic(
        'architecture/semantic-external-label',
        `External-system connection ${JSON.stringify(connection.from)} -> ${JSON.stringify(connection.to)} has no operation label. Name the protocol or action, or record a reasoned external-label omission.`,
        subjectValue,
        evidence,
        [
          `add a non-whitespace operation or protocol label to connections[${index}]`,
          `add an external-label omission for ${JSON.stringify(connection.from)} -> ${JSON.stringify(connection.to)} with a non-whitespace reason if the label is intentionally out of scope`,
        ],
      ));
    }
  }

  const summary = {
    checked: requirements.length,
    represented: requirements.filter((item) => item.status === 'represented').length,
    missing: requirements.filter((item) => item.status === 'missing').length,
    omitted: requirements.filter((item) => item.status === 'omitted').length,
    warnings: diagnostics.length,
  };
  return {
    schemaVersion: 1,
    status: diagnostics.length ? 'warn' : 'pass',
    summary,
    requirements,
    diagnostics,
    omissions: checks.omissions || [],
  };
}
