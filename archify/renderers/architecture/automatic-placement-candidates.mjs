import { normalizeRoutePoints, properSegmentIntersection, rectsOverlap } from '../shared/geometry.mjs';
import { analyzeSvgPath } from '../shared/svg-path-analysis.mjs';
import { prepareCrossingPath, visibleCrossings } from '../shared/route-crossings.mjs';
import { facingPortCorridor, horizontalLabelClearance } from './routing.mjs';

export function measuredCrossingPairs(routes) {
  const paths = routes.map(({ d }) => analyzeSvgPath(d).subpaths
    .map(({ commands }) => prepareCrossingPath(commands)));
  return routes.flatMap(({ relation }, index) => routes.slice(index + 1).flatMap(({ relation: other }, offset) =>
    paths[index].some(a => paths[index + offset + 1].some(b => visibleCrossings(a, b, 1).length))
      ? [[relation, other]] : []));
}

function move(box, x, y) {
  return { ...box, x, y, cx: x + box.width / 2, cy: y + box.height / 2 };
}

export function* centeredFanOutCandidates({ boxes, routes }) {
  const neighbors = new Map([...boxes.keys()].map(id => [id, new Set()]));
  for (const { relation: { from, to } } of routes) {
    neighbors.get(from).add(to);
    neighbors.get(to).add(from);
  }
  for (const [id, peers] of neighbors) {
    if (peers.size < 4 || [...peers].some(peer => neighbors.get(peer).size !== 1)) continue;
    const hub = boxes.get(id);
    if (hub.pos) continue;
    const leaves = [...peers].map(peer => boxes.get(peer));
    for (const [along, alongSize, rankCenter, acrossCenter] of [
      ['x', 'width', 'cx', 'cy'], ['y', 'height', 'cy', 'cx'],
    ]) {
      // A one-sided rank of leaves can pull its hub to the end of the
      // rank when the layout aligns the hub with the selected main path.
      if (!leaves.every(leaf => leaf[along] >= hub[along] + hub[alongSize])
          && !leaves.every(leaf => leaf[along] + leaf[alongSize] <= hub[along])) continue;
      if (leaves.some(leaf => Math.abs(leaf[rankCenter] - leaves[0][rankCenter]) > 0.0001)) continue;
      const ordered = leaves.map(leaf => leaf[acrossCenter]).sort((a, b) => a - b);
      const shift = ordered[Math.floor((ordered.length - 1) / 2)] - hub[acrossCenter];
      if (Math.abs(shift) < 60) continue;
      const moved = along === 'x' ? move(hub, hub.x, hub.y + shift) : move(hub, hub.x + shift, hub.y);
      if ([...boxes.values()].some(box => box !== hub && rectsOverlap(box, moved, 28))) continue;
      yield new Map(boxes).set(id, moved);
    }
  }
}

export function* nearAlignmentCandidates({ boxes, routes, titles }) {
  // Open a lane between the legal port ranges with a small perpendicular
  // nudge. Avoid repacking cards or changing a frame's membership.
  for (const route of routes) {
    if (route.points.length <= 2) continue;
    const { relation } = route;
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const corridor = facingPortCorridor(from, to);
    if (!corridor?.offset) continue;
    const { axis, low, high, offset } = corridor;
    const distance = 8 - (high - low);
    if (distance <= 0 || distance > 24 || distance > Math.abs(offset)) continue;
    for (const [box, change] of [[from, -Math.sign(offset) * distance], [to, Math.sign(offset) * distance]]) {
      if (box.pos) continue;
      const moved = move(box, box.x + (axis ? 0 : change), box.y + (axis ? change : 0));
      if (moved.x < 0 || moved.y < 0 || [...boxes.values()].some(other => other !== box && rectsOverlap(other, moved, 12))
          || titles.boundaries.some(frame => !frame.wraps.includes(box.id)
            && rectsOverlap(frame, moved, 12) && !rectsOverlap(frame, box, 12))) continue;
      yield { relation, boxes: new Map(boxes).set(box.id, moved) };
    }
  }
}

export function compositionImbalance({ boxes, routes, titles, viewBox }) {
  const balanced = { leadingVoid: 0, sunkenRoots: 0, score: 0 };
  if (boxes.size < 6 || titles.boundaries.length) return balanced;
  const cards = [...boxes.values()];
  if (cards.some(card => card.pos)) return balanced;

  const minX = Math.min(...cards.map(card => card.x));
  const minY = Math.min(...cards.map(card => card.y));
  const spanX = Math.max(...cards.map(card => card.x + card.width)) - minX;
  const spanY = Math.max(...cards.map(card => card.y + card.height)) - minY;
  const leading = { x: minX, y: minY, width: spanX * 0.42, height: spanY * 0.42 };
  const leadingVoid = spanX >= 420 && spanY >= 360 && !cards.some(card => rectsOverlap(card, leading))
    ? leading.width * leading.height / (viewBox[0] * viewBox[1]) : 0;

  const incoming = new Set();
  const outgoing = new Set();
  for (const { relation: { from, to, variant } } of routes) {
    if (variant === 'dashed') continue;
    incoming.add(to);
    outgoing.add(from);
  }
  const roots = [...outgoing].filter(id => !incoming.has(id)).map(id => boxes.get(id));
  const bottomBand = minY + spanY * 0.68;
  const sunkenRoots = roots.length && roots.every(card => card.cy > bottomBand)
    && cards.some(card => card.y === minY && !roots.includes(card)) ? 1 : 0;
  return { leadingVoid, sunkenRoots, score: leadingVoid + sunkenRoots };
}

export function routeSpanMeasures(routes, boxes, viewBox) {
  const spans = routes.map(({ relation, points }) => {
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const separation = Math.abs(to.cx - from.cx) + Math.abs(to.cy - from.cy);
    const length = points.slice(1).reduce((total, [x, y], index) =>
      total + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]), 0);
    return { length, bends: Math.max(0, normalizeRoutePoints(points).length - 2),
      centerRatio: separation ? length / separation : null };
  });
  return {
    spans,
    length: spans.reduce((total, route) => total + route.length, 0),
    longest: Math.max(0, ...spans.map(route => route.length)) / Math.hypot(...viewBox),
  };
}

function groupRouteLengthLimit(length) {
  return Math.max(length * 2, length + 200);
}

