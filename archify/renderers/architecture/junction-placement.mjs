import { normalizeRoutePoints, properSegmentIntersection, rectsOverlap, segmentIntersectsRect } from '../shared/geometry.mjs';
import { cardsHaveClearance } from './automatic-placement-candidates.mjs';
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

// Try open slots for terminals on crossing routes or beside their hubs. Projected
// paths only prioritize the slots. The renderer routes and checks each finalist.
function clearsFrames(box, frames) {
  return frames.every(frame => !rectsOverlap(frame, box, 20));
}

function compactSinkSlots(box, parents, cards, frames) {
  const distances = (cx, cy) => parents.map(parent => Math.abs(parent.cx - cx) + Math.abs(parent.cy - cy));
  const before = distances(box.cx, box.cy);
  const xs = new Set(cards.map(card => card.cx));
  const ys = new Set(cards.map(card => card.cy));
  const slots = [];
  for (const cx of xs) for (const cy of ys) {
    if (!parents.some(parent => parent.cx === cx || parent.cy === cy)) continue;
    const savings = distances(cx, cy).map((distance, i) => before[i] - distance);
    if (savings.some(delta => delta < -8)) continue;
    const total = savings.reduce((sum, delta) => sum + delta, 0);
    if (total < 96) continue;
    const moved = move(box, cx, cy);
    if (moved.x < 40 || moved.y < 40 || !clearsFrames(moved, frames)
        || cards.some(card => card !== box && rectsOverlap(card, moved, 28))) continue;
    slots.push({ moved, total });
  }
  return slots.sort((a, b) => b.total - a.total).slice(0, 2).map(({ moved }) => moved);
}

function transposeFrame(frame, boxes, routes, affected) {
  if (frame.wraps.length < 2 || frame.wraps.length > 3) return;
  const members = new Set(frame.wraps);
  const peers = frame.wraps.map(id => boxes.get(id));
  if (peers.some(peer => !peer)) return;
  const touches = ({ from, to }) => members.has(from) || members.has(to);
  if (![...affected].some(touches)
      || routes.some(({ relation: { from, to } }) => members.has(from) && members.has(to))) return;
  const along = axes.findIndex(({ center }, axis) => peers.every(peer =>
    Math.abs(peer[axes[1 - axis].center] - peers[0][axes[1 - axis].center]) <= 8)
    && peers.some(peer => peer[center] !== peers[0][center]));
  if (along === -1) return;
  const across = axes[along];
  const { pos, size, center } = axes[1 - along];
  const barycenter = peer => {
    const neighbors = routes.flatMap(({ relation: { from, to } }) =>
      from === peer.id ? [boxes.get(to)] : to === peer.id ? [boxes.get(from)] : []);
    return neighbors.length ? neighbors.reduce((sum, box) => sum + box[center], 0) / neighbors.length : peer[center];
  };
  const origin = Math.min(...peers.map(peer => peer[pos]));
  const lane = Math.min(...peers.map(peer => peer[across.pos]))
    + Math.max(...peers.map(peer => peer[across.size])) / 2;
  const ordered = peers.map(peer => ({ peer, order: barycenter(peer) })).sort((a, b) => a.order - b.order);
  const moved = new Map(boxes);
  let start = origin;
  for (const { peer } of ordered) {
    const nextCenter = start + peer[size] / 2;
    moved.set(peer.id, along === 0 ? move(peer, lane, nextCenter) : move(peer, nextCenter, lane));
    start += peer[size] + 64;
  }
  if (cardsHaveClearance(moved)) return { boxes: moved };
}

