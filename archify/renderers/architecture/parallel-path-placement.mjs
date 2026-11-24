import { horizontalLabelClearance } from './routing.mjs';

const before = [-1, 0];
const above = [0, -1];
const after = [1, 0];
const below = [0, 1];
const branchSlots = [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1], [1, 2], [1, -2]];

function relationshipWeight(edge) {
  return edge.variant === 'emphasis' ? 2 : edge.variant === 'dashed' ? 0.25 : 1;
}

function pathDirection(path, scores) {
  let score = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    score += (scores.get(previous)?.get(current) ?? 0) - (scores.get(current)?.get(previous) ?? 0);
  }
  return score;
}

function findParallelPaths(items, edges, neighbors) {
  // Peel off branches to expose the 2-core. Two degree-three junctions joined
  // by three routes can share a primary axis without forcing a crossover.
  const core = new Set(items);
  const degree = new Map(items.map((item) => [item, neighbors.get(item).length]));
  const leaves = items.filter((item) => degree.get(item) < 2);
  for (const leaf of leaves) {
    core.delete(leaf);
    for (const adjacent of neighbors.get(leaf)) {
      if (!core.has(adjacent)) continue;
      const remaining = degree.get(adjacent) - 1;
      degree.set(adjacent, remaining);
      if (remaining === 1) leaves.push(adjacent);
    }
  }
  const poles = [...core].filter((item) => degree.get(item) > 2);
  // Keep a few ranks around one loop. Ordinary diamonds and larger rings
  // retain the layered layout, which uses fewer lanes for those shapes.
  const simpleCycle = poles.length === 0 && core.size >= 5 && core.size <= 8
    && items.length > core.size && items.length <= 18
    && items.every((item) => !item.parent?.members);
  if (simpleCycle) {
    const outgoing = new Map([...core].map((item) => [item, 0]));
    for (const edge of edges) {
      if (!core.has(edge.from) || !core.has(edge.to)) continue;
      const weight = relationshipWeight(edge);
      outgoing.set(edge.from, outgoing.get(edge.from) + weight);
      outgoing.set(edge.to, outgoing.get(edge.to) - weight);
    }
    const first = [...core].sort((a, b) => outgoing.get(b) - outgoing.get(a)
      || neighbors.get(b).length - neighbors.get(a).length || a.index - b.index)[0];
    const cycle = [first];
    let next = neighbors.get(first).find((item) => core.has(item));
    while (next !== first) {
      const prior = cycle.at(-1);
      cycle.push(next);
      next = neighbors.get(next).find((item) => item !== prior && core.has(item));
    }
    const opposite = cycle.length / 2;
    const ends = [cycle[Math.floor(opposite)], cycle[Math.ceil(opposite)]];
    ends.sort((a, b) => outgoing.get(a) - outgoing.get(b) || a.index - b.index);
    poles.push(first, ends[0]);
  } else if (poles.length !== 2 || poles.some((item) => degree.get(item) !== 3)) return;

  const [start, end] = poles;
  const paths = [];
  for (let next of neighbors.get(start).filter((item) => core.has(item))) {
    const path = [start];
    while (next !== end) {
      if (next === start) return;
      const former = path.at(-1);
      path.push(next);
      next = neighbors.get(next).find((item) => item !== former && core.has(item));
    }
    paths.push([...path, end]);
  }
  return { paths, core };
}

function labelRankOffsets(sites, occupied, edges, vertical, pitch) {
  // The vertical pitch already leaves at least 42px for a 14px label.
  // Account for the transposed packing coordinates when the island rotates.
  const axis = vertical ? 1 : 0;
  const size = vertical ? 'height' : 'width';
  const slots = new Map();
  let first = 0;
  let last = 0;
  for (const site of sites.values()) {
    first = Math.min(first, site[axis]);
    last = Math.max(last, site[axis]);
  }
  for (const edge of edges) {
    if (!edge.label) continue;
    const from = sites.get(edge.from);
    const to = sites.get(edge.to);
    const lane = from[1 - axis];
    if (lane !== to[1 - axis] || from[axis] === to[axis]) continue;
    const left = Math.min(from[axis], to[axis]);
    const right = Math.max(from[axis], to[axis]);
    const gap = (right - left) * pitch - (edge.from[size] + edge.to[size]) / 2;
    const deficit = horizontalLabelClearance(edge) - gap;
    if (deficit <= 0) continue;
    let clear = true;
    for (let rank = left + 1; rank < right && clear; rank += 1) {
      clear = !occupied.has(vertical ? `${lane}:${rank}` : `${rank}:${lane}`);
    }
    if (!clear) continue;
    if (!slots.has(right)) slots.set(right, []);
    slots.get(right).push({ left, deficit });
  }

  const offsets = new Map();
  let shift = 0;
  for (let rank = first; rank <= last; rank += 1) {
    // Share any space already inserted between the endpoints. Keep ranks
    // in order and put the remaining deficit immediately before the target rank.
    for (const { left, deficit } of slots.get(rank) ?? []) {
      shift = Math.max(shift, offsets.get(left) + deficit);
    }
    offsets.set(rank, shift);
  }
  return offsets;
}