export function groupMoveCanPreserveRoutes(moved, routes, spans) {
  return routes.every(({ relation }, index) => {
    const a = moved.get(relation.from);
    const b = moved.get(relation.to);
    // The shortest possible orthogonal route is bounded by the gaps
    // between the card rectangles, regardless of ports or obstacles.
    const dx = Math.max(0, b.x - a.x - a.width, a.x - b.x - b.width);
    const dy = Math.max(0, b.y - a.y - a.height, a.y - b.y - b.height);
    return dx + dy <= groupRouteLengthLimit(spans[index].length) + 0.0001;
  });
}

export function groupMovePreservesRoutes(before, after) {
  return after.every((next, index) => {
    const old = before[index];
    // Keep straight links intact, including every straight main-path link.
    return next.bends <= (old.bends ? old.bends + 1 : 0)
      && next.length <= groupRouteLengthLimit(old.length) + 0.0001;
  });
}

// Pull a terminal branch toward the layer beside its first shared card.
// Preserve the spacing inside a short unary chain when it moves as a unit.
export function terminalBranchCandidates({ boxes, routes, viewBox, titles }, spans) {
  const neighbors = new Map([...boxes.keys()].map(id => [id, new Set()]));
  const incoming = new Map([...boxes.keys()].map(id => [id, new Set()]));
  const outgoing = new Map([...boxes.keys()].map(id => [id, new Set()]));
  for (const { relation: { from, to } } of routes) {
    neighbors.get(from).add(to);
    neighbors.get(to).add(from);
    incoming.get(to).add(from);
    outgoing.get(from).add(to);
  }
  const frames = titles.boundaries;
  const inScope = (frame, box) => frame.wraps.includes(box.id);
  const moves = [];
  const seen = new Set();
  const contentRight = Math.max(...[...boxes.values()].map(box => box.x + box.width));
  const contentBottom = Math.max(...[...boxes.values()].map(box => box.y + box.height));
  for (const [id, peers] of neighbors) {
    if (peers.size !== 1 || peers.has(id)) continue;
    const branch = new Set([id]);
    let attach = id;
    let [neighbor] = peers;
    while (branch.size < 3 && neighbors.get(neighbor).size === 2
      && incoming.get(neighbor).size === 1 && outgoing.get(neighbor).size === 1) {
      branch.add(neighbor);
      const next = [...neighbors.get(neighbor)].find(other => other !== attach);
      attach = neighbor;
      neighbor = next;
    }
    if (neighbors.get(neighbor).size < 2 || branch.has(neighbor)) continue;
    const links = routes.filter(({ relation }) => relation.from === attach && relation.to === neighbor
      || relation.to === attach && relation.from === neighbor);
    const longest = Math.max(...links.map(link => spans[routes.indexOf(link)].length));
    if (longest < Math.max(240, Math.hypot(...viewBox) / 3)) continue;
    const box = boxes.get(attach);
    const target = boxes.get(neighbor);
    const [left, right] = [target.x, target.x + target.width];
    const [top, bottom] = [target.y, target.y + target.height];
    const x = target.cx - box.width / 2;
    const y = target.cy - box.height / 2;
    const gap = 28;
    const horizontal = Math.max(52, ...links.map(({ relation }) => (relation.label?.length ?? 0) * 7 + 24));
    const inner = [...branch].map(member => boxes.get(member));
    const others = [...boxes.values()].filter(other => !branch.has(other.id));
    const xs = [x, left, right - box.width, box.x, left - box.width - gap, right + gap];
    const ys = [y, top, bottom - box.height, box.y, top - box.height - gap, bottom + gap];
    const positions = [
      ...xs.flatMap(value => [[value, top - box.height - 48], [value, bottom + 48]]),
      ...ys.flatMap(value => [[left - box.width - horizontal, value], [right + horizontal, value]]),
    ];
    for (const frame of frames.filter(frame => inScope(frame, target) && !inScope(frame, box))) {
      positions.push([x, frame.y - box.height - gap], [x, frame.y + frame.height + gap],
        [frame.x - box.width - gap, y], [frame.x + frame.width + gap, y]);
    }
    for (const other of others) {
      // Existing slots one band away can have a clearer approach than the
      // closest strip. Include their edges, but keep the neighbor alignment.
      if (Math.abs(other.cx - target.cx) < target.width * 1.5) {
        positions.push([x, other.y - box.height - gap], [x, other.y + other.height + gap]);
      }
      if (Math.abs(other.cy - target.cy) < target.height * 2) {
        positions.push([other.x - box.width - gap, y], [other.x + other.width + gap, y]);
      }
    }
    const oldGap = Math.abs(target.cx - box.cx) + Math.abs(target.cy - box.cy);
    for (const [cx, cy] of positions) {
      const gain = oldGap - (Math.abs(cx + box.width / 2 - target.cx) + Math.abs(cy + box.height / 2 - target.cy));
      if (gain < 48) continue;
      const changed = inner.map(member => move(member, member.x + cx - box.x, member.y + cy - box.y));
      if (changed.some((member, index) => member.x < 40 || member.y < 40
          || member.x + member.width > contentRight + 0.0001 || member.y + member.height > contentBottom + 0.0001
          || others.some(other => rectsOverlap(other, member, gap))
          || frames.some(frame => !inScope(frame, member) && rectsOverlap(frame, member, 12)
            && !rectsOverlap(frame, inner[index], 12)))) continue;
      const key = JSON.stringify(changed.map(({ id, x, y }) => [id, x, y]));
      if (seen.has(key)) continue;
      seen.add(key);
      const moved = new Map(boxes);
      for (const member of changed) moved.set(member.id, member);
      moves.push({ moved, gain, longest, attach });
    }
    if (inner.length !== 1) continue;
    // Peers of equal size can exchange slots inside a packed frame. This
    // gives a shared interface a shorter approach without moving its frame.
    for (const peer of others) {
      if (peer === target || peer.width !== box.width || peer.height !== box.height
          || !frames.every(frame => inScope(frame, peer) === inScope(frame, box))) continue;
      if (!frames.some(frame => inScope(frame, box))) continue;
      const gain = oldGap - (Math.abs(target.cx - peer.cx) + Math.abs(target.cy - peer.cy));
      if (gain < 48) continue;
      const moved = new Map(boxes).set(box.id, move(box, peer.x, peer.y)).set(peer.id, move(peer, box.x, box.y));
      moves.push({ moved, gain, longest, attach });
    }
  }
  return moves.sort((a, b) => b.longest - a.longest || b.gain - a.gain);
}

