const TARGET_SCHEMA_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Return the authored workflow as a schema-v2 document without its capacity
 * override. The compiler can use this projection to discover the intrinsic v2
 * rank plan before deciding whether an explicit viewBox needs to grow.
 */
export function intrinsicWorkflow(workflow) {
  const intrinsic = clone(workflow);
  intrinsic.schema_version = TARGET_SCHEMA_VERSION;
  intrinsic.meta = { ...intrinsic.meta };
  delete intrinsic.meta.viewBox;
  return intrinsic;
}

/**
 * Return a schema-v2 planning projection that removes authored route geometry
 * which may only become valid after its legacy X coordinates are remapped.
 * Rank-affecting automatic and straight relationships remain in the projection.
 */
export function planningWorkflow(workflow) {
  const planned = intrinsicWorkflow(workflow);
  planned.edges = planned.edges.flatMap((edge) => {
    const hasRoutedGeometry = Array.isArray(edge.via)
      || (edge.route && !['auto', 'straight'].includes(edge.route))
      || edge.channelX !== undefined
      || edge.channelY !== undefined;
    if (hasRoutedGeometry) return [];

    const automatic = {};
    for (const property of ['id', 'from', 'to', 'variant', 'role', 'width']) {
      if (edge[property] !== undefined) automatic[property] = edge[property];
    }
    if (edge.route === 'straight') automatic.route = 'straight';
    if (edge.labelAt === undefined && edge.label !== undefined) automatic.label = edge.label;
    return [automatic];
  });

  if (Array.isArray(planned.mainPath)) {
    const projectedPairs = new Set(planned.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
    const projectionBreaksMainPath = planned.mainPath.some((from, index) => (
      index < planned.mainPath.length - 1
      && !projectedPairs.has(`${from}\u0000${planned.mainPath[index + 1]}`)
    ));
    if (projectionBreaksMainPath) delete planned.mainPath;
  }

  return planned;
}

function mappedNumber(value) {
  return Number(value.toFixed(6));
}

/**
 * Build a deterministic piecewise-linear mapping between corresponding legacy
 * and readable rank centers. Coordinates outside the rank span are extrapolated
 * using the nearest segment so explicitly authored outside corridors retain
 * their relative offset.
 */
export function createHorizontalRankMapper(oldColumns, newColumns) {
  if (
    !Array.isArray(oldColumns)
    || !Array.isArray(newColumns)
    || oldColumns.length !== newColumns.length
    || oldColumns.length < 2
    || !oldColumns.every(Number.isFinite)
    || !newColumns.every(Number.isFinite)
  ) {
    throw new TypeError('Horizontal rank mapping requires matching finite column arrays.');
  }
  for (let index = 1; index < oldColumns.length; index += 1) {
    if (oldColumns[index] <= oldColumns[index - 1] || newColumns[index] <= newColumns[index - 1]) {
      throw new TypeError('Horizontal rank mapping requires strictly increasing columns.');
    }
  }

  return (x) => {
    if (!Number.isFinite(x)) throw new TypeError('Horizontal rank mapping requires a finite x coordinate.');
    let segment = oldColumns.length - 2;
    if (x <= oldColumns[0]) {
      segment = 0;
    } else {
      for (let index = 0; index < oldColumns.length - 1; index += 1) {
        if (x <= oldColumns[index + 1]) {
          segment = index;
          break;
        }
      }
    }
    const oldSpan = oldColumns[segment + 1] - oldColumns[segment];
    const newSpan = newColumns[segment + 1] - newColumns[segment];
    const ratio = (x - oldColumns[segment]) / oldSpan;
    return mappedNumber(newColumns[segment] + ratio * newSpan);
  };
}

/**
 * Apply one horizontal coordinate mapping to every schema-v1 absolute X pin.
 * The caller owns the supplied workflow; this function reports an audit trail
 * for each changed coordinate in stable document order.
 */
export function mapExplicitCoordinates(workflow, mapX) {
  const changedCoordinates = [];
  const record = (path, owner, property) => {
    const from = owner[property];
    const to = mapX(from);
    owner[property] = to;
    if (to !== from) changedCoordinates.push({ path, from, to });
  };

  for (const [edgeIndex, edge] of workflow.edges.entries()) {
    if (Array.isArray(edge.via)) {
      for (const [pointIndex, point] of edge.via.entries()) {
        if (Array.isArray(point) && Number.isFinite(point[0])) {
          record(`/edges/${edgeIndex}/via/${pointIndex}/0`, point, 0);
        }
      }
    }
    if (Array.isArray(edge.labelAt) && Number.isFinite(edge.labelAt[0])) {
      record(`/edges/${edgeIndex}/labelAt/0`, edge.labelAt, 0);
    }
    if (Number.isFinite(edge.channelX)) {
      record(`/edges/${edgeIndex}/channelX`, edge, 'channelX');
    }
  }
  return changedCoordinates;
}

/**
 * Construct an independently owned schema-v2 candidate with all authored
 * absolute X pins mapped to the readable rank plan.
 */
export function createMappedWorkflowCandidate(workflow, oldColumns, newColumns) {
  const document = clone(workflow);
  document.schema_version = TARGET_SCHEMA_VERSION;
  const mapX = createHorizontalRankMapper(oldColumns, newColumns);
  const changedCoordinates = mapExplicitCoordinates(document, mapX);
  return { document, changedCoordinates };
}
