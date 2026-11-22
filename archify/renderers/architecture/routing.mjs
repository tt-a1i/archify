// Internal architecture router shared by rendering and geometry inspection.
// Create a new router when measured boxes or connections change: port spreading
// is computed once and route results are cached for this scene.

import {
  segmentIntersectsRect,
  segmentRectClearanceWithin,
  anchor,
  automaticPortSpread,
  alignAutomaticFacingPorts,
  portHasCornerClearance,
  automaticPortRhythmBridge,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  properSegmentIntersection,
  routeHonorsEndpointSides,
  normalizeRoutePoints,
  rectsOverlap,
  roundedPath,
  roundedPathSegments,
  collectBorderRuns,
  collectRouteRhythmIssues,
  routeBudgetMetrics,
  frameBorderSegments,
  labelPoint,
} from '../shared/geometry.mjs';
import { shortestOrthogonalGridRoute } from '../shared/route-quality.mjs';
import { textUnits } from '../shared/utils.mjs';
import { reservedLabelRect } from '../shared/automatic-labels.mjs';
import { changeEdgeLabelExtraWidth } from '../shared/change-marks.mjs';
import { prepareCrossingPath, visibleCrossings } from '../shared/route-crossings.mjs';

function labelDistance(points, rect, limit) {
  let distance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, segmentRectClearanceWithin({ start: points[index - 1], end: points[index] }, rect, Math.min(limit, distance)));
  }
  return distance;
}

function labelFollowsRoute(rect, points, others) {
  const distance = labelDistance(points, rect, 20);
  return distance <= 20 && others.every(other => labelDistance(other.points, rect, distance) > distance);
}

export function connectionLabelBoxAt(conn, [lx, ly]) {
  const width = Math.max(30, textUnits(conn.label) * 4.8 + 10) + changeEdgeLabelExtraWidth(conn);
  return { x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly };
}

export function horizontalLabelClearance(conn) {
  return conn.label ? connectionLabelBoxAt(conn, [0, 0]).width + 28 : 0;
}

export function parallelFrameRunLength(points, borders, clearance = 8) {
  let total = 0;
  for (const [index, end] of points.slice(1).entries()) {
    const start = points[index];
    const axis = start[1] === end[1] ? 0 : 1;
    const across = 1 - axis;
    if (start[across] !== end[across]) continue;
    for (const border of borders) {
      if (border.start[across] !== border.end[across]
          || Math.abs(start[across] - border.start[across]) >= clearance) continue;
      const overlap = Math.min(Math.max(start[axis], end[axis]), Math.max(border.start[axis], border.end[axis]))
        - Math.max(Math.min(start[axis], end[axis]), Math.min(border.start[axis], border.end[axis]));
      if (overlap >= 24) total += overlap;
    }
  }
  return total;
}

export const READABLE_PORT_GAP = 22;
export const MIN_PARALLEL_DEPARTURE = 48;
export const READABLE_FRAME_GAP = 12;
const AUTOMATIC_PORT_CORNER_GUTTER = 16;

function portLaneLimits(box, axis) {
  const [start, size] = axis ? [box.y, box.height] : [box.x, box.width];
  const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, size / 2);
  return [start + inset, start + size - inset];
}

function facingSides(from, to) {
  if (from.x + from.width <= to.x) return { fromSide: 'right', toSide: 'left', axis: 1 };
  if (to.x + to.width <= from.x) return { fromSide: 'left', toSide: 'right', axis: 1 };
  if (from.y + from.height <= to.y) return { fromSide: 'bottom', toSide: 'top', axis: 0 };
  if (to.y + to.height <= from.y) return { fromSide: 'top', toSide: 'bottom', axis: 0 };
  return null;
}

export function facingPortCorridor(from, to) {
  const facing = facingSides(from, to);
  if (!facing) return null;
  const { axis } = facing;
  const [fromLow, fromHigh] = portLaneLimits(from, axis);
  const [toLow, toHigh] = portLaneLimits(to, axis);
  return { ...facing, low: Math.max(fromLow, toLow), high: Math.min(fromHigh, toHigh),
    offset: (fromLow + fromHigh - toLow - toHigh) / 2 };
}

function reciprocalPair(left, right) {
  return left.from === right.to && left.to === right.from;
}

function relationshipStroke(relation) {
  return relation.width || (relation.variant === 'emphasis' ? 1.8 : 1.5);
}

export function* closeParallelRuns(points, otherPoints, gap) {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const axis = start[1] === end[1] ? 0 : 1;
    const across = 1 - axis;
    if (start[across] !== end[across]) continue;
    for (let peerIndex = 0; peerIndex + 1 < otherPoints.length; peerIndex += 1) {
      const peerStart = otherPoints[peerIndex];
      const peerEnd = otherPoints[peerIndex + 1];
      const separation = start[across] - peerStart[across];
      if (peerStart[across] !== peerEnd[across] || Math.abs(separation) >= gap - 0.0001) continue;
      const overlap = Math.min(Math.max(start[axis], end[axis]), Math.max(peerStart[axis], peerEnd[axis]))
        - Math.max(Math.min(start[axis], end[axis]), Math.min(peerStart[axis], peerEnd[axis]));
      if (overlap > 0.0001) yield { index, across, separation, overlap, gap };
    }
  }
}

function parallelGap(left, right) {
  const arrowheadWidth = 3.5 * (relationshipStroke(left) + relationshipStroke(right));
  return Math.max(reciprocalPair(left, right) ? 28 : 18, arrowheadWidth + 4);
}

export function parallelRunMeasures(routes) {
  let length = 0;
  let debt = 0;
  for (const [index, { relation, points }] of routes.entries()) {
    for (let peer = index + 1; peer < routes.length; peer += 1) {
      const other = routes[peer];
      for (const run of closeParallelRuns(points, other.points, parallelGap(relation, other.relation))) {
        length += run.overlap;
        debt += run.overlap * (1 - Math.abs(run.separation) / run.gap);
      }
    }
  }
  return { length, debt };
}

export function* closeReciprocalLanes(points, otherPoints) {
  for (const [index, end] of points.slice(1).entries()) {
    const start = points[index];
    const axis = start[1] === end[1] ? 0 : 1;
    const across = 1 - axis;
    if (start[across] !== end[across]) continue;
    for (const [peerIndex, peerEnd] of otherPoints.slice(1).entries()) {
      const peerStart = otherPoints[peerIndex];
      const separation = start[across] - peerStart[across];
      if (peerStart[across] !== peerEnd[across] || Math.abs(separation) >= READABLE_PORT_GAP) continue;
      const overlap = Math.min(Math.max(start[axis], end[axis]), Math.max(peerStart[axis], peerEnd[axis]))
        - Math.max(Math.min(start[axis], end[axis]), Math.min(peerStart[axis], peerEnd[axis]));
      if (overlap >= 32) yield { index, across, separation, overlap };
    }
  }
}