// Compact several long links to the same card. Keep their spatial order
// along the new strip. An existing frame moves as a unit so its membership
// and internal layout do not interfere with the shared approach.
export function sharedNeighborCandidates({ boxes, routes, viewBox, titles }, spans) {
  const groups = new Map();
  const threshold = Math.max(280, Math.hypot(...viewBox) / 4);
  routes.forEach(({ relation }, index) => {
    if (spans[index].length < threshold || relation.from === relation.to) return;
    for (const [anchor, peer, direction] of [[relation.to, relation.from, 'in'], [relation.from, relation.to, 'out']]) {
      const key = JSON.stringify([anchor, direction]);
      if (!groups.has(key)) groups.set(key, { anchor, peers: new Map() });
      const { peers } = groups.get(key);
      peers.set(peer, Math.max(peers.get(peer) ?? 0, spans[index].length));
    }
  });
  const frames = titles.boundaries;
  const moves = [];
  const seen = new Set();
  const distance = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const oldLength = routes.reduce((sum, { relation }) => sum + distance(boxes.get(relation.from), boxes.get(relation.to)), 0);
  const content = {
    right: Math.max(...[...boxes.values()].map(box => box.x + box.width)),
    bottom: Math.max(...[...boxes.values()].map(box => box.y + box.height)),
  };
  const gap = 28;

  function propose(changed, group, anchor, movedFrames = []) {
    if (changed.some(box => box.pos || box.x < 40 || box.y < 40
        || box.x + box.width > content.right + 0.0001 || box.y + box.height > content.bottom + 0.0001)) return;
    const moved = new Map(boxes);
    const ids = new Set(changed.map(box => box.id));
    const others = [...boxes.values()].filter(box => !ids.has(box.id));
    for (const box of changed) {
      if (others.some(other => rectsOverlap(box, other, gap))
          || frames.some(frame => !frame.wraps.includes(box.id) && rectsOverlap(box, frame, 12))) return;
      moved.set(box.id, box);
    }
    if (movedFrames.some(frame => others.some(box => rectsOverlap(frame, box, 12)))) return;
    const sharedGain = group.reduce((sum, id) => sum + distance(anchor, boxes.get(id)) - distance(anchor, moved.get(id)), 0);
    if (sharedGain < 48) return;
    const gain = oldLength - routes.reduce((sum, { relation }) =>
      sum + distance(moved.get(relation.from), moved.get(relation.to)), 0);
    const key = JSON.stringify(changed.map(({ id, x, y }) => [id, x, y]));
    if (gain < 48 || seen.has(key)) return;
    seen.add(key);
    moves.push({ moved, gain });
  }

  for (const { anchor: anchorId, peers } of groups.values()) {
    if (peers.size < 2) continue;
    const anchor = boxes.get(anchorId);
    const ids = [...peers].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
    const peerFrames = ids.map(id => frames.filter(frame => frame.wraps.includes(id)));
    const outer = frames.filter(frame => frame.wraps.includes(anchorId)).sort((a, b) =>
      b.width * b.height - a.width * a.height)[0] ?? anchor;
    if (peerFrames.every(list => list.length === 1 && list[0] === peerFrames[0][0]) && peerFrames[0][0] !== outer) {
      const frame = peerFrames[0][0];
      const members = frame.wraps.map(id => boxes.get(id));
      if (members.some(member => !member)) continue; // Layout validation reports the unknown member.
      const positions = [
        [outer.x - frame.width - gap, frame.y],
        [outer.x + outer.width + gap, frame.y],
        [frame.x, outer.y - frame.height - gap],
        [frame.x, outer.y + outer.height + gap],
      ];
      for (const [x, y] of positions) {
        const moved = members.map(box => move(box, box.x + x - frame.x, box.y + y - frame.y));
        propose(moved, ids, anchor, [{ ...frame, x, y }]);
      }

      // A nearby card or frame can block translation of the whole scope.
      // In that case line up the peers on the face already toward the
      // anchor, retaining their order and leaving the other members put.
      const horizontal = Math.abs(anchor.cy - (frame.y + frame.height / 2))
        >= Math.abs(anchor.cx - (frame.x + frame.width / 2));
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const extent = horizontal ? 'width' : 'height';
      const thickness = horizontal ? 'height' : 'width';
      const boundary = horizontal ? content.right : content.bottom;
      const peers = ids.map(id => boxes.get(id)).sort((a, b) => a[along] - b[along] || a[across] - b[across]);
      const run = peers.reduce((sum, box) => sum + box[extent], (peers.length - 1) * gap);
      const near = (horizontal ? anchor.cy : anchor.cx) < frame[across] + frame[thickness] / 2;
      const rail = near ? Math.min(...peers.map(box => box[across]))
        : Math.max(...peers.map(box => box[across] + box[thickness]));
      const midpoint = horizontal ? anchor.cx : anchor.cy;
      for (const start of new Set([peers[0][along], frame[along] + gap, Math.min(boundary - run, midpoint - run / 2)])) {
        let at = start;
        const moved = peers.map(box => {
          const lane = near ? rail : rail - box[thickness];
          const candidate = move(box, horizontal ? at : lane, horizontal ? lane : at);
          at += box[extent] + gap;
          return candidate;
        });
        propose(moved, ids, anchor);
      }
    }
    const unframed = ids.filter((_, index) => !peerFrames[index].length);
    const sets = unframed.flatMap((first, index) => unframed.slice(index + 1).map(second => [first, second]));
    if (unframed.length > 2) sets.unshift(unframed);
    for (const set of sets) for (const horizontal of [true, false]) {
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const extent = horizontal ? 'width' : 'height';
      const thickness = horizontal ? 'height' : 'width';
      const members = set.map(id => boxes.get(id)).sort((a, b) => a[along] - b[along] || a[across] - b[across]);
      const run = members.reduce((sum, box) => sum + box[extent], (members.length - 1) * gap);
      const near = Math.max(...members.map(box => box[thickness]));
      const clearance = horizontal ? 48 : Math.max(52, ...routes.filter(({ relation }) =>
        set.includes(relation.from) && relation.to === anchorId || set.includes(relation.to) && relation.from === anchorId)
        .map(({ relation }) => horizontalLabelClearance(relation)));
      const low = outer[along];
      const high = low + outer[extent];
      for (const start of [low - run, low, (low + high - run) / 2, high - run, high]) {
        for (const lane of [outer[across] - near - clearance, outer[across] + outer[thickness] + clearance]) {
          let at = start;
          const changed = members.map(box => {
            const candidate = move(box, horizontal ? at : lane, horizontal ? lane : at);
            at += box[extent] + gap;
            return candidate;
          });
          propose(changed, set, anchor);
        }
      }
    }
  }
  return moves.sort((a, b) => b.gain - a.gain);
}

