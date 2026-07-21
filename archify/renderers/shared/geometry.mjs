// Geometry helpers shared by all typed renderers. Every function here is
// pure; renderers own their layout tables and pass measured rects
// ({x, y, width, height, cx, cy}) in.

// In degraded mode (no ajv) a type-wrong top-level field reaches the renderer.
// Coerce non-arrays to [] so the module-level Maps build without throwing and
// the friendly validator checks (which run later) report the real problem.
export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// A computed coordinate must be a finite number; NaN/undefined would silently
// write `<rect x="NaN">` into the output. Used by the validators as a backstop.
export function isFinitePoint(...coords) {
  return coords.every((c) => Number.isFinite(c));
}

export function rectsOverlap(a, b, gap = 0) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

export function segmentIntersectsRect(segment, rect, gap = 0) {
  const box = {
    x1: rect.x - gap,
    y1: rect.y - gap,
    x2: rect.x + rect.width + gap,
    y2: rect.y + rect.height + gap
  };
  const [a, b] = [segment.start, segment.end];
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  return (
    segmentsIntersect(a, b, [box.x1, box.y1], [box.x2, box.y1]) ||
    segmentsIntersect(a, b, [box.x2, box.y1], [box.x2, box.y2]) ||
    segmentsIntersect(a, b, [box.x2, box.y2], [box.x1, box.y2]) ||
    segmentsIntersect(a, b, [box.x1, box.y2], [box.x1, box.y1])
  );
}

// One mechanical quality gate for every renderer-owned relationship path.
// A renderer supplies its semantic obstacle set; source/target boxes are
// always exempt because paths are expected to terminate on their boundaries.
// Containers, lifelines, and other intentionally pass-through geometry should
// simply not be supplied as obstacles.
export function cleanFlowProblems({
  relations,
  obstacles,
  pathFor,
  diagramType,
  relationCollection,
  obstacleKind,
  profile,
  clearance = 2,
  routeHint = 'adjust fromSide/toSide, set route/via or channel coordinates, or move the obstacle'
}) {
  if (!process.env.ARCHIFY_QUALITY_PROFILE && !profile) return [];
  const problems = [];
  const obstacleList = [...obstacles];
  const obstacleIds = new Set(obstacleList.map((obstacle) => obstacle?.id));
  for (const [relationIndex, relation] of asArray(relations).entries()) {
    if (!relation || typeof relation.from !== 'string' || typeof relation.to !== 'string') continue;
    if (!obstacleIds.has(relation.from) || !obstacleIds.has(relation.to)) continue;
    const points = pathFor(relation)?.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    if (!points.every((point) => Array.isArray(point) && point.length === 2 && isFinitePoint(...point))) continue;

    const endpointIds = new Set([relation.from, relation.to]);
    for (const obstacle of obstacleList) {
      if (!obstacle || endpointIds.has(obstacle.id)) continue;
      if (!isFinitePoint(obstacle.x, obstacle.y, obstacle.width, obstacle.height)) continue;
      let hitSegment = -1;
      for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        if (segmentIntersectsRect({ start: points[segmentIndex], end: points[segmentIndex + 1] }, obstacle, clearance)) {
          hitSegment = segmentIndex;
          break;
        }
      }
      if (hitSegment === -1) continue;
      const from = points[hitSegment].map(Math.round).join(', ');
      const to = points[hitSegment + 1].map(Math.round).join(', ');
      const relationId = relation.id ? ` id "${relation.id}"` : '';
      problems.push(
        `[clean-flow/edge-through-node] ${diagramType} ${relationCollection}[${relationIndex}]${relationId} "${relation.from}" -> "${relation.to}" crosses ${obstacleKind} "${obstacle.id}" (unrelated to this relationship) on segment ${hitSegment} [${from}] -> [${to}] (${clearance}px clearance) — ${routeHint}.`
      );
    }
  }
  return problems;
}

