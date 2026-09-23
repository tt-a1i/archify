// Orthogonal connection router shared by the typed renderers (architecture,
// lifecycle, erd). Create a new router when measured boxes or connections
// change: port spreading is computed once and route results are cached for
// this scene.
//
// A type that owns diagram-specific geometry adds it through options instead of
// copying the router: `sideFor` biases the inferred endpoint sides,
// `portSpacing` widens the automatic port spread, `preferredCandidates`
// contributes a candidate family that runs before the shared ones, and
// `compositionFloors` states whether the rhythm floors describe the route this
// type ends up drawing. Every option is inert when omitted, so a caller that
// passes none keeps the architecture routing exactly.

import {
  segmentIntersectsRect,
  anchor,
  automaticPortSpread,
  automaticPortRhythmBridge,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  properSegmentIntersection,
  routeHonorsEndpointSides,
  normalizeRoutePoints,
  roundedPath,
  collectBorderRuns,
  collectRouteRhythmIssues,
  frameBorderSegments,
} from '../shared/geometry.mjs';
import { shortestOrthogonalGridRoute } from '../shared/route-quality.mjs';

// A route may touch its own endpoints (they are its source and target) but must
// not re-enter them: the first segment may leave from the source and the last
// may arrive at the target, nothing else.
function routeClearsEndpointComponents(points, from, to) {
  const lastSegment = points.length - 2;
  for (let index = 0; index <= lastSegment; index += 1) {
    const segment = { start: points[index], end: points[index + 1] };
    if (index > 0 && segmentIntersectsRect(segment, from)) return false;
    if (index < lastSegment && segmentIntersectsRect(segment, to)) return false;
  }
  return true;
}