export function foldedChain({ boxes, routes, titles, viewBox }) {
  if (boxes.size < 7 || titles.boundaries.length || routes.length !== boxes.size - 1
      || viewBox[1] < 850 || viewBox[1] < viewBox[0] * 2.6) return null;
  const outgoing = new Map(routes.map(route => [route.relation.from, route.relation]));
  const targets = new Set(routes.map(route => route.relation.to));
  if (outgoing.size !== routes.length || targets.size !== routes.length) return null;
  const order = [];
  const seen = new Set();
  let id = [...boxes.keys()].find(key => !targets.has(key));
  while (id && !seen.has(id)) {
    seen.add(id);
    order.push(boxes.get(id));
    id = outgoing.get(id)?.to;
  }
  if (order.length !== boxes.size) return null;
  const split = Math.ceil(order.length / 2);
  const height = Math.max(...order.map(box => box.height));
  const leftWidth = Math.max(...order.slice(0, split).map(box => box.width));
  const rightWidth = Math.max(...order.slice(split).map(box => box.width));
  const gap = Math.max(72, horizontalLabelClearance(outgoing.get(order[split - 1].id)));
  const moved = new Map(boxes);
  for (const [index, box] of order.entries()) {
    const left = index < split;
    const y = left ? index : split * 2 - index - 1;
    moved.set(box.id, move(box, 48 + (left ? (leftWidth - box.width) / 2
      : leftWidth + gap + (rightWidth - box.width) / 2), 48 + y * (height + 60)));
  }
  return moved;
}

function layerOrder(components, connections, frames, vertical, bestOnly = false) {
  const [along, depth, across, span] = vertical
    ? ['y', 'height', 'x', 'width'] : ['x', 'width', 'y', 'height'];
  const alongCenter = box => box[along] + box[depth] / 2;
  const acrossCenter = box => box[across] + box[span] / 2;
  const scope = box => frames.map(frame => Number(frame.wraps.includes(box.id))).join('');
  const layers = [];
  const rank = new Map();
  const baseline = new Map();
  for (const box of [...components.values()].sort((a, b) => alongCenter(a) - alongCenter(b))) {
    const layer = layers.at(-1);
    if (layer && box[along] < layer.end && box[along] + box[depth] > layer.start) {
      layer.boxes.push(box);
      layer.start = Math.max(layer.start, box[along]);
      layer.end = Math.min(layer.end, box[along] + box[depth]);
    } else {
      layers.push({ boxes: [box], start: box[along], end: box[along] + box[depth] });
    }
    rank.set(box.id, layers.length - 1);
    baseline.set(box.id, acrossCenter(box));
  }
  if (layers.length < 2) return [];
  // Only exchange sibling slots. A structural frame still owns the same
  // cards, and a layer cannot trade slots across a frame interface.
  const bands = layers.map(({ boxes }) => {
    const groups = [];
    for (const box of boxes.sort((a, b) => acrossCenter(a) - acrossCenter(b))) {
      const key = scope(box);
      if (groups.at(-1)?.key !== key) groups.push({ key, slots: [], order: [] });
      groups.at(-1).slots.push(box);
      groups.at(-1).order.push(box);
    }
    return groups;
  });
  if (!bands.some(groups => groups.some(({ slots }) => slots.length > 1))) return [];

  const neighbors = new Map([...components.keys()].map(id => [id, []]));
  for (const { from, to } of connections) {
    if (from === to) continue;
    neighbors.get(from).push(to);
    neighbors.get(to).push(from);
  }
  const cross = new Map(baseline);
  function update({ slots, order }) {
    let position = slots[0][across];
    for (const [index, box] of order.entries()) {
      cross.set(box.id, position + box[span] / 2);
      const next = slots[index + 1];
      if (next) position += box[span] + next[across] - slots[index][across] - slots[index][span];
    }
  }
  function score() {
    // A skipped layer is a virtual point on the line between the real
    // endpoints. Intersecting the lines includes every strip they cross.
    const position = id => [rank.get(id), cross.get(id)];
    return connections.reduce((total, { from, to }, index) => total + connections.slice(index + 1).filter(other =>
      properSegmentIntersection(position(from), position(to), position(other.from), position(other.to))).length, 0);
  }
  const candidates = [];
  const initial = bestOnly ? score() : 0;
  let best = initial;
  function snapshot() {
    const crossings = bestOnly ? score() : 0;
    if (bestOnly && crossings >= best) return;
    const moved = new Map(components);
    for (const [id, center] of cross) {
      if (center === baseline.get(id)) continue;
      const box = components.get(id);
      moved.set(id, vertical ? move(box, center - box.width / 2, box.y) : move(box, box.x, center - box.height / 2));
    }
    if ([...moved].some(([id, box]) => box !== components.get(id))) {
      if (bestOnly) {
        candidates.length = 0;
        best = crossings;
      }
      candidates.push({ moved, improvement: initial - best });
    }
  }

  for (const direction of [1, -1, 1, -1]) {
    const order = direction === 1 ? bands : [...bands].reverse();
    for (const layer of order) {
      for (const band of layer) {
        if (band.order.length < 2) continue;
        const preferred = new Map(band.order.map(({ id }) => {
          const peers = neighbors.get(id).filter(other => (rank.get(id) - rank.get(other)) * direction > 0);
          const start = cross.get(id);
          const total = peers.reduce((sum, other) =>
            sum + start + (cross.get(other) - start) / Math.abs(rank.get(id) - rank.get(other)), 0);
          return [id, peers.length ? total / peers.length : baseline.get(id)];
        }));
        band.order.sort((a, b) => preferred.get(a.id) - preferred.get(b.id) || baseline.get(a.id) - baseline.get(b.id));
        update(band);
      }
    }
    snapshot();
  }

  let crossings = score();
  for (const groups of bands) {
    for (const band of groups) {
      for (let index = 1; index < band.order.length && crossings; index += 1) {
        const swap = () => {
          [band.order[index - 1], band.order[index]] = [band.order[index], band.order[index - 1]];
          update(band);
        };
        swap();
        const next = score();
        if (next < crossings) crossings = next;
        else swap();
      }
    }
  }
  snapshot();
  return candidates;
}