// Reject only a proper interior X between relationships that share no semantic
// endpoint. Endpoint touches, branch/merge ports, and collinear shared
// corridors are intentionally outside this contract because geometry alone
// cannot tell whether those are authored junctions.
export function cleanCrossingProblems({
  relations,
  endpointIds,
  pathFor,
  diagramType,
  relationCollection,
  profile = 'standard',
  routeHint = 'adjust route/via or channel coordinates so the relationships use separate corridors'
}) {
  const requestedProfile = process.env.ARCHIFY_QUALITY_PROFILE || profile;
  const activeProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  if (activeProfile !== 'showcase') return [];
  const routed = asArray(relations).map((relation, index) => {
    if (!relation || !endpointIds.has(relation.from) || !endpointIds.has(relation.to)) return null;
    const points = pathFor(relation)?.points;
    if (!Array.isArray(points) || points.length < 2) return null;
    if (!points.every((point) => Array.isArray(point) && point.length === 2 && isFinitePoint(...point))) return null;
    return { relation, index, points };
  }).filter(Boolean);
  const problems = [];

  for (let leftIndex = 0; leftIndex < routed.length; leftIndex += 1) {
    const left = routed[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < routed.length; rightIndex += 1) {
      const right = routed[rightIndex];
      if ([left.relation.from, left.relation.to].some((id) => id === right.relation.from || id === right.relation.to)) continue;

      let hit = null;
      for (let leftSegment = 0; leftSegment < left.points.length - 1 && !hit; leftSegment += 1) {
        for (let rightSegment = 0; rightSegment < right.points.length - 1; rightSegment += 1) {
          const point = properSegmentIntersection(
            left.points[leftSegment],
            left.points[leftSegment + 1],
            right.points[rightSegment],
            right.points[rightSegment + 1]
          );
          if (point) {
            hit = { point, leftSegment, rightSegment };
            break;
          }
        }
      }
      if (!hit) continue;

      const describe = ({ relation, index }) => {
        const id = relation.id ? ` id "${relation.id}"` : '';
        return `${relationCollection}[${index}]${id} "${relation.from}" -> "${relation.to}"`;
      };
      const point = hit.point.map((value) => Math.round(value * 10) / 10).join(', ');
      problems.push(
        `[composition/proper-crossing] showcase ${diagramType} ${describe(left)} crosses ${describe(right)} at [${point}] (segments ${hit.leftSegment} and ${hit.rightSegment}) — ${routeHint}.`
      );
    }
  }
  return problems;
}

// Relationship paths may cross a structural frame, but they must not borrow a
// frame side as a routing corridor. Rounded rectangle corners are trimmed from
// the modeled straight sides so a short corner touch is not mistaken for a
// border run. Any positive straight overlap beyond the numeric epsilon is a
// hard failure in every quality profile; 16px belongs only to the separate,
// neutral short-segment metric and is not a corridor exemption.
export function collectBorderRuns({ routedRelations, frames }) {
  const hits = [];
  for (const routed of asArray(routedRelations)) {
    const routeSegments = Array.isArray(routed?.segments)
      ? routed.segments
      : asArray(routed?.points).slice(0, -1).map((start, index) => ({ start, end: routed.points[index + 1] }));
    if (!routeSegments.length) continue;
    if (!routeSegments.every((segment) => (
      Array.isArray(segment?.start) && segment.start.length === 2 && isFinitePoint(...segment.start)
      && Array.isArray(segment?.end) && segment.end.length === 2 && isFinitePoint(...segment.end)
    ))) continue;
    for (const [frameIndex, frame] of asArray(frames).entries()) {
      for (const border of frameBorderSegments(frame)) {
        const overlaps = [];
        for (let segmentIndex = 0; segmentIndex < routeSegments.length; segmentIndex += 1) {
          const segment = routeSegments[segmentIndex];
          const overlap = collinearAxisOverlap(
            segment.start,
            segment.end,
            border.start,
            border.end,
          );
          if (!overlap || overlap.length <= 0.0001) continue;
          overlaps.push({ ...overlap, segmentIndex });
        }
        if (!overlaps.length) continue;
        const merged = mergeBorderOverlaps(overlaps, border);
        const longest = [...merged].sort((left, right) => right.length - left.length || left.low - right.low)[0];
        hits.push({
          ...routed,
          frame,
          frameIndex,
          side: border.side,
          segmentIndex: Math.min(...overlaps.map((overlap) => overlap.segmentIndex)),
          overlapLength: merged.reduce((total, overlap) => total + overlap.length, 0),
          overlapStart: longest.start,
          overlapEnd: longest.end,
        });
      }
    }
  }
  return hits;
}

