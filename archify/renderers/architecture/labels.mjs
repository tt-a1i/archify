import { normalizeRoutePoints, rectsOverlap, segmentRectClearance } from '../shared/geometry.mjs';

// A bounded fallback for an unpinned label whose usual position collides.
// It never routes an edge, moves a node, expands the canvas, or rewrites input.
export function placeAutomaticLabels({
  labels, routes, components, titles, viewBox, placementBottom = viewBox[1], fallbackRing = true,
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
  const masksRoute = rect => segments.some(segment => segment.relationIndex !== rect.relationIndex
    && segmentRectClearance(segment, rect) + 0.0001 < 4);
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

  for (const [index, label] of placed.entries()) {
    const relation = label.relation;
    if (['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => relation[key] !== undefined)) continue;
    // Match actual defect thresholds before searching; a valid placement is
    // not a reason to restyle the diagram. New placements leave extra space.
    if (inside(label) && !components.some(component => rectsOverlap(label, component, -2))
        && !titles.some(title => rectsOverlap(label, title))
        && !overlapsLabel(label, index) && !masksRoute(label)) continue;
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
    // This keeps the label close to its edge while avoiding the hand-authored
    // labelDx/labelDy repair loop that otherwise dominates first-draft cost.
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
    )).find(rect => clear(rect, index));
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
