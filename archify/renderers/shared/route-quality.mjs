import { recordDiagnostic } from './diagnostics.mjs';
import {
  asArray,
  isFinitePoint,
  normalizeRoutePoints,
  properSegmentIntersection,
  segmentIntersectsRect,
} from './geometry.mjs';

const DEFAULTS = Object.freeze({
  clearance: 2,
  minimumDetourRatio: 2.5,
  minimumExcessLengthPx: 200,
  minimumEmptyExcursionPx: 96,
  maximumObstacleCount: 80,
  sharedCorridorMinimumPx: 32,
});

const OUTWARD = Object.freeze({
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
});

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function pointKey(point) {
  return `${point[0]}\u0000${point[1]}`;
}

class MinHeap {
  constructor() {
    this.entries = [];
  }

  push(key, distance) {
    const entry = { key, distance };
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].distance <= distance) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop() {
    if (!this.entries.length) return null;
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!this.entries.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const child = right < this.entries.length
        && this.entries[right].distance < this.entries[left].distance ? right : left;
      if (this.entries[child].distance >= last.distance) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function orthogonalLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    if (x1 !== x2 && y1 !== y2) return null;
    total += Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }
  return total;
}

function inferredSide(points, endpoint) {
  if (points.length < 2) return null;
  const start = endpoint === 'source' ? points[0] : points.at(-2);
  const end = endpoint === 'source' ? points[1] : points.at(-1);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (endpoint === 'source') {
    if (dx > 0 && dy === 0) return 'right';
    if (dx < 0 && dy === 0) return 'left';
    if (dy > 0 && dx === 0) return 'bottom';
    if (dy < 0 && dx === 0) return 'top';
  } else {
    if (dx > 0 && dy === 0) return 'left';
    if (dx < 0 && dy === 0) return 'right';
    if (dy > 0 && dx === 0) return 'top';
    if (dy < 0 && dx === 0) return 'bottom';
  }
  return null;
}

