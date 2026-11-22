import { rectsOverlap, routeBudgetMetrics, segmentIntersectsRect } from '../shared/geometry.mjs';

const cardGap = 24;
const routeLength = points => points.slice(1).reduce((total, [x, y], index) =>
  total + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]), 0);

function inside(box, left, top, right, bottom) {
  return box.x >= left - 0.0001 && box.y >= top - 0.0001
    && box.x + box.width <= right + 0.0001 && box.y + box.height <= bottom + 0.0001;
}

function insideMembers(box, members) {
  return members.length > 0 && inside(box,
    Math.min(...members.map(member => member.x)),
    Math.min(...members.map(member => member.y)),
    Math.max(...members.map(member => member.x + member.width)),
    Math.max(...members.map(member => member.y + member.height)));
}

// A straight branch to a terminal card can cut across a through route.
// Try moving the terminal beside its owner, inside the existing frames.
export function placeCrossedLeaf(components, connections, frames, baseline, makeRouter) {
  if (!frames.length || components.size > 24 || connections.length > 36
      || [...components.values()].some(box => box.pos)
      || connections.some(conn => !components.has(conn.from) || !components.has(conn.to)
        || conn.via || (conn.route && conn.route !== 'auto')
        || ['fromSide', 'toSide'].some(key => conn[key] && conn[key] !== 'auto')
        || ['channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment']
          .some(key => conn[key] !== undefined))) return null;
  const crossings = baseline.crossingPairs();
  if (crossings.length !== 1) return null;
  const paths = new Map(connections.map(conn => [conn, baseline.pathFor(conn).points]));
  const scenePoints = [...paths.values()].flat();
  for (const box of [...components.values(), ...frames]) {
    scenePoints.push([box.x + box.width, box.y + box.height]);
  }
  const bounds = [Math.max(...scenePoints.map(([x]) => x)), Math.max(...scenePoints.map(([, y]) => y))];

  for (const branch of crossings[0]) {
    const branchPoints = paths.get(branch);
    if (branchPoints.length !== 2) continue;
    const through = crossings[0].find(conn => conn !== branch);
    if (paths.get(through).length <= 4) continue;
    const owner = components.get(branch.from);
    const leaf = components.get(branch.to);
    if (connections.some(conn => conn !== branch && (conn.from === leaf.id || conn.to === leaf.id))) continue;
    const memberFrames = frames.filter(frame => frame.wraps.includes(leaf.id));
    if (!memberFrames.some(frame => frame.wraps.includes(owner.id))) continue;
    const siblings = memberFrames.map(frame => frame.wraps.filter(id => id !== leaf.id)
      .map(id => components.get(id)).filter(Boolean));
    // The other members must already define every frame edge. Both the
    // original and proposed card can then use the same measured frames.
    if (!siblings.every(members => insideMembers(leaf, members))) continue;

    const horizontal = branchPoints[0][1] === branchPoints[1][1];
    const [along, span, across, depth] = horizontal
      ? ['x', 'width', 'y', 'height'] : ['y', 'height', 'x', 'width'];
    const proposed = leaf[along] > owner[along]
      ? owner[along] + owner[span] + cardGap : owner[along] - leaf[span] - cardGap;
    for (const offset of [owner[across] + owner[depth] + cardGap, owner[across] - leaf[depth] - cardGap]) {
      const box = { ...leaf, [along]: proposed, [across]: offset };
      box.cx = box.x + box.width / 2;
      box.cy = box.y + box.height / 2;
      if (!siblings.every(members => insideMembers(box, members))
          || frames.some(frame => !memberFrames.includes(frame) && rectsOverlap(box, frame, cardGap))
          || [...components.values()].some(other => other !== leaf && rectsOverlap(box, other, cardGap))) continue;
      // Leave established corridors open. The branch itself moves with the
      // card; the through route is rerouted only to clear the former crossing.
      if ([...paths].some(([conn, points]) => conn !== branch && conn !== through && points.slice(1).some((end, index) =>
        segmentIntersectsRect({ start: points[index], end }, box, 8)))) continue;
      const moved = new Map(components).set(leaf.id, box);
      const router = makeRouter(moved);
      if (router.crossingPairs().length) continue;
      if (!connections.every(conn => {
        const previous = paths.get(conn);
        const next = router.pathFor(conn).points;
        const stretchDebt = points => routeBudgetMetrics({ routedRelations: [{ points }] }).routesOverSuggestedStretch;
        return next.length <= Math.max(previous.length, 4)
          && routeLength(next) <= routeLength(previous) + 0.0001 && stretchDebt(next) <= stretchDebt(previous);
      }) || !router.planIsClear(bounds)) continue;
      return { box, router };
    }
  }
  return null;
}