export function cleanBorderRunProblems({
  relations,
  endpointIds,
  frames,
  pathFor,
  diagramType,
  relationCollection,
  profile,
  routeHint = 'adjust route/via or channel coordinates so the relationship crosses the frame perpendicularly through a clear opening'
}) {
  if (!process.env.ARCHIFY_QUALITY_PROFILE && !profile) return [];
  const routedRelations = asArray(relations).map((relation, relationIndex) => {
    if (!relation || typeof relation.from !== 'string' || typeof relation.to !== 'string') return null;
    if (endpointIds && (!endpointIds.has(relation.from) || !endpointIds.has(relation.to))) return null;
    return { relation, relationIndex, points: pathFor(relation)?.points };
  }).filter(Boolean);
  return collectBorderRuns({ routedRelations, frames }).map((hit) => {
    const relation = hit.relation || {};
    const relationId = relation.id ? ` id "${relation.id}"` : '';
    const frameKind = hit.frame?.kind || hit.frame?.shape || 'frame';
    const frameIdentity = hit.frame?.label || hit.frame?.id || hit.frameIndex;
    const length = Math.round(hit.overlapLength * 10) / 10;
    const from = hit.overlapStart.map((value) => Math.round(value * 10) / 10).join(', ');
    const to = hit.overlapEnd.map((value) => Math.round(value * 10) / 10).join(', ');
    return `[composition/container-border-run] ${diagramType} ${relationCollection}[${hit.relationIndex}]${relationId} "${relation.from}" -> "${relation.to}" follows ${frameKind} "${frameIdentity}" ${hit.side} border for ${length}px on segment ${hit.segmentIndex} [${from}] -> [${to}] — ${routeHint}.`;
  });
}

export function routeBudgetMetrics({
  routedRelations,
  bendsPerRelationship = 2,
  stretch = 1.35,
  segmentPx = 16,
  microSegmentPx = 8,
}) {
  let maxBends = 0;
  let routesOverSuggestedBends = 0;
  let maxStretch = null;
  let routesOverSuggestedStretch = 0;
  let minSegmentPx = null;
  let minInteriorSegmentPx = null;
  let shortSegmentCount = 0;
  let shortEndpointSegmentCount = 0;
  let shortInteriorSegmentCount = 0;
  let microSegmentCount = 0;

  for (const routed of asArray(routedRelations)) {
    const points = normalizeRoutePoints(routed?.points);
    if (points.length < 2) continue;
    const bends = Math.max(0, points.length - 2);
    maxBends = Math.max(maxBends, bends);
    if (bends > bendsPerRelationship) routesOverSuggestedBends += 1;

    let routeLength = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const length = Math.abs(points[index + 1][0] - points[index][0]) + Math.abs(points[index + 1][1] - points[index][1]);
      if (length <= 0.0001) continue;
      const position = segmentPosition(index, points.length - 1);
      routeLength += length;
      minSegmentPx = minSegmentPx == null ? length : Math.min(minSegmentPx, length);
      if (position === 'interior') {
        minInteriorSegmentPx = minInteriorSegmentPx == null ? length : Math.min(minInteriorSegmentPx, length);
      }
      if (length < segmentPx) {
        shortSegmentCount += 1;
        if (position === 'interior') shortInteriorSegmentCount += 1;
        else shortEndpointSegmentCount += 1;
      }
      if (length < microSegmentPx) microSegmentCount += 1;
    }
    const direct = Math.abs(points.at(-1)[0] - points[0][0]) + Math.abs(points.at(-1)[1] - points[0][1]);
    if (direct > 0.0001) {
      const routeStretch = routeLength / direct;
      maxStretch = maxStretch == null ? routeStretch : Math.max(maxStretch, routeStretch);
      if (routeStretch > stretch + 0.0001) routesOverSuggestedStretch += 1;
    }
  }

  return {
    maxBends,
    routesOverSuggestedBends,
    maxStretch,
    routesOverSuggestedStretch,
    minSegmentPx,
    minInteriorSegmentPx,
    shortSegmentCount,
    shortEndpointSegmentCount,
    shortInteriorSegmentCount,
    microSegmentCount,
  };
}