// Clearance from the components a route is not attached to. Module level so the
// closure below can add its reserved-label rule without reimplementing the
// segment test.
function routeClearsComponents(conn, points, components, clearance = 2) {
  const endpointIds = new Set([conn.from, conn.to]);
  for (const component of components.values()) {
    if (endpointIds.has(component.id)) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, component, clearance)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Router bound to one set of measured component boxes.
 *
 * @param {Map<string, {x,y,width,height,cx,cy}>} components measured boxes by id
 * @param {Array<object>} connections the connection list to spread ports across
 * @param {object} [options]
 * @param {Array<{x,y,width,height,radius?}>} [options.frames] structural frames
 *   (boundaries) whose borders an automatic route may cross but never follow
 * @param {number} [options.interiorSegmentPx] showcase floor for interior segments
 * @param {number} [options.microSegmentPx] floor for any segment
 * @param {(conn: object, points: number[][], context: {routes: number[][][], labels: object[]}) => object|null} [options.labelRectFor]
 *   default label rect of a routed relationship given the routes and label
 *   rects resolved so far; later automatic routes keep clear of it so a dense
 *   fan-out does not leave the label nowhere to go
 */
/**
 * @param {(conn: object, endpoint: 'source'|'target') => string|undefined} [options.sideFor]
 *   default side of an endpoint when the connection does not author one; a
 *   type whose glyphs or reading order differ from architecture supplies its own
 * @param {number} [options.portSpacing] automatic port spread spacing on a
 *   shared side; raise it when an endpoint glyph is taller than the default
 * @param {(context: {conn: object, from: object, to: object, start: number[], end: number[], fromSide: string, toSide: string}) => number[][][]} [options.preferredCandidates]
 *   candidate families tried before the shared ones, so a type-owned corridor
 *   (a bundled trunk, a dedicated lane) wins over the generic midpoint
 * @param {boolean} [options.compositionFloors = true] hold every automatic
 *   route to the rhythm floors the showcase gate enforces, so the planner never
 *   accepts a route the gate will reject. A type that draws a route differently
 *   from its logical points (the erd renderer removes the bundled trunk stretch
 *   from each branch and draws the bus as one path) turns this off: the floors
 *   describe the drawn route, and that type answers for the drawn result at its
 *   own gate instead.
 */
export function createRouter(components, connections, {
  frames = [],
  interiorSegmentPx = 16,
  microSegmentPx = 8,
  labelRectFor = null,
  sideFor = null,
  portSpacing = null,
  preferredCandidates = null,
  compositionFloors = true,
} = {}) {
  const frameBorders = frames.flatMap((frame) => frameBorderSegments(frame));
  const LABEL_CLEARANCE = 4;
  // Labels of already-routed relationships, reserved while planning the rest.
  let reservedLabels = [];
  let honourReservedLabels = true;

  function routeClearsReservedLabels(conn, points) {
    if (!honourReservedLabels) return true;
    for (const entry of reservedLabels) {
      if (entry.conn === conn) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, entry.rect, LABEL_CLEARANCE)) {
          return false;
        }
      }
    }
    return true;
  }

  // The grid search adds its own 2px component clearance; pre-expand so a
  // reserved label keeps the same 4px clearance the placement pass demands.
  function reservedLabelObstacles(gridClearance) {
    if (!honourReservedLabels) return [];
    const grow = LABEL_CLEARANCE - gridClearance;
    return reservedLabels.map(({ rect }) => ({
      x: rect.x - grow,
      y: rect.y - grow,
      width: rect.width + grow * 2,
      height: rect.height + grow * 2,
    }));
  }

  // Automatic routes are held to the same composition floors the showcase
  // gate enforces afterwards. Accepting a route here that the gate rejects
  // only hands the author a hand-routing repair the planner could have made.
  function routeMeetsCompositionFloors(points) {
    if (compositionFloors
        && collectRouteRhythmIssues({ routedRelations: [{ points }], interiorSegmentPx, microSegmentPx }).length) {
      return false;
    }
    return !frames.length || collectBorderRuns({ routedRelations: [{ points }], frames }).length === 0;
  }
  const planningMetrics = {
    routeCount: 0,
    explicitRouteCount: 0,
    automaticRouteCount: 0,
    gridSearchCount: 0,
    gridRoutedCount: 0,
    gridCandidateNodeCount: 0,
    gridUsableNodeCount: 0,
    gridEdgeCount: 0,
    gridVisitedNodeCount: 0,
    avoidedSegmentCount: 0,
    conflictFallbackCount: 0,
    maximumGridSearchCount: 64,
    gridBudgetExhaustedCount: 0,
    crossoverRoutedCount: 0,
    gridAttempts: [],
  };

  // ---- Connection routing ------------------------------------------------------
  function clearsScene(conn, points, clearance = 2) {
    return routeClearsComponents(conn, points, components, clearance)
      && routeClearsReservedLabels(conn, points);
  }


  function relationshipsShareEndpoint(left, right) {
    return left.from === right.from
      || left.from === right.to
      || left.to === right.from
      || left.to === right.to;
  }

  function collinearOverlapLength(leftStart, leftEnd, rightStart, rightEnd) {
    const epsilon = 0.0001;
    if (Math.abs(leftStart[0] - leftEnd[0]) <= epsilon
        && Math.abs(rightStart[0] - rightEnd[0]) <= epsilon
        && Math.abs(leftStart[0] - rightStart[0]) <= epsilon) {
      return Math.max(0,
        Math.min(Math.max(leftStart[1], leftEnd[1]), Math.max(rightStart[1], rightEnd[1]))
          - Math.max(Math.min(leftStart[1], leftEnd[1]), Math.min(rightStart[1], rightEnd[1])));
    }
    if (Math.abs(leftStart[1] - leftEnd[1]) <= epsilon
        && Math.abs(rightStart[1] - rightEnd[1]) <= epsilon
        && Math.abs(leftStart[1] - rightStart[1]) <= epsilon) {
      return Math.max(0,
        Math.min(Math.max(leftStart[0], leftEnd[0]), Math.max(rightStart[0], rightEnd[0]))
          - Math.max(Math.min(leftStart[0], leftEnd[0]), Math.min(rightStart[0], rightEnd[0])));
    }
    return 0;
  }

  function orthogonalTouchOnResolvedInterior(start, end, resolvedStart, resolvedEnd) {
    const epsilon = 0.0001;
    const candidateHorizontal = Math.abs(start[1] - end[1]) <= epsilon;
    const candidateVertical = Math.abs(start[0] - end[0]) <= epsilon;
    const resolvedHorizontal = Math.abs(resolvedStart[1] - resolvedEnd[1]) <= epsilon;
    const resolvedVertical = Math.abs(resolvedStart[0] - resolvedEnd[0]) <= epsilon;
    if (candidateHorizontal && resolvedVertical) {
      const x = resolvedStart[0];
      const y = start[1];
      return x >= Math.min(start[0], end[0]) - epsilon
        && x <= Math.max(start[0], end[0]) + epsilon
        && y > Math.min(resolvedStart[1], resolvedEnd[1]) + epsilon
        && y < Math.max(resolvedStart[1], resolvedEnd[1]) - epsilon;
    }
    if (candidateVertical && resolvedHorizontal) {
      const x = start[0];
      const y = resolvedStart[1];
      return y >= Math.min(start[1], end[1]) - epsilon
        && y <= Math.max(start[1], end[1]) + epsilon
        && x > Math.min(resolvedStart[0], resolvedEnd[0]) + epsilon
        && x < Math.max(resolvedStart[0], resolvedEnd[0]) - epsilon;
    }
    return false;
  }

  function unrelatedResolvedRoutes(conn, resolvedRoutes) {
    return resolvedRoutes.filter((entry) => !relationshipsShareEndpoint(conn, entry.conn));
  }

  function routeConflictsWithResolved(conn, points, resolvedRoutes) {
    const unrelated = unrelatedResolvedRoutes(conn, resolvedRoutes);
    for (const entry of unrelated) {
      for (let left = 0; left < points.length - 1; left += 1) {
        for (let right = 0; right < entry.points.length - 1; right += 1) {
          if (properSegmentIntersection(
            points[left],
            points[left + 1],
            entry.points[right],
            entry.points[right + 1],
          )) return true;
          if (orthogonalTouchOnResolvedInterior(
            points[left],
            points[left + 1],
            entry.points[right],
            entry.points[right + 1],
          )) return true;
          if (collinearOverlapLength(
            points[left],
            points[left + 1],
            entry.points[right],
            entry.points[right + 1],
          ) >= 8) return true;
        }
      }
    }
    return false;
  }

  function routeOverlapsResolved(conn, points, resolvedRoutes) {
    const unrelated = unrelatedResolvedRoutes(conn, resolvedRoutes);
    for (const entry of unrelated) {
      for (let left = 0; left < points.length - 1; left += 1) {
        for (let right = 0; right < entry.points.length - 1; right += 1) {
          if (collinearOverlapLength(
            points[left],
            points[left + 1],
            entry.points[right],
            entry.points[right + 1],
          ) >= 8) return true;
        }
      }
    }
    return false;
  }

  const OUTWARD_SIDE_VECTOR = {
    left: [-1, 0],
    right: [1, 0],
    top: [0, -1],
    bottom: [0, 1],
  };

  function outwardStub(point, side, distance = 24) {
    const [dx, dy] = OUTWARD_SIDE_VECTOR[side] || [0, 0];
    return [point[0] + dx * distance, point[1] + dy * distance];
  }

  function collinearBacktrack(a, b, c) {
    const first = [b[0] - a[0], b[1] - a[1]];
    const second = [c[0] - b[0], c[1] - b[1]];
    const cross = first[0] * second[1] - first[1] * second[0];
    const dot = first[0] * second[0] + first[1] * second[1];
    return Math.abs(cross) <= 0.0001 && dot < -0.0001;
  }

  function sideAwareBridgeCandidates(start, end, fromSide, toSide) {
    const startStub = outwardStub(start, fromSide);
    const endStub = outwardStub(end, toSide);
    const rawCandidates = [];
    const minimumBridge = 16;
    const verticalSides = new Set(['top', 'bottom']);
    const horizontalSides = new Set(['left', 'right']);

    // Port spreading can leave parallel-side anchors only a few pixels apart.
    // Route through a bounded outside channel so we keep both endpoint normals
    // without introducing a tiny, noisy connector between the two stubs.
    if (verticalSides.has(fromSide) && verticalSides.has(toSide)
        && Math.abs(start[0] - end[0]) < minimumBridge) {
      for (const channelX of [
        Math.max(start[0], end[0]) + minimumBridge,
        Math.min(start[0], end[0]) - minimumBridge,
      ]) {
        rawCandidates.push([
          startStub,
          [channelX, startStub[1]],
          [channelX, endStub[1]],
          endStub,
        ]);
      }
    }
    if (horizontalSides.has(fromSide) && horizontalSides.has(toSide)
        && Math.abs(start[1] - end[1]) < minimumBridge) {
      for (const channelY of [
        Math.max(start[1], end[1]) + minimumBridge,
        Math.min(start[1], end[1]) - minimumBridge,
      ]) {
        rawCandidates.push([
          startStub,
          [startStub[0], channelY],
          [endStub[0], channelY],
          endStub,
        ]);
      }
    }

    rawCandidates.push(
      [startStub, [endStub[0], startStub[1]], endStub],
      [startStub, [startStub[0], endStub[1]], endStub],
    );
    return rawCandidates.map((candidate) => normalizeRoutePoints([start, ...candidate, end]))
      .filter((points) => points.length >= 2)
      .filter((points) => !collinearBacktrack(points[0], points[1], points[2] || points[1]))
      .filter((points) => !collinearBacktrack(points.at(-3) || points.at(-2), points.at(-2), points.at(-1)))
      .filter((points) => routeHonorsEndpointSides(points, fromSide, toSide))
      .map((points) => points.slice(1, -1));
  }

  const AUTOMATIC_PORT_CORNER_GUTTER = 16;
  const AUTOMATIC_PORT_ALIGNMENT_DELTA = 16;

  function portHasCornerClearance(rect, side, point) {
    if (side === 'left' || side === 'right') {
      const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, rect.height / 2);
      return point[1] >= rect.y + inset && point[1] <= rect.y + rect.height - inset;
    }
    if (side === 'top' || side === 'bottom') {
      const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, rect.width / 2);
      return point[0] >= rect.x + inset && point[0] <= rect.x + rect.width - inset;
    }
    return false;
  }

  function alignFacingPorts(conn, from, to, start, end, fromSide, toSide, ports) {
    const hasExplicitGeometry = (
      conn.via
      || (conn.route && conn.route !== 'auto')
      || conn.channelX !== undefined
      || conn.channelY !== undefined
      || conn.labelAt
    );
    const horizontallyFacing = (
      (fromSide === 'right' && toSide === 'left')
      || (fromSide === 'left' && toSide === 'right')
    );
    const verticallyFacing = (
      (fromSide === 'bottom' && toSide === 'top')
      || (fromSide === 'top' && toSide === 'bottom')
    );
    if (hasExplicitGeometry || (!horizontallyFacing && !verticallyFacing)) return { start, end };

    const fromSpread = Boolean(ports?.from);
    const toSpread = Boolean(ports?.to);
    if (fromSpread && toSpread) return { start, end };
    const hasExplicitSides = (
      (conn.fromSide && conn.fromSide !== 'auto')
      || (conn.toSide && conn.toSide !== 'auto')
    );
    if (!fromSpread && !toSpread && hasExplicitSides) return { start, end };

    const alignmentDelta = horizontallyFacing
      ? Math.abs(start[1] - end[1])
      : Math.abs(start[0] - end[0]);
    if (alignmentDelta >= AUTOMATIC_PORT_ALIGNMENT_DELTA) return { start, end };

    // Keep the shared endpoint's distinct spread slot and move only the
    // relationship's unshared endpoint onto that axis. With no spread endpoint,
    // retain the existing least-movement choice between the two facing sides.
    // If both endpoints are shared, preserve the outside bridge so no competing
    // port is silently collapsed.
    const alignEndToStart = horizontallyFacing
      ? { start, end: [end[0], start[1]] }
      : { start, end: [start[0], end[1]] };
    const alignStartToEnd = horizontallyFacing
      ? { start: [start[0], end[1]], end }
      : { start: [end[0], start[1]], end };
    const candidates = fromSpread
      ? [alignEndToStart]
      : toSpread
        ? [alignStartToEnd]
        : [alignEndToStart, alignStartToEnd];
    for (const candidate of candidates) {
      const points = [candidate.start, candidate.end];
      if (portHasCornerClearance(from, fromSide, candidate.start)
          && portHasCornerClearance(to, toSide, candidate.end)
          && routeHonorsEndpointSides(points, fromSide, toSide)
          && routeClearsEndpointComponents(points, from, to)
          && clearsScene(conn, points)) {
        return candidate;
      }
    }
    return { start, end };
  }

  function routeVia(conn, from, to, start, end, fromSide, toSide, resolvedRoutes = []) {
    if (conn.via) return conn.via;
    switch (conn.route || 'auto') {
      case 'straight':
        return [];
      case 'orthogonal-h': {
        const midX = (start[0] + end[0]) / 2;
        return [[midX, start[1]], [midX, end[1]]];
      }
      case 'orthogonal-v': {
        const midY = (start[1] + end[1]) / 2;
        return [[start[0], midY], [end[0], midY]];
      }
      case 'auto':
      default: {
        // A type may own the corridor for relationships that would otherwise
        // share one channel. Preferred candidates are tried before the shared
        // families, so a declared trunk or lane wins over the generic midpoint;
        // a candidate that violates the endpoint contract or an obstacle is
        // skipped and the historical order below still applies.
        if (preferredCandidates) {
          for (const candidate of preferredCandidates({ conn, from, to, start, end, fromSide, toSide }) || []) {
            const points = [start, ...candidate, end];
            if (routeHonorsEndpointSides(points, fromSide, toSide)
                && routeClearsEndpointComponents(points, from, to)
                && clearsScene(conn, points)
                && routeMeetsCompositionFloors(points)
                && !routeConflictsWithResolved(conn, points, resolvedRoutes)) return candidate;
          }
        }

        // Direct line unless the anchors are clearly orthogonal-friendly.
        const deltaX = Math.abs(start[0] - end[0]);
        const deltaY = Math.abs(start[1] - end[1]);
        if (deltaX < 4 || deltaY < 4) {
          const direct = [start, end];
          if (routeHonorsEndpointSides(direct, fromSide, toSide)
              && routeClearsEndpointComponents(direct, from, to)
              && clearsScene(conn, direct)
              && routeMeetsCompositionFloors(direct)
              && !routeConflictsWithResolved(conn, direct, resolvedRoutes)) return [];
        }

        const rhythmBridge = automaticPortRhythmBridge(start, end, fromSide, toSide, {
          accept: (points) => (
            routeClearsEndpointComponents(points, from, to)
            && clearsScene(conn, points)
            && routeMeetsCompositionFloors(points)
            && !routeConflictsWithResolved(conn, points, resolvedRoutes)
          ),
        });
        if (rhythmBridge) return rhythmBridge.slice(1, -1);

        // Automatic port spreading can leave otherwise aligned endpoints only a
        // few pixels apart. A midpoint route would split that tiny difference
        // into two unreadable endpoint stubs, so take a bounded outside channel
        // when both anchors sit on parallel component sides.
        const minimumStub = 8;
        const fromVerticalSide = start[1] === from.y || start[1] === from.y + from.height;
        const toVerticalSide = end[1] === to.y || end[1] === to.y + to.height;
        if (fromVerticalSide && toVerticalSide && deltaX < minimumStub * 2) {
          const outsideChannels = [
            Math.max(start[0], end[0]) + minimumStub * 2,
            Math.min(start[0], end[0]) - minimumStub * 2,
          ];
          for (const channelX of outsideChannels) {
            const candidate = [[channelX, start[1]], [channelX, end[1]]];
            const points = [start, ...candidate, end];
            if (routeHonorsEndpointSides(points, fromSide, toSide)
                && clearsScene(conn, points)
                && routeMeetsCompositionFloors(points)
                && !routeConflictsWithResolved(conn, points, resolvedRoutes)) return candidate;
          }
        }

        const fromHorizontalSide = start[0] === from.x || start[0] === from.x + from.width;
        const toHorizontalSide = end[0] === to.x || end[0] === to.x + to.width;
        if (fromHorizontalSide && toHorizontalSide && deltaY < minimumStub * 2) {
          const outsideChannels = [
            Math.max(start[1], end[1]) + minimumStub * 2,
            Math.min(start[1], end[1]) - minimumStub * 2,
          ];
          for (const channelY of outsideChannels) {
            const candidate = [[start[0], channelY], [end[0], channelY]];
            const points = [start, ...candidate, end];
            if (routeHonorsEndpointSides(points, fromSide, toSide)
                && clearsScene(conn, points)
                && routeMeetsCompositionFloors(points)
                && !routeConflictsWithResolved(conn, points, resolvedRoutes)) return candidate;
          }
        }

        const midX = (start[0] + end[0]) / 2;
        const horizontalFirst = [[midX, start[1]], [midX, end[1]]];
        const midY = (start[1] + end[1]) / 2;
        const verticalFirst = [[start[0], midY], [end[0], midY]];
        const candidates = [horizontalFirst, verticalFirst];
        const sideSafe = candidates.filter((candidate) => (
          routeHonorsEndpointSides([start, ...candidate, end], fromSide, toSide)
        ));
        const sideAware = sideAwareBridgeCandidates(start, end, fromSide, toSide);
        const nearParallelPorts = (
          ((fromSide === 'top' || fromSide === 'bottom')
            && (toSide === 'top' || toSide === 'bottom')
            && deltaX < minimumStub * 2)
          || ((fromSide === 'left' || fromSide === 'right')
            && (toSide === 'left' || toSide === 'right')
            && deltaY < minimumStub * 2)
        );
        const ordered = [
          ...(nearParallelPorts ? sideAware : sideSafe),
          ...(nearParallelPorts ? sideSafe : sideAware),
        ];
        for (const candidate of ordered) {
          const points = [start, ...candidate, end];
          if (routeClearsEndpointComponents(points, from, to)
              && clearsScene(conn, points)
              && routeMeetsCompositionFloors(points)
              && !routeConflictsWithResolved(conn, points, resolvedRoutes)) return candidate;
        }

        // Two-bend doglegs are deliberately cheap, but a real architecture can
        // place adjacent components on both of those corridors. Search a
        // bounded obstacle grid before falling back to a route that the Clean
        // Flow gate already knows violates the inferred endpoint directions.
        // This keeps ordinary multi-bend avoidance renderer-owned instead of
        // forcing the author to hand-place via points.
        if (planningMetrics.gridSearchCount >= planningMetrics.maximumGridSearchCount) {
          planningMetrics.gridBudgetExhaustedCount += 1;
          planningMetrics.conflictFallbackCount += 1;
          return sideSafe[0] || sideAware[0] || horizontalFirst;
        }
        // First-draft architecture graphs are not always planar at their
        // authored node positions. The renderer gives automatic crossings a
        // visible halo, so the grid owns opaque-node avoidance and rejects
        // ambiguous shared corridors without forcing the model to hand-route
        // a sprawling perimeter detour. Cheap candidates above still prefer a
        // genuinely crossing-free path whenever one is available.
        const avoidedSegments = [];
        const gridMetrics = {};
        planningMetrics.gridSearchCount += 1;
        planningMetrics.avoidedSegmentCount += avoidedSegments.length;
        const searched = shortestOrthogonalGridRoute({
          start,
          end,
          points: [start, end],
          obstacles: [...components.values(), ...reservedLabelObstacles(2)],
          fromSide,
          toSide,
          clearance: 2,
          maximumObstacleCount: 80,
          endpointStubPx: 24,
          maximumGridNodes: 4096,
          avoidedSegments,
          minimumAvoidedOverlapPx: 8,
          routeSeparationPx: 8,
          minimumSegmentPx: interiorSegmentPx,
          borderSegments: frameBorders,
          bendPenaltyPx: 48,
          metrics: gridMetrics,
        });
        planningMetrics.gridCandidateNodeCount += gridMetrics.candidateNodeCount || 0;
        planningMetrics.gridUsableNodeCount += gridMetrics.usableNodeCount || 0;
        planningMetrics.gridEdgeCount += gridMetrics.graphEdgeCount || 0;
        planningMetrics.gridVisitedNodeCount += gridMetrics.visitedNodeCount || 0;
        const clearsEndpoints = searched
          ? routeClearsEndpointComponents(searched.points, from, to) : false;
        const clearsComponents = searched
          ? clearsScene(conn, searched.points) : false;
        const clearsRelationships = searched
          ? !routeConflictsWithResolved(conn, searched.points, resolvedRoutes) : false;
        const clearsSharedCorridors = searched
          ? !routeOverlapsResolved(conn, searched.points, resolvedRoutes) : false;
        const meetsFloors = searched ? routeMeetsCompositionFloors(searched.points) : false;
        const accepted = Boolean(
          searched && clearsEndpoints && clearsComponents && clearsSharedCorridors && meetsFloors,
        );
        planningMetrics.gridAttempts.push({
          relationship: conn.id || `${conn.from}->${conn.to}`,
          fromSide,
          toSide,
          inputAvoidedSegmentCount: avoidedSegments.length,
          ...gridMetrics,
          accepted,
          ...(!accepted && searched ? {
            rejectedBy: [
              ...(!clearsEndpoints ? ['endpoint-components'] : []),
              ...(!clearsComponents ? ['components'] : []),
              ...(!clearsSharedCorridors ? ['shared-corridor'] : []),
              ...(!meetsFloors ? ['composition-floors'] : []),
            ],
            candidatePoints: searched.points,
          } : {}),
        });
        if (accepted) {
          planningMetrics.gridRoutedCount += 1;
          if (!clearsRelationships) planningMetrics.crossoverRoutedCount += 1;
          return searched.points.slice(1, -1);
        }

        // Both bounded doglegs are blocked. Keep the best endpoint-safe route
        // when one exists so the universal Clean Flow gate reports the actual
        // obstacle; otherwise preserve the historical deterministic fallback
        // and let the endpoint-direction gate explain the side mismatch.
        planningMetrics.conflictFallbackCount += 1;
        return sideSafe[0] || sideAware[0] || horizontalFirst;
      }
    }
  }

  const pathCache = new Map();
  const selectedSides = new Map();
  const automaticPorts = automaticPortSpread(connections, components, {
    ...(sideFor ? { sideFor } : {}),
    ...(portSpacing !== null ? { maxSpacing: portSpacing } : {}),
  });
  function inferredConnectionSides(conn) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    return {
      fromSide: chosenSide(conn.fromSide, sideFor?.(conn, 'source') || defaultFromSide(from, to)),
      toSide: chosenSide(conn.toSide, sideFor?.(conn, 'target') || defaultToSide(from, to)),
    };
  }

  function connectionSides(conn) {
    if (!routesPlanned && !routesPlanning) planRoutes();
    return selectedSides.get(conn) || inferredConnectionSides(conn);
  }

  // The same side inference without the planning pass. A type that must group
  // relationships before any route exists (the erd renderer assigns a shared
  // trunk per fan-in) reads its sides here: calling connectionSides from that
  // pass would plan routes, and planning asks the grouping what the trunks are.
  function inferredSides(conn) {
    return inferredConnectionSides(conn);
  }

  function connectionEndpointSide(conn, endpoint) {
    const field = endpoint === 'source' ? 'fromSide' : 'toSide';
    if (conn[field] && conn[field] !== 'auto') return conn[field];
    return connectionSides(conn)[field];
  }

  function hasAuthoredRouteGeometry(conn) {
    return Boolean(
      conn?.via
      || (conn?.route && conn.route !== 'auto')
      || conn?.channelX !== undefined
      || conn?.channelY !== undefined
    );
  }

  function connectionGeometry(conn, sides = inferredConnectionSides(conn)) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    const inferred = inferredConnectionSides(conn);
    const usesInferredSides = sides.fromSide === inferred.fromSide
      && sides.toSide === inferred.toSide;
    const ports = usesInferredSides ? automaticPorts.get(conn) : null;
    const { fromSide, toSide } = sides;
    const baseStart = ports?.from || anchor(from, fromSide);
    const baseEnd = ports?.to || anchor(to, toSide);
    const { start, end } = alignFacingPorts(
      conn,
      from,
      to,
      baseStart,
      baseEnd,
      fromSide,
      toSide,
      ports,
    );
    return { from, to, start, end, fromSide, toSide };
  }

  function routedForGeometry(conn, resolvedRoutes, geometry) {
    const { from, to, start, end, fromSide, toSide } = geometry;
    const authoredPoints = [
      start,
      ...routeVia(conn, from, to, start, end, fromSide, toSide, resolvedRoutes),
      end,
    ];
    // Explicit waypoints are author-owned geometry. Keep even a collinear
    // waypoint: it can intentionally split a route at a semantic touch point,
    // and preserving it is part of the backwards-compatible authoring contract.
    // Automatic routes remain normalized so the renderer does not emit noisy
    // duplicate turns or zero-length segments.
    const points = hasAuthoredRouteGeometry(conn)
      ? authoredPoints
      : normalizeRoutePoints(authoredPoints);
    return { d: roundedPath(points, 8), points };
  }

  function cachePath(conn, routed, sides) {
    pathCache.set(conn, routed);
    selectedSides.set(conn, { fromSide: sides.fromSide, toSide: sides.toSide });
    return routed;
  }

  const SIDE_ORDER = ['right', 'bottom', 'left', 'top'];
  function candidateSidePairs(conn) {
    const inferred = inferredConnectionSides(conn);
    const authoredFrom = conn.fromSide && conn.fromSide !== 'auto' ? conn.fromSide : null;
    const authoredTo = conn.toSide && conn.toSide !== 'auto' ? conn.toSide : null;
    const fromOptions = authoredFrom
      ? [authoredFrom]
      : [inferred.fromSide, ...SIDE_ORDER.filter((side) => side !== inferred.fromSide)];
    const toOptions = authoredTo
      ? [authoredTo]
      : [inferred.toSide, ...SIDE_ORDER.filter((side) => side !== inferred.toSide)];
    return fromOptions.flatMap((fromSide) => toOptions.map((toSide) => ({
      fromSide,
      toSide,
      deviationCount: Number(fromSide !== inferred.fromSide) + Number(toSide !== inferred.toSide),
    }))).sort((left, right) => {
      if (left.deviationCount !== right.deviationCount) {
        return left.deviationCount - right.deviationCount;
      }
      const leftGeometry = connectionGeometry(conn, left);
      const rightGeometry = connectionGeometry(conn, right);
      const leftDistance = Math.abs(leftGeometry.end[0] - leftGeometry.start[0])
        + Math.abs(leftGeometry.end[1] - leftGeometry.start[1]);
      const rightDistance = Math.abs(rightGeometry.end[0] - rightGeometry.start[0])
        + Math.abs(rightGeometry.end[1] - rightGeometry.start[1]);
      return leftDistance - rightDistance;
    });
  }

  function routeIsClear(conn, routed, geometry, resolvedRoutes) {
    return routed.points.length >= 2
      && routeHonorsEndpointSides(routed.points, geometry.fromSide, geometry.toSide)
      && routeClearsEndpointComponents(routed.points, geometry.from, geometry.to)
      && clearsScene(conn, routed.points)
      && routeMeetsCompositionFloors(routed.points)
      && !routeOverlapsResolved(conn, routed.points, resolvedRoutes);
  }

  function computePath(conn, resolvedRoutes) {
    if (hasAuthoredRouteGeometry(conn)) {
      const sides = inferredConnectionSides(conn);
      return cachePath(conn, routedForGeometry(
        conn,
        resolvedRoutes,
        connectionGeometry(conn, sides),
      ), sides);
    }

    let firstFallback = null;
    const clearRoute = () => {
      for (const sides of candidateSidePairs(conn)) {
        const geometry = connectionGeometry(conn, sides);
        const routed = routedForGeometry(conn, resolvedRoutes, geometry);
        if (!firstFallback) firstFallback = { routed, sides };
        if (routeIsClear(conn, routed, geometry, resolvedRoutes)) return { routed, sides };
      }
      return null;
    };
    const routeLength = ({ routed }) => routed.points.slice(1)
      .reduce((total, point, index) => total + Math.abs(point[0] - routed.points[index][0]) + Math.abs(point[1] - routed.points[index][1]), 0);

    // Reserved labels are a preference, not an obstacle. A route that has no
    // corridor around them, or that would have to detour far around them,
    // takes the plain route instead and the label placement pass moves the
    // label; only a modest extra length is worth keeping a label in place.
    honourReservedLabels = true;
    let chosen = clearRoute();
    if (reservedLabels.length) {
      honourReservedLabels = false;
      if (!chosen) chosen = clearRoute();
      else {
        const direct = Math.abs(chosen.routed.points.at(-1)[0] - chosen.routed.points[0][0])
          + Math.abs(chosen.routed.points.at(-1)[1] - chosen.routed.points[0][1]);
        if (routeLength(chosen) > direct * 1.25 + 64) {
          const plain = clearRoute();
          if (plain && routeLength(plain) * 1.25 + 64 < routeLength(chosen)) chosen = plain;
        }
      }
      honourReservedLabels = true;
    }
    if (chosen) return cachePath(conn, chosen.routed, chosen.sides);
    return cachePath(conn, firstFallback.routed, firstFallback.sides);
  }

  let routesPlanned = false;
  let routesPlanning = false;
  function planRoutes() {
    if (routesPlanned || routesPlanning) return;
    routesPlanning = true;
    const indexed = connections
      .map((conn, index) => ({ conn, index }))
      .filter(({ conn }) => components.has(conn.from) && components.has(conn.to));
    const explicit = indexed.filter(({ conn }) => hasAuthoredRouteGeometry(conn));
    const automatic = indexed.filter(({ conn }) => !hasAuthoredRouteGeometry(conn))
      .sort((left, right) => {
        const leftFrom = components.get(left.conn.from);
        const leftTo = components.get(left.conn.to);
        const rightFrom = components.get(right.conn.from);
        const rightTo = components.get(right.conn.to);
        const leftDistance = Math.abs(leftTo.cx - leftFrom.cx) + Math.abs(leftTo.cy - leftFrom.cy);
        const rightDistance = Math.abs(rightTo.cx - rightFrom.cx) + Math.abs(rightTo.cy - rightFrom.cy);
        return leftDistance - rightDistance || left.index - right.index;
      });
    const resolvedRoutes = [];
    reservedLabels = [];
    for (const { conn } of [...explicit, ...automatic]) {
      const routed = computePath(conn, resolvedRoutes);
      resolvedRoutes.push({ conn, points: routed.points });
      const rect = labelRectFor?.(conn, routed.points, {
        routes: resolvedRoutes.map((entry) => entry.points),
        labels: reservedLabels.map((entry) => entry.rect),
      });
      if (rect) reservedLabels.push({ conn, rect });
    }
    planningMetrics.routeCount = resolvedRoutes.length;
    planningMetrics.explicitRouteCount = explicit.length;
    planningMetrics.automaticRouteCount = automatic.length;
    routesPlanning = false;
    routesPlanned = true;
  }

  function pathFor(conn) {
    planRoutes();
    if (pathCache.has(conn)) return pathCache.get(conn);
    return computePath(conn, []);
  }

  function routingMetrics() {
    planRoutes();
    return { ...planningMetrics };
  }

  return { ports: automaticPorts, pathFor, connectionSides, inferredSides, connectionEndpointSide, routingMetrics };
}
