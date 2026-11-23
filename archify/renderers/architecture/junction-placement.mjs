import { normalizeRoutePoints, properSegmentIntersection, rectsOverlap, segmentIntersectsRect } from '../shared/geometry.mjs';
import { horizontalLabelClearance } from './routing.mjs';

const axes = [
  { pos: 'x', size: 'width', center: 'cx' },
  { pos: 'y', size: 'height', center: 'cy' },
];

function move(box, cx, cy) {
  return { ...box, cx, cy, x: cx - box.width / 2, y: cy - box.height / 2 };
}

function projectedPath(from, to, others, straightOnly = false) {
  const clear = (start, end) => others.every(box => !segmentIntersectsRect({ start, end }, box, 6));
  const paths = [];
  for (const axis of [0, 1]) {
    const along = axes[axis];
    const across = axes[1 - axis];
    const forward = from[along.center] < to[along.center];
    const start = from[along.pos] + (forward ? from[along.size] : 0);
    const end = to[along.pos] + (forward ? 0 : to[along.size]);
    if (forward ? end <= start : end >= start) continue;
    const point = (a, b) => axis ? [b, a] : [a, b];
    const lo = Math.max(from[across.pos], to[across.pos]) + 8;
    const hi = Math.min(from[across.pos] + from[across.size], to[across.pos] + to[across.size]) - 8;
    if (lo <= hi) {
      for (const lane of [(lo + hi) / 2, lo, hi]) {
        const a = point(start, lane);
        const b = point(end, lane);
        if (clear(a, b)) return [a, b];
      }
    }
    if (straightOnly) continue;
    const lane = from[across.center];
    const corner = point(to[along.center], lane);
    const a = point(start, lane);
    const b = point(to[along.center], to[across.pos] + (lane > to[across.center] ? to[across.size] : 0));
    if (Math.abs(lane - to[across.center]) > to[across.size] / 2 && clear(a, corner) && clear(corner, b)) {
      paths.push([a, corner, b]);
    }
  }
  return paths[0];
}

function segments(points) {
  return points.slice(1).map((end, i) => [points[i], end]);
}

function length(points) {
  return segments(points).reduce((sum, [[x, y], [u, v]]) => sum + Math.abs(x - u) + Math.abs(y - v), 0);
}