function moveOutward(point, side, distance) {
  const [dx, dy] = OUTWARD[side] || [0, 0];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function expandedRect(rect, clearance) {
  return {
    id: rect.id,
    x: rect.x - clearance,
    y: rect.y - clearance,
    width: rect.width + clearance * 2,
    height: rect.height + clearance * 2,
  };
}

function boundsForRects(rects) {
  const usable = [...rects].filter((rect) => (
    rect && isFinitePoint(rect.x, rect.y, rect.width, rect.height)
      && rect.width >= 0 && rect.height >= 0
  ));
  if (!usable.length) return null;
  const left = Math.min(...usable.map((rect) => rect.x));
  const top = Math.min(...usable.map((rect) => rect.y));
  const right = Math.max(...usable.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...usable.map((rect) => rect.y + rect.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function boundsForPoints(points) {
  if (!points.length) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function outsideExcursion(routeBounds, contentBounds) {
  if (!routeBounds || !contentBounds) return null;
  const sides = {
    left: Math.max(0, contentBounds.left - routeBounds.left),
    top: Math.max(0, contentBounds.top - routeBounds.top),
    right: Math.max(0, routeBounds.right - contentBounds.right),
    bottom: Math.max(0, routeBounds.bottom - contentBounds.bottom),
  };
  return { ...sides, maximum: Math.max(...Object.values(sides)) };
}

function pointDistanceFromRect(point, rect) {
  const dx = Math.max(rect.x - point[0], 0, point[0] - (rect.x + rect.width));
  const dy = Math.max(rect.y - point[1], 0, point[1] - (rect.y + rect.height));
  return dx + dy;
}

function emptyControlPointClearance(points, contentRects) {
  const controls = points.slice(1, -1);
  const rects = [...contentRects].filter((rect) => (
    rect && isFinitePoint(rect.x, rect.y, rect.width, rect.height)
      && rect.width >= 0 && rect.height >= 0
  ));
  if (!controls.length || !rects.length) return null;
  const distances = controls.map((point) => Math.min(
    ...rects.map((rect) => pointDistanceFromRect(point, rect)),
  ));
  const maximum = Math.max(...distances);
  return { maximum, point: controls[distances.indexOf(maximum)] };
}

function pointBlocked(point, obstacles) {
  return obstacles.some((rect) => (
    point[0] >= rect.x && point[0] <= rect.x + rect.width
      && point[1] >= rect.y && point[1] <= rect.y + rect.height
  ));
}

function segmentBlocked(start, end, obstacles) {
  return obstacles.some((rect) => segmentIntersectsRect({ start, end }, rect));
}

function segmentConflictsWithAvoided(start, end, avoidedSegments, minimumOverlapPx) {
  return avoidedSegments.some((segment) => (
    properSegmentIntersection(start, end, segment.start, segment.end)
      || orthogonalTouchOnAvoidedInterior(start, end, segment.start, segment.end)
      || collinearOverlap(start, end, segment.start, segment.end) >= minimumOverlapPx
  ));
}

function orthogonalTouchOnAvoidedInterior(start, end, avoidedStart, avoidedEnd) {
  const epsilon = 0.0001;
  const candidateHorizontal = Math.abs(start[1] - end[1]) <= epsilon;
  const candidateVertical = Math.abs(start[0] - end[0]) <= epsilon;
  const avoidedHorizontal = Math.abs(avoidedStart[1] - avoidedEnd[1]) <= epsilon;
  const avoidedVertical = Math.abs(avoidedStart[0] - avoidedEnd[0]) <= epsilon;
  if (candidateHorizontal && avoidedVertical) {
    const x = avoidedStart[0];
    const y = start[1];
    return x >= Math.min(start[0], end[0]) - epsilon
      && x <= Math.max(start[0], end[0]) + epsilon
      && y > Math.min(avoidedStart[1], avoidedEnd[1]) + epsilon
      && y < Math.max(avoidedStart[1], avoidedEnd[1]) - epsilon;
  }
  if (candidateVertical && avoidedHorizontal) {
    const x = start[0];
    const y = avoidedStart[1];
    return y >= Math.min(start[1], end[1]) - epsilon
      && y <= Math.max(start[1], end[1]) + epsilon
      && x > Math.min(avoidedStart[0], avoidedEnd[0]) + epsilon
      && x < Math.max(avoidedStart[0], avoidedEnd[0]) - epsilon;
  }
  return false;
}

function pointOnSegmentInterior(point, start, end) {
  const epsilon = 0.0001;
  const cross = (end[0] - start[0]) * (point[1] - start[1])
    - (end[1] - start[1]) * (point[0] - start[0]);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point[0] - start[0]) * (point[0] - end[0])
    + (point[1] - start[1]) * (point[1] - end[1]);
  return dot < -epsilon;
}

function pointOnAvoidedInterior(point, avoidedSegments) {
  return avoidedSegments.some((segment) => (
    pointOnSegmentInterior(point, segment.start, segment.end)
  ));
}

function writeGridMetrics(metrics, patch) {
  if (!metrics || typeof metrics !== 'object') return;
  Object.assign(metrics, patch);
}

export function shortestOrthogonalGridRoute({
  start,
  end,
  points,
  obstacles,
  fromSide,
  toSide,
  clearance,
  maximumObstacleCount,
  endpointStubPx = clearance + 2,
  maximumGridNodes = Infinity,
  avoidedSegments = [],
  minimumAvoidedOverlapPx = 8,
  routeSeparationPx = 8,
  minimumSegmentPx = 8,
  borderSegments = [],
  bendPenaltyPx = 0,
  metrics,
}) {
  writeGridMetrics(metrics, {
    status: 'initializing',
    maximumGridNodes,
    obstacleCount: 0,
    avoidedSegmentCount: 0,
    coordinateCount: 0,
    candidateNodeCount: 0,
    usableNodeCount: 0,
    graphEdgeCount: 0,
    visitedNodeCount: 0,
  });
  if (!OUTWARD[fromSide] || !OUTWARD[toSide]) {
    writeGridMetrics(metrics, { status: 'unsupported-endpoint-side' });
    return null;
  }
  const startStub = moveOutward(start, fromSide, endpointStubPx);
  const endStub = moveOutward(end, toSide, endpointStubPx);
  // The graph may legally leave the initial endpoint bounds to find a clear
  // corridor. Keep every bounded obstacle and occupied relationship visible
  // to that search; filtering them against the initial box lets a detour walk
  // straight through geometry that only becomes relevant after it leaves the
  // box. The explicit obstacle/node budgets below keep this deterministic.
  const expanded = [...obstacles]
    .filter((rect) => rect && isFinitePoint(rect.x, rect.y, rect.width, rect.height))
    .map((rect) => expandedRect(rect, clearance));
  const relevantAvoidedSegments = [...avoidedSegments]
    .filter((segment) => segment?.start && segment?.end);
  // Frame borders may be crossed perpendicularly but never borrowed as a
  // corridor: the composition gate rejects any collinear run along them.
  const relevantBorderSegments = [...borderSegments]
    .filter((segment) => segment?.start && segment?.end);
  writeGridMetrics(metrics, {
    obstacleCount: expanded.length,
    avoidedSegmentCount: relevantAvoidedSegments.length,
  });
  if (expanded.length > maximumObstacleCount) {
    writeGridMetrics(metrics, { status: 'obstacle-budget-exceeded' });
    return null;
  }

  const xs = new Set([startStub[0], endStub[0], ...points.map(([x]) => x)]);
  const ys = new Set([startStub[1], endStub[1], ...points.map(([, y]) => y)]);
  for (const rect of expanded) {
    xs.add(rect.x - 1);
    xs.add(rect.x + rect.width + 1);
    ys.add(rect.y - 1);
    ys.add(rect.y + rect.height + 1);
  }
  for (const segment of relevantAvoidedSegments) {
    const [segmentStart, segmentEnd] = [segment.start, segment.end];
    xs.add(segmentStart[0]);
    xs.add(segmentEnd[0]);
    ys.add(segmentStart[1]);
    ys.add(segmentEnd[1]);
    if (Math.abs(segmentStart[0] - segmentEnd[0]) <= 0.0001) {
      xs.add(segmentStart[0] - routeSeparationPx);
      xs.add(segmentStart[0] + routeSeparationPx);
    }
    if (Math.abs(segmentStart[1] - segmentEnd[1]) <= 0.0001) {
      ys.add(segmentStart[1] - routeSeparationPx);
      ys.add(segmentStart[1] + routeSeparationPx);
    }
  }
  for (const segment of relevantBorderSegments) {
    if (Math.abs(segment.start[0] - segment.end[0]) <= 0.0001) {
      xs.add(segment.start[0] - routeSeparationPx);
      xs.add(segment.start[0] + routeSeparationPx);
    }
    if (Math.abs(segment.start[1] - segment.end[1]) <= 0.0001) {
      ys.add(segment.start[1] - routeSeparationPx);
      ys.add(segment.start[1] + routeSeparationPx);
    }
  }
  // Grid lines closer than a readable segment would let the search emit a
  // micro jog between two obstacle edges; keep the endpoint stubs and coalesce
  // the rest so every turn the route can take is at least one segment long.
  const coalesce = (values, keep) => values.sort((a, b) => a - b).filter((value, index, sorted) => (
    index === 0 || keep.has(value) || value - sorted[index - 1] >= minimumSegmentPx
  ));
  const orderedX = coalesce([...xs], new Set([startStub[0], endStub[0]]));
  const orderedY = coalesce([...ys], new Set([startStub[1], endStub[1]]));
  const candidateNodeCount = orderedX.length * orderedY.length;
  writeGridMetrics(metrics, {
    coordinateCount: orderedX.length + orderedY.length,
    candidateNodeCount,
  });
  if (candidateNodeCount > maximumGridNodes) {
    writeGridMetrics(metrics, { status: 'node-budget-exceeded' });
    return null;
  }
  const nodes = new Map();
  for (const x of orderedX) {
    for (const y of orderedY) {
      const point = [x, y];
      if (!pointBlocked(point, expanded)
          && !pointOnAvoidedInterior(point, relevantAvoidedSegments)) {
        nodes.set(pointKey(point), point);
      }
    }
  }
  writeGridMetrics(metrics, { usableNodeCount: nodes.size });
  if (!nodes.has(pointKey(startStub)) || !nodes.has(pointKey(endStub))) {
    writeGridMetrics(metrics, { status: 'endpoint-blocked' });
    return null;
  }

  const adjacency = new Map([...nodes.keys()].map((key) => [key, []]));
  let graphEdgeCount = 0;
  const connectLine = (line, axis) => {
    for (let index = 0; index < line.length - 1; index += 1) {
      const left = line[index];
      const right = line[index + 1];
      if (segmentBlocked(left, right, expanded)) continue;
      if (segmentConflictsWithAvoided(
        left,
        right,
        relevantAvoidedSegments,
        minimumAvoidedOverlapPx,
      )) continue;
      if (relevantBorderSegments.some((segment) => (
        collinearOverlap(left, right, segment.start, segment.end) > 0.0001
      ))) continue;
      const distance = Math.abs(right[0] - left[0]) + Math.abs(right[1] - left[1]);
      const leftKey = pointKey(left);
      const rightKey = pointKey(right);
      adjacency.get(leftKey).push([rightKey, distance, axis === 'h' ? 'R' : 'D']);
      adjacency.get(rightKey).push([leftKey, distance, axis === 'h' ? 'L' : 'U']);
      graphEdgeCount += 1;
    }
  };
  for (const y of orderedY) {
    connectLine(orderedX.map((x) => nodes.get(pointKey([x, y]))).filter(Boolean), 'h');
  }
  for (const x of orderedX) {
    connectLine(orderedY.map((y) => nodes.get(pointKey([x, y]))).filter(Boolean), 'v');
  }
  writeGridMetrics(metrics, { graphEdgeCount });

  // The search state carries the incoming direction so a turn can cost extra
  // and a reversal is never taken: the pure shortest path hugs every obstacle
  // corner with a staircase of short jogs, while a bend-penalised one takes
  // the same corridor in a few long strokes. The first stub already leaves
  // the endpoint along its side and the last one arrives along the end side.
  const directionOf = ([dx, dy]) => (dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'D' : 'U');
  const opposite = { R: 'L', L: 'R', D: 'U', U: 'D' };
  const stateKey = (key, direction) => `${key}|${direction}`;
  const sourceAxis = directionOf(OUTWARD[fromSide]);
  const targetAxis = opposite[directionOf(OUTWARD[toSide])];
  const source = pointKey(startStub);
  const target = pointKey(endStub);
  const sourceState = stateKey(source, sourceAxis);
  const distances = new Map([[sourceState, 0]]);
  const previous = new Map();
  const queue = new MinHeap();
  queue.push(sourceState, 0);
  let visitedNodeCount = 0;
  let targetState = null;
  while (queue.entries.length) {
    const next = queue.pop();
    const current = next.key;
    const currentDistance = next.distance;
    if (currentDistance !== distances.get(current)) continue;
    visitedNodeCount += 1;
    const [currentNode, currentAxis] = current.split('|');
    if (currentNode === target) {
      // Arriving on the wrong axis costs one final turn onto the end stub.
      const arrival = currentDistance + (currentAxis === targetAxis ? 0 : bendPenaltyPx);
      if (targetState == null || arrival < targetState.distance) {
        targetState = { key: current, distance: arrival };
      }
      if (currentAxis === targetAxis || bendPenaltyPx === 0) break;
      continue;
    }
    if (targetState && currentDistance >= targetState.distance) break;
    for (const [neighbor, weight, axis] of adjacency.get(currentNode) || []) {
      if (axis === opposite[currentAxis]) continue;
      const candidate = currentDistance + weight + (axis === currentAxis ? 0 : bendPenaltyPx);
      const neighborState = stateKey(neighbor, axis);
      if (candidate >= (distances.get(neighborState) ?? Infinity)) continue;
      distances.set(neighborState, candidate);
      previous.set(neighborState, current);
      queue.push(neighborState, candidate);
    }
  }
  writeGridMetrics(metrics, { visitedNodeCount });
  if (!targetState) {
    writeGridMetrics(metrics, { status: 'no-route' });
    return null;
  }
  const reversed = [];
  for (let key = targetState.key; key; key = previous.get(key)) {
    reversed.push(nodes.get(key.split('|')[0]));
    if (key === sourceState) break;
  }
  if (pointKey(reversed.at(-1)) !== source) {
    writeGridMetrics(metrics, { status: 'broken-predecessor-chain' });
    return null;
  }
  const shortestPoints = normalizeRoutePoints([start, ...reversed.reverse(), end]);
  writeGridMetrics(metrics, { status: 'routed' });
  return {
    points: shortestPoints,
    length: orthogonalLength(shortestPoints),
    obstacleCount: expanded.length,
  };
}

function collinearOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  if (leftStart[0] === leftEnd[0] && rightStart[0] === rightEnd[0]
      && leftStart[0] === rightStart[0]) {
    return Math.max(0, Math.min(Math.max(leftStart[1], leftEnd[1]), Math.max(rightStart[1], rightEnd[1]))
      - Math.max(Math.min(leftStart[1], leftEnd[1]), Math.min(rightStart[1], rightEnd[1])));
  }
  if (leftStart[1] === leftEnd[1] && rightStart[1] === rightEnd[1]
      && leftStart[1] === rightStart[1]) {
    return Math.max(0, Math.min(Math.max(leftStart[0], leftEnd[0]), Math.max(rightStart[0], rightEnd[0]))
      - Math.max(Math.min(leftStart[0], leftEnd[0]), Math.min(rightStart[0], rightEnd[0])));
  }
  return 0;
}

function segmentOutsideContent(start, end, contentBounds) {
  if (!contentBounds) return false;
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return midpoint[0] < contentBounds.left || midpoint[0] > contentBounds.right
    || midpoint[1] < contentBounds.top || midpoint[1] > contentBounds.bottom;
}

function sharesOuterCorridor({ relation, relations, pathFor, points, contentBounds, minimumOverlap }) {
  for (const other of asArray(relations)) {
    if (!other || other === relation) continue;
    const related = relation.from === other.from || relation.from === other.to
      || relation.to === other.from || relation.to === other.to;
    if (!related) continue;
    const otherPoints = normalizeRoutePoints(pathFor(other)?.points || []);
    for (let left = 0; left < points.length - 1; left += 1) {
      if (!segmentOutsideContent(points[left], points[left + 1], contentBounds)) continue;
      for (let right = 0; right < otherPoints.length - 1; right += 1) {
        if (collinearOverlap(points[left], points[left + 1], otherPoints[right], otherPoints[right + 1]) >= minimumOverlap) {
          return true;
        }
      }
    }
  }
  return false;
}

function relationshipSubject(diagramType, relationCollection, relationIndex, relation) {
  return {
    diagramType,
    collection: relationCollection,
    index: relationIndex,
    ...(relation.id ? { id: relation.id } : {}),
    from: relation.from,
    to: relation.to,
  };
}

/**
 * Reject conspicuous authored detours without penalizing routes whose length is
 * explained by opaque-node avoidance or a related shared outer corridor.
 */
export function cleanRouteDetourProblems({
  relations,
  obstacles,
  contentRects = obstacles,
  endpointIds,
  pathFor,
  fromSideFor,
  toSideFor,
  diagramType,
  relationCollection,
  profile,
  thresholds = {},
}) {
  if (profile !== 'showcase') return [];
  const policy = { ...DEFAULTS, ...thresholds };
  const obstacleList = [...obstacles];
  const contentBounds = boundsForRects(contentRects);
  const problems = [];
  for (const [relationIndex, relation] of asArray(relations).entries()) {
    if (!relation || !endpointIds?.has(relation.from) || !endpointIds?.has(relation.to)) continue;
    if (!Array.isArray(relation.via) || relation.via.length === 0) continue;
    const points = normalizeRoutePoints(pathFor(relation)?.points || []);
    if (points.length < 3 || !points.every((point) => Array.isArray(point) && isFinitePoint(...point))) continue;
    const actualLength = orthogonalLength(points);
    if (!Number.isFinite(actualLength)) continue;
    const start = points[0];
    const end = points.at(-1);
    const manhattan = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
    if (actualLength < manhattan * policy.minimumDetourRatio
        || actualLength - manhattan < policy.minimumExcessLengthPx) continue;
    const routeBounds = boundsForPoints(points);
    const excursion = outsideExcursion(routeBounds, contentBounds);
    const emptyClearance = emptyControlPointClearance(points, obstacleList);
    if (Math.max(excursion?.maximum || 0, emptyClearance?.maximum || 0)
        < policy.minimumEmptyExcursionPx) continue;
    if (sharesOuterCorridor({
      relation,
      relations,
      pathFor,
      points,
      contentBounds,
      minimumOverlap: policy.sharedCorridorMinimumPx,
    })) continue;

    const fromSide = fromSideFor?.(relation) || inferredSide(points, 'source');
    const toSide = toSideFor?.(relation) || inferredSide(points, 'target');
    const shortest = shortestOrthogonalGridRoute({
      start,
      end,
      points,
      obstacles: obstacleList,
      fromSide,
      toSide,
      clearance: policy.clearance,
      maximumObstacleCount: policy.maximumObstacleCount,
    });
    if (!shortest || !Number.isFinite(shortest.length) || shortest.length <= 0) continue;
    const detourRatio = actualLength / shortest.length;
    const excessLength = actualLength - shortest.length;
    if (detourRatio < policy.minimumDetourRatio || excessLength < policy.minimumExcessLengthPx) continue;

    const relationId = relation.id ? ` id "${relation.id}"` : '';
    const message = `[composition/excessive-route-detour] ${diagramType} ${relationCollection}[${relationIndex}]${relationId} "${relation.from}" -> "${relation.to}" travels ${Math.round(actualLength)}px, ${rounded(detourRatio)}x the ${Math.round(shortest.length)}px shortest obstacle-clearing orthogonal route, and reaches ${Math.round(excursion.maximum)}px beyond the content bounds — remove the distant via corridor or move it close to the connected content.`;
    const supportedFix = 'remove the distant via points and retry automatic routing, or keep the endpoint sides and move the via corridor near the connected nodes while preserving labels and direction';
    recordDiagnostic({
      code: 'composition/excessive-route-detour',
      severity: 'error',
      message,
      subject: relationshipSubject(diagramType, relationCollection, relationIndex, relation),
      evidence: {
        points,
        actualLengthPx: rounded(actualLength),
        shortestLegalPoints: shortest.points,
        shortestLegalLengthPx: rounded(shortest.length),
        detourRatio: rounded(detourRatio),
        excessLengthPx: rounded(excessLength),
        routeBounds,
        contentBounds,
        emptyExcursionPx: excursion,
        emptyControlPointClearancePx: emptyClearance,
        obstacleCount: shortest.obstacleCount,
        thresholds: {
          minimumDetourRatio: policy.minimumDetourRatio,
          minimumExcessLengthPx: policy.minimumExcessLengthPx,
          minimumEmptyExcursionPx: policy.minimumEmptyExcursionPx,
        },
      },
      supportedFixes: [supportedFix],
    });
    problems.push(message);
  }
  return problems;
}
