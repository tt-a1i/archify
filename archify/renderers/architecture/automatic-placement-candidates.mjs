import { properSegmentIntersection, rectsOverlap } from '../shared/geometry.mjs';
import { analyzeSvgPath } from '../shared/svg-path-analysis.mjs';

function pointOnSegment(point, { start, end }) {
  const [x, y] = point;
  return x >= Math.min(start[0], end[0]) && x <= Math.max(start[0], end[0])
    && y >= Math.min(start[1], end[1]) && y <= Math.max(start[1], end[1])
    && Math.abs((end[0] - start[0]) * (y - start[1])
      - (end[1] - start[1]) * (x - start[0])) <= 0.0001;
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function raysAlternate(point, a, b, c, d) {
  const rays = [a, b, c, d].map(([x, y], index) => ({
    angle: Math.atan2(y - point[1], x - point[0]), path: index < 2,
  })).sort((left, right) => left.angle - right.angle);
  return rays.every((ray, index) => {
    const next = rays[(index + 1) % rays.length];
    const angle = next.angle - ray.angle + (index === rays.length - 1 ? 2 * Math.PI : 0);
    return ray.path !== next.path && angle > 1e-9;
  });
}

function crossesAtInteriorVertex(points, other) {
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    for (let j = 1; j < other.length; j += 1) {
      const start = other[j - 1];
      const end = other[j];
      if (!pointOnSegment(point, { start, end }) || samePoint(point, end)) continue;
      // Inspect an interior vertex of the other path only on its outgoing
      // segment. True endpoints have one ray and cannot form a crossing.
      const before = samePoint(point, start) ? other[j - 2] : start;
      if (before && raysAlternate(point, points[i - 1], points[i + 1], before, end)) return true;
    }
  }
  return false;
}

function pathsCross(left, right) {
  if (left.maxX < right.minX || right.maxX < left.minX || left.maxY < right.minY || right.maxY < left.minY) return false;
  return left.segments.some(a => right.segments.some(b => properSegmentIntersection(a.start, a.end, b.start, b.end)))
    || crossesAtInteriorVertex(left.points, right.points) || crossesAtInteriorVertex(right.points, left.points);
}

export function measuredCrossingPairs(routes) {
  const paths = routes.map(({ d }) => analyzeSvgPath(d).subpaths.map(part => {
    const points = part.points.filter((point, index, points) => !index || !samePoint(points[index - 1], point));
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      segments: part.segments, points,
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }));
  return routes.flatMap(({ relation }, index) => routes.slice(index + 1).flatMap(({ relation: other }, offset) =>
    paths[index].some(a => paths[index + offset + 1].some(b => pathsCross(a, b)))
      ? [[relation, other]] : []));
}

function move(box, x, y) {
  return { ...box, x, y, cx: x + box.width / 2, cy: y + box.height / 2 };
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