function* alignedLeafPositions(components, connections, frames, crossingPairs) {
  const right = Math.max(...[...components.values()].map(box => box.x + box.width));
  const bottom = Math.max(...[...components.values()].map(box => box.y + box.height));
  const gap = 24;
  const beside = (start, span, origin, depth) => start + span <= origin ? origin - span - gap
    : start >= origin + depth ? origin + depth + gap : start;
  for (const conn of new Set(crossingPairs.flat())) {
    for (const [id, peerId] of [[conn.from, conn.to], [conn.to, conn.from]]) {
      if (connections.some(other => other !== conn && (other.from === id || other.to === id))) continue;
      const box = components.get(id);
      const peer = components.get(peerId);
      if (frames.some(frame => frame.wraps.includes(id) !== frame.wraps.includes(peerId))) continue;
      const centeredX = peer.cx - box.width / 2;
      const centeredY = peer.cy - box.height / 2;
      const nearX = beside(box.x, box.width, peer.x, peer.width);
      const nearY = beside(box.y, box.height, peer.y, peer.height);
      for (const candidate of [
        move(box, centeredX, box.y),
        move(box, box.x, centeredY),
        // Try the corners of the adjacent lane when direct alignment still
        // puts the branch across a route which skips this peer's layer.
        move(box, peer.x - box.width - gap, nearY),
        move(box, peer.x + peer.width + gap, nearY),
        move(box, nearX, peer.y - box.height - gap),
        move(box, nearX, peer.y + peer.height + gap),
      ]) {
        if (candidate.x === box.x && candidate.y === box.y) continue;
        if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.width > right || candidate.y + candidate.height > bottom
          || [...components.values()].some(other => other !== box && rectsOverlap(candidate, other, gap))) continue;
        yield new Map(components).set(id, candidate);
      }
    }
  }
}

export function* crossingPlacementCandidates(components, connections, frames, crossingPairs) {
  const seen = new Set();
  for (const candidates of [
    layerOrder(components, connections, frames, true).map(({ moved }) => moved),
    layerOrder(components, connections, frames, false).map(({ moved }) => moved),
    alignedLeafPositions(components, connections, frames, crossingPairs),
  ]) {
    for (const moved of candidates) {
      const signature = JSON.stringify([...moved.values()].map(({ x, y }) => [x, y]));
      if (seen.has(signature)) continue;
      seen.add(signature);
      yield moved;
    }
  }
}

export function strongestLayerOrder(components, connections, frames) {
  return [true, false].flatMap(vertical => layerOrder(components, connections, frames, vertical, true))
    .sort((a, b) => b.improvement - a.improvement)[0]?.moved;
}

export function* frameAttachmentCandidates(components, connections, frames, crossingPairs) {
  const gap = 16;
  const endpoints = new Set(crossingPairs.flatMap(pair => pair.flatMap(({ from, to }) => [from, to])));
  for (const id of endpoints) {
    const neighbors = new Set(connections.flatMap(({ from, to }) => from === id ? [to] : to === id ? [from] : []));
    if (neighbors.size < 2 || neighbors.has(id)) continue;
    const box = components.get(id);
    for (const frame of frames) {
      if (frame.wraps.includes(id) || ![...neighbors].every(peer => frame.wraps.includes(peer))) continue;
      const peers = [...neighbors].map(peer => components.get(peer));
      const mean = key => peers.reduce((total, peer) => total + peer[key], 0) / peers.length;
      // A shared dependency can approach its own frame from the spare lane
      // before the next layer. Keep it on the same side of the frame.
      const options = [];
      if (box.y >= frame.y + frame.height) options.push(move(box, mean('cx') - box.width / 2, frame.y + frame.height + gap));
      if (box.y + box.height <= frame.y) options.push(move(box, mean('cx') - box.width / 2, frame.y - box.height - gap));
      if (box.x >= frame.x + frame.width) options.push(move(box, frame.x + frame.width + gap, mean('cy') - box.height / 2));
      if (box.x + box.width <= frame.x) options.push(move(box, frame.x - box.width - gap, mean('cy') - box.height / 2));
      for (const candidate of options) {
        if (candidate.x < 0 || candidate.y < 0
            || [...components.values()].some(other => other !== box && rectsOverlap(candidate, other, gap))) continue;
        yield new Map(components).set(id, candidate);
      }
    }
  }
}

export function* frameEnclosureCandidates(components, enclosures) {
  const gap = 24;
  const seen = new Set();
  const clear = (box, x, y) => {
    const key = JSON.stringify([box.id, x, y]);
    if (seen.has(key)) return null;
    seen.add(key);
    const candidate = move(box, x, y);
    return x >= 0 && y >= 0 && (x !== box.x || y !== box.y)
      && [...components.values()].every(other => other === box || !rectsOverlap(candidate, other, gap))
      ? new Map(components).set(box.id, candidate) : null;
  };
  for (const { frame, box } of enclosures) {
    for (const [x, y] of [
      [frame.x - box.width - gap, box.y],
      [frame.x + frame.width + gap, box.y],
      [box.x, frame.y - box.height - gap],
      [box.x, frame.y + frame.height + gap],
    ]) {
      const moved = clear(box, x, y);
      if (moved) yield moved;
    }
  }

  for (const frame of new Set(enclosures.map(({ frame }) => frame))) {
    const members = frame.wraps.map(id => components.get(id)).filter(Boolean);
    if (members.length < 2) continue;
    // Bringing an outer member beside its nearest sibling can remove an
    // entire empty bay from the frame, including several enclosed outsiders.
    const extremes = new Set([
      (a, b) => a.x - b.x,
      (a, b) => b.x + b.width - a.x - a.width,
      (a, b) => a.y - b.y,
      (a, b) => b.y + b.height - a.y - a.height,
    ].map(order => [...members].sort(order)[0]));
    for (const box of extremes) {
      const distance = other => Math.abs(other.cx - box.cx) + Math.abs(other.cy - box.cy);
      const peer = members.filter(other => other !== box).sort((a, b) => distance(a) - distance(b))[0];
      for (const [x, y] of [
        [peer.x - box.width - gap, peer.y],
        [peer.x + peer.width + gap, peer.y],
        [peer.x, peer.y - box.height - gap],
        [peer.x, peer.y + peer.height + gap],
      ]) {
        const moved = clear(box, x, y);
        if (moved) yield moved;
      }
    }
  }
}

