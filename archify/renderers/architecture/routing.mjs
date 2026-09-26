// Internal architecture router shared by rendering and geometry inspection.
// Create a new router when measured boxes or connections change: port spreading
// is computed once and route results are cached for this scene.

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
  rectsOverlap,
  roundedPath,
  collectBorderRuns,
  collectRouteRhythmIssues,
  frameBorderSegments,
} from '../shared/geometry.mjs';
import { shortestOrthogonalGridRoute } from '../shared/route-quality.mjs';

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
export function createRouter(components, connections = [], {
  frames = [],
  interiorSegmentPx = 16,
  microSegmentPx = 8,
  labelRectFor = null,
  distinctAutomaticPorts = false,
  preferReadableRoutes = false,
} = {}) {
  const frameBorders = frames.flatMap((frame) => frameBorderSegments(frame));
  const LABEL_CLEARANCE = 4;
  // Labels of already-routed relationships, reserved while planning the rest.
  let reservedLabels = [];
  let honourReservedLabels = true;
  let allowGridSearch = true;

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
    if (collectRouteRhythmIssues({ routedRelations: [{ points }], interiorSegmentPx, microSegmentPx }).length) {
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
    readabilityCandidateCount: 0,
    readabilityImprovedCount: 0,
    reciprocalCandidateCount: 0,
    reciprocalImprovedCount: 0,
    gridAttempts: [],
  };

  // ---- Connection routing ------------------------------------------------------
  function routeClearsComponents(conn, points, clearance = 2) {
    const endpointIds = new Set([conn.from, conn.to]);
    for (const component of components.values()) {
      if (endpointIds.has(component.id)) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, component, clearance)) {
          return false;
        }
      }
    }
    return routeClearsReservedLabels(conn, points);
  }

  function routeClearsEndpointComponents(points, from, to) {
    const lastSegment = points.length - 2;
    for (let index = 0; index <= lastSegment; index += 1) {
      const segment = { start: points[index], end: points[index + 1] };
      if (index > 0 && segmentIntersectsRect(segment, from)) return false;
      if (index < lastSegment && segmentIntersectsRect(segment, to)) return false;
    }
    return true;
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
    // A common destination does not make two independently labelled routes a
    // bus. Keep their corridors distinct too; explicit routes bypass planning.
    for (const entry of resolvedRoutes) {
      if (relationshipsShareEndpoint(conn, entry.conn)
          && (!distinctAutomaticPorts || hasAuthoredRouteGeometry(entry.conn) || entry.conn.labelAt || conn.labelAt)) continue;
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
          && routeClearsComponents(conn, points)) {
        return candidate;
      }
    }
    return { start, end };
  }

  // A reciprocal pair is repaired jointly after planning, so crossings that
  // involve it are not final yet; keep the established first choice there.
  const reciprocal = (conn) => connections.some((other) => other.from === conn.to && other.to === conn.from);
  function siblingCrossings(conn, points, resolvedRoutes) {
    if (reciprocal(conn)) return 0;
    return crossingCount(conn, points, resolvedRoutes.filter((entry) => !reciprocal(entry.conn)));
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
        // Direct line unless the anchors are clearly orthogonal-friendly.
        const deltaX = Math.abs(start[0] - end[0]);
        const deltaY = Math.abs(start[1] - end[1]);
        if (deltaX < 4 || deltaY < 4) {
          const direct = [start, end];
          if (routeHonorsEndpointSides(direct, fromSide, toSide)
              && routeClearsEndpointComponents(direct, from, to)
              && routeClearsComponents(conn, direct)
              && routeMeetsCompositionFloors(direct)
              && !routeConflictsWithResolved(conn, direct, resolvedRoutes)) return [];
        }

        const rhythmBridge = automaticPortRhythmBridge(start, end, fromSide, toSide, {
          accept: (points) => (
            routeClearsEndpointComponents(points, from, to)
            && routeClearsComponents(conn, points)
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
                && routeClearsComponents(conn, points)
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
                && routeClearsComponents(conn, points)
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
              && routeClearsComponents(conn, points)
              && routeMeetsCompositionFloors(points)
              && !routeConflictsWithResolved(conn, points, resolvedRoutes)
              && (!distinctAutomaticPorts || (!routeOverlapsResolved(conn, points, resolvedRoutes)
                && !siblingCrossings(conn, points, resolvedRoutes)))) return candidate;
        }
        // Siblings fanning out from one side all want the same midpoint
        // channel. Step outward through the corridor to a free parallel
        // channel before searching.
        if (distinctAutomaticPorts) {
          const channels = (from, to, mid) => {
            const [low, high] = [Math.min(from, to) + 24, Math.max(from, to) - 24];
            const values = [];
            for (let offset = 16; mid - offset >= low || mid + offset <= high; offset += 16) {
              values.push(...[mid + offset, mid - offset].filter((value) => value >= low && value <= high));
            }
            return values;
          };
          for (const candidate of [
            ...channels(start[0], end[0], midX).map((x) => [[x, start[1]], [x, end[1]]]),
            ...channels(start[1], end[1], midY).map((y) => [[start[0], y], [end[0], y]]),
          ]) {
            const points = [start, ...candidate, end];
            if (routeHonorsEndpointSides(points, fromSide, toSide)
                && routeClearsEndpointComponents(points, from, to)
                && routeClearsComponents(conn, points)
                && routeMeetsCompositionFloors(points)
                && !routeConflictsWithResolved(conn, points, resolvedRoutes)
                && !routeOverlapsResolved(conn, points, resolvedRoutes)
                && !siblingCrossings(conn, points, resolvedRoutes)) return candidate;
          }
        }

        // Two-bend doglegs are deliberately cheap, but a real architecture can
        // place adjacent components on both of those corridors. Search a
        // bounded obstacle grid before falling back to a route that the Clean
        // Flow gate already knows violates the inferred endpoint directions.
        // This keeps ordinary multi-bend avoidance renderer-owned instead of
        // forcing the author to hand-place via points.
        // Alternative endpoint pairs are cheap probes, not another grid-search
        // budget. A legal short bridge often beats the first grid detour.
        if (!allowGridSearch) return sideSafe[0] || sideAware[0] || horizontalFirst;
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
        const avoidedSegments = resolvedRoutes
          .filter((entry) => distinctAutomaticPorts && relationshipsShareEndpoint(conn, entry.conn)
            && !hasAuthoredRouteGeometry(entry.conn) && !entry.conn.labelAt && !conn.labelAt)
          .flatMap((entry) => entry.points.slice(1).map((end, index) => ({
            start: entry.points[index], end,
          })));
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
          allowAvoidedCrossings: true,
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
          ? routeClearsComponents(conn, searched.points) : false;
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

  // A node's neighbours laid out as one row below (or above) it read as a
  // fan-out: reach them all through the same vertical side. Center-based
  // inference alone sends the outer ones sideways around their siblings.
  const neighbourRects = new Map();
  for (const conn of connections) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    if (!from || !to || from === to) continue;
    for (const [node, other] of [[from, to], [to, from]]) {
      neighbourRects.set(node.id, [...(neighbourRects.get(node.id) || []), other]);
    }
  }
  function rowFanOutSides(from, to) {
    if (!preferReadableRoutes) return null;
    const verticalSides = (node, other) => {
      const below = other.y >= node.y + node.height;
      if (!below && other.y + other.height > node.y) return null;
      if (['top', 'bottom'].includes(defaultFromSide(node, other))) return null;
      const rowSibling = (neighbourRects.get(node.id) || []).some((sibling) => sibling !== other
        && Math.abs(sibling.cy - other.cy) < 1
        && defaultFromSide(node, sibling) === (below ? 'bottom' : 'top'));
      // Only when a node of that row blocks a sideways route to one of the
      // neighbours on this side; otherwise side exits stay clear and keep the
      // vertical side free. Decide per side so a row never mixes both styles.
      const blocked = (target) => {
        const [gapStart, gapEnd] = target.cx < node.cx
          ? [target.x + target.width, node.x] : [node.x + node.width, target.x];
        return [...components.values()].some((rect) => rect !== node && rect !== target
          && rect.y < target.y + target.height && rect.y + rect.height > target.y
          && rect.x < gapEnd && rect.x + rect.width > gapStart);
      };
      const sameSide = (neighbourRects.get(node.id) || []).filter((sibling) => Math.abs(sibling.cy - other.cy) < 1
        && defaultFromSide(node, sibling) === defaultFromSide(node, other));
      return rowSibling && sameSide.some(blocked) ? (below ? 'bottom' : 'top') : null;
    };
    const opposite = { top: 'bottom', bottom: 'top' };
    const fromSide = verticalSides(from, to);
    if (fromSide) return { fromSide, toSide: opposite[fromSide] };
    const toSide = verticalSides(to, from);
    return toSide ? { fromSide: opposite[toSide], toSide } : null;
  }

  const pathCache = new Map();
  const selectedSides = new Map();
  const stroke = (relation) => relation.width || (relation.variant === 'emphasis' ? 1.8 : 1.5);
  const markerSpacing = (left, right) => 3.5 * (stroke(left) + stroke(right));
  const portSpacing = (left, right) => Math.max(14, markerSpacing(left, right) + 3.5);
  const automaticPorts = automaticPortSpread(connections, components, {
    sideFor: (relation, endpoint) => rowFanOutSides(components.get(relation.from), components.get(relation.to))
      ?.[endpoint === 'source' ? 'fromSide' : 'toSide'],
    // Preserve the established initial placement for ordinary markers; only
    // widen groups whose arrowheads cannot fit the legacy 14px slots.
    ...(distinctAutomaticPorts ? { spacingFor: (left, right) =>
      markerSpacing(left, right) > 14 ? portSpacing(left, right) : 14 } : {}),
  });
  const incidentEndpoints = new Map();
  for (const conn of connections) {
    if (!components.has(conn.from) || !components.has(conn.to)) continue;
    for (const [field, sideField] of [['from', 'fromSide'], ['to', 'toSide']]) {
      const entries = incidentEndpoints.get(conn[field]) || [];
      entries.push({ conn, field, sideField });
      incidentEndpoints.set(conn[field], entries);
    }
  }
  function inferredConnectionSides(conn) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    const fanOut = rowFanOutSides(from, to);
    return {
      fromSide: chosenSide(conn.fromSide, fanOut?.fromSide || defaultFromSide(from, to)),
      toSide: chosenSide(conn.toSide, fanOut?.toSide || defaultToSide(from, to)),
    };
  }

  function connectionSides(conn) {
    if (!routesPlanned && !routesPlanning) planRoutes();
    return selectedSides.get(conn) || inferredConnectionSides(conn);
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

  function hasAuthoredLabelPlacement(conn) {
    return ['labelAt', 'labelDx', 'labelDy', 'labelSegment']
      .some((field) => conn?.[field] !== undefined);
  }

  // A route can change sides after the initial port spread. Reserve slots on
  // the final side as well: falling back to its midpoint can put an arrow
  // between two existing slots, or directly on another incoming arrow.
  function automaticEndpoint(conn, endpoint, rect, side, inferredSide) {
    const initial = side === inferredSide ? automaticPorts.get(conn)?.[endpoint] : null;
    const preferred = initial || anchor(rect, side);
    if (hasAuthoredRouteGeometry(conn) || conn.labelAt) return { point: preferred, spread: Boolean(initial) };
    const axis = side === 'left' || side === 'right' ? 1 : 0;
    const occupied = [];
    for (const { conn: other, field, sideField } of incidentEndpoints.get(rect.id) || []) {
      if (other === conn || hasAuthoredRouteGeometry(other) || other.labelAt) continue;
      const routed = pathCache.get(other);
      const sides = selectedSides.get(other) || inferredConnectionSides(other);
      if (sides[sideField] !== side) continue;
      const point = routed
        ? (field === 'from' ? routed.points[0] : routed.points.at(-1))
        : automaticPorts.get(other)?.[field] || anchor(rect, side);
      occupied.push({ value: point[axis], spacing: portSpacing(conn, other) });
    }
    if (!occupied.length) return { point: preferred, spread: Boolean(initial) };
    const candidates = [preferred[axis], ...occupied.flatMap(({ value, spacing }) => [value - spacing, value + spacing])]
      .sort((a, b) => Math.abs(a - preferred[axis]) - Math.abs(b - preferred[axis]) || a - b);
    for (const value of candidates) {
      const point = [...preferred];
      point[axis] = value;
      if (portHasCornerClearance(rect, side, point)
          && occupied.every((other) => Math.abs(value - other.value) >= other.spacing - 0.0001)) {
        return { point, spread: true };
      }
    }
    return { point: preferred, spread: true, crowded: true };
  }

  function connectionGeometry(conn, sides = inferredConnectionSides(conn)) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    const inferred = inferredConnectionSides(conn);
    const { fromSide, toSide } = sides;
    const legacyPorts = fromSide === inferred.fromSide && toSide === inferred.toSide ? automaticPorts.get(conn) : null;
    const source = distinctAutomaticPorts
      ? automaticEndpoint(conn, 'from', from, fromSide, inferred.fromSide)
      : { point: legacyPorts?.from || anchor(from, fromSide), spread: Boolean(legacyPorts?.from) };
    const target = distinctAutomaticPorts
      ? automaticEndpoint(conn, 'to', to, toSide, inferred.toSide)
      : { point: legacyPorts?.to || anchor(to, toSide), spread: Boolean(legacyPorts?.to) };
    const ports = { from: source.spread, to: target.spread };
    const { start, end } = alignFacingPorts(
      conn,
      from,
      to,
      source.point,
      target.point,
      fromSide,
      toSide,
      ports,
    );
    return { from, to, start, end, fromSide, toSide, crowded: source.crowded || target.crowded };
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
    return !geometry.crowded && routed.points.length >= 2
      && routeHonorsEndpointSides(routed.points, geometry.fromSide, geometry.toSide)
      && routeClearsEndpointComponents(routed.points, geometry.from, geometry.to)
      && routeClearsComponents(conn, routed.points)
      && routeMeetsCompositionFloors(routed.points)
      && !routeOverlapsResolved(conn, routed.points, resolvedRoutes);
  }

  function crossingCount(conn, points, resolvedRoutes) {
    return resolvedRoutes.reduce((total, entry) => total + Number(
      !(relationshipsShareEndpoint(conn, entry.conn)
        && (!distinctAutomaticPorts || hasAuthoredRouteGeometry(entry.conn) || entry.conn.labelAt || conn.labelAt))
      && points.slice(1).some((end, index) => entry.points.slice(1).some((otherEnd, otherIndex) =>
        properSegmentIntersection(points[index], end, entry.points[otherIndex], otherEnd))),
    ), 0);
  }

  function readabilityCost(conn, routed, resolvedRoutes) {
    const points = routed.points;
    const length = points.slice(1).reduce((total, point, index) => total
      + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1]), 0);
    // A crossover is a reading cost even with a halo. Keep it finite: avoiding
    // one crossing must not justify an arbitrarily long perimeter excursion.
    return length + Math.max(0, points.length - 2) * 48 + crossingCount(conn, points, resolvedRoutes) * 160;
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
      let firstClear = null;
      for (const sides of candidateSidePairs(conn)) {
        const geometry = connectionGeometry(conn, sides);
        const routed = routedForGeometry(conn, resolvedRoutes, geometry);
        if (!firstFallback) firstFallback = { routed, sides };
        if (routeIsClear(conn, routed, geometry, resolvedRoutes)) {
          firstClear = { routed, sides };
          break;
        }
      }
      return firstClear;
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
    // Improve against the complete set of routes, not only earlier edges.
    // A greedy side change during the initial pass can steal a later edge's
    // corridor. This bounded sweep only changes one route at a time, keeping
    // every other route and label as an obstacle/reference.
    if (preferReadableRoutes) {
      const scenePoints = resolvedRoutes.flatMap((entry) => entry.points);
      for (const rect of [...components.values(), ...frames, ...reservedLabels.map((entry) => entry.rect)]) {
        scenePoints.push([rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]);
      }
      const bounds = {
        left: Math.min(...scenePoints.map(([x]) => x)), right: Math.max(...scenePoints.map(([x]) => x)),
        top: Math.min(...scenePoints.map(([, y]) => y)), bottom: Math.max(...scenePoints.map(([, y]) => y)),
      };
      const withinScene = ([x, y]) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      const jointlyImproved = new Set();
      function improveReciprocalPairs() {
        // A one-route sweep cannot repair reciprocal facing edges whose initial
        // spread groups differ. Try both direct lanes together after final side
        // geometry is known, leaving every other route and authored port in place.
        const paired = new Set();
        for (const first of resolvedRoutes) {
          const conn = first.conn;
          if (paired.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
              || (conn.fromSide && conn.fromSide !== 'auto')
              || (conn.toSide && conn.toSide !== 'auto')) continue;
          const second = resolvedRoutes.find((entry) => entry !== first
            && entry.conn.from === conn.to && entry.conn.to === conn.from
            && !hasAuthoredRouteGeometry(entry.conn) && !hasAuthoredLabelPlacement(entry.conn)
            && (!entry.conn.fromSide || entry.conn.fromSide === 'auto')
            && (!entry.conn.toSide || entry.conn.toSide === 'auto'));
          if (!second) continue;
          paired.add(conn);
          paired.add(second.conn);
          const firstSides = inferredConnectionSides(conn);
          const secondSides = inferredConnectionSides(second.conn);
          const horizontal = firstSides.fromSide === 'right' && firstSides.toSide === 'left'
            && secondSides.fromSide === 'left' && secondSides.toSide === 'right';
          const horizontalReverse = firstSides.fromSide === 'left' && firstSides.toSide === 'right'
            && secondSides.fromSide === 'right' && secondSides.toSide === 'left';
          const vertical = firstSides.fromSide === 'bottom' && firstSides.toSide === 'top'
            && secondSides.fromSide === 'top' && secondSides.toSide === 'bottom';
          const verticalReverse = firstSides.fromSide === 'top' && firstSides.toSide === 'bottom'
            && secondSides.fromSide === 'bottom' && secondSides.toSide === 'top';
          if (!horizontal && !horizontalReverse && !vertical && !verticalReverse) continue;
          if (first.points.length <= 2 && second.points.length <= 2) continue;
          const axis = horizontal || horizontalReverse ? 1 : 0;
          const others = resolvedRoutes.filter((entry) => entry !== first && entry !== second);
          const firstGeometry = connectionGeometry(conn, firstSides);
          const secondGeometry = connectionGeometry(second.conn, secondSides);
          if (firstGeometry.crowded || secondGeometry.crowded) continue;
          const previousLabels = reservedLabels;
          let improved = false;
          reservedLabels = reservedLabels.filter((entry) => entry.conn !== conn && entry.conn !== second.conn);
          try {
            const lanes = (geometry) => [...new Set([geometry.start[axis], geometry.end[axis]])];
            const direct = (geometry, lane) => {
              const start = [...geometry.start];
              const end = [...geometry.end];
              start[axis] = lane;
              end[axis] = lane;
              return { points: [start, end], d: roundedPath([start, end], 8) };
            };
            const endpointSlotsClear = (candidateRoutes) => {
              const entries = [...others, ...candidateRoutes];
              for (const candidate of candidateRoutes) {
                const sides = candidate.conn === conn ? firstSides : secondSides;
                for (const [componentId, side, point] of [
                  [candidate.conn.from, sides.fromSide, candidate.points[0]],
                  [candidate.conn.to, sides.toSide, candidate.points.at(-1)],
                ]) {
                  const coordinate = side === 'left' || side === 'right' ? 1 : 0;
                  for (const other of entries) {
                    if (other.conn === candidate.conn) continue;
                    const otherSides = other.conn === conn ? firstSides
                      : other.conn === second.conn ? secondSides : selectedSides.get(other.conn);
                    for (const [otherId, otherSide, otherPoint] of [
                      [other.conn.from, otherSides.fromSide, other.points[0]],
                      [other.conn.to, otherSides.toSide, other.points.at(-1)],
                    ]) {
                      if (componentId === otherId && side === otherSide
                          && Math.abs(point[coordinate] - otherPoint[coordinate])
                            < portSpacing(candidate.conn, other.conn) - 0.0001) return false;
                    }
                  }
                }
              }
              return true;
            };
            const labelClears = (rect, owner, entries, labels) => {
              if (!rect) return !owner.label;
              if (!withinScene([rect.x, rect.y])
                  || !withinScene([rect.x + rect.width, rect.y + rect.height])
                  || labels.some((other) => rectsOverlap(rect, other.rect, 2))) return false;
              return entries.every((entry) => entry.conn === owner || entry.points.slice(1).every((end, index) =>
                !segmentIntersectsRect({ start: entry.points[index], end }, rect, LABEL_CLEARANCE)));
            };
            let best = null;
            let bestCost = readabilityCost(conn, first, [...others, second])
              + readabilityCost(second.conn, second, [...others, first]);
            for (const firstLane of lanes(firstGeometry)) {
              for (const secondLane of lanes(secondGeometry)) {
                planningMetrics.reciprocalCandidateCount += 1;
                const firstRoute = { conn, ...direct(firstGeometry, firstLane) };
                const secondRoute = { conn: second.conn, ...direct(secondGeometry, secondLane) };
                const candidates = [firstRoute, secondRoute];
                if (!candidates.every((entry) => entry.points.every(withinScene))) continue;
                if (!endpointSlotsClear(candidates)) continue;
                if (!candidates.every((entry, index) => {
                  const geometry = entry.conn === conn ? firstGeometry : secondGeometry;
                  if (!portHasCornerClearance(geometry.from, geometry.fromSide, entry.points[0])
                      || !portHasCornerClearance(geometry.to, geometry.toSide, entry.points.at(-1))) return false;
                  return routeIsClear(entry.conn, entry, geometry, [...others, candidates[1 - index]]);
                })) continue;
                const firstRect = labelRectFor?.(conn, firstRoute.points, {
                  routes: [...others.map((entry) => entry.points), ...candidates.map((entry) => entry.points)],
                  labels: reservedLabels.map((entry) => entry.rect),
                });
                if (!labelClears(firstRect, conn, [...others, secondRoute], reservedLabels)) continue;
                const secondRect = labelRectFor?.(second.conn, secondRoute.points, {
                  routes: [...others.map((entry) => entry.points), ...candidates.map((entry) => entry.points)],
                  labels: [...reservedLabels.map((entry) => entry.rect), ...(firstRect ? [firstRect] : [])],
                });
                if (!labelClears(secondRect, second.conn, [...others, firstRoute], [
                  ...reservedLabels, ...(firstRect ? [{ conn, rect: firstRect }] : []),
                ])) continue;
                const cost = readabilityCost(conn, firstRoute, [...others, secondRoute])
                  + readabilityCost(second.conn, secondRoute, [...others, firstRoute]);
                if (cost < bestCost) {
                  best = { firstRoute, secondRoute, firstRect, secondRect };
                  bestCost = cost;
                }
              }
            }
            if (!best) continue;
            cachePath(conn, best.firstRoute, firstSides);
            cachePath(second.conn, best.secondRoute, secondSides);
            first.points = best.firstRoute.points;
            second.points = best.secondRoute.points;
            planningMetrics.reciprocalImprovedCount += 1;
            jointlyImproved.add(conn);
            jointlyImproved.add(second.conn);
            improved = true;
            reservedLabels = [
              ...reservedLabels,
              ...(best.firstRect ? [{ conn, rect: best.firstRect }] : []),
              ...(best.secondRect ? [{ conn: second.conn, rect: best.secondRect }] : []),
            ];
          } finally {
            if (!improved) reservedLabels = previousLabels;
          }
        }
      }
      allowGridSearch = false;
      try {
        improveReciprocalPairs();
        for (const entry of resolvedRoutes) {
          const { conn } = entry;
          if (jointlyImproved.has(conn) || hasAuthoredRouteGeometry(conn) || conn.labelAt) continue;
          const others = resolvedRoutes.filter((other) => other !== entry);
          // Preserve uncomplicated routes and their established inferred sides.
          // Spend the comparison budget where the complete scene has a reading
          // cost: a crossover or more than two bends.
          if (entry.points.length <= 4 && crossingCount(conn, entry.points, others) === 0) continue;
          let best = null;
          let bestCost = readabilityCost(conn, { points: entry.points }, others);
          for (const sides of candidateSidePairs(conn)) {
            const geometry = connectionGeometry(conn, sides);
            const routed = routedForGeometry(conn, others, geometry);
            planningMetrics.readabilityCandidateCount += 1;
            if (!routed.points.every(withinScene) || !routeIsClear(conn, routed, geometry, others)) continue;
            const cost = readabilityCost(conn, routed, others);
            if (cost < bestCost) {
              const rect = labelRectFor?.(conn, routed.points, {
                routes: [...others.map((other) => other.points), routed.points],
                labels: reservedLabels.filter((label) => label.conn !== conn).map((label) => label.rect),
              });
              // A shorter route must not expand the canvas and shrink every
              // label at the default viewport. Include its reserved label too.
              if (rect && (!withinScene([rect.x, rect.y]) || !withinScene([rect.x + rect.width, rect.y + rect.height]))) continue;
              best = { routed, sides, rect };
              bestCost = cost;
            }
          }
          if (!best) continue;
          cachePath(conn, best.routed, best.sides);
          entry.points = best.routed.points;
          planningMetrics.readabilityImprovedCount += 1;
          reservedLabels = reservedLabels.filter((label) => label.conn !== conn);
          if (best.rect) reservedLabels.push({ conn, rect: best.rect });
        }
      } finally {
        allowGridSearch = true;
      }
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

  return { pathFor, connectionSides, connectionEndpointSide, routingMetrics };
}