export function denseTerminalCandidates({ boxes, routes, titles }, crossingPairs, { limit, refine }) {
  const cards = [...boxes.values()];
  const frames = titles?.boundaries ?? [];
  const unframed = box => frames.every(frame => !frame.wraps.includes(box.id));
  const affected = new Set(crossingPairs.flat());
  const crossedCards = new Set([...affected].flatMap(({ from, to }) => [from, to]));
  const crossedFrameMembers = new Set(frames.filter(frame => frame.wraps.some(id => crossedCards.has(id)))
    .flatMap(frame => frame.wraps));
  const crossingEndpoints = [...affected].map(({ from, to }) => [boxes.get(from), boxes.get(to)]);
  const nearCrossing = hub => crossingEndpoints.some(([from, to]) => hub === from || hub === to
    || axes.every(({ center }) => hub[center] >= Math.min(from[center], to[center]) - 24
      && hub[center] <= Math.max(from[center], to[center]) + 24));
  const proposals = [];
  const refinements = [];
  const paired = [];
  const compacted = new Map();
  const terminals = cards.filter(unframed).map(box => ({
    box, links: routes.filter(({ relation }) => relation.to === box.id || relation.from === box.id),
  })).filter(({ links }) => links.length && !links.some(({ relation }) => relation.variant === 'emphasis'));
  const right = cards.reduce((max, card) => Math.max(max, card.x + card.width), 0);
  const bottom = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0);
  for (const { box, links } of terminals) {
    if (links.some(({ relation }) => relation.from === box.id || affected.has(relation))) continue;
    const parents = links.map(({ relation }) => boxes.get(relation.from));
    const slots = compactSinkSlots(box, parents, cards, frames);
    if (slots.length) compacted.set(box, slots);
  }
  for (const { box, links } of terminals) {
    const peerFor = ({ from, to }) => boxes.get(from === box.id ? to : from);
    const crosses = links.some(({ relation }) => affected.has(relation));
    // A shared sink can occupy a usable frame exit even when its own routes
    // do not cross. Include it when the crossing reaches one of its peers' frames.
    const sink = links.every(({ relation }) => relation.from !== box.id)
      && (crosses || (links.length > 1 && links.some(({ relation }) => crossedFrameMembers.has(relation.from))));
    const secondarySource = links.some(({ relation }) => relation.from === box.id
      && relation.to !== box.id && affected.has(relation))
      && links.every(({ relation }) => relation.to !== box.id || relation.variant === 'dashed');
    const hub = !crosses && links.length === 1 ? peerFor(links[0].relation) : undefined;
    const corridorLeaf = hub && hub !== box && nearCrossing(hub);
    if (!sink && !secondarySource && !corridorLeaf) continue;
    const otherCards = cards.filter(other => other !== box);
    const fixedSegments = routes.filter(route => !links.includes(route)).flatMap(route => segments(route.points));
    const xs = new Set(cards.map(card => Math.min(card.cx, right - box.width / 2)));
    const ys = new Set(cards.map(card => card.cy));
    const addSlots = (rect, gap) => {
      xs.add(rect.x - gap - box.width / 2);
      xs.add(rect.x + rect.width + gap + box.width / 2);
      ys.add(rect.y - 64 - box.height / 2);
      ys.add(rect.y + rect.height + 64 + box.height / 2);
    };
    let frameGap = 64;
    for (const { relation } of links) {
      const gap = Math.max(64, horizontalLabelClearance(relation));
      addSlots(peerFor(relation), gap);
      frameGap = Math.max(frameGap, gap);
    }
    for (const frame of frames) addSlots(frame, frameGap);
    const opensSlot = moved => {
      const extraX = moved.x + box.width - right;
      const extraY = moved.y + box.height - bottom;
      const swapsRight = corridorLeaf && box.cx < hub.cx && moved.cx > hub.cx;
      const swapsDown = corridorLeaf && box.cy < hub.cy && moved.cy > hub.cy;
      return moved.x >= 40 && moved.y >= 40
        && extraX <= (swapsRight ? box.width : 0)
        && extraY <= (frames.length ? box.height + 96 : swapsDown ? box.width : 0)
        && clearsFrames(moved, frames);
    };
    const proposalFor = moved => ({ boxes: new Map(boxes).set(box.id, moved), terminal: box.id });
    // An accepted move can open a route but leave a narrow port lane. Save
    // a few nearby slots for the same terminal if it still crosses a route.
    if (box.id === refine && crosses) {
      for (const dx of [-24, 24]) for (const dy of [-24, 24]) {
        const moved = move(box, box.cx + dx, box.cy + dy);
        if (opensSlot(moved) && otherCards.every(other => !rectsOverlap(other, moved, 28))) {
          refinements.push(proposalFor(moved));
        }
      }
    }
    const ranked = [];
    for (const cx of xs) for (const cy of ys) {
      if (cx === box.cx && cy === box.cy) continue;
      const moved = move(box, cx, cy);
      if (!opensSlot(moved)) continue;
      const blockers = otherCards.filter(other => rectsOverlap(other, moved, 28));
      if (blockers.length) {
        const [blocker] = blockers;
        if (!crosses || blockers.length !== 1 || !rectsOverlap(blocker, moved)) continue;
        for (const compact of compacted.get(blocker) ?? []) {
          if (rectsOverlap(compact, moved, 28)) continue;
          const distance = Math.abs(blocker.cx - cx) + Math.abs(blocker.cy - cy);
          const span = links.reduce((sum, { relation }) => {
            const peer = peerFor(relation);
            return sum + Math.abs(peer.cx - cx) + Math.abs(peer.cy - cy);
          }, 0);
          paired.push({ boxes: new Map(boxes).set(box.id, moved).set(compact.id, compact),
            terminal: box.id, compactedSink: true, distance, span });
        }
        continue;
      }
      let misses = 0;
      let crossings = 0;
      let span = 0;
      for (const { relation } of links) {
        const peer = peerFor(relation);
        const obstacles = otherCards.filter(other => other !== peer);
        const path = projectedPath(peer, moved, obstacles) ?? projectedPath(moved, peer, obstacles);
        if (!path) misses++;
        else {
          for (const [a, b] of segments(path)) {
            for (const [c, d] of fixedSegments) {
              if (properSegmentIntersection(a, b, c, d)) crossings++;
            }
          }
        }
        span += Math.abs(peer.cx - cx) + Math.abs(peer.cy - cy);
      }
      // Leave room for the fixed routes when possible. The real router
      // can still find a better route around a displaced obstacle.
      const blocks = fixedSegments.filter(([start, end]) => segmentIntersectsRect({ start, end }, moved, 6)).length;
      ranked.push({ moved, conflicts: misses + crossings + blocks, span });
    }
    const seen = new Set();
    for (const { moved, conflicts, span } of ranked.sort((a, b) =>
      a.conflicts - b.conflicts || a.span - b.span)) {
      const slot = `${Math.round(moved.cx / 48)}:${Math.round(moved.cy / 48)}`;
      if (seen.has(slot)) continue;
      seen.add(slot);
      proposals.push({ ...proposalFor(moved), order: seen.size, conflicts, span });
      if (seen.size === 10) break;
    }
  }
  proposals.sort((a, b) => a.order - b.order || a.conflicts - b.conflicts || a.span - b.span);
  const transposed = frames.map(frame => transposeFrame(frame, boxes, routes, affected)).filter(Boolean);
  paired.sort((a, b) => a.distance - b.distance || a.span - b.span);
  return [...proposals.slice(0, limit - refinements.length), ...refinements, ...transposed, ...paired.slice(0, 4)];
}