export function layOutParallelPaths(items, edges, neighbors, vertical) {
  if (items.length < 4 || items.length > 64 || items.some((item) => item.children)) return;
  const result = findParallelPaths(items, edges, neighbors);
  if (!result) return;
  const { paths, core } = result;
  const scores = new Map();
  for (const edge of edges) {
    if (!core.has(edge.from) || !core.has(edge.to)) continue;
    if (!scores.has(edge.from)) scores.set(edge.from, new Map());
    const fromScores = scores.get(edge.from);
    const weight = relationshipWeight(edge);
    fromScores.set(edge.to, (fromScores.get(edge.to) ?? 0) + weight);
  }
  const direction = new Map(paths.map((path) => [path, pathDirection(path, scores)]));
  const flow = paths.reduce((sum, path) => sum + direction.get(path), 0) < 0 ? -1 : 1;
  if (flow < 0) for (const path of paths) path.reverse();
  paths.sort((a, b) => a.length - b.length || flow * (direction.get(b) - direction.get(a)));
  const lanes = paths.length === 3 ? [0, -1, 1] : [-1, 1];
  const start = paths[0][0];
  const end = paths[0].at(-1);
  const xLength = Math.max(...paths.map((path) => path.length - 1));
  const sites = new Map();
  const occupied = new Set();
  function place(item, x, y) {
    sites.set(item, [x, y]);
    occupied.add(`${x}:${y}`);
  }
  place(start, 0, 0);
  place(end, xLength, 0);
  for (const [index, path] of paths.entries()) {
    const lane = lanes[index];
    for (const [i, item] of path.slice(1, -1).entries()) {
      const x = Math.round((i + 1) * xLength / (path.length - 1));
      place(item, x, lane);
    }
  }

  // Put branches on the outer sides of the parallel paths. Place a branch
  // with descendants first so it has room to continue straight.
  const branchQueue = [...core].map((item) => ({
    item,
    outward: item === start ? before : item === end ? after : sites.get(item)[1] > 0 ? below : above,
  }));
  for (const { item, outward: [dx, dy] } of branchQueue) {
    const [x, y] = sites.get(item);
    const children = neighbors.get(item).filter((adjacent) => !sites.has(adjacent));
    children.sort((a, b) => neighbors.get(b).length - neighbors.get(a).length || a.index - b.index);
    for (const child of children) {
      for (let tier = 0; !sites.has(child); tier += 1) {
        for (const [depth, offset] of branchSlots) {
          const distance = tier + depth;
          const candidateX = x + dx * distance - dy * offset;
          const candidateY = y + dy * distance + dx * offset;
          if (occupied.has(`${candidateX}:${candidateY}`)) continue;
          place(child, candidateX, candidateY);
          const outward = distance === 0 ? [-dy * Math.sign(offset), dx * Math.sign(offset)] : [dx, dy];
          branchQueue.push({ item: child, outward });
          break;
        }
      }
    }
  }

  const width = Math.max(...items.map((item) => item.width));
  const height = Math.max(...items.map((item) => item.height));
  const xGap = vertical ? 42 : 60;
  const yGap = vertical ? 56 : 62;
  const offsets = labelRankOffsets(sites, occupied, edges, vertical, vertical ? height + yGap : width + xGap);
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  for (const [item, [x, y]] of sites) {
    item.x = x * (width + xGap) - item.width / 2 + (vertical ? 0 : offsets.get(x));
    item.y = y * (height + yGap) - item.height / 2 + (vertical ? offsets.get(y) : 0);
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }
  for (const item of items) item.x -= left;
  return { items, width: right - left, height: bottom - top, top, parallel: paths.length === 3 };
}