export function* sharedSinkColumnCandidates({ boxes, routes }) {
  const incoming = new Map([...boxes.keys()].map(id => [id, new Set()]));
  const outgoing = new Map([...boxes.keys()].map(id => [id, []]));
  for (const { relation } of routes) {
    incoming.get(relation.to).add(relation.from);
    outgoing.get(relation.from).push(relation);
  }
  const shared = [...boxes.values()].filter(box => !outgoing.get(box.id).length && incoming.get(box.id).size >= 2);
  if (shared.length < 3 || shared.length > 5) return;
  const hubIds = new Set(shared.flatMap(sink => [...incoming.get(sink.id)]));
  if (hubIds.size < 2 || hubIds.size > 3) return;
  const hubs = [...hubIds].map(id => boxes.get(id)).sort((a, b) => a.cy - b.cy);
  if (hubs.some(hub => shared.filter(sink => incoming.get(sink.id).has(hub.id)).length < 3)) return;
  const sinks = [...boxes.values()].filter(box => !outgoing.get(box.id).length
    && incoming.get(box.id).size && [...incoming.get(box.id)].every(id => hubIds.has(id)));
  if (sinks.length > shared.length + 1) return;
  const sinkIds = new Set(sinks.map(box => box.id));
  const fan = new Set(hubs.flatMap(hub => outgoing.get(hub.id).filter(relation => sinkIds.has(relation.to))));
  const entry = [...boxes.values()].filter(box => !incoming.get(box.id).size && outgoing.get(box.id).length === 1
    && hubIds.has(outgoing.get(box.id)[0].to));
  if (hubs.length + sinks.length + entry.length !== boxes.size || entry.length > 1
      || hubs.some(hub => outgoing.get(hub.id).some(relation => !fan.has(relation)))) return;
  const labelGap = [...fan].reduce((gap, relation) => Math.max(gap, horizontalLabelClearance(relation)), 84);
  const withEntry = entry[0] && outgoing.get(entry[0].id)[0];
  const leftHub = withEntry ? hubs.find(hub => hub.id === withEntry.to) : hubs[0];
  const rightHub = hubs.findLast(hub => hub !== leftHub);
  const leftHubs = hubs.filter(hub => hub !== rightHub);
  const leftEdge = Math.max(...leftHubs.map(hub => hub.width)) + 48
    + (withEntry ? entry[0].width + Math.max(84, horizontalLabelClearance(withEntry)) : 0);
  const sinkWidth = Math.max(...sinks.map(sink => sink.width));

  // A hub on the far side of the column gives its links their own corridor.
  // Keep the entry on the outside so its link does not pass through the fan.
  // Two hubs on one side need separate paths past each other. Set the
  // lower hub closer to the sinks and leave enough space for both lanes.
  const corridors = hubs.length === 2 ? [[labelGap - 36, 0], [labelGap, 0]] : [[labelGap, 36], [labelGap, 60]];
  for (const rowGap of [40, 64]) for (const [gap, stagger] of corridors) {
    for (const centered of [false, true]) {
      const moved = new Map(boxes);
      const height = sinks.reduce((sum, sink) => sum + sink.height, rowGap * (sinks.length - 1));
      for (const group of [leftHubs, [rightHub]]) for (const [index, hub] of group.entries()) {
        const cy = group.length === 1
          ? 48 + height * (centered ? (hub === leftHub ? 0.375 : 0.625) : 0.5)
          : 48 + height * (index + 0.5) / group.length;
        moved.set(hub.id, move(hub, hub === rightHub ? leftEdge + 2 * gap + sinkWidth : leftEdge - hub.width + (index ? stagger : 0),
          Math.max(48, cy - hub.height / 2)));
      }
      if (withEntry) {
        const box = entry[0];
        moved.set(box.id, move(box, 48, moved.get(leftHub.id).cy - box.height / 2));
      }
      const barycenter = sink => [...incoming.get(sink.id)].reduce((sum, id) => sum + moved.get(id).cy, 0)
        / incoming.get(sink.id).size;
      const ordered = [...sinks].sort((a, b) => barycenter(a) - barycenter(b) || a.cy - b.cy);
      let y = 48;
      for (const sink of ordered) {
        moved.set(sink.id, move(sink, leftEdge + gap + (sinkWidth - sink.width) / 2, y));
        y += sink.height + rowGap;
      }
      if (!cardsHaveClearance(moved)) continue;
      for (const elbow of [true, false]) {
        const sideFor = (relation, endpoint) => {
          if (!fan.has(relation)) return;
          const source = moved.get(relation.from);
          const sink = moved.get(relation.to);
          const right = source.cx < sink.cx;
          if (endpoint === 'source') return right ? 'right' : 'left';
          if (elbow && Math.abs(source.cy - sink.cy) >= (source.height + sink.height) / 2 - 18) {
            return source.cy < sink.cy ? 'top' : 'bottom';
          }
          return right ? 'left' : 'right';
        };
        yield { boxes: moved, sideFor, fan };
      }
    }
  }
}

function cardsHaveClearance(boxes) {
  const cards = [...boxes.values()];
  return cards.every((box, index) => cards.slice(index + 1).every(other => !rectsOverlap(box, other, 24)));
}