export function junctionCandidates({ boxes, routes, titles, viewBox }, limit) {
  const incoming = new Map();
  const outgoing = new Map();
  const add = (map, id, peer) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(peer);
  };
  for (const { relation: { from, to, variant } } of routes) {
    if (from === to || variant === 'dashed') continue;
    add(outgoing, from, to);
    add(incoming, to, from);
  }
  const cards = [...boxes.values()];
  const proposals = [];
  const frames = titles.boundaries;
  const routeSegments = routes.map(route => segments(route.points));
  const routeLengths = routes.map(route => length(route.points));
  const touches = ({ relation }, id) => relation.from === id || relation.to === id;
  for (const direction of [incoming, outgoing]) {
    for (const [id, peers] of direction) {
      if (peers.size < 3) continue;
      const hub = boxes.get(id);
      const links = routes.filter(route => touches(route, id));
      if (links.filter(({ points }) => length(points) >= 180).length < 2) continue;
      const neighbors = [...peers].map(peer => boxes.get(peer));
      const otherCards = cards.filter(box => box !== hub);
      const labelGap = links.reduce((gap, { relation }) => Math.max(gap, horizontalLabelClearance(relation)), 92);
      const centers = axes.map(({ pos, size, center }, axis) => {
        const coordinates = new Set([hub[center], neighbors.reduce((sum, box) => sum + box[center], 0) / neighbors.length]);
        for (const box of neighbors) {
          coordinates.add(box[center]);
          coordinates.add(box[center] + 20);
          coordinates.add(box[center] - 20);
          for (const gap of axis ? [40, 68] : [92, labelGap]) {
            coordinates.add(box[pos] - gap - hub[size] / 2);
            coordinates.add(box[pos] + box[size] + gap + hub[size] / 2);
          }
        }
        // Adjacent lanes may both reach the junction through overlapping
        // ports even when the mean of the whole group misses their span.
        const ordered = [...neighbors].sort((a, b) => a[center] - b[center]);
        for (let i = 1; i < ordered.length; i++) {
          coordinates.add((ordered[i - 1][center] + ordered[i][center]) / 2);
        }
        for (const box of otherCards) {
          const gap = axis ? 68 : labelGap;
          coordinates.add(box[pos] - gap - hub[size] / 2);
          coordinates.add(box[pos] + box[size] + gap + hub[size] / 2);
        }
        return coordinates;
      });
      const fixedSegments = routeSegments.filter((_, i) => !touches(routes[i], id)).flat();
      const before = routeLengths.reduce((sum, value, i) => sum + (touches(routes[i], id) ? value : 0), 0);
      const candidates = [];
      for (const x of centers[0]) for (const y of centers[1]) {
        if (x === hub.cx && y === hub.cy) continue;
        const moved = move(hub, x, y);
        if (moved.x < 48 || moved.y < 48 || moved.x + moved.width > viewBox[0] - 40
            || moved.y + moved.height > viewBox[1] - 40 || otherCards.some(box => rectsOverlap(moved, box, 32))
            || frames.some(frame => !frame.wraps.includes(id) && rectsOverlap(moved, frame, 12))) continue;
        const occupied = [...fixedSegments];
        let estimate = 0;
        let crossings = 0;
        let portRoom = 0;
        const sides = new Map();
        for (const { relation } of links) {
          const from = relation.from === id ? moved : boxes.get(relation.from);
          const to = relation.to === id ? moved : boxes.get(relation.to);
          const others = otherCards.filter(box => box !== from && box !== to);
          const path = projectedPath(from, to, others) ?? projectedPath(to, from, others)?.reverse();
          if (!path) {
            estimate += Math.abs(from.cx - to.cx) + Math.abs(from.cy - to.cy) + 60;
            continue;
          }
          estimate += length(path) + (path.length - 2) * 20;
          if (path.length === 2) {
            const { pos, size } = axes[path[0][0] === path[1][0] ? 0 : 1];
            portRoom += Math.min(60, Math.min(from[pos] + from[size], to[pos] + to[size]) - Math.max(from[pos], to[pos]));
          }
          for (const [a, b] of segments(path)) {
            for (const [c, d] of occupied) {
              if (properSegmentIntersection(a, b, c, d)) crossings++;
            }
            occupied.push([a, b]);
          }
          const side = ([x, y], box) => x === box.x ? 'left' : x === box.x + box.width ? 'right'
            : y === box.y ? 'top' : 'bottom';
          sides.set(relation, [side(path[0], from), side(path.at(-1), to)]);
        }
        if (estimate >= before - 48) continue;
        const distance = neighbors.reduce((sum, box) => sum + Math.abs(x - box.cx) + Math.abs(y - box.cy), 0);
        const score = (estimate + crossings * 100 + distance * 0.12 - portRoom) / before;
        candidates.push({ moved, sides, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      const spread = center => {
        let low = Infinity;
        let high = -Infinity;
        for (const box of neighbors) {
          low = Math.min(low, box[center]);
          high = Math.max(high, box[center]);
        }
        return high - low;
      };
      const along = spread('cx') < spread('cy') ? 'cx' : 'cy';
      const across = along === 'cx' ? 'cy' : 'cx';
      const seen = new Set();
      const testedPerLane = new Map();
      for (const { moved, sides, score } of candidates) {
        const lane = Math.floor(moved[along] / 64);
        const key = `${lane}:${Math.round(moved[across] / 16)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const order = testedPerLane.get(lane) ?? 0;
        testedPerLane.set(lane, order + 1);
        proposals.push({ moved, sides, score: score + order * 0.045 });
      }
    }
  }
  return proposals.sort((a, b) => a.score - b.score).slice(0, limit).map(({ moved, sides }) => ({
    boxes: new Map(boxes).set(moved.id, moved),
    junction: moved.id,
    sideFor: (relation, endpoint) => sides.get(relation)?.[endpoint === 'source' ? 0 : 1],
  }));
}

export function junctionBends({ routes, boxes }) {
  let bends = 0;
  let avoidable = 0;
  for (const { points, relation } of routes) {
    const steps = segments(normalizeRoutePoints(points));
    const count = Math.max(0, steps.length - 1);
    bends += count;
    if (!count || relation.from === relation.to) continue;
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const others = [...boxes.values()].filter(box => box !== from && box !== to);
    if (projectedPath(from, to, others, true)
        || (count > 1 && (projectedPath(from, to, others) || projectedPath(to, from, others)))) avoidable++;
    for (let i = 1; i + 1 < steps.length; i++) {
      const [[x, y], [u, v]] = steps[i];
      const [before, , after] = steps.slice(i - 1, i + 2).map(([[a, b], [c, d]]) => [c - a, d - b]);
      if (Math.abs(x - u) + Math.abs(y - v) < 28 && (before[0] * after[0] > 0 || before[1] * after[1] > 0)) {
        avoidable++;
        break;
      }
    }
  }
  return { bends, avoidable };
}