export function collectRouteRhythmIssues({
  routedRelations,
  interiorSegmentPx = 16,
  microSegmentPx = 8,
}) {
  const issues = [];
  for (const [fallbackIndex, routed] of asArray(routedRelations).entries()) {
    const points = normalizeRoutePoints(routed?.points);
    if (points.length < 2) continue;
    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
      const start = points[segmentIndex];
      const end = points[segmentIndex + 1];
      const length = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
      if (length <= 0.0001) continue;
      const position = segmentPosition(segmentIndex, points.length - 1);
      const code = length < microSegmentPx - 0.0001
        ? 'composition/micro-segment'
        : position === 'interior' && length < interiorSegmentPx - 0.0001
          ? 'composition/short-interior-segment'
          : null;
      if (!code) continue;
      issues.push({
        code,
        relation: routed.relation,
        relationIndex: Number.isInteger(routed.relationIndex) ? routed.relationIndex : fallbackIndex,
        segmentIndex,
        position,
        length,
        start,
        end,
      });
    }
  }
  return issues;
}

export function cleanRouteRhythmProblems({
  relations,
  endpointIds,
  pathFor,
  diagramType,
  relationCollection,
  profile,
  routeHint = 'move the channel/via point to remove the cramped turn or give the route more corridor space',
  interiorSegmentPx = 16,
  microSegmentPx = 8,
}) {
  const requestedProfile = process.env.ARCHIFY_QUALITY_PROFILE || profile;
  if (requestedProfile !== 'showcase') return [];
  const routedRelations = asArray(relations).map((relation, relationIndex) => {
    if (!relation || typeof relation.from !== 'string' || typeof relation.to !== 'string') return null;
    if (endpointIds && (!endpointIds.has(relation.from) || !endpointIds.has(relation.to))) return null;
    return { relation, relationIndex, points: pathFor(relation)?.points };
  }).filter(Boolean);
  return collectRouteRhythmIssues({ routedRelations, interiorSegmentPx, microSegmentPx }).map((hit) => {
    const relation = hit.relation || {};
    const relationId = relation.id ? ` id "${relation.id}"` : '';
    const length = Math.round(hit.length * 10) / 10;
    const from = hit.start.map((value) => Math.round(value * 10) / 10).join(', ');
    const to = hit.end.map((value) => Math.round(value * 10) / 10).join(', ');
    const rule = hit.code === 'composition/micro-segment'
      ? `is below the ${microSegmentPx}px micro-segment floor`
      : `is below the ${interiorSegmentPx}px interior-segment floor`;
    return `[${hit.code}] showcase ${diagramType} ${relationCollection}[${hit.relationIndex}]${relationId} "${relation.from}" -> "${relation.to}" has a ${length}px ${hit.position} segment ${hit.segmentIndex} [${from}] -> [${to}] that ${rule} — ${routeHint}.`;
  });
}

function segmentPosition(index, segmentCount) {
  if (index === 0) return 'source-stub';
  if (index === segmentCount - 1) return 'target-stub';
  return 'interior';
}

function normalizeRoutePoints(points) {
  const finite = asArray(points).filter((point) => Array.isArray(point) && point.length === 2 && isFinitePoint(...point));
  const deduped = [];
  for (const point of finite) {
    const previous = deduped.at(-1);
    if (!previous || Math.abs(point[0] - previous[0]) > 0.0001 || Math.abs(point[1] - previous[1]) > 0.0001) deduped.push(point);
  }
  const normalized = [];
  for (const point of deduped) {
    while (normalized.length >= 2 && collinearForward(normalized.at(-2), normalized.at(-1), point)) normalized.pop();
    normalized.push(point);
  }
  return normalized;
}

function collinearForward(a, b, c) {
  if (Math.abs(crossProduct(a, b, c)) > 0.0001) return false;
  return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) >= -0.0001;
}

function frameBorderSegments(frame) {
  if (!frame || typeof frame !== 'object') return [];
  if (frame.shape === 'line') {
    const start = frame.start || [frame.x1, frame.y1];
    const end = frame.end || [frame.x2, frame.y2];
    return isFinitePoint(...start, ...end) ? [{ side: 'line', start, end }] : [];
  }
  if (!isFinitePoint(frame.x, frame.y, frame.width, frame.height) || frame.width <= 0 || frame.height <= 0) return [];
  const radius = Math.max(0, Math.min(Number(frame.radius) || 0, frame.width / 2, frame.height / 2));
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  return [
    { side: 'top', start: [left + radius, top], end: [right - radius, top] },
    { side: 'right', start: [right, top + radius], end: [right, bottom - radius] },
    { side: 'bottom', start: [right - radius, bottom], end: [left + radius, bottom] },
    { side: 'left', start: [left, bottom - radius], end: [left, top + radius] },
  ].filter(({ start, end }) => Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.0001);
}