export function* chainReflowCandidates({ boxes, routes, viewBox: [width, height] }) {
  const horizontal = width > 1050 && width > height * 1.9;
  if (!horizontal && (height < 720 || height < width * 1.3)) return;
  const axis = horizontal ? 0 : 1;
  const along = horizontal ? 'x' : 'y';
  const across = horizontal ? 'y' : 'x';
  const depth = horizontal ? 'width' : 'height';
  const breadth = horizontal ? 'height' : 'width';
  const alongCenter = box => box[along] + box[depth] / 2;
  const acrossCenter = box => box[across] + box[breadth] / 2;
  const place = (box, depthPosition, breadthPosition) => horizontal
    ? move(box, depthPosition, breadthPosition) : move(box, breadthPosition, depthPosition);
  const cards = [...boxes.values()].sort((a, b) => alongCenter(a) - alongCenter(b));
  const outgoing = new Map(cards.map(card => [card.id, []]));
  for (const { relation } of routes) {
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    if (to[along] > from[along] + from[depth]) outgoing.get(from.id).push(to.id);
  }
  // Forward edges are acyclic on the long axis, even when the full graph
  // includes return links. Find the longest forward chain in one sweep.
  const tails = new Map();
  for (const box of cards.slice().reverse()) {
    let tail = [];
    for (const next of outgoing.get(box.id)) {
      if (tails.get(next).length > tail.length) tail = tails.get(next);
    }
    tails.set(box.id, [box, ...tail]);
  }
  const order = [...tails.values()].sort((a, b) => b.length - a.length)[0];
  if (order.length < 6 || order.length > 9 || boxes.size - order.length > 3
      || order.slice(1).filter((box, index) => Math.abs(acrossCenter(box) - acrossCenter(order[index])) < box[breadth] / 2).length
        < order.length - 2) return;
  const sides = cards.filter(box => !order.includes(box));
  if (!horizontal && !sides.length) return; // The earlier pure-chain fold handles this shape.
  const slotDepth = Math.max(...cards.map(box => box[depth]));
  const laneBreadth = Math.max(...order.map(box => box[breadth]));
  const labelGap = routes.reduce((gap, { relation }) => Math.max(gap, horizontalLabelClearance(relation)), 84);
  const sideGap = horizontal ? 56 : labelGap;
  const orderByRank = box => (a, b) => Math.abs(alongCenter(a) - alongCenter(box)) - Math.abs(alongCenter(b) - alongCenter(box));
  const peerRanks = sides.map(box => {
    const peers = new Set(routes.flatMap(({ relation }) =>
      relation.from === box.id ? [relation.to] : relation.to === box.id ? [relation.from] : []));
    return order.filter(card => peers.has(card.id)).sort(orderByRank(box))[0];
  });
  // A side card needs its own attachment to the chain. Moving an entire
  // side branch would change its internal spacing and label slots.
  if (peerRanks.some(peer => !peer)) return;
  const nearestRanks = sides.map(box => [...order].sort(orderByRank(box))[0]);
  function* fit(moved) {
    const inset = Math.min(...[...moved.values()].map(box => box[across]));
    for (const [id, box] of moved) moved.set(id, place(box, box[along], box[across] - inset + 48));
    if (cardsHaveClearance(moved)) yield { boxes: moved, axis };
  }
  if (!horizontal) {
    // Shorten a chain in place when folding would complicate its extra links.
    for (const gap of [36, 44]) {
      const moved = new Map(boxes);
      for (const [rank, box] of order.entries()) {
        moved.set(box.id, place(box, 48 + rank * (slotDepth + gap), box[across]));
      }
      for (const [i, box] of sides.entries()) {
        const peer = peerRanks[i];
        const anchor = moved.get(peer.id);
        const pos = acrossCenter(box) >= acrossCenter(peer)
          ? anchor[across] + anchor[breadth] + sideGap : anchor[across] - box[breadth] - sideGap;
        moved.set(box.id, place(box, alongCenter(anchor) - box[depth] / 2, pos));
      }
      yield* fit(moved);
    }
  }
  const midpoint = Math.ceil(order.length / 2);
  for (const split of [midpoint, midpoint + 1, midpoint - 1]) {
    for (const laneGap of [sideGap + 32, sideGap + 110]) {
      for (const usePeerRank of [true, false]) {
        const step = slotDepth + (horizontal ? labelGap : 56);
        const moved = new Map(boxes);
        for (const [index, box] of order.entries()) {
          const firstLane = index < split;
          const rank = firstLane ? index : 2 * split - index - 1;
          const offset = Math.max(0, order.length - 2 * split);
          moved.set(box.id, place(box, 48 + (rank + offset) * step + (slotDepth - box[depth]) / 2,
            48 + (firstLane ? 0 : laneBreadth + laneGap) + (laneBreadth - box[breadth]) / 2));
        }
        for (const [i, box] of sides.entries()) {
          const peer = (usePeerRank ? peerRanks[i] : undefined) ?? nearestRanks[i];
          const anchor = moved.get(peer.id);
          const outer = acrossCenter(anchor) > 48 + laneBreadth;
          const pos = outer ? anchor[across] + anchor[breadth] + sideGap + 24 : anchor[across] - box[breadth] - sideGap - 24;
          moved.set(box.id, place(box, alongCenter(anchor) - box[depth] / 2 + (usePeerRank ? 0 : i * step), pos));
        }
        yield* fit(moved);
      }
    }
  }
}

const placementAxes = [
  { start: 'x', size: 'width', center: 'cx' },
  { start: 'y', size: 'height', center: 'cy' },
];

function obstructedAxis(from, to, boxes) {
  for (const [axis, along] of placementAxes.entries()) {
    const across = placementAxes[1 - axis];
    const low = Math.min(from[along.start] + from[along.size], to[along.start] + to[along.size]);
    const high = Math.max(from[along.start], to[along.start]);
    const lane = (from[across.center] + to[across.center]) / 2;
    if (low >= high || Math.abs(from[across.center] - to[across.center]) > 12) continue;
    const blockers = [...boxes.values()].filter(box => box[along.start] >= low
      && box[along.start] + box[along.size] <= high
      && box[across.start] < lane && box[across.start] + box[across.size] > lane);
    if (blockers.length) return { axis, blockers };
  }
}

export function blockedLinkCount({ boxes, routes }) {
  return routes.filter(({ relation, points }) => points.length > 2
    && obstructedAxis(boxes.get(relation.from), boxes.get(relation.to), boxes)).length;
}

