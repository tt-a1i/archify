import { anchor } from '../shared/geometry.mjs';
import { throwDiagnosticError } from '../shared/diagnostics.mjs';

function hasRelativeVia(connection) {
  return connection.via?.some(point => point.some(value => typeof value === 'object'));
}

function diagnostic(connection, index, field, code, message, evidence, supportedFixes) {
  return {
    code: `architecture/${code}`, severity: 'error', message,
    subject: {
      diagramType: 'architecture', connection: connection.id ?? null,
      path: `/connections/${index}/${field}`, from: connection.from, to: connection.to,
    },
    evidence, supportedFixes,
  };
}

// Schema validation precedes this step. Resolve once, before any routing,
// boundary/canvas measurement or label placement; never rewrite the source IR.
export function resolveRelativeVia(connections, components) {
  const diagnostics = [];
  const resolved = connections?.map((connection, index) => {
    if (!hasRelativeVia(connection)) return connection;
    const via = connection.via.map((point, pointIndex) => point.map((value, axis) => {
      if (typeof value === 'number') return value;
      const endpoint = value.anchor;
      const node = components.get(connection[endpoint]);
      const side = connection[`${endpoint}Side`];
      const field = `via/${pointIndex}/${axis}`;
      const fail = (code, message, evidence, fixes) => {
        diagnostics.push(diagnostic(connection, index, field, code, message, evidence, fixes));
      };
      if (!node) {
        fail('relative-via-endpoint', `Relative via references unknown ${endpoint} component "${connection[endpoint]}".`,
          { anchor: endpoint, nodeId: connection[endpoint], availableNodeIds: [...components.keys()] },
          [`set /connections/${index}/${endpoint} to the intended declared component id`]);
        return value;
      }
      if (!side) {
        fail('relative-via-side', `Relative via requires an explicit ${endpoint}Side.`,
          { anchor: endpoint, side: side ?? null },
          [`set /connections/${index}/${endpoint}Side to top, right, bottom or left to identify the intended port`]);
        return value;
      }
      const port = anchor(node, side);
      const coordinate = port[axis] + (value.offset ?? 0);
      if (!Number.isFinite(coordinate)) {
        fail('relative-via-coordinate', 'Relative via must resolve to a finite coordinate.',
          { anchor: endpoint, axis: axis === 0 ? 'x' : 'y', port, offset: value.offset ?? 0 },
          [`use finite component positions, sizes and an offset at /connections/${index}/${field} whose sum is finite`]);
      }
      return coordinate;
    }));
    return { ...connection, via };
  });
  if (diagnostics.length) throwDiagnosticError('Architecture relative via resolution failed', diagnostics);
  return resolved;
}

// Authored points (including collinear points) retain their indices in the
// router. Do not silently clamp a label to a different or collapsed segment.
// Absolute labelAt and legacy numeric via keep their existing semantics.
export function relativeViaLabelProblem(connection, points, index) {
  if (!hasRelativeVia(connection) || !connection.label || connection.labelAt) return null;
  const segment = connection.labelSegment ?? 1;
  const start = points[segment];
  const end = points[segment + 1];
  if (start && end && Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.0001) return null;
  return diagnostic(connection, index, 'labelSegment', 'relative-via-label-segment',
    'Relative via label must select an existing nonzero route segment.',
    { segment, segmentCount: points.length - 1, start: start ?? null, end: end ?? null },
    [`set /connections/${index}/labelSegment to an existing nonzero segment index (0 through ${points.length - 2})`,
      `adjust the selected via offsets or component spacing to keep the intended label segment nonzero`]);
}