function mergeBorderOverlaps(overlaps, border) {
  const horizontal = Math.abs(border.start[1] - border.end[1]) <= 0.0001;
  const axis = horizontal ? 0 : 1;
  const fixed = horizontal ? border.start[1] : border.start[0];
  const sorted = overlaps.map((overlap) => ({
    low: Math.min(overlap.start[axis], overlap.end[axis]),
    high: Math.max(overlap.start[axis], overlap.end[axis]),
  })).sort((left, right) => left.low - right.low || left.high - right.high);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.low <= previous.high + 0.0001) previous.high = Math.max(previous.high, interval.high);
    else merged.push({ ...interval });
  }
  return merged.map((interval) => ({
    ...interval,
    length: interval.high - interval.low,
    start: horizontal ? [interval.low, fixed] : [fixed, interval.low],
    end: horizontal ? [interval.high, fixed] : [fixed, interval.high],
  }));
}

function collinearAxisOverlap(a, b, c, d) {
  const epsilon = 0.0001;
  const horizontal = Math.abs(a[1] - b[1]) <= epsilon
    && Math.abs(c[1] - d[1]) <= epsilon
    && Math.abs(a[1] - c[1]) <= epsilon;
  const vertical = Math.abs(a[0] - b[0]) <= epsilon
    && Math.abs(c[0] - d[0]) <= epsilon
    && Math.abs(a[0] - c[0]) <= epsilon;
  if (!horizontal && !vertical) return null;
  const axis = horizontal ? 0 : 1;
  const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  if (high - low <= epsilon) return null;
  const fixed = horizontal ? a[1] : a[0];
  return {
    length: high - low,
    start: horizontal ? [low, fixed] : [fixed, low],
    end: horizontal ? [high, fixed] : [fixed, high],
  };
}

function properSegmentIntersection(a, b, c, d) {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  const epsilon = 0.0001;
  const opposite = (left, right) => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (!opposite(abC, abD) || !opposite(cdA, cdB)) return null;

  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < epsilon) return null;
  const ab = a[0] * b[1] - a[1] * b[0];
  const cd = c[0] * d[1] - c[1] * d[0];
  return [
    (ab * (c[0] - d[0]) - (a[0] - b[0]) * cd) / denominator,
    (ab * (c[1] - d[1]) - (a[1] - b[1]) * cd) / denominator
  ];
}

function crossProduct(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;

  return o1 !== o2 && o3 !== o4;
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    b[0] <= Math.max(a[0], c[0]) &&
    b[0] >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) &&
    b[1] >= Math.min(a[1], c[1])
  );
}

export function anchor(rect, side) {
  switch (side) {
    case 'left': return [rect.x, rect.cy];
    case 'right': return [rect.x + rect.width, rect.cy];
    case 'top': return [rect.cx, rect.y];
    case 'bottom': return [rect.cx, rect.y + rect.height];
    default:
      return [rect.x + rect.width, rect.cy];
  }
}

export function defaultFromSide(from, to) {
  if (to.cx < from.cx) return 'left';
  if (to.cx > from.cx) return 'right';
  if (to.cy > from.cy) return 'bottom';
  return 'top';
}

export function defaultToSide(from, to) {
  if (to.cx < from.cx) return 'right';
  if (to.cx > from.cx) return 'left';
  if (to.cy > from.cy) return 'top';
  return 'bottom';
}

export function chosenSide(side, fallback) {
  return side && side !== 'auto' ? side : fallback;
}

export function polylinePath(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

export function routePointsValue(points) {
  return asArray(points)
    .filter((point) => Array.isArray(point) && point.length === 2 && isFinitePoint(...point))
    .map(([x, y]) => `${x},${y}`)
    .join(';');
}

export function roundedPath(points, radius) {
  if (points.length < 3 || radius <= 0) {
    return polylinePath(points);
  }

  const commands = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const prevLen = Math.hypot(cx - px, cy - py);
    const nextLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, prevLen / 2, nextLen / 2);
    if (r < 1) {
      commands.push(`L ${cx} ${cy}`);
      continue;
    }
    const before = [cx - ((cx - px) / prevLen) * r, cy - ((cy - py) / prevLen) * r];
    const after = [cx + ((nx - cx) / nextLen) * r, cy + ((ny - cy) / nextLen) * r];
    commands.push(`L ${before[0]} ${before[1]}`);
    commands.push(`Q ${cx} ${cy} ${after[0]} ${after[1]}`);
  }
  const [endX, endY] = points[points.length - 1];
  commands.push(`L ${endX} ${endY}`);
  return commands.join(' ');
}

