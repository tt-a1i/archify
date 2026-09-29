import { normalizeRoutePoints, rectsOverlap, segmentRectClearanceWithin } from '../shared/geometry.mjs';
import { createSpatialGrid } from '../shared/spatial-grid.mjs';

// A bounded fallback for an unpinned label whose usual position collides.
// It never routes an edge, moves a node, expands the canvas, or rewrites input.
export function placeAutomaticLabels({
  labels, routes, components, titles, viewBox, placementBottom = viewBox[1], fallbackRing = true, keepFallbackNearRoute = false,
  gridSweep = false,
}) {
  const placed = [...labels];
  const obstacles = [...components, ...titles];
  const segments = routes.flatMap(({ relationIndex, points }) => {
    const normalized = normalizeRoutePoints(points);
    return normalized.slice(1).map((end, index) => ({ relationIndex, start: normalized[index], end }));
  });
  const inside = rect => (
    rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= viewBox[0] && rect.y + rect.height <= viewBox[1]
  );
  // The mask test asked every segment about every candidate position. Segments
  // go into a uniform grid once, and a candidate only asks the cells it covers.
  const SEGMENT_CELL = 120;
  const segmentGrid = createSpatialGrid(SEGMENT_CELL);
  for (const segment of segments) {
    const [sx, sy] = segment.start;
    const [ex, ey] = segment.end;
    segmentGrid.insert({
      minX: Math.min(sx, ex), maxX: Math.max(sx, ex),
      minY: Math.min(sy, ey), maxY: Math.max(sy, ey),
    }, segment);
  }
  const segmentsNear = (rect, margin) => segmentGrid.query({
    minX: rect.x - margin, maxX: rect.x + rect.width + margin,
    minY: rect.y - margin, maxY: rect.y + rect.height + margin,
  });
  const masksRoute = rect => {
    for (const segment of segmentsNear(rect, 4)) {
      if (segment.relationIndex === rect.relationIndex) continue;
      if (segmentRectClearanceWithin(segment, rect, 4) + 0.0001 < 4) return true;
    }
    return false;
  };
  const overlapsLabel = (rect, index, gap = 0) => placed.some((other, otherIndex) => (
    otherIndex !== index && rectsOverlap(rect, other, gap)
  ));
  const clear = (rect, index) => (
    inside(rect) && rect.y + rect.height <= placementBottom
    && !obstacles.some(obstacle => rectsOverlap(rect, obstacle, 2))
    && !overlapsLabel(rect, index, 2) && !masksRoute(rect)
  );
  const rectAt = (label, lx, ly) => ({
    ...label, lx, ly, x: lx - label.width / 2, y: ly - 10,
  });
  // An opted-in grid layout runs parallel lines through shared gaps. Rank
  // every position along all of the label's own segments: beside the line
  // first, then centred on its own line (the plate interrupts only that
  // line), then stepping outward past neighbouring parallels.
  const gridCandidates = (label) => {
    const fractions = [0.5, 0.25, 0.75, 0.375, 0.625, 0.125, 0.875];
    const ranked = [];
    // A close parallel of another relationship on one side (a reciprocal
    // pair) makes a label on that side read as the neighbour's: prefer the
    // far side.
    const parallelOnLowSide = (a, b, axis) => {
      const across = 1 - axis;
      const [low, high] = [Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])];
      let nearest = null;
      for (const other of segments) {
        if (other.relationIndex === label.relationIndex) continue;
        if (Math.abs(other.start[across] - other.end[across]) > 0.0001) continue;
        const distance = other.start[across] - a[across];
        if (Math.abs(distance) < 0.0001 || Math.abs(distance) > 36) continue;
        const overlap = Math.min(high, Math.max(other.start[axis], other.end[axis]))
          - Math.max(low, Math.min(other.start[axis], other.end[axis]));
        if (overlap <= 0) continue;
        if (nearest === null || Math.abs(distance) < Math.abs(nearest)) nearest = distance;
      }
      return nearest !== null && nearest < 0;
    };
    for (const { start: a, end: b } of segments.filter(segment => segment.relationIndex === label.relationIndex)) {
      if (Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[0] - b[0]) >= label.width + 16) {
        const [above, below] = parallelOnLowSide(a, b, 0) ? [1, 0] : [0, 1];
        for (const fraction of fractions) {
          const x = a[0] + (b[0] - a[0]) * fraction;
          if (Math.min(Math.abs(x - a[0]), Math.abs(x - b[0])) < label.width / 2 + 6) continue;
          ranked.push([above, x, a[1] - 10], [below, x, a[1] + 20], [2, x, a[1] + 3], [3, x, a[1] - 18], [3, x, a[1] + 28]);
        }
      } else if (Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) >= label.height + 16) {
        const leftFirst = !parallelOnLowSide(a, b, 1);
        for (const fraction of fractions) {
          const y = a[1] + (b[1] - a[1]) * fraction;
          if (Math.min(Math.abs(y - a[1]), Math.abs(y - b[1])) < label.height / 2 + 6) continue;
          ranked.push([2, a[0], y + 3]);
          [6, 14, 22, 30, 38, 46, 54].forEach((offset, step) => {
            const tier = step === 0 ? 0 : step === 1 ? 1 : 2 + step;
            const left = [tier + (leftFirst ? 0 : 0.5), a[0] - label.width / 2 - offset, y + 3];
            const right = [tier + (leftFirst ? 0.5 : 0), a[0] + label.width / 2 + offset, y + 3];
            ranked.push(left, right);
          });
        }
      }
    }
    return ranked.map((entry, order) => [...entry, order])
      .sort((left, right) => left[0] - right[0] || left[3] - right[3])
      .map(([, lx, ly]) => [lx, ly]);
  };

  for (const [index, label] of placed.entries()) {
    const relation = label.relation;
    if (['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => relation[key] !== undefined)) continue;
    // Match actual defect thresholds before searching; a valid placement is
    // not a reason to restyle the diagram. New placements leave extra space.
    // The grid ranking already starts from the preferred position, so it
    // also re-ranks labels whose default spot is merely valid.
    if (!gridSweep && inside(label) && !components.some(component => rectsOverlap(label, component, -2))
        && !titles.some(title => rectsOverlap(label, title))
        && !overlapsLabel(label, index) && !masksRoute(label)) continue;
    if (gridSweep) {
      // Callers measure the plate one pixel higher than rectAt; test with a
      // pixel of slack so the chosen position also passes their clearance.
      const replacement = gridCandidates(label).map(([lx, ly]) => rectAt(label, lx, ly))
        .find(rect => clear({ ...rect, x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 }, index));
      if (replacement) {
        placed[index] = replacement;
        continue;
      }
    }
    for (const segment of segments.filter(segment => segment.relationIndex === label.relationIndex)) {
      const [a, b] = [segment.start, segment.end];
      let candidates = [];
      if (Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[0] - b[0]) >= label.width + 16) {
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap(fraction => {
          const x = a[0] + (b[0] - a[0]) * fraction;
          if (Math.min(Math.abs(x - a[0]), Math.abs(x - b[0])) < 8) return [];
          return [
            [x, a[1] - 10],
            [x, a[1] + 20],
            [x, a[1] - 18],
            [x, a[1] + 28],
          ];
        });
      } else if (Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) >= label.height + 16) {
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap(fraction => {
          const y = a[1] + (b[1] - a[1]) * fraction;
          if (Math.min(Math.abs(y - a[1]), Math.abs(y - b[1])) < 8) return [];
          return [
            [a[0] - label.width / 2 - 6, y + 3],
            [a[0] + label.width / 2 + 6, y + 3],
            [a[0] - label.width / 2 - 14, y + 3],
            [a[0] + label.width / 2 + 14, y + 3],
          ];
        });
      }
      const replacement = candidates.map(([lx, ly]) => rectAt(label, lx, ly))
        .find(rect => clear(rect, index));
      if (replacement) {
        placed[index] = replacement;
        break;
      }
    }
    if (placed[index] !== label || !fallbackRing) continue;

    // Dense but valid topologies can leave every point directly beside the
    // relationship occupied by another route. Search a small deterministic
    // ring around the current anchor and the relationship's segment centres.
    // A collision-free island above a node is not a readable edge label.
    // Architecture opts into keeping the mask within two label heights of
    // its own route; shared callers retain their existing policy. If no nearby
    // slot fits, retain the collision so validation can request more space.
    const ownSegments = segments.filter(segment => segment.relationIndex === label.relationIndex);
    const baseAnchors = [
      [label.lx, label.ly],
      ...ownSegments.map(segment => [
        (segment.start[0] + segment.end[0]) / 2,
        (segment.start[1] + segment.end[1]) / 2,
      ]),
    ];
    const horizontalStep = label.width / 2 + 12;
    const ringOffsets = [
      [0, -28], [0, 38],
      [-horizontalStep, -28], [horizontalStep, -28],
      [-horizontalStep, 38], [horizontalStep, 38],
      [-(label.width + 20), -52], [label.width + 20, -52],
      [-(label.width + 20), 62], [label.width + 20, 62],
      [-(label.width + 20), -76], [label.width + 20, -76],
      [-(label.width + 20), 86], [label.width + 20, 86],
    ];
    const fallback = baseAnchors.flatMap(([baseX, baseY]) => (
      ringOffsets.map(([dx, dy]) => rectAt(label, baseX + dx, baseY + dy))
    )).find(rect => clear(rect, index) && (!keepFallbackNearRoute || ownSegments.some(segment => (
      segmentRectClearanceWithin(segment, rect, label.height * 2) <= label.height * 2
    ))));
    if (fallback) placed[index] = fallback;
  }
  return placed;
}

// The rect a single unpinned label would occupy given only its own route and
// the nodes: what the planner reserves before the remaining routes are laid.
// Only a placement beside the route itself is worth reserving; a label that
// would already need the fallback ring is left to the final placement pass.
export function reservedLabelRect({
  label, points, routes = [], labels = [], components, viewBox = [Infinity, Infinity], placementBottom = Infinity,
}) {
  const [rect] = placeAutomaticLabels({
    labels: [{ ...label, relationIndex: -1 }, ...labels.map(other => ({ ...other, relationIndex: -2 }))],
    routes: [{ relationIndex: -1, points }, ...routes],
    components,
    titles: [],
    viewBox,
    placementBottom,
    fallbackRing: false,
  });
  return components.some(component => rectsOverlap(rect, component, -2)) ? null : rect;
}
