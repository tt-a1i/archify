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

function canRearrange(components, connections, allowSides = false) {
  return !(components.size > 24 || connections.length > 36
      || [...components.values()].some(box => box.pos)
      || connections.some(conn => !components.has(conn.from) || !components.has(conn.to)
        || conn.via || (conn.route && conn.route !== 'auto')
        || (!allowSides && ['fromSide', 'toSide'].some(key => conn[key] && conn[key] !== 'auto'))
        || ['channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment']
          .some(key => conn[key] !== undefined)));
}

function contentBounds(components, frames, paths) {
  const scenePoints = [...paths.values()].flat();
  for (const box of [...components.values(), ...frames]) {
    scenePoints.push([box.x + box.width, box.y + box.height]);
  }
  return [Math.max(...scenePoints.map(([x]) => x)), Math.max(...scenePoints.map(([, y]) => y))];
}

// A straight branch to a terminal card can cut across a through route.
// Try moving the terminal beside its owner, inside the existing frames.
export function placeCrossedLeaf(components, connections, frames, baseline, makeRouter) {
  if (!frames.length || !canRearrange(components, connections)) return null;
  const crossings = baseline.crossingPairs();
  if (crossings.length !== 1) return null;
  const paths = new Map(connections.map(conn => [conn, baseline.pathFor(conn).points]));
  const bounds = contentBounds(components, frames, paths);

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
      if (!router) return null;
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

// Two terminal neighbours on the same rank can be in the wrong order for
// their incoming branches. Exchange equal slots, then replan the routes.
export function placeCrossedSinks(components, connections, frames, baseline, makeRouter, keepsLabels) {
  if (frames.length || !canRearrange(components, connections)) return null;
  const crossings = baseline.crossingPairs();
  if (crossings.length !== 1) return null;
  const [[left, right]] = crossings;
  if (left.to === right.to || connections.some(conn => conn.from === left.to || conn.from === right.to)) return null;
  const first = components.get(left.to);
  const second = components.get(right.to);
  if (first.width !== second.width || first.height !== second.height
      || (first.x !== second.x && first.y !== second.y)) return null;

  const at = (box, slot) => ({ ...box, x: slot.x, y: slot.y, cx: slot.cx, cy: slot.cy });
  const boxes = [at(first, second), at(second, first)];
  const moved = new Map(components);
  for (const box of boxes) moved.set(box.id, box);
  const router = makeRouter(moved);
  if (!router) return null;
  if (router.crossingPairs().length) return null;
  const before = new Map(connections.map(conn => [conn, baseline.pathFor(conn).points]));
  const after = new Map(connections.map(conn => [conn, router.pathFor(conn).points]));
  const metrics = paths => routeBudgetMetrics({ routedRelations: [...paths.values()].map(points => ({ points })) });
  const old = metrics(before);
  const next = metrics(after);
  if ((next.maxStretch ?? 0) > (old.maxStretch ?? 0) + 0.0001
      || next.routesOverSuggestedBends > old.routesOverSuggestedBends
      || next.routesOverSuggestedStretch > old.routesOverSuggestedStretch
      || !router.planIsClear(contentBounds(components, frames, before))
      || !keepsLabels(moved, baseline.pathFor, router.pathFor)) return null;
  return { boxes, router };
}

// Two components with opposing authored sides usually face each other.
// If several links at the same frame interface agree on that order, try
// putting the whole upper frame above the lower one in existing canvas space.
export function facingFramePlacements(components, connections, frames, right) {
  if (frames.length !== 2 || frames.some(frame => frame.wraps.some(id => !components.has(id)))
      || !canRearrange(components, connections, true)) return [];
  const [upper, lower] = [...frames].sort((a, b) => b.y - a.y);
  if (lower.y + lower.height > upper.y || upper.wraps.some(id => lower.wraps.includes(id))) return [];
  const matched = [];
  const interfaceMembers = new Set();
  for (const conn of connections) {
    if (!['top', 'bottom'].includes(conn.fromSide) || !['top', 'bottom'].includes(conn.toSide)
        || conn.fromSide === conn.toSide) continue;
    const [top, bottom] = conn.fromSide === 'bottom' ? [conn.from, conn.to] : [conn.to, conn.from];
    if (lower.wraps.includes(top) && upper.wraps.includes(bottom)) return [];
    if (upper.wraps.includes(top) && lower.wraps.includes(bottom)) {
      matched.push(components.get(bottom).cx - components.get(top).cx);
      interfaceMembers.add(bottom);
    }
  }
  if (matched.length < 2) return [];
  const left = Math.min(...frames.map(frame => frame.x), ...[...components.values()].map(box => box.x));
  const y = lower.y - upper.height - 16;
  const x = Math.min(right - upper.width, upper.x + matched.reduce((total, dx) => total + dx, 0) / matched.length);
  if (x < left || y < 16) return [];
  const nextFrame = { ...upper, x, y };
  const moved = new Map(components);
  const translate = (box, dx, dy) => ({ ...box, x: box.x + dx, y: box.y + dy, cx: box.cx + dx, cy: box.cy + dy });
  for (const id of upper.wraps) {
    moved.set(id, translate(components.get(id), x - upper.x, y - upper.y));
  }

  // A single unattached entry can take the open leading side of the frame
  // on its original row. Keep all other ranks in their existing positions.
  const outsiders = [...components.values()].filter(box => !upper.wraps.includes(box.id) && !lower.wraps.includes(box.id));
  const blocked = outsiders.filter(box => rectsOverlap(box, nextFrame, cardGap));
  if (blocked.length > 1) return [];
  for (const entry of blocked) {
    const links = connections.filter(conn => conn.from === entry.id || conn.to === entry.id);
    if (links.length !== 1 || links[0].from !== entry.id || !lower.wraps.includes(links[0].to)
        || left + entry.width + cardGap > x) return [];
    const replacement = translate(entry, left - entry.x, 0);
    if ([...moved.values()].some(other => other.id !== entry.id && rectsOverlap(other, replacement, cardGap))
        || rectsOverlap(replacement, lower, cardGap)) return [];
    moved.set(entry.id, replacement);
  }
  const candidates = [moved];
  // A single interface card on the edge of the row can also leave room
  // for a label and the return elbow entering its original side.
  if (interfaceMembers.size === 1) {
    const [id] = interfaceMembers;
    const box = moved.get(id);
    const peers = lower.wraps.filter(member => member !== id).map(member => moved.get(member));
    const direction = peers.every(peer => peer.x + peer.width <= box.x) ? 1
      : peers.every(peer => peer.x >= box.x + box.width) ? -1 : 0;
    const roomy = translate(box, direction * (2 * cardGap + 8), 0);
    if (direction && roomy.x - (lower.pad ?? 30) >= left
        && roomy.x + roomy.width + (lower.pad ?? 30) <= right
        && [...moved.values()].every(other => other.id === id || !rectsOverlap(other, roomy, cardGap))) {
      candidates.push(new Map(moved).set(id, roomy));
    }
  }
  return candidates;
}