// Shared by edges/flows/transitions: all carry the same optional
// labelAt/labelDx/labelDy/labelSegment knobs.
export function labelPoint(item, points) {
  if (item.labelAt) return item.labelAt;
  if (points.length === 2) {
    return [
      (points[0][0] + points[1][0]) / 2 + (item.labelDx || 0),
      points[0][1] - 10 + (item.labelDy || 0)
    ];
  }
  const segmentIndex = Math.min(points.length - 2, Math.max(0, item.labelSegment ?? 1));
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  return [(a[0] + b[0]) / 2 + (item.labelDx || 0), (a[1] + b[1]) / 2 - 10 + (item.labelDy || 0)];
}

export const componentFill = {
  frontend: 'c-frontend',
  backend: 'c-backend',
  database: 'c-database',
  cloud: 'c-cloud',
  security: 'c-security',
  messagebus: 'c-messagebus',
  external: 'c-external'
};

export const componentText = {
  frontend: 't-frontend',
  backend: 't-backend',
  database: 't-database',
  cloud: 't-cloud',
  security: 't-security',
  messagebus: 't-messagebus',
  external: 't-external'
};

export const arrowClassMap = {
  default: ['a-default', 'arrowhead'],
  emphasis: ['a-emphasis', 'arrowhead-emphasis'],
  security: ['a-security', 'arrowhead-security'],
  dashed: ['a-dashed', 'arrowhead-dashed']
};

// Label accent per edge variant. Workflow colors dashed (async trace) labels
// like the trace store it points at; the other renderers use the bus color.
export function variantAccent(variant, { dashed = 't-messagebus' } = {}) {
  return variant === 'security'
    ? 't-security'
    : variant === 'emphasis'
      ? 't-backend'
      : variant === 'dashed'
        ? dashed
        : 't-muted';
}

export function formatRect(r) {
  return `[${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}, ${Math.round(r.height)}]`;
}

function formatDelta(n) {
  const v = Math.round(n);
  return v >= 0 ? `+${v}` : String(v);
}

/** Actionable hint when an edge label rect hits a node/component box (#7). */
export function suggestLabelObstacleFix(labelRect, lx, ly, obstacle, obstacleKind = 'component') {
  const lxR = Math.round(lx);
  const lyR = Math.round(ly);
  const belowY = Math.round(obstacle.y + obstacle.height + 14);
  const aboveY = Math.round(obstacle.y - 4);
  return [
    `  label rect: ${formatRect(labelRect)}`,
    `  ${obstacleKind} "${obstacle.id}" rect: ${formatRect(obstacle)}`,
    `  Suggested fix: labelAt [${lxR}, ${belowY}] or labelDy ${formatDelta(belowY - lyR)} (below); or labelAt [${lxR}, ${aboveY}] or labelDy ${formatDelta(aboveY - lyR)} (above)`,
  ].join('\n');
}

/** Hint when two edge labels collide. */
export function suggestLabelPairFix(a, b) {
  return [
    `  "${a.label}" ${formatRect(a)}; "${b.label}" ${formatRect(b)}`,
    '  Suggested fix: add labelDy +24 on one edge, adjust labelDx, or remove one label',
  ].join('\n');
}

/** Hint when two components/nodes are too close. */
export function suggestComponentSeparation(a, b, minGap = 8) {
  const rightX = Math.round(a.x + a.width + minGap);
  const belowY = Math.round(a.y + a.height + minGap);
  return [
    `  "${a.id}" ${formatRect(a)}; "${b.id}" ${formatRect(b)}`,
    `  Suggested fix: move "${b.id}" pos to [${rightX}, ${Math.round(b.y)}] (right of "${a.id}") or [${Math.round(b.x)}, ${belowY}] (below)`,
  ].join('\n');
}