export function* directLinkCandidates({ boxes, routes }) {
  const neighbors = new Map([...boxes.keys()].map(id => [id, new Map()]));
  for (const { relation } of routes) {
    neighbors.get(relation.from).set(relation.to, relation);
  }
  const peers = id => [...boxes.keys()].filter(other => id !== other
    && (neighbors.get(id).has(other) || neighbors.get(other).has(id)));
  const considered = new Set();
  const targets = [];
  for (const { relation, points } of routes) {
    const { from, to } = relation;
    if (from === to || points.length <= 2 || considered.has(relation)) continue;
    const reverse = neighbors.get(to).get(from);
    const obstruction = obstructedAxis(boxes.get(from), boxes.get(to), boxes);
    if (!obstruction && !reverse) continue;
    const links = reverse ? [relation, reverse] : [relation];
    for (const link of links) considered.add(link);
    targets.push({ links, obstruction, first: boxes.get(from), second: boxes.get(to) });
  }
  // Spend the routing budget on blocked reciprocal links first, then
  // blocked one-way links, then pairs that only need alignment.
  const priority = ({ obstruction, links }) => obstruction ? links.length : 0;
  targets.sort((a, b) => priority(b) - priority(a));
  for (const { links, obstruction, first, second } of targets) {
    const gap = links.reduce((value, link) => Math.max(value, horizontalLabelClearance(link)), 96);
    if (!obstruction) {
      for (const axis of [0, 1]) {
        const along = placementAxes[axis];
        const across = placementAxes[1 - axis];
        for (const [anchor, peer] of [[first, second], [second, first]]) {
          const pos = (peer[along.center] < anchor[along.center]
            ? anchor[along.start] - peer[along.size] : anchor[along.start] + anchor[along.size]);
          const direction = peer[along.center] < anchor[along.center] ? -1 : 1;
          const beside = [peer[along.start], pos + direction * (axis ? 76 : gap)];
          for (const start of beside) {
            const aligned = anchor[across.center] - peer[across.size] / 2;
            const moved = new Map(boxes).set(peer.id, axis ? move(peer, aligned, start) : move(peer, start, aligned));
            if (cardsHaveClearance(moved)) yield { boxes: moved, links };
          }
        }
      }
      continue;
    }
    const { axis, blockers } = obstruction;
    if (blockers.length !== 1) continue;
    const [blocker] = blockers;
    // A separate one-way input enters this flow at the intermediate card.
    // Keep that entry path in place instead of moving it with the shortcut.
    if (peers(blocker.id).some(id => id !== first.id && id !== second.id
        && neighbors.get(id).has(blocker.id) && !neighbors.get(blocker.id).has(id))) continue;
    const along = placementAxes[axis];
    const across = placementAxes[1 - axis];
    const place = (box, a, b) => axis ? move(box, b, a) : move(box, a, b);
    const [leading, trailing] = first[along.start] < second[along.start] ? [first, second] : [second, first];
    const leavesOf = id => peers(id).filter(peer => peers(peer).length === 1);
    const leaves = leavesOf(blocker.id).map(id => boxes.get(id));
    const partner = leaves.find(box => neighbors.get(box.id).has(blocker.id) && neighbors.get(blocker.id).has(box.id));
    const [leadingSide, trailingSide] = axis ? ['top', 'bottom'] : ['left', 'right'];
    const acrossSides = axis ? ['left', 'right'] : ['top', 'bottom'];
    function* fit(moved, direction) {
      const sideFor = (link, endpoint) => {
        const id = endpoint === 'source' ? link.from : link.to;
        if (links.includes(link)) return id === leading.id ? trailingSide : leadingSide;
        const peer = endpoint === 'source' ? link.to : link.from;
        if (id === blocker.id && (peer === leading.id || peer === trailing.id)) return peer === leading.id ? leadingSide : trailingSide;
        if (peer === blocker.id && (id === leading.id || id === trailing.id)) return acrossSides[direction > 0 ? 1 : 0];
      };
      if (!cardsHaveClearance(moved)) return;
      yield { boxes: moved, links, sideFor };
      const aligned = new Map(moved);
      for (const endpoint of [leading, trailing]) for (const id of leavesOf(endpoint.id)) {
        const anchor = moved.get(endpoint.id);
        const leaf = moved.get(id);
        if (Math.abs(leaf[across.center] - anchor[across.center]) < (leaf[across.size] + anchor[across.size]) / 2 + 24) continue;
        const next = place(leaf, anchor[along.center] - leaf[along.size] / 2, leaf[across.start]);
        if (next[along.start] === leaf[along.start]
            || [...aligned.values()].some(box => box.id !== id && rectsOverlap(box, next, 24))) continue;
        aligned.set(id, next);
      }
      if ([...aligned.values()].some(box => moved.get(box.id) !== box)) yield { boxes: aligned, links, sideFor };
    }
    const originalGap = trailing[along.start] - leading[along.start] - leading[along.size];
    const minimumGap = axis ? 72 : gap;
    const gaps = new Set([minimumGap, blocker[along.size] + 20, blocker[along.size] + 56, originalGap]
      .map(value => Math.min(originalGap, Math.max(minimumGap, value))));
    const adjacentGaps = axis ? [56, 88] : [72, 104];
    for (const targetGap of gaps) for (const direction of [1, -1]) for (const spacing of adjacentGaps) {
      const moved = new Map(boxes);
      const shift = targetGap - originalGap;
      for (const [id, box] of boxes) {
        if (box[along.center] >= trailing[along.center]) {
          moved.set(id, place(box, box[along.start] + shift, box[across.start]));
        }
      }
      const near = direction > 0
        ? Math.max(leading[across.start] + leading[across.size], trailing[across.start] + trailing[across.size])
        : Math.min(leading[across.start], trailing[across.start]) - blocker[across.size];
      // Center the displaced card between the facing edges. With unequal
      // endpoint widths, centering between the cards can crowd one elbow.
      const blockerAlong = (leading[along.start] + leading[along.size] + moved.get(trailing.id)[along.start]
        - blocker[along.size]) / 2;
      const blockerAcross = near + direction * spacing;
      moved.set(blocker.id, place(blocker, blockerAlong, blockerAcross));
      yield* fit(new Map(moved), direction);
      if (!partner) continue;
      const beyond = direction > 0 ? blockerAcross + blocker[across.size] : blockerAcross - partner[across.size];
      moved.set(partner.id, place(partner, blockerAlong + (blocker[along.size] - partner[along.size]) / 2,
        beyond + direction * spacing));
      yield* fit(moved, direction);
      for (const other of leaves) {
        if (other === partner) continue;
        const otherGap = Math.max(96, horizontalLabelClearance(neighbors.get(blocker.id).get(other.id)
          ?? neighbors.get(other.id).get(blocker.id)));
        const side = other[along.center] < blocker[along.center] ? -1 : 1;
        const pos = side > 0 ? blockerAlong + blocker[along.size] + otherGap : blockerAlong - other[along.size] - otherGap;
        const alternate = new Map(moved).set(other.id, place(other, pos,
          blockerAcross + (blocker[across.size] - other[across.size]) / 2));
        yield* fit(alternate, direction);
      }
    }
  }
}