// Use the same architecture route preferences for rendering and placement checks.
export function createArchitectureRouter(components, connections, {
  frames = [], fixedCanvas = false, automaticPlacement = false, acceptSimplification,
  readablePorts = false, spreadLanes = false, frameClearance = 0, separateRuns = false,
} = {}) {
  return createRouter(components, connections, {
    distinctAutomaticPorts: true,
    countSharedEndpointCrossings: true,
    preferReadableRoutes: true,
    repairAutomaticPorts: automaticPlacement,
    readablePorts,
    spreadLanes,
    frameClearance,
    separateRuns,
    acceptSimplification,
    // Intrinsic canvases can use one outward stub without shrinking their text.
    readabilityBottomMargin: fixedCanvas ? 0 : 24,
    frames,
    labelRectFor: (conn, points, { routes, labels }) => (conn.label ? reservedLabelRect({
      label: { relation: conn, label: conn.label, ...connectionLabelBoxAt(conn, labelPoint(conn, points)) },
      points,
      routes: routes.map((route, index) => ({ relationIndex: index, points: route })),
      labels,
      components: [...components.values()],
    }) : null),
  });
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
 * @param {(conn: object, endpoint: 'source'|'target') => string|undefined} [options.sideFor]
 *   endpoint side of a relationship whose author did not pin one, for a type
 *   that reads its layout on a different axis than architecture's row fan-out;
 *   an endpoint this hook leaves undefined keeps the shared inference
 * @param {number} [options.maxPortSpacing] widest spacing the automatic port
 *   spread may use on a shared side; a type whose endpoint glyphs are taller
 *   than the default raises this so two symbols never draw over each other
 * @param {number} [options.minimumPortSpacing] reserve this much room between
 *   glyphs on the selected side, including when a route changes sides
 * @param {(context: {conn: object, from: object, to: object, start: number[], end: number[], fromSide: string, toSide: string}) => number[][][]} [options.preferredCandidates]
 *   candidate families tried before the shared ones, so a type-owned corridor
 *   (a bundled trunk, a dedicated lane) wins over the generic midpoint
 * @param {boolean} [options.crossingFreeGridFirst = false] before the obstacle
 *   grid search that may cross earlier routes, try one that treats every
 *   unrelated resolved route as a wall. A type whose showcase gate rejects any
 *   proper crossing (erd) opts in so a later relationship takes a clear detour
 *   instead of the shorter crossing the gate would refuse.
 * @param {number} [options.componentGapPx = 0] when positive, the obstacle
 *   grid first keeps a route this far from every component it merely passes
 *   (its own endpoints stay at the 2-unit clearance) and falls back to the
 *   tight search only when no spaced route is accepted, so a detour does not
 *   run along a neighbouring box edge 3 units away from its border.
 * @param {number} [options.minimumTerminalSegmentPx = 0] shortest first and
 *   last segment any automatic route may have, applied even with
 *   compositionFloors off: a type that rounds its corners when drawing needs
 *   the end segment to outlast the corner radius plus the micro-segment floor.
 * @param {boolean} [options.compositionFloors = true] hold every automatic
 *   route to the rhythm floors the showcase gate enforces, so the planner never
 *   accepts a route the gate will reject. A type that draws a route differently
 *   from its logical points (the erd renderer removes the bundled trunk stretch
 *   from each branch and draws the bus as one path) turns this off: the floors
 *   describe a route drawn exactly as planned, and that type answers for the
 *   drawn result at its own gate instead.
 * @param {number} [options.readabilityBottomMargin = 0] extra vertical room for
 *   the bounded readability sweep on an intrinsic-height canvas. Width and
 *   authored geometry stay fixed; fixed canvases leave this at zero.
 * @param {boolean} [options.repairAutomaticPorts = false] allow automatic
 *   architecture layouts to reuse approach segments or exchange endpoint slots
 *   without altering authored controls or using a new routing corridor.
 * @param {boolean} [options.countSharedEndpointCrossings = false] include
 *   all route pairs in architecture crossing counts and acceptance checks.
 */
export function createRouter(components, connections = [], {
  frames = [],
  interiorSegmentPx = 16,
  microSegmentPx = 8,
  labelRectFor = null,
  distinctAutomaticPorts = false,
  countSharedEndpointCrossings = false,
  preferReadableRoutes = false,
  sideFor = null,
  maxPortSpacing = null,
  minimumPortSpacing = 0,
  preferredCandidates = null,
  compositionFloors = true,
  crossingFreeGridFirst = false,
  componentGapPx = 0,
  minimumTerminalSegmentPx = 0,
  readabilityBottomMargin = 0,
  repairAutomaticPorts = false,
  readablePorts = false,
  spreadLanes = false,
  frameClearance = 0,
  separateRuns = false,
  acceptSimplification = null,
} = {}) {
  const frameBorders = frames.flatMap((frame) => frameBorderSegments(frame));
  const LABEL_CLEARANCE = 4;
  // Labels of already-routed relationships, reserved while planning the rest.
  let reservedLabels = [];
  let honourReservedLabels = true;
  let allowGridSearch = true;

  function routeClearsReservedLabels(conn, points, labels = reservedLabels) {
    if (!honourReservedLabels) return true;
    for (const entry of labels) {
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
    if (minimumTerminalSegmentPx > 0 && points.length > 2) {
      const span = (a, b) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (span(points[0], points[1]) < minimumTerminalSegmentPx
        || span(points.at(-2), points.at(-1)) < minimumTerminalSegmentPx) return false;
    }
    if (compositionFloors
        && collectRouteRhythmIssues({ routedRelations: [{ points }], interiorSegmentPx, microSegmentPx }).length) {
      return false;
    }
    const borders = !frames.length || collectBorderRuns({ routedRelations: [{ points }], frames }).length === 0;
    return borders && (!frameClearance || parallelFrameRunLength(points, frameBorders, frameClearance) === 0);
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
    residualCandidateCount: 0,
    residualLabelRejectionCount: 0,
    labelRelocationCandidateCount: 0,
    labelRelocationImprovedCount: 0,
    reciprocalCandidateCount: 0,
    reciprocalImprovedCount: 0,
    gridAttempts: [],
  };

  // ---- Connection routing ------------------------------------------------------
  const gridComponentGaps = componentGapPx > 0 ? [componentGapPx, 0] : [0];
  // The spaced search is a readability preference, so its route must also be
  // clean as drawn: full rhythm floors (even for a type that turns them off)
  // and terminal segments long enough for a rounded corner and an end marker.
  function spacedRouteIsClean(points, gap) {
    if (gap === 0) return true;
    const terminal = (a, b) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    return terminal(points[0], points[1]) >= 16 && terminal(points.at(-2), points.at(-1)) >= 16
      && collectRouteRhythmIssues({ routedRelations: [{ points }], interiorSegmentPx, microSegmentPx }).length === 0;
  }
  function gridComponentObstacles(conn, gap) {
    return [...components.values()].map((component) => (gap === 0 || component.id === conn.from || component.id === conn.to
      ? component
      : { ...component, x: component.x - gap, y: component.y - gap, width: component.width + gap * 2, height: component.height + gap * 2 }));
  }

  function routeClearsComponents(conn, points, clearance = 2, labels = reservedLabels, obstacles = components.values()) {
    const endpointIds = new Set([conn.from, conn.to]);
    for (const component of obstacles) {
      if (endpointIds.has(component.id)) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, component, clearance)) {
          return false;
        }
      }
    }
    return routeClearsReservedLabels(conn, points, labels);
  }

  function routeClearsEndpointComponents(points, from, to) {
    const lastSegment = points.length - 2;
    const sameComponent = repairAutomaticPorts && from === to;
    for (let index = 0; index <= lastSegment; index += 1) {
      const segment = { start: points[index], end: points[index + 1] };
      if (index > 0 && !(sameComponent && index === lastSegment) && segmentIntersectsRect(segment, from)) return false;
      if (index < lastSegment && !(sameComponent && index === 0) && segmentIntersectsRect(segment, to)) return false;
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
      if (countSharedEndpointCrossings && crossingPoints(points, entry, 1)) return true;
      for (let left = 0; left < points.length - 1; left += 1) {
        for (let right = 0; right < entry.points.length - 1; right += 1) {
          if (!countSharedEndpointCrossings && properSegmentIntersection(
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
      .sort((a, b) => a.length - b.length)
      .map((points) => points.slice(1, -1));
  }


  function alignFacingPorts(conn, from, to, start, end, fromSide, toSide, ports) {
    return alignAutomaticFacingPorts(conn, from, to, start, end, fromSide, toSide, ports, {
      accept: points => routeClearsEndpointComponents(points, from, to) && routeClearsComponents(conn, points),
    });
  }

  // A reciprocal pair is repaired jointly after planning, so crossings that
  // involve it are not final yet; keep the established first choice there.
  const reciprocal = (conn) => connections.some((other) => other.from === conn.to && other.to === conn.from);
  function siblingCrossings(conn, points, resolvedRoutes) {
    if (reciprocal(conn)) return 0;
    return crossingCount(conn, points, resolvedRoutes.filter((entry) => !reciprocal(entry.conn)));
  }

  function routeVia(conn, from, to, start, end, fromSide, toSide, resolvedRoutes = [], endpointStubPx = 24) {
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
        // A caller may own the corridor for relationships that would otherwise
        // share one channel. Preferred candidates are tried before the shared
        // families, so a declared trunk or lane wins over the generic midpoint;
        // a candidate that violates the endpoint contract or an obstacle is
        // skipped and the historical order below still applies.
        if (preferredCandidates) {
          for (const candidate of preferredCandidates({ conn, from, to, start, end, fromSide, toSide }) || []) {
            const points = [start, ...candidate, end];
            if (routeHonorsEndpointSides(points, fromSide, toSide)
                && routeClearsEndpointComponents(points, from, to)
                && routeClearsComponents(conn, points)
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
        let firstFeasible = null;
        for (const candidate of ordered) {
          const points = [start, ...candidate, end];
          if (!(routeClearsEndpointComponents(points, from, to)
              && routeClearsComponents(conn, points)
              && routeMeetsCompositionFloors(points)
              && !routeConflictsWithResolved(conn, points, resolvedRoutes)
              && (!distinctAutomaticPorts || (!routeOverlapsResolved(conn, points, resolvedRoutes)
                && !siblingCrossings(conn, points, resolvedRoutes))))) continue;
          if (!conn.label || !labelRectFor || labelRectFor(conn, points, {
            routes: resolvedRoutes.map((entry) => entry.points),
            labels: reservedLabels.map((entry) => entry.rect),
          })) return candidate;
          firstFeasible ||= candidate;
        }
        if (firstFeasible) return firstFeasible;
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
        if (crossingFreeGridFirst) {
          const unrelatedSegments = unrelatedResolvedRoutes(conn, resolvedRoutes)
            .flatMap((entry) => entry.points.slice(1).map((end, index) => ({ start: entry.points[index], end })));
          for (const gap of unrelatedSegments.length ? gridComponentGaps : []) {
            planningMetrics.gridSearchCount += 1;
            const strict = shortestOrthogonalGridRoute({
              start,
              end,
              points: [start, end],
              obstacles: [...gridComponentObstacles(conn, gap), ...reservedLabelObstacles(2)],
              fromSide,
              toSide,
              clearance: 2,
              maximumObstacleCount: 80,
              endpointStubPx,
              maximumGridNodes: 4096,
              avoidedSegments: unrelatedSegments,
              allowAvoidedCrossings: false,
              minimumAvoidedOverlapPx: 8,
              routeSeparationPx: 8,
              minimumSegmentPx: interiorSegmentPx,
              borderSegments: frameBorders,
              bendPenaltyPx: 48,
            });
            if (strict
                && routeClearsEndpointComponents(strict.points, from, to)
                && routeClearsComponents(conn, strict.points)
                && !routeConflictsWithResolved(conn, strict.points, resolvedRoutes)
                && !routeOverlapsResolved(conn, strict.points, resolvedRoutes)
                && routeMeetsCompositionFloors(strict.points)
                && spacedRouteIsClean(strict.points, gap)) {
              planningMetrics.gridRoutedCount += 1;
              return strict.points.slice(1, -1);
            }
          }
        }
        const avoidedSegments = resolvedRoutes
          .filter((entry) => distinctAutomaticPorts && relationshipsShareEndpoint(conn, entry.conn)
            && !hasAuthoredRouteGeometry(entry.conn) && !entry.conn.labelAt && !conn.labelAt)
          .flatMap((entry) => entry.points.slice(1).map((end, index) => ({
            start: entry.points[index], end,
          })));
        for (const gap of gridComponentGaps) {
          const gridMetrics = {};
          planningMetrics.gridSearchCount += 1;
          planningMetrics.avoidedSegmentCount += avoidedSegments.length;
          const searched = shortestOrthogonalGridRoute({
            start,
            end,
            points: [start, end],
            obstacles: [...gridComponentObstacles(conn, gap), ...reservedLabelObstacles(2)],
            fromSide,
            toSide,
            clearance: 2,
            maximumObstacleCount: 80,
            endpointStubPx,
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
          const meetsFloors = searched
            ? routeMeetsCompositionFloors(searched.points) && spacedRouteIsClean(searched.points, gap) : false;
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
  const portSpacing = (left, right) => minimumPortSpacing || Math.max(readablePorts ? READABLE_PORT_GAP : 14, markerSpacing(left, right) + 3.5);
  const reserveAutomaticPorts = distinctAutomaticPorts || minimumPortSpacing > 0;
  function fanOutSide(conn, endpoint) {
    const fanOut = rowFanOutSides(components.get(conn.from), components.get(conn.to));
    return endpoint === 'source' ? fanOut?.fromSide : fanOut?.toSide;
  }
  // A caller may own the endpoint side of a relationship; whatever it leaves
  // unresolved keeps architecture's row fan-out inference.
  function inferredSide(conn, endpoint) {
    return sideFor?.(conn, endpoint) || fanOutSide(conn, endpoint);
  }
  const automaticPorts = automaticPortSpread(connections, components, {
    sideFor: inferredSide,
    ...(maxPortSpacing === null ? {} : { maxSpacing: maxPortSpacing }),
    // Preserve the established initial placement for ordinary markers; only
    // widen groups whose arrowheads cannot fit the legacy 14px slots.
    ...(distinctAutomaticPorts ? { spacingFor: (left, right) =>
      readablePorts || markerSpacing(left, right) > 14 ? portSpacing(left, right) : 14 } : {}),
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
    return {
      fromSide: chosenSide(conn.fromSide, inferredSide(conn, 'source') || defaultFromSide(from, to)),
      toSide: chosenSide(conn.toSide, inferredSide(conn, 'target') || defaultToSide(from, to)),
    };
  }

  function connectionSides(conn) {
    if (!routesPlanned && !routesPlanning) planRoutes();
    return selectedSides.get(conn) || inferredConnectionSides(conn);
  }

  // The same side inference without the planning pass. A caller that must group
  // relationships before any route exists (the erd renderer assigns a shared
  // trunk per fan-in) reads its sides here: connectionSides() plans routes, and
  // planning asks the grouping what the trunks are.
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

  function hasAuthoredLabelPlacement(conn) {
    return ['labelAt', 'labelDx', 'labelDy', 'labelSegment']
      .some((field) => conn?.[field] !== undefined);
  }

  // A route can change sides after the initial port spread. Reserve slots on
  // the final side as well: falling back to its midpoint can put an arrow
  // between two existing slots, or directly on another incoming arrow.
  function automaticEndpoint(conn, endpoint, rect, side, inferredSide, loopSource, findAlternates = false) {
    const initial = side === inferredSide ? automaticPorts.get(conn)?.[endpoint] : null;
    const preferred = initial || anchor(rect, side);
    if (hasAuthoredRouteGeometry(conn) || conn.labelAt) return { point: preferred, spread: Boolean(initial) };
    const axis = side === 'left' || side === 'right' ? 1 : 0;
    // A loop needs room to turn and distinguish its two arrow ports.
    const occupied = loopSource ? [{ value: loopSource[axis], spacing: 24 }] : [];
    for (const { conn: other, field, sideField } of incidentEndpoints.get(rect.id) || []) {
      if (other === conn || (!minimumPortSpacing && (hasAuthoredRouteGeometry(other) || other.labelAt))) continue;
      const routed = pathCache.get(other);
      const sides = selectedSides.get(other) || inferredConnectionSides(other);
      if (sides[sideField] !== side) continue;
      const point = routed
        ? (field === 'from' ? routed.points[0] : routed.points.at(-1))
        : automaticPorts.get(other)?.[field] || anchor(rect, side);
      occupied.push({ value: point[axis], spacing: portSpacing(conn, other) });
    }
    if (!occupied.length && !findAlternates) return { point: preferred, spread: Boolean(initial) };
    // On an alternate side, equally close slots should approach the other
    // node rather than pass its neighbours just because a coordinate is lower.
    // Keep the established spread order on the inferred side unchanged.
    const counterpart = components.get(endpoint === 'from' ? conn.to : conn.from);
    const toward = side === inferredSide ? preferred[axis] : (axis === 1 ? counterpart.cy : counterpart.cx);
    const origin = axis ? rect.y : rect.x;
    const size = axis ? rect.height : rect.width;
    const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, size / 2);
    const bounds = findAlternates ? [origin + inset, origin + size - inset] : [];
    const candidates = [preferred[axis], ...occupied.flatMap(({ value, spacing }) => [value - spacing, value + spacing]), ...bounds]
      .sort((a, b) => Math.abs(a - preferred[axis]) - Math.abs(b - preferred[axis])
        || Math.abs(a - toward) - Math.abs(b - toward) || a - b);
    const alternates = [];
    for (const value of candidates) {
      const point = [...preferred];
      point[axis] = value;
      if (portHasCornerClearance(rect, side, point)
          && occupied.every((other) => Math.abs(value - other.value) >= other.spacing - 0.0001)) {
        if (!findAlternates) return { point, spread: true };
        alternates.push(point);
      }
    }
    if (findAlternates) return { point: preferred, spread: true, alternates };
    return { point: preferred, spread: true, crowded: true };
  }

  function connectionGeometry(conn, sides = inferredConnectionSides(conn)) {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    const inferred = inferredConnectionSides(conn);
    const { fromSide, toSide } = sides;
    const legacyPorts = fromSide === inferred.fromSide && toSide === inferred.toSide ? automaticPorts.get(conn) : null;
    let source = reserveAutomaticPorts
      ? automaticEndpoint(conn, 'from', from, fromSide, inferred.fromSide)
      : { point: legacyPorts?.from || anchor(from, fromSide), spread: Boolean(legacyPorts?.from) };
    const loopSource = repairAutomaticPorts && from === to && fromSide === toSide ? source.point : null;
    let target = reserveAutomaticPorts
      ? automaticEndpoint(conn, 'to', to, toSide, inferred.toSide, loopSource)
      : { point: legacyPorts?.to || anchor(to, toSide), spread: Boolean(legacyPorts?.to) };
    if (loopSource && target.crowded) {
      const { alternates } = automaticEndpoint(conn, 'from', from, fromSide, inferred.fromSide, null, true);
      for (const point of alternates) {
        const options = automaticEndpoint(conn, 'to', to, toSide, inferred.toSide, point, true);
        if (!options.alternates.length) continue;
        source = { point, spread: true };
        target = { point: options.alternates[0], spread: true };
        break;
      }
    }
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

  function routedForGeometry(conn, resolvedRoutes, geometry, endpointStubPx) {
    const { from, to, start, end, fromSide, toSide } = geometry;
    const authoredPoints = [
      start,
      ...routeVia(conn, from, to, start, end, fromSide, toSide, resolvedRoutes, endpointStubPx),
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

  function routeIsClear(conn, routed, geometry, resolvedRoutes, labels = reservedLabels, obstacles = components.values()) {
    return !geometry.crowded && routed.points.length >= 2
      && routeHonorsEndpointSides(routed.points, geometry.fromSide, geometry.toSide)
      && routeClearsEndpointComponents(routed.points, geometry.from, geometry.to)
      && routeClearsComponents(conn, routed.points, 2, labels, obstacles)
      && routeMeetsCompositionFloors(routed.points)
      && !routeOverlapsResolved(conn, routed.points, resolvedRoutes);
  }

  const crossingPaths = new WeakMap();
  function crossingPath(points) {
    if (!crossingPaths.has(points)) crossingPaths.set(points, prepareCrossingPath(roundedPathSegments(points, 8)));
    return crossingPaths.get(points);
  }

  function crossingPoints(points, other, limit = Infinity) {
    if (countSharedEndpointCrossings) {
      return visibleCrossings(crossingPath(points), crossingPath(other.points), limit).length;
    }
    let count = 0;
    for (let index = 1; index < points.length; index += 1) {
      for (let otherIndex = 1; otherIndex < other.points.length; otherIndex += 1) {
        if (properSegmentIntersection(points[index - 1], points[index], other.points[otherIndex - 1], other.points[otherIndex])
          && ++count >= limit) return count;
      }
    }
    return count;
  }

  function crossingCount(conn, points, resolvedRoutes) {
    return resolvedRoutes.reduce((count, other) => {
      if (!countSharedEndpointCrossings && relationshipsShareEndpoint(conn, other.conn)
          && (!distinctAutomaticPorts || hasAuthoredRouteGeometry(other.conn) || other.conn.labelAt || conn.labelAt)) return count;
      return count + crossingPoints(points, other, 1);
    }, 0);
  }

  function routeLength(points) {
    return points.slice(1).reduce((total, point, index) => total
      + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1]), 0);
  }

  function readabilityCost(conn, routed, resolvedRoutes) {
    const points = routed.points;
    // Keep the established cost for approaching a shared endpoint with a
    // pinned label. Pricing the X here can leave two arrows on the same
    // track. The crossing report and acceptance guards still see it.
    const costPeers = countSharedEndpointCrossings && resolvedRoutes.some(entry => entry.conn.labelAt)
      ? resolvedRoutes.filter(entry => !((conn.labelAt || entry.conn.labelAt) && relationshipsShareEndpoint(conn, entry.conn)))
      : resolvedRoutes;
    // A crossover is a reading cost even with a halo. Keep it finite: avoiding
    // one crossing must not justify an arbitrarily long perimeter excursion.
    return routeLength(points) + Math.max(0, points.length - 2) * 48 + crossingCount(conn, points, costPeers) * 160;
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
    const clearRoute = (endpointStubPx) => {
      let firstClear = null;
      for (const sides of candidateSidePairs(conn)) {
        const geometry = connectionGeometry(conn, sides);
        // This pair cannot pass the port-spacing check. Keep the original
        // fallback, but save the shared grid budget for viable ports.
        if (repairAutomaticPorts && firstFallback && geometry.crowded) continue;
        const routed = routedForGeometry(conn, resolvedRoutes, geometry, endpointStubPx);
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
    // A default grid stub can land on an occupied track and strand the
    // endpoint even when a shorter or longer departure reaches the corridor.
    // Retry only after every ordinary alternative has failed.
    if (!chosen && repairAutomaticPorts) {
      honourReservedLabels = false;
      for (const stub of [16, 32]) {
        if (planningMetrics.gridSearchCount >= planningMetrics.maximumGridSearchCount) break;
        chosen = clearRoute(stub);
        if (chosen) break;
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
      // A loop, not Math.min(...points): large scenes exceed the argument limit.
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      for (const [x, y] of scenePoints) {
        if (x < bounds.left) bounds.left = x;
        if (x > bounds.right) bounds.right = x;
        if (y < bounds.top) bounds.top = y;
        if (y > bounds.bottom) bounds.bottom = y;
      }
      const withinScene = ([x, y]) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      const jointlyImproved = new Set();
      const labelClears = (rect, owner, entries, labels, inBounds = withinScene) => {
        if (!rect) return !owner.label;
        if (!inBounds([rect.x, rect.y])
            || !inBounds([rect.x + rect.width, rect.y + rect.height])
            || labels.some((other) => rectsOverlap(rect, other.rect, 2))) return false;
        return entries.every((entry) => entry.conn === owner || entry.points.slice(1).every((end, index) =>
          !segmentIntersectsRect({ start: entry.points[index], end }, rect, LABEL_CLEARANCE)));
      };
      function improveReciprocalPairs() {
        // A one-route sweep cannot repair reciprocal facing edges whose initial
        // spread groups differ. Try both direct lanes together after final side
        // geometry is known, leaving every other route and authored port in place.
        const paired = new Set();
        for (const first of resolvedRoutes) {
          const conn = first.conn;
          if (paired.has(conn) || typeOwned.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
              || (conn.fromSide && conn.fromSide !== 'auto')
              || (conn.toSide && conn.toSide !== 'auto')) continue;
          const second = resolvedRoutes.find((entry) => entry !== first
            && entry.conn.from === conn.to && entry.conn.to === conn.from && !typeOwned.has(entry.conn)
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
            const pairSides = (candidate) => (candidate === conn ? firstSides
              : candidate === second.conn ? secondSides : selectedSides.get(candidate));
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
                if (!endpointSlotsClear(candidates, others, pairSides)) continue;
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
      // A type-owned corridor (an erd bundled trunk or dedicated lane) is the
      // route its renderer draws around; the generic sweep must not trade it
      // for a shorter lane and leave the bus without its branch.
      const followsPreferredCorridor = (entry) => {
        if (!preferredCandidates) return false;
        const sides = selectedSides.get(entry.conn);
        if (!sides) return false;
        const interior = JSON.stringify(entry.points.slice(1, -1));
        return (preferredCandidates({
          conn: entry.conn,
          from: components.get(entry.conn.from),
          to: components.get(entry.conn.to),
          start: entry.points[0],
          end: entry.points.at(-1),
          fromSide: sides.fromSide,
          toSide: sides.toSide,
        }) || []).some((candidate) => JSON.stringify(candidate) === interior);
      };
      const typeOwned = new Set(resolvedRoutes.filter(followsPreferredCorridor).map((entry) => entry.conn));
      function straightenParallelCorridors() {
        // Plan dense reciprocal lanes together. A reservation above the
        // middle lane otherwise blocks an outer lane before it is tried.
        const groups = new Map();
        for (const entry of resolvedRoutes) {
          const key = JSON.stringify([entry.conn.from, entry.conn.to].sort());
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(entry);
        }
        // The outside masks can use up to 4px of intrinsic canvas padding
        // while keeping both endpoints of every route inside the scene.
        const labelInBounds = ([x, y]) => x >= Math.max(0, bounds.left) && x <= bounds.right
          && y >= Math.max(0, bounds.top - LABEL_CLEARANCE)
          && y <= bounds.bottom + Math.min(readabilityBottomMargin, LABEL_CLEARANCE);
        for (const group of groups.values()) {
          if (group.length < 3 || group.every(({ conn }) => conn.from === group[0].conn.from)
              || group.some(({ conn }) => typeOwned.has(conn) || hasAuthoredRouteGeometry(conn)
                || hasAuthoredLabelPlacement(conn) || [conn.fromSide, conn.toSide].some(side => side && side !== 'auto'))) continue;
          const lanes = group.map(({ conn }) => {
            const sides = inferredConnectionSides(conn);
            const ports = automaticPorts.get(conn);
            return { conn, sides, points: [ports?.from, ports?.to] };
          });
          if (lanes.some(({ sides, points: [start, end] }) => !start || !end || start[1] !== end[1]
              || !((sides.fromSide === 'right' && sides.toSide === 'left')
                || (sides.fromSide === 'left' && sides.toSide === 'right')))) continue;
          lanes.sort((a, b) => a.points[0][1] - b.points[0][1]);
          // An interior mask is only needed when the usual beside-line
          // placement cannot clear both neighboring tracks.
          const maskWithClearance = 14 + 2 * LABEL_CLEARANCE;
          if (!lanes.slice(1, -1).some(({ conn, points }, index) => conn.label && Math.max(
            points[0][1] - lanes[index].points[0][1],
            lanes[index + 2].points[0][1] - points[0][1],
          ) < maskWithClearance)) continue;
          const members = new Set(group.map(({ conn }) => conn));
          const others = resolvedRoutes.filter(({ conn }) => !members.has(conn));
          const labels = reservedLabels.filter(({ conn }) => !members.has(conn));
          const byConnection = new Map(lanes.map((lane) => [lane.conn, lane]));
          const sidesOf = (conn) => byConnection.get(conn)?.sides || selectedSides.get(conn);
          if (!endpointSlotsClear(lanes, others, sidesOf)) continue;
          const routes = [...others, ...lanes];
          const accepted = lanes.every((lane, index) => {
            const { conn, points, sides } = lane;
            const [start, end] = points;
            const from = components.get(conn.from);
            const to = components.get(conn.to);
            const neighbors = routes.filter((entry) => entry !== lane);
            if (!points.every(withinScene) || !portHasCornerClearance(from, sides.fromSide, start)
                || !portHasCornerClearance(to, sides.toSide, end)
                || !routeIsClear(conn, lane, { ...sides, from, to }, neighbors, labels)
                || crossingCount(conn, points, neighbors) > 0) return false;
            if (!conn.label) return true;
            const baseline = start[1] + (index === 0 ? -10 : index === lanes.length - 1 ? 16 : 3);
            const rect = {
              relation: conn,
              label: conn.label,
              ...connectionLabelBoxAt(conn, [(start[0] + end[0]) / 2, baseline]),
            };
            if ([...components.values()].some((component) => rectsOverlap(rect, component, 2))
                || !labelClears(rect, conn, routes, labels, labelInBounds)) return false;
            lane.labelAt = [rect.lx, rect.ly];
            labels.push({ conn, rect });
            return true;
          });
          if (!accepted) continue;
          for (const entry of group) {
            const { conn, points, sides, labelAt } = byConnection.get(entry.conn);
            entry.points = points;
            cachePath(conn, { points, d: roundedPath(points, 8), ...(labelAt ? { labelAt } : {}) }, sides);
            jointlyImproved.add(conn);
          }
          reservedLabels = labels;
          planningMetrics.readabilityImprovedCount += group.length;
        }
      }
      function relocatedLabelsFor(conn, routed, others) {
        // A provisional label may occupy an otherwise clear corridor. Move at
        // most one automatic label, on its existing route, and accept the pair
        // only when both labels fit without borrowing other labels' space.
        const displaced = reservedLabels.filter((label) => label.conn !== conn && routed.points.slice(1).some((end, index) =>
          segmentIntersectsRect({ start: routed.points[index], end }, label.rect, LABEL_CLEARANCE)));
        if (displaced.length !== 1) return null;
        const owner = displaced[0].conn;
        // The jointly placed lanes publish their label positions with the
        // routes. Keep that plan intact during this single-route repair.
        if (jointlyImproved.has(owner) || typeOwned.has(owner)
            || hasAuthoredRouteGeometry(owner) || hasAuthoredLabelPlacement(owner)) return null;
        const labels = reservedLabels.filter((label) => label.conn !== conn && label.conn !== owner);
        const routes = [...others, { conn, points: routed.points }];
        const moved = routes.find((entry) => entry.conn === owner);
        for (const entry of [moved, { conn, points: routed.points }]) {
          const rect = labelRectFor?.(entry.conn, entry.points, {
            routes: routes.map((route) => route.points),
            labels: labels.map((label) => label.rect),
          });
          if (!labelClears(rect, entry.conn, routes, labels)
              || (rect && [...components.values()].some((component) => rectsOverlap(rect, component, -2)))) return null;
          if (rect) labels.push({ conn: entry.conn, rect });
        }
        return labels;
      }
      function improveComplexRoutes(onlyCrossings = false) {
        for (const entry of resolvedRoutes) {
          const { conn } = entry;
          if (jointlyImproved.has(conn) || typeOwned.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)) continue;
          const others = resolvedRoutes.filter((other) => other !== entry);
          // Preserve uncomplicated routes and their established inferred sides.
          // Spend the comparison budget where the complete scene has a reading
          // cost: a crossover, more than two bends, or no room for its label.
          const crossingsBefore = crossingCount(conn, entry.points, others);
          const currentLabel = labelRectFor?.(conn, entry.points, {
            routes: others.map(other => other.points),
            labels: reservedLabels.filter(label => label.conn !== conn).map(label => label.rect),
          });
          const labelBlocked = Boolean(conn.label && labelRectFor && !currentLabel);
          if (!labelBlocked && crossingsBefore === 0 && (onlyCrossings || entry.points.length <= 4)) continue;
          let best = null;
          let bestCost = labelBlocked ? Infinity : readabilityCost(conn, { points: entry.points }, others);
          for (const sides of candidateSidePairs(conn)) {
            const geometry = connectionGeometry(conn, sides);
            const candidates = [routedForGeometry(conn, others, geometry)];
            const previousSides = selectedSides.get(conn);
            if (onlyCrossings && repairAutomaticPorts && sides.fromSide === previousSides.fromSide && sides.toSide !== previousSides.toSide) {
              // The existing route may already have a good channel before a
              // detour. Keep its approach and test a turn from that channel
              // into another target side without searching the grid again.
              const axis = sides.toSide === 'top' || sides.toSide === 'bottom' ? 0 : 1;
              const prefixLimit = Math.min(4, entry.points.length - 3);
              for (let index = 1; index < prefixLimit; index += 1) {
                const point = entry.points[index];
                const next = entry.points[index + 1];
                const direction = Math.sign(next[axis] - point[axis]);
                if (!direction || direction !== Math.sign(geometry.end[axis] - point[axis])) continue;
                const turn = [...point];
                turn[axis] = geometry.end[axis];
                const points = normalizeRoutePoints([...entry.points.slice(0, index + 1), turn, geometry.end]);
                candidates.push({ points, d: roundedPath(points, 8) });
              }
            }
            for (const routed of candidates) {
              planningMetrics.readabilityCandidateCount += 1;
              if (!routed.points.every(withinScene) || !routeIsClear(conn, routed, geometry, others)) continue;
              if (onlyCrossings && crossingCount(conn, routed.points, others) >= crossingsBefore) continue;
              const cost = readabilityCost(conn, routed, others);
              if (cost < bestCost) {
                const rect = labelRectFor?.(conn, routed.points, {
                  routes: [...others.map((other) => other.points), routed.points],
                  labels: reservedLabels.filter((label) => label.conn !== conn).map((label) => label.rect),
                });
                // Include the reserved label in this pass's bounds. In
                // particular, a shorter route must not widen and shrink the graph.
                if (labelRectFor && !labelClears(rect, conn, others, reservedLabels.filter(label => label.conn !== conn))) continue;
                if (onlyCrossings && (!endpointSlotsClear([{ conn, points: routed.points }], others,
                  candidate => candidate === conn ? sides : selectedSides.get(candidate))
                    || (rect && [...components.values()].some(component => rectsOverlap(rect, component, -2))))) continue;
                best = { routed, sides, rect };
                bestCost = cost;
              }
            }
          }
          if (!best) continue;
          cachePath(conn, best.routed, best.sides);
          entry.points = best.routed.points;
          planningMetrics.readabilityImprovedCount += 1;
          reservedLabels = reservedLabels.filter((label) => label.conn !== conn);
          if (best.rect) reservedLabels.push({ conn, rect: best.rect });
        }
      }
      function straightenFacingRoutes() {
        // A bent route between nodes that overlap across the gap separating
        // them can run straight through facing sides inside that overlap.
        // Authored sides must already face. Keep the other paths and slots
        // fixed while testing whether the labels fit with the straight lane.
        for (const entry of resolvedRoutes) {
          const { conn } = entry;
          if (entry.points.length < 4 || jointlyImproved.has(conn) || typeOwned.has(conn)
              || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)) continue;
          const from = components.get(conn.from);
          const to = components.get(conn.to);
          const facing = from.x + from.width <= to.x ? { fromSide: 'right', toSide: 'left' }
            : to.x + to.width <= from.x ? { fromSide: 'left', toSide: 'right' }
              : from.y + from.height <= to.y ? { fromSide: 'bottom', toSide: 'top' }
                : to.y + to.height <= from.y ? { fromSide: 'top', toSide: 'bottom' } : null;
          if (!facing) continue;
          const axis = facing.fromSide === 'right' || facing.fromSide === 'left' ? 1 : 0;
          const [origin, size] = axis === 1 ? ['y', 'height'] : ['x', 'width'];
          const low = Math.max(from[origin], to[origin]) + AUTOMATIC_PORT_CORNER_GUTTER;
          const high = Math.min(from[origin] + from[size], to[origin] + to[size]) - AUTOMATIC_PORT_CORNER_GUTTER;
          if (high < low
              || (conn.fromSide && conn.fromSide !== 'auto' && conn.fromSide !== facing.fromSide)
              || (conn.toSide && conn.toSide !== 'auto' && conn.toSide !== facing.toSide)) continue;
          const sides = facing;
          const geometry = connectionGeometry(conn, sides);
          const start = geometry.start;
          const end = geometry.end;
          const clamp = (value) => Math.min(high, Math.max(low, value));
          const others = resolvedRoutes.filter((other) => other !== entry);
          const otherLabels = reservedLabels.filter((label) => label.conn !== conn);
          const crossingsBefore = crossingCount(conn, entry.points, others);
          const sidesOf = (candidate) => (candidate === conn ? sides : selectedSides.get(candidate));
          for (const lane of new Set([start[axis], end[axis], (start[axis] + end[axis]) / 2, (low + high) / 2].map(clamp))) {
            const points = [[...start], [...end]];
            points[0][axis] = lane;
            points[1][axis] = lane;
            const routed = { conn, points, d: roundedPath(points, 8) };
            if (!points.every(withinScene)
                || !endpointSlotsClear([routed], others, sidesOf)
                || !routeIsClear(conn, routed, geometry, others)
                || !routeClearsReservedLabels(conn, points)
                || crossingCount(conn, points, others) > crossingsBefore) continue;
            const rect = labelRectFor?.(conn, points, {
              routes: [...others.map((other) => other.points), points],
              labels: otherLabels.map((label) => label.rect),
            });
            if (!labelClears(rect, conn, others, otherLabels)) continue;
            cachePath(conn, { points, d: routed.d }, sides);
            entry.points = points;
            planningMetrics.readabilityImprovedCount += 1;
            reservedLabels = [...otherLabels, ...(rect ? [{ conn, rect }] : [])];
            break;
          }
        }
      }
      function simplifyResidualRoutes() {
        // Try off-center ports and short orthogonal routes after the regular
        // planner has settled. Keep every other route and label in place.
        const maximumCandidatesPerRoute = 4096;
        const maximumCandidates = 16384;
        const horizontal = side => side === 'left' || side === 'right';
        const direction = side => side === 'right' || side === 'bottom' ? 1 : -1;
        const withCoordinate = (point, axis, value) => axis === 0 ? [value, point[1]] : [point[0], value];
        // The SVG origin is fixed. A label in blank space above or left of
        // the scene can still fit in the same viewBox.
        const labelInBounds = ([x, y]) => x >= 0 && x <= bounds.right && y >= 0 && y <= bounds.bottom;
        const hasPinnedLabel = ({ conn }) => Boolean(conn.label && Array.isArray(conn.labelAt));
        // A detached pinned label can block the short path for another
        // relationship. Repair its own automatic arrow first when possible.
        const entries = [
          ...resolvedRoutes.filter(hasPinnedLabel),
          ...resolvedRoutes.filter(entry => !hasPinnedLabel(entry)),
        ];
        for (const entry of entries) {
          const { conn } = entry;
          const pinned = hasPinnedLabel(entry) ? connectionLabelBoxAt(conn, conn.labelAt) : null;
          if (entry.points.length <= 4 || jointlyImproved.has(conn) || typeOwned.has(conn) || hasAuthoredRouteGeometry(conn)
              || (hasAuthoredLabelPlacement(conn) && !pinned) || conn.from === conn.to) continue;
          const others = resolvedRoutes.filter(other => other !== entry);
          const previousCrossings = others.map(other => crossingPoints(entry.points, other));
          const crossingTotal = previousCrossings.reduce((total, count) => total + count, 0);
          if (pinned && (!crossingTotal || labelDistance(entry.points, pinned, 20) <= 20)) continue;
          const length = routeLength(entry.points) + (pinned ? 3 * interiorSegmentPx : 0);
          const labels = reservedLabels.filter(label => label.conn !== conn);
          const routes = others.map(other => other.points);
          const fromBox = components.get(conn.from);
          const toBox = components.get(conn.to);
          // Any point on a path within this length must be reachable from
          // both endpoints. Take their outer extents and include clearance.
          const left = (fromBox.x + toBox.x - length) / 2 - 2.001;
          const right = (fromBox.x + fromBox.width + toBox.x + toBox.width + length) / 2 + 2.001;
          const top = (fromBox.y + toBox.y - length) / 2 - 2.001;
          const bottom = (fromBox.y + fromBox.height + toBox.y + toBox.height + length) / 2 + 2.001;
          const nearby = [...components.values()].filter(box =>
            box.x <= right && box.x + box.width >= left && box.y <= bottom && box.y + box.height >= top);
          const obstacles = [...nearby, ...frames, ...labels.map(({ rect }) => rect)];
          const segments = routes.flatMap(points => points.slice(1).map((end, index) => [points[index], end]));
          let remaining = Math.min(maximumCandidatesPerRoute, maximumCandidates - planningMetrics.residualCandidateCount);
          if (!remaining) break;
          const ownedLabels = labels.flatMap(({ conn: owner, rect }) => {
            const distance = labelDistance(pathCache.get(owner).points, rect, 20);
            return distance <= 20 && labelDistance(entry.points, rect, distance) > distance
              ? [{ rect, distance }] : [];
          });
          const slots = (rect, side, preferred) => {
            const axis = Number(horizontal(side));
            const origin = axis ? rect.y : rect.x;
            const size = axis ? rect.height : rect.width;
            const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, size / 2);
            const low = origin + inset;
            const high = origin + size - inset;
            const values = [preferred[axis], low, high];
            if (pinned) values.push(low + portSpacing(conn, conn), high - portSpacing(conn, conn));
            for (const { conn: other, field, sideField } of incidentEndpoints.get(rect.id) || []) {
              if (other === conn || selectedSides.get(other)[sideField] !== side) continue;
              const port = pathCache.get(other).points.at(field === 'from' ? 0 : -1);
              const gap = portSpacing(conn, other);
              values.push(port[axis] - gap, port[axis] + gap);
            }
            return [...new Set(values)].filter(value => value >= low && value <= high);
          };
          let best;
          sidePairs: for (const sides of candidateSidePairs(conn)) {
            const geometry = connectionGeometry(conn, sides);
            const { from, to, start, end, fromSide, toSide } = geometry;
            const sourceAxis = Number(horizontal(fromSide));
            const targetAxis = Number(horizontal(toSide));
            const starts = slots(from, fromSide, start);
            const ends = slots(to, toSide, end);
            if (sourceAxis === targetAxis) {
              starts.push(...ends.filter(value => portHasCornerClearance(from, fromSide, withCoordinate(start, sourceAxis, value))));
              ends.push(...starts.filter(value => portHasCornerClearance(to, toSide, withCoordinate(end, targetAxis, value))));
            }
            const axis = 1 - sourceAxis;
            const step = direction(fromSide);
            const lastStep = direction(toSide);
            const stub = Math.max(interiorSegmentPx, microSegmentPx);
            const startLimit = start[axis] + step * stub;
            const endLimit = end[axis] + lastStep * stub;
            const coordinates = [(startLimit + endLimit) / 2, startLimit, endLimit, ...entry.points.map(point => point[axis])];
            if (pinned) {
              const [origin, span] = axis ? [pinned.y, pinned.height] : [pinned.x, pinned.width];
              coordinates.push(origin - 8, origin + span + 8);
            }
            if (sourceAxis === targetAxis) {
              // A two-turn route spends its transverse span plus the two
              // approach legs. Ignore cuts outside the union of feasible
              // channels and outside the span of the endpoint ports.
              const sourceLow = Math.min(...starts);
              const sourceHigh = Math.max(...starts);
              const targetLow = Math.min(...ends);
              const targetHigh = Math.max(...ends);
              const acrossLow = Math.min(sourceLow, targetLow);
              const acrossHigh = Math.max(sourceHigh, targetHigh);
              const alongBudget = length - Math.max(0, sourceLow - targetHigh, targetLow - sourceHigh);
              const from = start[axis];
              const to = end[axis];
              const low = Math.max((from + to - alongBudget) / 2,
                step > 0 ? startLimit : -Infinity, lastStep > 0 ? endLimit : -Infinity);
              const high = Math.min((from + to + alongBudget) / 2,
                step < 0 ? startLimit : Infinity, lastStep < 0 ? endLimit : Infinity);
              const cuts = [startLimit, endLimit, low, high];
              const collectCuts = ([x1, y1], [x2, y2]) => {
                const [axisStart, axisEnd, acrossStart, acrossEnd] = axis ? [y1, y2, x1, x2] : [x1, x2, y1, y2];
                if (Math.max(acrossStart, acrossEnd) < acrossLow || Math.min(acrossStart, acrossEnd) > acrossHigh
                    || Math.max(axisStart, axisEnd) < low || Math.min(axisStart, axisEnd) > high) return;
                cuts.push(axisStart, axisEnd);
              };
              for (const rect of obstacles) collectCuts([rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]);
              for (const [start, end] of segments) collectCuts(start, end);
              const ordered = [...new Set(cuts)].sort((a, b) => a - b);
              coordinates.push(...ordered.slice(1).map((cut, index) => (ordered[index] + cut) / 2)
                .filter(value => value >= low && value <= high));
            }
            const channels = [...new Set(coordinates)].filter(value =>
              step * (value - startLimit) >= 0 && lastStep * (value - endLimit) >= 0);
            const sidesOf = candidate => candidate === conn ? sides : selectedSides.get(candidate);
            const consider = (points, drift) => {
              remaining -= 1;
              planningMetrics.residualCandidateCount += 1;
              const span = routeLength(points);
              if (span > length + 0.0001 || !points.every(withinScene)) return;
              const labelGap = pinned ? labelDistance(points,
                { x: pinned.lx, y: pinned.ly, width: 0, height: 0 }, Infinity) : 0;
              const order = best ? points.length - best.points.length
                || labelGap - best.labelGap
                || (Math.abs(span - best.length) > 0.0001 ? span - best.length : drift - best.drift) : -1;
              if (best?.crossings === 0 && order >= 0) return;
              if (!endpointSlotsClear([{ conn, points }], others, sidesOf)
                  || !routeIsClear(conn, { points }, { ...geometry, crowded: false }, others, reservedLabels, nearby)) return;
              let crossings = 0;
              for (const [index, other] of others.entries()) {
                const previous = previousCrossings[index];
                const current = crossingPoints(points, other, previous + 1);
                if (current > previous) return;
                crossings += current;
              }
              if (pinned && crossings >= crossingTotal) return;
              if (best && (crossings - best.crossings || order) >= 0) return;
              const rect = pinned ?? labelRectFor?.(conn, points, { routes: [...routes, points], labels: labels.map(label => label.rect) });
              if (!labelClears(rect, conn, others, labels, labelInBounds)
                  || (rect && !labelFollowsRoute(rect, points, others))
                  || ownedLabels.some(({ rect, distance }) => labelDistance(points, rect, distance) <= distance)) return;
              best = { points, sides, rect, length: span, drift, crossings, labelGap };
            };
            for (const fromValue of new Set(starts)) {
              for (const toValue of new Set(ends)) {
                if (!remaining) break sidePairs;
                const source = withCoordinate(start, sourceAxis, fromValue);
                const target = withCoordinate(end, targetAxis, toValue);
                const drift = Math.abs(start[sourceAxis] - fromValue) + Math.abs(end[targetAxis] - toValue);
                if (sourceAxis !== targetAxis) {
                  consider([source, withCoordinate(source, axis, target[axis]), target], drift);
                } else if (fromValue === toValue) {
                  consider([source, target], drift);
                } else {
                  for (const channel of channels) {
                    if (!remaining) break sidePairs;
                    consider([source, withCoordinate(source, axis, channel), withCoordinate(target, axis, channel), target], drift);
                  }
                }
              }
            }
          }
          if (!best) continue;
          const { points, sides, rect } = best;
          const routed = { points, d: roundedPath(points, 8), ...(rect ? { labelAt: [rect.lx, rect.ly] } : {}) };
          if (acceptSimplification && connections.some(connection => connection.label)
              && !acceptSimplification(other => pathCache.get(other), other => other === conn ? routed : pathCache.get(other))) {
            planningMetrics.residualLabelRejectionCount += 1;
            continue;
          }
          cachePath(conn, routed, sides);
          entry.points = points;
          reservedLabels = [...labels, ...(rect ? [{ conn, rect }] : [])];
          planningMetrics.readabilityImprovedCount += 1;
        }
      }

      function uncrossEndpointPorts() {
        // Two elbows can cross because of the order of ports on a shared
        // endpoint side. Exchanging the occupied slots leaves the rest of each
        // path intact and needs no new obstacle or port search.
        const groups = new Map();
        for (const entry of resolvedRoutes) {
          const { conn, points } = entry;
          if (points.length < 3 || jointlyImproved.has(conn) || typeOwned.has(conn)
              || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
              || [conn.fromSide, conn.toSide].some(side => side && side !== 'auto')) continue;
          const { fromSide, toSide } = selectedSides.get(conn);
          for (const [id, side, incoming] of [[conn.from, fromSide, false], [conn.to, toSide, true]]) {
            const key = `${id}:${side}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ entry, side, incoming });
          }
        }
        // Read the elbow outward from the common endpoint, even for an
        // incoming route. The saved path still follows its original direction.
        const endpointPoint = ({ entry, incoming }, offset) => entry.points.at(incoming ? -1 - offset : offset);
        for (const group of groups.values()) {
          for (const [index, leftEndpoint] of group.entries()) {
            for (const rightEndpoint of group.slice(index + 1)) {
              const { entry: left, side } = leftEndpoint;
              const { entry: right } = rightEndpoint;
              if (left === right || left.points.length < 3 || right.points.length < 3
                  || (countSharedEndpointCrossings && !crossingPoints(left.points, right, 1))) continue;
              const leftPort = endpointPoint(leftEndpoint, 0);
              const leftElbow = endpointPoint(leftEndpoint, 1);
              const rightPort = endpointPoint(rightEndpoint, 0);
              const rightElbow = endpointPoint(rightEndpoint, 1);
              if (!properSegmentIntersection(leftPort, leftElbow, rightElbow, endpointPoint(rightEndpoint, 2))
                  && !properSegmentIntersection(rightPort, rightElbow, leftElbow, endpointPoint(leftEndpoint, 2))) continue;
              const entries = [left, right];
              const coordinate = side === 'left' || side === 'right' ? 1 : 0;
              const candidates = [leftEndpoint, rightEndpoint].map((endpoint, entryIndex) => {
                const { entry: { conn, points }, incoming } = endpoint;
                const shifted = points.map(point => [...point]);
                const portIndex = incoming ? shifted.length - 1 : 0;
                const elbowIndex = portIndex + (incoming ? -1 : 1);
                shifted[portIndex][coordinate] = shifted[elbowIndex][coordinate] = [rightPort, leftPort][entryIndex][coordinate];
                return { conn, points: normalizeRoutePoints(shifted) };
              });
              if (crossingPoints(candidates[0].points, candidates[1], 1)
                  || routeLength(candidates[0].points) + routeLength(candidates[1].points)
                    > routeLength(left.points) + routeLength(right.points) + 0.0001) continue;
              const others = resolvedRoutes.filter(entry => !entries.includes(entry));
              const labels = reservedLabels.filter(label => label.conn !== left.conn && label.conn !== right.conn);
              if (!endpointSlotsClear(candidates, others, conn => selectedSides.get(conn))) continue;
              const routes = [...others, ...candidates];
              const clear = candidates.every(({ conn, points }, entryIndex) => {
                const geometry = connectionGeometry(conn, selectedSides.get(conn));
                if (!points.every(withinScene)
                    || !routeIsClear(conn, { points }, { ...geometry, start: points[0], end: points.at(-1), crowded: false },
                      routes.filter(entry => entry.conn !== conn), labels)
                    || others.some(entry => crossingPoints(points, entry)
                      > crossingPoints(entries[entryIndex].points, entry))) return false;
                const rect = labelRectFor?.(conn, points, {
                  routes: routes.map(entry => entry.points),
                  labels: labels.map(label => label.rect),
                });
                if (!labelClears(rect, conn, routes, labels)
                    || (rect && [...components.values()].some(component => rectsOverlap(rect, component, -2)))) return false;
                if (rect) labels.push({ conn, rect });
                return true;
              });
              if (!clear) continue;
              candidates.forEach(({ conn, points }, entryIndex) => {
                cachePath(conn, { points, d: roundedPath(points, 8) }, selectedSides.get(conn));
                entries[entryIndex].points = points;
              });
              reservedLabels = labels;
              planningMetrics.readabilityImprovedCount += candidates.length;
            }
          }
        }
      }

      function separateNearbyLanes() {
        // Slide one leg between existing elbows or on an automatic port.
        // Keep the rest of the route and the ports on other routes stable.
        for (const entry of resolvedRoutes) {
          const { conn, points } = entry;
          if (points.length < 3 || hasAuthoredLabelPlacement(conn) || hasAuthoredRouteGeometry(conn)
              || conn.from === conn.to || typeOwned.has(conn)) continue;
          const sides = selectedSides.get(conn);
          const others = resolvedRoutes.filter(other => other !== entry);
          const geometry = connectionGeometry(conn, sides);
          const labels = reservedLabels.filter(label => label.conn !== conn);
          const moves = [];
          for (const [end, index, at] of [['to', points.length - 2, -1], ['from', 0, 0]]) {
            const side = sides[`${end}Side`];
            const axis = side === 'top' || side === 'bottom' ? 0 : 1;
            const longDeparture = route => Math.abs(route[0][1 - axis] - route[1][1 - axis]) >= MIN_PARALLEL_DEPARTURE;
            if (at === 0 && !longDeparture(points)) continue;
            const original = points.at(at)[axis];
            const neighbors = others.filter(other => other.conn[end] === conn[end]
              && selectedSides.get(other.conn)[`${end}Side`] === side
              && (at === -1 || longDeparture(other.points))).map(other => other.points.at(at)[axis]);
            if (!neighbors.some(value => Math.abs(value - original) < READABLE_PORT_GAP)) continue;
            moves.push(...neighbors.flatMap(value => [value - READABLE_PORT_GAP, value + READABLE_PORT_GAP])
              .filter(value => neighbors.every(other => Math.abs(other - value) >= READABLE_PORT_GAP - 0.0001))
              .sort((a, b) => Math.abs(a - original) - Math.abs(b - original) || a - b)
              .map(value => ({ index, across: axis, value })));
          }
          for (const other of others) {
            if (other.conn.from !== conn.to || other.conn.to !== conn.from) continue;
            for (const { index, across, separation } of closeReciprocalLanes(points, other.points)) {
              if (index === 0 || index === points.length - 2 || separation === 0) continue;
              moves.push({ index, across, value: points[index][across]
                + Math.sign(separation) * (READABLE_PORT_GAP - Math.abs(separation)) });
            }
          }
          for (const { index, across, value } of moves) {
            const shifted = points.map(point => [...point]);
            shifted[index][across] = shifted[index + 1][across] = value;
            const next = normalizeRoutePoints(shifted);
            const approach = path => routeLength(path.slice(-2));
            // Widening the parallel legs must leave room for the marker.
            if (approach(next) < Math.min(approach(points), 16)
                || routeLength(next) > routeLength(points) + 8 || !routeMeetsCompositionFloors(next)
                || !portHasCornerClearance(components.get(conn.from), sides.fromSide, next[0])
                || !portHasCornerClearance(components.get(conn.to), sides.toSide, next.at(-1))
                || !next.every(withinScene)
                || !endpointSlotsClear([{ conn, points: next }], others, other => selectedSides.get(other))
                || !routeIsClear(conn, { points: next }, { ...geometry, crowded: false }, others, labels)
                || others.some(other => crossingPoints(next, other) > crossingPoints(points, other))) continue;
            const rect = labelRectFor?.(conn, next, { routes: [...others.map(other => other.points), next], labels: labels.map(label => label.rect) });
            if (!labelClears(rect, conn, others, labels)) continue;
            const routed = { points: next, d: roundedPath(next, 8), ...(rect ? { labelAt: [rect.lx, rect.ly] } : {}) };
            if (acceptSimplification && !acceptSimplification(other => pathCache.get(other),
              other => other === conn ? routed : pathCache.get(other))) continue;
            entry.points = next;
            cachePath(conn, routed, sides);
            reservedLabels = [...labels, ...(rect ? [{ conn, rect }] : [])];
            break;
          }
        }
      }

      function separateParallelRuns() {
        const measure = (entry, others) => {
          const runs = others.flatMap(other => [...closeParallelRuns(entry.points, other.points, parallelGap(entry.conn, other.conn))]);
          const borders = frameBorders.flatMap(border => [...closeParallelRuns(entry.points, [border.start, border.end], READABLE_FRAME_GAP)])
            .filter(run => run.overlap >= 24);
          return { runs, borders, parallel: runs.reduce((sum, run) => sum + run.overlap, 0),
            frame: borders.reduce((sum, run) => sum + run.overlap, 0),
            debt: runs.reduce((sum, run) => sum + run.overlap * (1 - Math.abs(run.separation) / run.gap), 0) };
        };
        const ranked = resolvedRoutes.map(entry => ({ entry, ...measure(entry, resolvedRoutes.filter(other => other !== entry)) }))
          .sort((a, b) => b.debt + b.frame - a.debt - a.frame);
        let probes = 160;
        let compositions = 12;
        for (const { entry, parallel, frame } of ranked) {
          if (!probes || (!parallel && !frame)) break;
          const { conn, points } = entry;
          if (typeOwned.has(conn) || conn.from === conn.to || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
              || [conn.fromSide, conn.toSide].some(side => side && side !== 'auto')) continue;
          const others = resolvedRoutes.filter(other => other !== entry);
          const before = measure(entry, others);
          if (!before.parallel && !before.frame) continue;
          const oldSides = selectedSides.get(conn);
          const from = components.get(conn.from);
          const to = components.get(conn.to);
          const labels = reservedLabels.filter(label => label.conn !== conn);
          const previousCrossings = others.map(other => crossingPoints(points, other));
          const budget = routeBudgetMetrics({ routedRelations: [entry] });
          const length = routeLength(points);
          const approach = path => routeLength(path.slice(-2));
          const maxLength = length + Math.min(before.frame ? 40 : 24, length * 0.2);
          const moves = [];
          for (const { index, across, separation, gap } of [...before.runs, ...before.borders]
            .sort((a, b) => b.overlap - a.overlap).slice(0, 6)) {
            const peer = points[index][across] - separation;
            for (const direction of (separation < 0 ? [-1, 1] : [1, -1])) {
              const shifted = points.map(point => [...point]);
              shifted[index][across] = shifted[index + 1][across] = peer + direction * gap;
              moves.push({ points: normalizeRoutePoints(shifted), sides: oldSides });
            }
          }
          // Staggered reciprocal elbows may leave no usable room in their
          // shared corridor. Try a different face with at most one turn.
          const alternatePorts = (box, side, point, previous, pinnedSide) => {
            if (side === pinnedSide) return [previous];
            const axis = side === 'top' || side === 'bottom' ? 0 : 1;
            const low = (axis ? box.y : box.x) + 16;
            const high = (axis ? box.y + box.height : box.x + box.width) - 16;
            const near = [...point];
            near[axis] = Math.max(low, Math.min(high, previous[axis]));
            return [near, point];
          };
          for (const sides of candidateSidePairs(conn)) {
            const { start, end } = connectionGeometry(conn, sides);
            const starts = alternatePorts(from, sides.fromSide, start, points[0], oldSides.fromSide);
            const ends = alternatePorts(to, sides.toSide, end, points.at(-1), oldSides.toSide);
            for (const first of starts) for (const last of ends) {
              for (const elbow of [[first[0], last[1]], [last[0], first[1]]]) {
                moves.push({ points: normalizeRoutePoints([first, elbow, last]), sides });
              }
            }
          }
          const seen = new Set();
          const feasible = [];
          for (const { points: next, sides } of moves) {
            const key = JSON.stringify(next);
            if (seen.has(key) || next.length < 2 || !next.every(withinScene)
                || routeLength(next) > maxLength || next.length > Math.max(4, points.length)
                || approach(next) < Math.min(approach(points), 16)) continue;
            seen.add(key);
            const after = measure({ conn, points: next }, others);
            if (after.parallel > before.parallel + 0.0001 || after.frame > before.frame + 0.0001
                || after.debt > before.debt + 0.0001
                || (after.debt >= before.debt - 0.0001 && after.frame >= before.frame - 0.0001)) continue;
            const nextBudget = routeBudgetMetrics({ routedRelations: [{ points: next }] });
            if (nextBudget.routesOverSuggestedStretch > budget.routesOverSuggestedStretch) continue;
            if (!probes) break;
            probes -= 1;
            if (!portHasCornerClearance(from, sides.fromSide, next[0]) || !portHasCornerClearance(to, sides.toSide, next.at(-1))
                || !endpointSlotsClear([{ conn, points: next }], others, other => other === conn ? sides : selectedSides.get(other))
                || !routeIsClear(conn, { points: next }, { ...sides, from, to }, others, [])
                || others.some((other, index) => crossingPoints(next, other, previousCrossings[index] + 1) > previousCrossings[index])) continue;
            const gain = before.debt + before.frame - after.debt - after.frame;
            const rect = labelRectFor?.(conn, next, { routes: [...others.map(other => other.points), next], labels: labels.map(label => label.rect) });
            const hint = labelClears(rect, conn, others, labels) ? rect : null;
            const routed = { points: next, d: roundedPath(next, 8), ...(hint ? { labelAt: [hint.lx, hint.ly] } : {}) };
            feasible.push({ routed, sides, rect: hint, gain, length: routeLength(next) });
          }
          // Provisional labels can block the best lane on paper. Check the
          // final composition, including label ownership, before committing.
          const chosen = feasible.sort((a, b) => b.gain - a.gain || a.length - b.length).slice(0, 4)
            .find(candidate => {
              if (!compositions) return false;
              compositions -= 1;
              return !acceptSimplification || acceptSimplification(other => pathCache.get(other),
                other => other === conn ? candidate.routed : pathCache.get(other));
            });
          if (!chosen) continue;
          entry.points = chosen.routed.points;
          cachePath(conn, chosen.routed, chosen.sides);
          reservedLabels = [...labels, ...(chosen.rect ? [{ conn, rect: chosen.rect }] : [])];
        }

        // Both facing shafts can use their spare corner clearance when neither
        // one can reach the target while the other stays in its original slot.
        const movable = resolvedRoutes.filter(({ conn, points }) => points.length === 2 && !typeOwned.has(conn)
          && conn.from !== conn.to && !hasAuthoredRouteGeometry(conn) && !hasAuthoredLabelPlacement(conn)
          && [conn.fromSide, conn.toSide].every(side => !side || side === 'auto'));
        const sidesOf = conn => selectedSides.get(conn);
        const limits = (entry, axis) => {
          const { fromSide, toSide } = sidesOf(entry.conn);
          const expected = axis ? ['left', 'right'] : ['top', 'bottom'];
          if (!expected.includes(fromSide) || !expected.includes(toSide) || fromSide === toSide) return null;
          const edges = [entry.conn.from, entry.conn.to].map(id => {
            const box = components.get(id);
            const [start, extent] = axis ? [box.y, box.height] : [box.x, box.width];
            const inset = Math.min(16, extent / 2);
            return [start + inset, start + extent - inset];
          });
          return [Math.max(edges[0][0], edges[1][0]), Math.min(edges[0][1], edges[1][1])];
        };
        for (const [index, first] of movable.entries()) {
          for (const second of movable.slice(index + 1)) {
            if (!probes || !compositions) return;
            if (!reciprocalPair(first.conn, second.conn)) continue;
            const gap = parallelGap(first.conn, second.conn);
            const [run] = closeParallelRuns(first.points, second.points, gap);
            if (!run || !run.separation) continue;
            const axis = run.across;
            const pair = run.separation < 0 ? [first, second] : [second, first];
            const [low, high] = pair.map(entry => limits(entry, axis));
            if (!low || !high) continue;
            const min = Math.max(low[0], high[0] - gap);
            const max = Math.min(low[1], high[1] - gap);
            if (min > max) continue;
            const [a, b] = pair.map(entry => entry.points[0][axis]);
            const clamp = lane => Math.min(max, Math.max(min, lane));
            const members = new Set(pair.map(entry => entry.conn));
            const others = resolvedRoutes.filter(entry => !members.has(entry.conn));
            const labels = reservedLabels.filter(label => !members.has(label.conn));
            for (const lane of new Set([clamp((a + b - gap) / 2), clamp(a), clamp(b - gap), min, max])) {
              if (!probes || !compositions) return;
              probes -= 1;
              const candidates = pair.map(({ conn, points }, offset) => ({ conn, points: points.map(point => {
                const moved = [...point];
                moved[axis] = lane + offset * gap;
                return moved;
              }) }));
              if (!endpointSlotsClear(candidates, others, sidesOf)) continue;
              if (!candidates.every((entry, i) => {
                const { conn, points } = entry;
                const peers = [...others, candidates[1 - i]];
                const previous = measure(pair[i], [...others, pair[1 - i]]);
                const next = measure(entry, peers);
                return points.every(withinScene) && next.frame <= previous.frame + 0.0001
                  && next.parallel <= previous.parallel + 0.0001 && next.debt < previous.debt
                  && routeIsClear(conn, entry, connectionGeometry(conn, sidesOf(conn)), peers, [])
                  && others.every(other => crossingPoints(points, other) <= crossingPoints(pair[i].points, other));
              })) continue;
              const nextLabels = [...labels];
              const routes = [...others, ...candidates];
              const alternatives = new Map(candidates.map(({ conn, points }) => {
                const rect = labelRectFor?.(conn, points, {
                  routes: routes.map(route => route.points), labels: nextLabels.map(label => label.rect),
                });
                const hint = labelClears(rect, conn, routes, nextLabels) ? rect : null;
                if (hint) nextLabels.push({ conn, rect: hint });
                return [conn, { points, d: roundedPath(points, 8), ...(hint ? { labelAt: [hint.lx, hint.ly] } : {}) }];
              }));
              compositions -= 1;
              if (acceptSimplification && !acceptSimplification(conn => pathCache.get(conn),
                conn => alternatives.get(conn) ?? pathCache.get(conn))) continue;
              for (const entry of pair) {
                const routed = alternatives.get(entry.conn);
                entry.points = routed.points;
                cachePath(entry.conn, routed, sidesOf(entry.conn));
              }
              reservedLabels = nextLabels;
              break;
            }
          }
        }
      }
      allowGridSearch = false;
      try {
        if (repairAutomaticPorts) straightenParallelCorridors();
        improveReciprocalPairs();
        improveComplexRoutes();
        straightenFacingRoutes();
        // Finish the established route/straightening plan first. Moving a
        // label earlier could prevent a later edge from taking its straight
        // corridor, even though the local candidate was cheaper.
        for (const entry of resolvedRoutes) {
          const { conn } = entry;
          if (jointlyImproved.has(conn) || typeOwned.has(conn) || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)) continue;
          const others = resolvedRoutes.filter((other) => other !== entry);
          if (entry.points.length <= 4 && crossingCount(conn, entry.points, others) === 0) continue;
          let best = null;
          let bestCost = readabilityCost(conn, entry, others);
          if (labelRectFor && reservedLabels.some((label) => label.conn !== conn)) {
            // One additional side sweep, with no grid search or cascading
            // relayout. Temporary reservations can be ignored only after a
            // replacement placement is verified against the complete scene.
            for (const sides of candidateSidePairs(conn)) {
              const geometry = connectionGeometry(conn, sides);
              let routed;
              let clear;
              honourReservedLabels = false;
              try {
                routed = routedForGeometry(conn, others, geometry);
                clear = routeIsClear(conn, routed, geometry, others);
              } finally {
                honourReservedLabels = true;
              }
              planningMetrics.labelRelocationCandidateCount += 1;
              const cost = readabilityCost(conn, routed, others);
              if (cost >= bestCost || !clear || !routed.points.every(withinScene)
                  || crossingCount(conn, routed.points, others) > crossingCount(conn, entry.points, others)
                  || !endpointSlotsClear([{ conn, points: routed.points }], others,
                    (candidate) => candidate === conn ? sides : selectedSides.get(candidate))) continue;
              const labels = relocatedLabelsFor(conn, routed, others);
              if (!labels) continue;
              best = { routed, sides, labels };
              bestCost = cost;
            }
          }
          if (!best) continue;
          cachePath(conn, best.routed, best.sides);
          entry.points = best.routed.points;
          reservedLabels = best.labels;
          planningMetrics.labelRelocationImprovedCount += 1;
        }
        // A side's midpoint may be blocked even when a corner port has a
        // clear one-bend route. Probe bent automatic routes, keeping
        // all other paths/labels fixed and the existing corner inset intact.
        // Eight perpendicular side pairs, at most three slots per endpoint:
        // 72 cheap candidates per route, without another grid search.
        for (const entry of resolvedRoutes) {
          const { conn } = entry;
          if (entry.points.length < 4 || jointlyImproved.has(conn) || typeOwned.has(conn)
              || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)) continue;
          const others = resolvedRoutes.filter((other) => other !== entry);
          const labels = reservedLabels.filter((label) => label.conn !== conn);
          const crossingsBefore = crossingCount(conn, entry.points, others);
          let best = null;
          let bestCost = readabilityCost(conn, entry, others);
          const slots = (rect, side, preferred) => {
            const horizontal = side === 'left' || side === 'right';
            const axis = horizontal ? 1 : 0;
            const origin = horizontal ? rect.y : rect.x;
            const size = horizontal ? rect.height : rect.width;
            const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, size / 2);
            return [...new Set([preferred[axis], origin + inset, origin + size - inset])].map((value) => {
              const point = [...preferred];
              point[axis] = value;
              return point;
            }).filter((point) => portHasCornerClearance(rect, side, point));
          };
          for (const sides of candidateSidePairs(conn)) {
            const horizontal = (side) => side === 'left' || side === 'right';
            if (horizontal(sides.fromSide) === horizontal(sides.toSide)) continue;
            const geometry = connectionGeometry(conn, sides);
            for (const start of slots(geometry.from, sides.fromSide, geometry.start)) {
              for (const end of slots(geometry.to, sides.toSide, geometry.end)) {
                const corner = horizontal(sides.fromSide) ? [end[0], start[1]] : [start[0], end[1]];
                const points = normalizeRoutePoints([start, corner, end]);
                const routed = { points, d: roundedPath(points, 8) };
                const cost = readabilityCost(conn, routed, others);
                if (cost >= bestCost || points.length !== 3 || !points.every(withinScene)
                    || !endpointSlotsClear([{ conn, points }], others,
                      (candidate) => candidate === conn ? sides : selectedSides.get(candidate))
                    || !routeIsClear(conn, routed, { ...geometry, start, end, crowded: false }, others)
                    || crossingCount(conn, points, others) > crossingsBefore) continue;
                const rect = labelRectFor?.(conn, points, {
                  routes: [...others.map((other) => other.points), points],
                  labels: labels.map((label) => label.rect),
                });
                if (!labelClears(rect, conn, others, labels)
                    || (rect && [...components.values()].some((component) => rectsOverlap(rect, component, -2)))) continue;
                best = { routed, sides, rect };
                bestCost = cost;
              }
            }
          }
          if (!best) continue;
          cachePath(conn, best.routed, best.sides);
          entry.points = best.routed.points;
          reservedLabels = [...labels, ...(best.rect ? [{ conn, rect: best.rect }] : [])];
          planningMetrics.readabilityImprovedCount += 1;
        }
        // Complete the original bounded plan first. Only a remaining crossing
        // can justify using an extra lower corridor; an already clear scene
        // must not grow merely because its labels could move into that space.
        if (readabilityBottomMargin > 0) {
          bounds.bottom += readabilityBottomMargin;
          const improvedBefore = planningMetrics.readabilityImprovedCount;
          improveComplexRoutes(true);
          // Rerouting a crossing can free a straight corridor that was
          // occupied when the earlier pass examined it.
          if (planningMetrics.readabilityImprovedCount !== improvedBefore) straightenFacingRoutes();
        }
        if (repairAutomaticPorts) {
          uncrossEndpointPorts();
          simplifyResidualRoutes();
          if (spreadLanes) separateNearbyLanes();
          if (separateRuns) separateParallelRuns();
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

  function routedEntries() {
    planRoutes();
    return [...pathCache].map(([conn, routed]) => ({ conn, ...routed }));
  }

  function crossingPairs() {
    const entries = routedEntries();
    return entries.flatMap(({ conn, points }, index) => entries.slice(index + 1)
      .filter(other => crossingCount(conn, points, [other]))
      .map(other => [conn, other.conn]));
  }

  function endpointSlotsClear(candidateRoutes, others, sidesOf, previous) {
    const entries = [...others, ...candidateRoutes];
    for (const candidate of candidateRoutes) {
      const sides = sidesOf(candidate.conn);
      for (const [componentId, side, point, field, index] of [
        [candidate.conn.from, sides.fromSide, candidate.points[0], 'fromSide', 0],
        [candidate.conn.to, sides.toSide, candidate.points.at(-1), 'toSide', -1],
      ]) {
        const prior = previous?.points.at(index);
        if (prior && previous.sides[field] === side && point[0] === prior[0] && point[1] === prior[1]) continue;
        const coordinate = side === 'left' || side === 'right' ? 1 : 0;
        for (const other of entries) {
          if (other.conn === candidate.conn) continue;
          const otherSides = sidesOf(other.conn);
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
  }

  const jogs = points => points.slice(3).flatMap((d, offset) => {
    const [a, b, c] = points.slice(offset, offset + 3);
    const axis = a[0] === b[0] ? 1 : 0;
    return b[axis] === c[axis] && c[1 - axis] === d[1 - axis]
      && (b[axis] - a[axis]) * (d[axis] - c[axis]) > 0
      && Math.abs(c[1 - axis] - b[1 - axis]) < 28 ? [{ offset, axis }] : [];
  });

  // Work on the finished plan. Changing a port during the greedy pass can
  // steal a later route's corridor or change an authored route's fallback.
  function simplifyFinishedRoutes(viewBox, borders, accept, detachedLabels) {
    const entries = routedEntries();
    const withLane = (point, axis, lane) => axis ? [point[0], lane] : [lane, point[1]];
    const frameRuns = points => borders.flatMap(border => [...closeParallelRuns(points, [border.start, border.end], 8)]
      .filter(run => run.overlap >= 8));
    let compositions = 48;
    for (const entry of entries) {
      const { conn, points } = entry;
      if (!compositions) break;
      if (conn.from === conn.to || hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
          || [conn.fromSide, conn.toSide].some(side => side && side !== 'auto')) continue;
      const runs = frameRuns(points);
      const detached = points.length === 2 ? detachedLabels?.get(conn) : null;
      if (detachedLabels ? !detached : points.length <= 2 && !runs.length) continue;
      const wiggles = jogs(points);
      const oldSides = selectedSides.get(conn);
      const from = components.get(conn.from);
      const to = components.get(conn.to);
      const candidates = [];
      const add = (points, sides = oldSides) => candidates.push({ points: normalizeRoutePoints(points), sides });
      const facing = facingPortCorridor(from, to);
      const others = entries.filter(other => other !== entry);
      if (facing) {
        const { fromSide, toSide, axis, low, high } = facing;
        if (low <= high) {
          const start = anchor(from, fromSide);
          const end = anchor(to, toSide);
          const mid = (low + high) / 2;
          const lanes = [mid, start[axis], end[axis], points[0][axis], points.at(-1)[axis],
            (low + mid) / 2, (mid + high) / 2, low, high];
          // Include the edges of occupied slots and card shadows. A clear
          // lane can sit between a spread port and the edge of the overlap.
          const cuts = [];
          for (const other of others) {
            const sides = selectedSides.get(other.conn);
            for (const [id, side, point] of [[other.conn.from, sides.fromSide, other.points[0]],
              [other.conn.to, sides.toSide, other.points.at(-1)]]) {
              if ((id === conn.from && side === fromSide) || (id === conn.to && side === toSide)) {
                const spacing = portSpacing(conn, other.conn);
                cuts.push(point[axis] - spacing, point[axis] + spacing);
              }
            }
          }
          const min = Math.min(start[1 - axis], end[1 - axis]);
          const max = Math.max(start[1 - axis], end[1 - axis]);
          for (const box of components.values()) {
            if (box === from || box === to) continue;
            const [start, size, edge, span] = axis
              ? [box.x, box.width, box.y, box.height] : [box.y, box.height, box.x, box.width];
            if (start <= max + 2 && start + size >= min - 2) cuts.push(edge - 3, edge + span + 3);
          }
          lanes.push(...cuts.filter(lane => lane > low && lane < high)
            .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b).slice(0, 12));
          if (detached) {
            const center = axis ? detached.y + detached.height / 2 : detached.x + detached.width / 2;
            lanes.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
          }
          for (const lane of new Set(lanes.map(value => Math.max(low, Math.min(high, value))))) {
            add([withLane(start, axis, lane), withLane(end, axis, lane)], { fromSide, toSide });
          }
        }
      }
      for (const { offset, axis } of wiggles) {
        const [a, , , d] = points.slice(offset, offset + 4);
        for (const lane of [a[1 - axis], d[1 - axis]]) {
          add([...points.slice(0, offset), withLane(a, 1 - axis, lane),
            withLane(d, 1 - axis, lane), ...points.slice(offset + 4)]);
        }
      }
      for (const { index, across, separation, gap } of runs) {
        const border = points[index][across] - separation;
        for (const lane of [border - READABLE_FRAME_GAP, border + READABLE_FRAME_GAP, border - gap, border + gap]) {
          add(points.map((point, i) => i === index || i === index + 1 ? withLane(point, across, lane) : point));
        }
      }
      if (points.length >= 4) {
        // The earlier elbow sweep uses provisional label reservations. Retry
        // the natural elbows against the final masks and occupied ports.
        for (const axis of [0, 1]) {
          const fromSide = axis ? (to.cy < from.cy ? 'top' : 'bottom') : (to.cx < from.cx ? 'left' : 'right');
          const toSide = axis ? (to.cx < from.cx ? 'right' : 'left') : (to.cy < from.cy ? 'bottom' : 'top');
          const start = anchor(from, fromSide);
          const end = anchor(to, toSide);
          const ports = (point, box, side, across, previous, oldSide) => [...new Set([
            point[across], ...(side === oldSide ? [previous[across]] : []), ...portLaneLimits(box, across),
          ])].map(lane => withLane(point, across, lane));
          for (const first of ports(start, from, fromSide, 1 - axis, points[0], oldSides.fromSide)) {
            for (const last of ports(end, to, toSide, axis, points.at(-1), oldSides.toSide)) {
              add([first, withLane(first, axis, last[axis]), last], { fromSide, toSide });
            }
          }
        }
      }
      if (!candidates.length) continue;
      const oldBudget = routeBudgetMetrics({ routedRelations: [entry] });
      const oldLength = routeLength(points);
      const approach = path => routeLength(path.slice(-2));
      const minApproach = Math.min(approach(points), runs.length ? microSegmentPx : Math.max(16, 9 * relationshipStroke(conn)));
      let crossings;
      const seen = new Set();
      let attempts = 8;
      for (const { points: next, sides } of candidates) {
        if (!attempts || !compositions) break;
        const { fromSide, toSide } = sides;
        const key = JSON.stringify(next);
        if (seen.has(key)) continue;
        seen.add(key);
        if (next.length < 2 || next.length > points.length || frameRuns(next).length
            || approach(next) < minApproach || (!runs.length && routeLength(next) > oldLength + 0.0001)
            || jogs(next).length > wiggles.length
            || !next.every(([x, y]) => x >= 0 && y >= 0 && x <= viewBox[0] && y <= viewBox[1])
            || !portHasCornerClearance(from, fromSide, next[0]) || !portHasCornerClearance(to, toSide, next.at(-1))
            || !endpointSlotsClear([{ conn, points: next }], others,
              other => other === conn ? sides : selectedSides.get(other), { points, sides: oldSides })
            || !routeIsClear(conn, { points: next }, { from, to, ...sides }, others, [])) continue;
        const nextBudget = routeBudgetMetrics({ routedRelations: [{ points: next }] });
        crossings ??= others.map(other => crossingPoints(points, other));
        if (nextBudget.routesOverSuggestedStretch > oldBudget.routesOverSuggestedStretch
            || others.some((other, index) => crossingPoints(next, other, crossings[index] + 1) > crossings[index]
              || [...closeParallelRuns(next, other.points, 3)].some(run => run.overlap >= 8))) continue;
        attempts -= 1;
        compositions -= 1;
        const routed = { points: next, d: roundedPath(next, 8) };
        if (!accept(conn, routed, sides, runs.length > 0, Boolean(detached))) continue;
        cachePath(conn, routed, sides);
        entry.points = next;
        break;
      }
    }
  }

  // Compare finished geometry with the complete scene. Each accepted change
  // removes a counted signal and preserves bend counts, jogs and previously
  // uncrossed pairs. A pair can exchange space before either route is installed.
  function repairFinishedRoutes(viewBox, borders, accept) {
    const entries = routedEntries();
    const movable = entry => entry.conn.from !== entry.conn.to
      && !hasAuthoredRouteGeometry(entry.conn) && !hasAuthoredLabelPlacement(entry.conn)
      && [entry.conn.fromSide, entry.conn.toSide].every(side => !side || side === 'auto');
    const crossing = (a, b) => crossingPoints(a.points, b, 1);
    const budget = entry => routeBudgetMetrics({ routedRelations: [entry] });
    const budgets = new Map(entries.map(entry => [entry.conn, budget(entry)]));
    const crossingPeers = entry => entries.filter(peer => peer !== entry && crossing(entry, peer));
    const flagged = entries.filter(entry => {
      if (!movable(entry)) return false;
      const { routesOverSuggestedBends, routesOverSuggestedStretch } = budgets.get(entry.conn);
      return routesOverSuggestedBends || routesOverSuggestedStretch || crossingPeers(entry).length;
    });
    if (!flagged.length) return;

    const terminal = points => routeLength(points.slice(-2));
    const axisOf = side => Number(side === 'left' || side === 'right');
    const onLane = (port, axis, lane) => axis ? [port[0], lane] : [lane, port[1]];
    let probes = 12_000;
    let compositions = 40;
    function alternatives(entry, peers, limit, joint) {
      const { conn, points: before } = entry;
      const oldSides = selectedSides.get(conn);
      const { routesOverSuggestedBends: bends, routesOverSuggestedStretch: stretch } = budgets.get(conn);
      const crossed = new Set(peers.filter(peer => crossing(entry, peer)));
      const minimumApproach = Math.min(terminal(before), Math.max(16, 9 * relationshipStroke(conn)));
      const oldLength = routeLength(before);
      const maxPoints = before.length;
      const oldJogs = jogs(before).length;
      const fromBox = components.get(conn.from);
      const toBox = components.get(conn.to);
      const seen = new Set([JSON.stringify(before)]);
      const candidates = [];
      function consider(raw, sides, from, to) {
        if (!limit || !probes) return;
        limit -= 1;
        probes -= 1;
        const points = normalizeRoutePoints(raw);
        if (points.length < 2 || points.length > maxPoints || terminal(points) < minimumApproach
          || points.slice(1).some((end, index) => end[0] !== points[index][0] && end[1] !== points[index][1])
          || points.some(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1])) return;
        if (!joint && !crossed.size && !stretch && points.length > 4) return;
        const length = routeLength(points);
        const metrics = budget({ points });
        const bendGain = bends - metrics.routesOverSuggestedBends;
        const stretchGain = stretch - metrics.routesOverSuggestedStretch;
        if (bendGain < 0 || stretchGain < 0 || jogs(points).length > oldJogs || parallelFrameRunLength(points, borders)) return;
        const key = JSON.stringify(points);
        if (seen.has(key)) return;
        seen.add(key);
        const next = { conn, points, sides };
        if (!portHasCornerClearance(from, sides.fromSide, points[0])
          || !portHasCornerClearance(to, sides.toSide, points.at(-1))
          || !endpointSlotsClear([next], peers, other => other === conn ? sides : selectedSides.get(other), { points: before, sides: oldSides })
          || !routeIsClear(conn, next, { from, to, ...sides }, peers, [])) return;
        let removed = crossed.size;
        for (const peer of peers) {
          if (!crossing(next, peer)) continue;
          if (!crossed.has(peer)) return;
          removed -= 1;
        }
        const gain = bendGain + stretchGain + removed;
        if ((!joint && !gain) || (!gain && length > oldLength + interiorSegmentPx)) return;
        candidates.push({ ...next, metrics, gain, length });
      }
      function ports(box, side, axis, preferred, oldPort) {
        const [low, high] = portLaneLimits(box, axis);
        const values = [preferred[axis], oldPort[axis], low, high, (low + high) / 2];
        for (const { conn: other, field, sideField } of incidentEndpoints.get(box.id) || []) {
          if (other === conn || selectedSides.get(other)[sideField] !== side) continue;
          const value = pathCache.get(other).points.at(field === 'from' ? 0 : -1)[axis];
          const gap = portSpacing(conn, other);
          values.push(value - gap, value + gap);
        }
        return [...new Set(values.filter(value => value >= low && value <= high))].slice(0, 8);
      }
      for (let index = 1; index + 1 < before.length; index += 1) {
        const first = before[index - 1];
        const last = before[index];
        const axis = Number(first[1] === last[1]);
        const lane = first[axis];
        // Sliding a whole leg keeps the neighbouring legs perpendicular.
        const offsets = [-READABLE_FRAME_GAP, -4, 4, READABLE_FRAME_GAP];
        const cuts = [before[index - 2]?.[axis], before[index + 1][axis], ...offsets.map(offset => lane + offset)];
        for (const cut of cuts) {
          if (cut === undefined) continue;
          consider(before.map((point, i) => i === index - 1 || i === index ? onLane(point, axis, cut) : point),
            oldSides, fromBox, toBox);
        }
      }
      for (const sides of candidateSidePairs(conn)) {
        if (!limit || !probes) break;
        const { from, to, start, end, fromSide, toSide } = connectionGeometry(conn, sides);
        const sourceAxis = axisOf(fromSide);
        const targetAxis = axisOf(toSide);
        const along = 1 - sourceAxis;
        const starts = ports(from, fromSide, sourceAxis, start, before[0]);
        const ends = ports(to, toSide, targetAxis, end, before.at(-1));
        if (sourceAxis === targetAxis) {
          const [low, high] = portLaneLimits(to, targetAxis);
          for (const lane of starts) if (lane >= low && lane <= high) {
            consider([onLane(start, sourceAxis, lane), onLane(end, targetAxis, lane)], sides, from, to);
          }
        }
        const launch = outwardStub(start, fromSide, interiorSegmentPx);
        const land = outwardStub(end, toSide, Math.max(interiorSegmentPx, minimumApproach));
        const channels = [...new Set([(start[along] + end[along]) / 2, launch[along], land[along],
          ...before.map(point => point[along])])];
        // Start with the geometry chosen by the ordinary router, then look
        // beyond its first bridge without reopening the full obstacle grid.
        consider(routedForGeometryWithoutGrid(conn, peers, { from, to, start, end, ...sides }).points, sides, from, to);
        for (const source of starts) for (const target of ends) {
          const first = onLane(start, sourceAxis, source);
          const last = onLane(end, targetAxis, target);
          if (sourceAxis !== targetAxis) {
            consider([first, onLane(first, along, last[along]), last], sides, from, to);
            if (maxPoints >= 5 && (crossed.size || stretch || joint)) {
              const firstStub = outwardStub(first, fromSide, interiorSegmentPx);
              const lastStub = outwardStub(last, toSide, Math.max(interiorSegmentPx, minimumApproach));
              for (const distance of [0, interiorSegmentPx]) {
                const firstTurn = outwardStub(firstStub, fromSide, distance);
                const lastTurn = outwardStub(lastStub, toSide, distance);
                consider([first, firstTurn, onLane(firstTurn, sourceAxis, lastTurn[sourceAxis]), lastTurn, last], sides, from, to);
              }
            }
          } else {
            for (const channel of channels) {
              consider([first, onLane(first, along, channel), onLane(last, along, channel), last], sides, from, to);
            }
          }
        }
      }
      return candidates.sort((a, b) => b.gain - a.gain || a.points.length - b.points.length || a.length - b.length);
    }

    function install(candidates) {
      if (!compositions) return false;
      compositions -= 1;
      const changes = candidates.map(({ conn, points, sides }) => ({ conn, sides, routed: { points, d: roundedPath(points, 8) } }));
      if (!accept(changes)) return false;
      for (const [index, { conn, sides, routed }] of changes.entries()) {
        cachePath(conn, routed, sides);
        entries.find(entry => entry.conn === conn).points = routed.points;
        budgets.set(conn, candidates[index].metrics);
      }
      return true;
    }

    for (const entry of flagged) {
      if (!compositions || !probes) break;
      const peers = entries.filter(peer => peer !== entry);
      const { routesOverSuggestedBends, routesOverSuggestedStretch } = budgets.get(entry.conn);
      if (!routesOverSuggestedBends && !routesOverSuggestedStretch && !peers.some(peer => crossing(entry, peer))) continue;
      for (const candidate of alternatives(entry, peers, 1550, false).slice(0, 5)) {
        if (install([candidate])) break;
      }
    }
    let pairProbes = 6;
    for (const entry of flagged) {
      for (const peer of crossingPeers(entry)) {
        if (!pairProbes || !compositions || !probes) return;
        if (!movable(peer) || flagged.indexOf(peer) < flagged.indexOf(entry)) continue;
        pairProbes -= 1;
        const others = entries.filter(other => other !== entry && other !== peer);
        const first = alternatives(entry, others, 950, true).slice(0, 12);
        const second = alternatives(peer, others, 950, true).slice(0, 12);
        pairs: for (const a of first) for (const b of second) {
          const sidesOf = conn => conn === a.conn ? a.sides : conn === b.conn ? b.sides : selectedSides.get(conn);
          if (crossing(a, b) || routeOverlapsResolved(a.conn, a.points, [b])
            || routeOverlapsResolved(b.conn, b.points, [a]) || !endpointSlotsClear([a, b], others, sidesOf)) continue;
          if (install([a, b])) break pairs;
        }
      }
    }
  }

  function routedForGeometryWithoutGrid(conn, peers, geometry) {
    allowGridSearch = false;
    try {
      return routedForGeometry(conn, peers, geometry);
    } finally {
      allowGridSearch = true;
    }
  }

  // Keep the current plan unless a bounded port and lane search can expose
  // a masked approach without adding a crossover or exceeding a route budget.
  function repairMaskedApproach(conn, [width, height], accept) {
    if (hasAuthoredRouteGeometry(conn) || hasAuthoredLabelPlacement(conn)
        || [conn.fromSide, conn.toSide].some(side => side && side !== 'auto')) return false;
    const current = pathFor(conn);
    if (current.points.length !== 4) return false;
    const sides = selectedSides.get(conn);
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    const others = routedEntries().filter(entry => entry.conn !== conn);
    const crossingCounts = others.map(other => crossingPoints(current.points, other));
    const budget = routeBudgetMetrics({ routedRelations: [current] });
    const currentLength = routeLength(current.points);
    const candidates = [];
    const verticalFace = side => side === 'top' || side === 'bottom';
    const withLane = (point, axis, lane) => axis ? [point[0], lane] : [lane, point[1]];
    const add = (points, fromSide, toSide) => {
      candidates.push({ points, sides: { fromSide, toSide }, length: routeLength(points) });
    };

    const first = current.points[0];
    const last = current.points.at(-1);
    if (sides.fromSide !== sides.toSide && verticalFace(sides.fromSide) === verticalFace(sides.toSide)) {
      const axis = verticalFace(sides.fromSide) ? 0 : 1;
      for (const lane of new Set([last[axis], first[axis]])) {
        add([withLane(first, axis, lane), withLane(last, axis, lane)], sides.fromSide, sides.toSide);
      }
    }
    // An outside lane can expose a label that cannot fit inside the facing
    // corridor. Test the near lane at the same bend count as the dogleg.
    for (const side of SIDE_ORDER) {
      const axis = verticalFace(side) ? 0 : 1;
      const start = anchor(from, side);
      const end = anchor(to, side);
      const outward = side === 'top' || side === 'left' ? -1 : 1;
      const lane = (outward < 0 ? Math.min : Math.max)(start[1 - axis], end[1 - axis])
        + outward * AUTOMATIC_PORT_CORNER_GUTTER;
      for (const fromLane of [start[axis], ...portLaneLimits(from, axis)]) {
        for (const toLane of [end[axis], ...portLaneLimits(to, axis)]) {
          const source = withLane(start, axis, fromLane);
          const target = withLane(end, axis, toLane);
          add([source, withLane(source, 1 - axis, lane), withLane(target, 1 - axis, lane), target], side, side);
        }
      }
    }
    let remainingCompositions = 8;
    for (const { points, sides, length } of candidates.sort((a, b) => a.length - b.length)) {
      const { fromSide, toSide } = sides;
      const nextBudget = routeBudgetMetrics({ routedRelations: [{ points }] });
      const next = { conn, points };
      if (points.some(([x, y]) => x < 0 || y < 0 || x > width || y > height)
          || nextBudget.routesOverSuggestedBends > budget.routesOverSuggestedBends
          || nextBudget.routesOverSuggestedStretch > budget.routesOverSuggestedStretch
          || !portHasCornerClearance(from, fromSide, points[0])
          || !portHasCornerClearance(to, toSide, points.at(-1))
          || !endpointSlotsClear([next], others, other => selectedSides.get(other))
          || !routeIsClear(conn, next, { from, to, ...sides }, others, [])
          || others.some((other, index) => crossingPoints(points, other) > crossingCounts[index])) continue;
      if (!remainingCompositions) break;
      remainingCompositions -= 1;
      const routed = { points, d: roundedPath(points, 8) };
      if (!accept(routed, sides, length < currentLength)) continue;
      cachePath(conn, routed, sides);
      return true;
    }
    return false;
  }

  function planIsClear([right, bottom], { checkProvisionalLabels = true } = {}) {
    const entries = routedEntries();
    const labels = checkProvisionalLabels ? reservedLabels : [];
    const fits = ([x, y]) => x >= 0 && y >= 0 && x <= right + 0.0001 && y <= bottom + 0.0001;
    return entries.every(entry => {
      const { conn, points } = entry;
      const geometry = { ...selectedSides.get(conn), from: components.get(conn.from), to: components.get(conn.to) };
      const others = entries.filter(other => other !== entry);
      if (!points.every(fits) || !routeIsClear(conn, entry, geometry, others, labels)) return false;
      if (!checkProvisionalLabels || !conn.label) return true;
      const rect = reservedLabels.find(label => label.conn === conn)?.rect;
      return rect && fits([rect.x, rect.y]) && fits([rect.x + rect.width, rect.y + rect.height])
        && labelFollowsRoute(rect, points, others)
        && !reservedLabels.some(label => label.conn !== conn && rectsOverlap(label.rect, rect))
        && ![...components.values()].some(box => rectsOverlap(box, rect, -2));
    });
  }

  function routingMetrics() {
    planRoutes();
    return { ...planningMetrics };
  }

  return { ports: automaticPorts, pathFor, connectionSides, inferredSides, connectionEndpointSide, routingMetrics, crossingPairs, planIsClear, repairMaskedApproach, simplifyFinishedRoutes, repairFinishedRoutes };
}
