import { asArray, properSegmentIntersection, rectsOverlap, segmentIntersectsRect } from '../shared/geometry.mjs';
import { textUnits } from '../shared/utils.mjs';
import { placeFrameAttachments } from './frame-attachment-placement.mjs';
import { layOutParallelPaths } from './parallel-path-placement.mjs';
import { connectionLabelBoxAt, createArchitectureRouter, horizontalLabelClearance } from './routing.mjs';
import { straightChainPlacementDirection } from './straight-chain-placement.mjs';

const canvasMargin = 48;
const horizontalGap = 92;
const verticalGap = 96;
const islandGap = 72;
const comfortableWidth = 1040;
const emphasisPriority = 2;

function isPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function membersOf(items, neighbors) {
  const seen = new Set();
  const groups = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    const group = [item];
    seen.add(item);
    for (const current of group) {
      for (const neighbor of neighbors.get(current)) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        group.push(neighbor);
      }
    }
    groups.push(group);
  }
  return groups;
}

function edgePriority(edge) {
  if (edge.variant === 'emphasis') return emphasisPriority;
  if (edge.variant === 'dashed') return 0;
  return 1;
}

function directedRelationships(items, edges) {
  const pairs = new Map();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const a = Math.min(edge.from.index, edge.to.index);
    const b = Math.max(edge.from.index, edge.to.index);
    const key = `${a}:${b}`;
    const previous = pairs.get(key);
    if (!previous || edgePriority(edge) > edgePriority(previous)) pairs.set(key, edge);
  }

  const outgoing = new Map(items.map((item) => [item, []]));
  const incoming = new Map(items.map((item) => [item, []]));
  const neighbors = new Map(items.map((item) => [item, []]));
  for (const edge of pairs.values()) {
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
    neighbors.get(edge.from).push(edge.to);
    neighbors.get(edge.to).push(edge.from);
  }
  for (const edges of outgoing.values()) {
    edges.sort((a, b) => edgePriority(b) - edgePriority(a));
  }
  return { outgoing, incoming, neighbors };
}

// A depth-first walk ignores edges that return to an active ancestor for ranking.
// Those relationships still reach the router with their original directions.
function forwardOrder(items, incoming, outgoing) {
  const roots = items.filter((item) => incoming.get(item).length === 0);
  const feedbackTargets = items.filter((item) => incoming.get(item).length > 0
    && incoming.get(item).every((edge) => edge.variant === 'dashed'));
  const state = new Map();
  const backward = new Set();
  const finished = [];
  for (const root of [...roots, ...feedbackTargets, ...items]) {
    if (state.has(root)) continue;
    state.set(root, 'active');
    const stack = [{ item: root, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1);
      const edges = outgoing.get(frame.item);
      if (frame.next === edges.length) {
        state.set(frame.item, 'finished');
        finished.push(frame.item);
        stack.pop();
        continue;
      }
      const edge = edges[frame.next++];
      if (state.get(edge.to) === 'active') backward.add(edge);
      if (state.has(edge.to)) continue;
      state.set(edge.to, 'active');
      stack.push({ item: edge.to, next: 0 });
    }
  }
  return { order: finished.reverse(), backward };
}

function layOutIsland(items, edges, incoming, outgoing, vertical, { alternateTies = false, centerDependency = false, alignExternalSource = false } = {}) {
  const { order, backward } = forwardOrder(items, incoming, outgoing);
  const parents = new Map();
  const rank = new Map();
  const pathWeight = new Map();
  const predecessor = new Map();
  const columns = [];
  let last;
  for (const item of order) {
    let column = 0;
    let weight = 0;
    const usable = incoming.get(item).filter((edge) => !backward.has(edge));
    const strong = usable.filter((edge) => edge.variant !== 'dashed');
    parents.set(item, strong.length ? strong : usable);
    for (const edge of parents.get(item)) {
      const nextColumn = rank.get(edge.from) + 1;
      const nextWeight = pathWeight.get(edge.from) + edgePriority(edge);
      if (nextColumn > column || (nextColumn === column && nextWeight > weight)) {
        column = nextColumn;
        weight = nextWeight;
        predecessor.set(item, edge.from);
      }
    }
    rank.set(item, column);
    pathWeight.set(item, weight);
    (columns[column] ??= []).push(item);
    if (!last || column > rank.get(last) || (column === rank.get(last) && weight > pathWeight.get(last))) {
      last = item;
    }
  }

  const spine = new Set();
  for (let item = last; item; item = predecessor.get(item)) spine.add(item);
  const gaps = Array(columns.length).fill(vertical ? 68 : horizontalGap);
  for (const edge of vertical ? [] : edges) {
    if (!edge.label) continue;
    const first = Math.min(rank.get(edge.from), rank.get(edge.to));
    if (first === Math.max(rank.get(edge.from), rank.get(edge.to))) continue;
    gaps[first] = Math.max(gaps[first], horizontalLabelClearance(edge));
  }

  const crossGap = vertical ? 64 : verticalGap;
  let columnX = 0;
  let top = Infinity;
  let bottom = -Infinity;
  let right = 0;
  for (const [index, column] of columns.entries()) {
    const preferred = new Map();
    let columnWidth = 0;
    for (const item of column) {
      columnWidth = Math.max(columnWidth, item.width);
      const predecessors = parents.get(item);
      const desiredY = predecessors.length
        ? predecessors.reduce((sum, edge) => sum + edge.from.y + edge.from.height / 2, 0) / predecessors.length
        : 0;
      preferred.set(item, spine.has(item) ? 0 : desiredY);
    }
    // Try putting every other tied sibling across the main path. The
    // normal order stays authoritative unless it needlessly blocks routes.
    const anchorOrder = column.find((item) => spine.has(item))?.index ?? 0;
    const side = (item) => alternateTies ? Math.abs(item.index - anchorOrder) % 2 : 0;
    column.sort((a, b) => preferred.get(a) - preferred.get(b) || side(a) - side(b) || a.index - b.index);

    if (index === 0 && alignExternalSource) {
      // A root that joins the main path partway through can be separated
      // from that path by an earlier branch. Try it beside the path while
      // keeping it on the same side and preserving the other roots' order.
      const sources = column.filter((item) => {
        const [edge, next] = outgoing.get(item);
        return !spine.has(item) && !incoming.get(item).length && edge && !next
          && spine.has(edge.to) && edge.to !== last && rank.get(edge.to) > 1;
      });
      if (sources.length === 1) {
        const sourceIndex = column.indexOf(sources[0]);
        const spineIndex = column.findIndex((item) => spine.has(item));
        const [source] = column.splice(sourceIndex, 1);
        column.splice(sourceIndex < spineIndex ? spineIndex - 1 : spineIndex + 1, 0, source);
      }
    }
    const anchorIndex = Math.max(0, column.findIndex((item) => spine.has(item)));
    const anchor = column[anchorIndex];
    anchor.y = preferred.get(anchor) - anchor.height / 2;
    for (let i = anchorIndex + 1; i < column.length; i++) {
      const previous = column[i - 1];
      const item = column[i];
      item.y = Math.max(previous.y + previous.height + crossGap, preferred.get(item) - item.height / 2);
    }
    for (let i = anchorIndex - 1; i >= 0; i--) {
      const next = column[i + 1];
      const item = column[i];
      item.y = Math.min(next.y - item.height - crossGap, preferred.get(item) - item.height / 2);
    }
    for (const item of column) {
      item.x = columnX + (columnWidth - item.width) / 2;
      top = Math.min(top, item.y);
      bottom = Math.max(bottom, item.y + item.height);
    }
    right = columnX + columnWidth;
    columnX = right + gaps[index];
  }
  const emphasizedSpine = pathWeight.get(last) === emphasisPriority * rank.get(last);
  if (centerDependency && emphasizedSpine) placeSharedDependency(items, edges, spine, rank, right);
  return { items, width: right, height: bottom - top, top };
}

function placeSharedDependency(items, edges, spine, rank, width) {
  if (spine.size !== items.length - 1) return;
  const dependency = items.find((item) => !spine.has(item));
  if (edges.some((edge) => edge.from === dependency)) return;
  const links = edges.filter((edge) => edge.to === dependency);
  if (links.length < 2 || links.some((edge) => edge.variant === 'emphasis')) return;

  // A single shared dependency can sit beside the phases that use it,
  // instead of extending the time-ordered path after the last phase.
  const ranks = links.map(({ from }) => rank.get(from));
  if (Math.max(...ranks) - Math.min(...ranks) < 2) return;
  const centers = links.map(({ from }) => from.x + from.width / 2);
  const x = (Math.min(...centers) + Math.max(...centers) - dependency.width) / 2;
  if (x < 0 || x + dependency.width > width) return;
  const clearance = 24;
  const space = { x: x - clearance, y: dependency.y - clearance,
    width: dependency.width + clearance * 2, height: dependency.height + clearance * 2 };
  if (items.every((item) => item === dependency || !rectsOverlap(item, space))) dependency.x = x;
}

function directRouteInterference(items, edges) {
  const segments = edges.map(({ from, to }) => ({
    from, to,
    start: [from.x + from.width / 2, from.y + from.height / 2],
    end: [to.x + to.width / 2, to.y + to.height / 2],
  }));
  let score = 0;
  for (const [index, segment] of segments.entries()) {
    for (const item of items) {
      if (item !== segment.from && item !== segment.to && segmentIntersectsRect(segment, item)) score++;
    }
    for (let i = 0; i < index; i++) {
      const other = segments[i];
      if (properSegmentIntersection(segment.start, segment.end, other.start, other.end)) score++;
    }
  }
  return score;
}

function layOutReciprocalPeers(items, edges, incoming, outgoing, allowedWidth) {
  if (items.some((item) => item.hasSelfConnection)) return;
  const hub = items.find((item) => incoming.get(item).length + outgoing.get(item).length === 2);
  if (!hub) return;
  const peers = items.filter((item) => item !== hub);
  const links = peers.map((peer) => edges.filter(({ from, to }) =>
    (from === hub && to === peer) || (from === peer && to === hub)));
  if (links[0].length + links[1].length !== edges.length) return;
  // A standard card has room for three horizontal ports on one side.
  if (links.some((pair) => pair.length > 3 || !pair.some(({ from }) => from === hub)
    || !pair.some(({ to }) => to === hub))) return;

  // The ranked layout already picked the main path by edge priority.
  // Keep that peer facing the same way and give the off-row peer the free side.
  const cy = (item) => item.y + item.height / 2;
  const [first, second] = peers;
  if (Math.sign(first.x - hub.x) !== Math.sign(second.x - hub.x)) return;
  const primary = peers.find((peer) => cy(peer) === cy(hub));
  if (!primary) return;
  const secondary = primary === first ? second : first;
  const [left, right] = primary.x > hub.x ? [secondary, primary] : [primary, secondary];
  const gaps = new Map(peers.map((peer, i) => [peer, Math.max(horizontalGap,
    ...links[i].map(horizontalLabelClearance))]));
  const width = left.width + gaps.get(left) + hub.width + gaps.get(right) + right.width;
  if (width > allowedWidth) return;
  left.x = 0;
  hub.x = left.width + gaps.get(left);
  right.x = width - right.width;
  const height = Math.max(...items.map((item) => item.height));
  for (const item of items) item.y = (height - item.height) / 2;
  return { items, width, height, top: 0 };
}

function chooseIslandLayout(items, edges, incoming, outgoing, vertical, allowAlternate, allowedWidth) {
  const small = items.length >= 4 && items.length <= 24 && edges.length <= 36;
  const threeNodeCandidate = !vertical && items.length === 3 && edges.length >= 4 && edges.length <= 6;
  const allowsAlternatives = allowAlternate && (small || threeNodeCandidate)
    && items.every((item) => !item.children && !item.parent.members);
  const smallUnframed = small && allowsAlternatives;
  const layout = layOutIsland(items, edges, incoming, outgoing, vertical, { centerDependency: smallUnframed });
  if (allowsAlternatives && threeNodeCandidate) {
    const reciprocal = layOutReciprocalPeers(items, edges, incoming, outgoing, allowedWidth);
    if (reciprocal) return reciprocal;
  }
  // Try bounded alternatives for small unframed drafts. Explicit geometry
  // and frame membership can influence routes in ways this estimate does not see.
  if (!smallUnframed) return layout;
  const score = directRouteInterference(items, edges);
  if (score < 2) return layout;
  const positions = items.map(({ x, y }) => [x, y]);
  const alternatives = [{ alternateTies: true }];
  if (vertical) alternatives.push({ alignExternalSource: true });
  for (const options of alternatives) {
    const alternate = layOutIsland(items, edges, incoming, outgoing, vertical, { ...options, centerDependency: true });
    if (alternate.width <= layout.width && alternate.height <= layout.height
      && directRouteInterference(items, edges) <= score - 2) return alternate;
  }
  for (const [index, item] of items.entries()) [item.x, item.y] = positions[index];
  return layout;
}

function layOutSiblings(items, edges, vertical, allowParallel, allowedWidth) {
  if (!items.length) return { width: 0, height: 0 };
  const { outgoing, incoming, neighbors } = directedRelationships(items, edges);
  const islands = membersOf(items, neighbors).map((group) => ({ group, edges: [] }));
  const islandFor = new Map();
  for (const island of islands) {
    for (const item of island.group) islandFor.set(item, island);
  }
  for (const edge of edges) islandFor.get(edge.from).edges.push(edge);
  const layouts = islands.map(({ group, edges }) => {
    const direction = straightChainPlacementDirection(group, edges);
    const islandVertical = direction?.vertical ?? vertical;
    if (islandVertical) {
      for (const item of group) [item.width, item.height] = [item.height, item.width];
    }
    const layout = (allowParallel && !direction && layOutParallelPaths(group, edges, neighbors, islandVertical))
      || chooseIslandLayout(group, edges, incoming, outgoing, islandVertical, allowParallel, allowedWidth);
    for (const item of group) {
      item.y -= layout.top;
      if (direction?.reverse) item.x = layout.width - item.x - item.width;
      if (islandVertical) {
        [item.x, item.y] = [item.y, item.x];
        [item.width, item.height] = [item.height, item.width];
      }
    }
    if (islandVertical) [layout.width, layout.height] = [layout.height, layout.width];
    return { ...layout, edges };
  });
  layouts.sort((a, b) => b.items.length - a.items.length);
  const rowLimit = Math.max(Math.min(1000, allowedWidth), layouts[0].width);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const [index, initial] of layouts.entries()) {
    let layout = initial;
    if (x > 0 && x + layout.width > rowLimit) {
      x = 0;
      y += rowHeight + islandGap;
      rowHeight = 0;
    }
    // Fit a disconnected pair across its own final row. Its direction is
    // independent of the main flow, and earlier rows keep their geometry.
    if (allowParallel && vertical && x === 0 && y > 0 && index === layouts.length - 1
      && !layout.items[0].parent.members
      && layout.items.length === 2 && layout.edges.length === 1
      && layout.items.every((item) => !item.children)) {
      const [edge] = layout.edges;
      const gap = Math.max(horizontalGap, horizontalLabelClearance(edge));
      if (edge.from.width + gap + edge.to.width <= Math.min(rowLimit, width)) {
        layout = layOutIsland(layout.items, layout.edges, incoming, outgoing, false);
        for (const item of layout.items) item.y -= layout.top;
      }
    }
    for (const item of layout.items) {
      item.x += x;
      item.y += y;
    }
    width = Math.max(width, x + layout.width);
    rowHeight = Math.max(rowHeight, layout.height);
    x += layout.width + islandGap;
  }
  return { width, height: y + rowHeight, parallel: layouts.length === 1 && layouts[0].parallel, vertical };
}

function fitSiblingLayout(items, edges, allowParallel, viewBox) {
  const allowedWidth = viewBox ? viewBox[0] - canvasMargin : comfortableWidth;
  const allowedHeight = viewBox ? viewBox[1] - canvasMargin : Infinity;
  const overflow = ({ width, height }) => Math.max(0, width - allowedWidth) + Math.max(0, height - allowedHeight);
  const horizontal = layOutSiblings(items, edges, false, allowParallel, allowedWidth);
  if (!overflow(horizontal)) return horizontal;

  const positions = items.map(({ x, y }) => [x, y]);
  const vertical = layOutSiblings(items, edges, true, allowParallel, allowedWidth);
  if (overflow(vertical) < overflow(horizontal)) return vertical;
  for (const [index, item] of items.entries()) [item.x, item.y] = positions[index];
  return horizontal;
}

// Build boxes for disjoint/nested frames first, then place those boxes among
// their peer components. A boundary that shares only some members with another
// can still be rendered, but cannot be represented in this packing tree.
function boundaryHierarchy(boundaries, byId) {
  const root = { children: [], edges: [], pad: 0, topPad: 0, titleWidth: 0 };
  const groups = boundaries.map((boundary) => ({
    members: new Set(asArray(boundary.wraps).map((id) => byId.get(id)).filter(Boolean)),
    children: [],
    edges: [],
    index: Infinity,
    pad: boundary.pad ?? 30,
    titleWidth: textUnits(boundary.label) * 5.4 + 18,
  })).filter((group) => group.members.size > 0);
  groups.sort((a, b) => b.members.size - a.members.size);
  const owners = new Map();
  for (const group of groups) {
    const first = group.members.values().next().value;
    const parent = owners.get(first) ?? root;
    if ([...group.members].some((item) => (owners.get(item) ?? root) !== parent)) continue;
    if (parent.members?.size === group.members.size) {
      parent.pad = Math.max(parent.pad, group.pad);
      parent.topPad = Math.max(parent.pad, 24);
      parent.titleWidth = Math.max(parent.titleWidth, group.titleWidth);
      continue;
    }
    group.parent = parent;
    group.topPad = Math.max(group.pad, 24);
    parent.children.push(group);
    for (const item of group.members) {
      owners.set(item, group);
      group.index = Math.min(group.index, item.index);
    }
  }
  for (const item of byId.values()) {
    item.parent = owners.get(item) ?? root;
    item.parent.children.push(item);
  }
  return root;
}

function distributeEdges(byId, connections) {
  for (const edge of connections) {
    const originalFrom = byId.get(edge?.from);
    const originalTo = byId.get(edge?.to);
    let from = originalFrom;
    let to = originalTo;
    if (!from || !to) continue;
    if (from === to) {
      from.hasSelfConnection = true;
      continue;
    }
    const ancestors = new Map();
    for (let item = from; item.parent; item = item.parent) ancestors.set(item.parent, item);
    while (!ancestors.has(to.parent)) to = to.parent;
    from = ancestors.get(to.parent);
    to.parent.edges.push({ ...edge, from, to, originalFrom, originalTo });
  }
}

// Align an isolated peer with its actual endpoint inside a parallel-path
// region. A clear perpendicular exit keeps that route outside the branch lanes.
function placeParallelPeer(group) {
  if (group.children.length !== 2 || group.edges.length !== 1) return;
  const [edge] = group.edges;
  const inner = [edge.from, edge.to].find((item) => item.parallel);
  if (!inner) return;
  const [member, other, peer] = inner === edge.from
    ? [edge.originalFrom, edge.originalTo, edge.to]
    : [edge.originalTo, edge.originalFrom, edge.from];
  if (member.parent !== inner || (other !== peer &&
    (other.parent !== peer || peer.children.length !== 1))) return;

  const [axis, length, across, span, inset, acrossInset] = inner.vertical
    ? ['x', 'width', 'y', 'height', 'leftInset', 'topPad']
    : ['y', 'height', 'x', 'width', 'topPad', 'leftInset'];
  const track = member[across] + inner[acrossInset] + member[span] / 2;
  const center = member[axis] + inner[inset] + member[length] / 2;
  const clear = (direction) => inner.children.every((child) => {
    if (child === member) return true;
    const from = child[axis] + inner[inset];
    const near = child[across] + inner[acrossInset];
    return (direction > 0 ? from + child[length] <= center : from >= center)
      || track < near - 8 || track > near + child[span] + 8;
  });
  const directions = center <= inner[length] / 2 ? [-1, 1] : [1, -1];
  const side = directions.find(clear);
  if (!side) return;

  const gap = Math.max(islandGap, edge.label ? connectionLabelBoxAt(edge, [0, 0]).width + 20 : 0);
  const peerCenter = other === peer ? other[span] / 2
    : other[across] + peer[acrossInset] + other[span] / 2;
  inner[axis] = side < 0 ? peer[length] + gap : 0;
  peer[axis] = side > 0 ? inner[length] + gap : 0;
  inner[across] = Math.max(0, peerCenter - track);
  peer[across] = Math.max(0, track - peerCenter);
  return {
    width: Math.max(inner.x + inner.width, peer.x + peer.width),
    height: Math.max(inner.y + inner.height, peer.y + peer.height),
  };
}

function idealPositions(root, { allowParallel, viewBox, relocatesLabels }) {
  const groups = [root];
  for (const group of groups) {
    for (const child of group.children) {
      if (child.children) groups.push(child);
    }
  }
  for (const group of [...groups].reverse()) {
    group.children.sort((a, b) => a.index - b.index);
    const layout = fitSiblingLayout(group.children, group.edges, allowParallel, viewBox);
    group.parallel = layout.parallel;
    group.vertical = layout.vertical;
    const parallelPeer = placeParallelPeer(group);
    if (allowParallel && !parallelPeer) placeFrameAttachments(group, layout, canvasMargin / 2, { relocatesLabels });
    const { width, height } = parallelPeer ?? layout;
    group.width = Math.max(width + group.pad * 2, group.titleWidth);
    group.leftInset = (group.width - width) / 2;
    group.height = height + group.topPad + (group === root ? 0 : 50);
  }

  root.x = canvasMargin;
  root.y = canvasMargin;
  for (const group of groups) {
    for (const child of group.children) {
      child.x += group.x + group.leftInset;
      child.y += group.y + group.topPad;
    }
  }
}

// Search the intended column first and then obstacle sides. Within a column,
// one sweep in each direction finds the nearest gap between occupied intervals.
function nearestFreePosition(x, y, minX, minY, obstacles, maxX = Infinity, maxY = Infinity) {
  if (maxX < minX || maxY < minY) return undefined;
  const startY = Math.min(y, maxY);
  const columns = new Set([Math.min(x, maxX)]);
  if (Number.isFinite(maxX)) {
    columns.add(minX);
    columns.add(maxX);
  }
  for (const { left, right } of obstacles) {
    if (Number.isFinite(left) && left >= minX && left <= maxX) columns.add(left);
    if (Number.isFinite(right) && right >= minX && right <= maxX) columns.add(right);
  }
  const intervals = [...obstacles].sort((a, b) => a.top - b.top);
  let closest;
  let distance = Infinity;
  for (const column of [...columns].sort((a, b) => Math.abs(a - x) - Math.abs(b - x))) {
    const dx = Math.abs(column - x);
    if (dx >= distance) break;
    const blocked = intervals.filter((box) => column > box.left && column < box.right);
    let below = startY;
    let above = startY;
    for (const box of blocked) if (below > box.top && below < box.bottom) below = box.bottom;
    // Upper ends, rather than lower ends, order the upward sweep when the
    // forbidden intervals overlap or contain each other.
    blocked.sort((a, b) => b.bottom - a.bottom);
    for (const box of blocked) if (above > box.top && above < box.bottom) above = box.top;
    for (const row of [below, above]) {
      const drift = dx + Math.abs(row - y);
      if (Number.isFinite(row) && row >= minY && row <= maxY && drift < distance) {
        closest = [column, row];
        distance = drift;
      }
    }
  }
  return closest;
}

function avoidPinnedComponents(byId, connections, boundaries, viewBox) {
  const items = [...byId.values()];
  const pinned = items.filter((item) => item.pin);
  const fixedRoutes = connections.filter((edge) => asArray(edge?.via).length
    && byId.get(edge.from)?.pin && byId.get(edge.to)?.pin);
  const anchoredRouter = fixedRoutes.length ? createArchitectureRouter(new Map([...byId]
    .filter(([, item]) => item.pin)
    .map(([id, { pin: [x, y], width, height }]) => [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }])), fixedRoutes) : null;
  const anchoredEdges = new Set(fixedRoutes);
  const authoredGeometry = connections.flatMap((edge) => {
    // When both endpoints are pinned, reserve the approach to the ordered
    // waypoints too. With inferred endpoints only the authored points and
    // the segments between them are known at placement time.
    const points = anchoredEdges.has(edge) ? anchoredRouter.pathFor(edge).points : asArray(edge?.via).filter(isPoint);
    const corridors = points.slice(1).map(([x, y], index) => {
      const [a, b] = points[index];
      return { x: Math.min(x, a), y: Math.min(y, b), width: Math.abs(x - a), height: Math.abs(y - b) };
    });
    if (points.length === 1) corridors.push({ x: points[0][0], y: points[0][1], width: 0, height: 0 });
    if (edge?.label && isPoint(edge.labelAt)) corridors.push(connectionLabelBoxAt(edge, edge.labelAt));
    return corridors;
  });
  if (!pinned.length && !authoredGeometry.length) {
    // Frames with partially overlapping memberships cannot all be packing
    // groups. Keep every authored frame inside the origin without changing
    // relative placement or converting any inferred coordinates into pins.
    let dx = 0;
    let dy = 0;
    for (const boundary of boundaries) {
      const pad = boundary.pad ?? 30;
      for (const id of asArray(boundary.wraps)) {
        const item = byId.get(id);
        if (!item) continue;
        dx = Math.max(dx, pad - item.x);
        dy = Math.max(dy, Math.max(pad, 24) - item.y);
      }
    }
    if (dx || dy) {
      for (const item of items) {
        item.x += dx;
        item.y += dy;
      }
    }
    return;
  }

  // Let each inferred box follow the nearest anchor along the relationship
  // graph. A disconnected box keeps its inferred location.
  const neighbors = new Map(items.map((item) => [item, []]));
  for (const edge of connections) {
    const from = byId.get(edge?.from);
    const to = byId.get(edge?.to);
    if (!from || !to) continue;
    neighbors.get(from).push(to);
    neighbors.get(to).push(from);
  }
  const offset = new Map(pinned.map((item) => [item, [item.pin[0] - item.x, item.pin[1] - item.y]]));
  const queue = [...pinned];
  for (const item of queue) {
    for (const other of neighbors.get(item)) {
      if (offset.has(other)) continue;
      offset.set(other, offset.get(item));
      queue.push(other);
    }
  }

  const clearance = 24;
  const ownedGroups = new Map(items.map((item) => {
    const groups = [];
    for (let group = item.parent; group?.members; group = group.parent) groups.push(group);
    return [item, groups];
  }));
  const frames = new Map();
  const placed = new Map();
  function place(item, x, y) {
    placed.set(item, { x, y, width: item.width, height: item.height });
    for (const group of ownedGroups.get(item)) {
      const existing = frames.get(group);
      const left = Math.min(existing?.x ?? Infinity, x - group.pad);
      const top = Math.min(existing?.y ?? Infinity, y - group.topPad);
      const right = Math.max(existing ? existing.x + existing.width : -Infinity, x + item.width + group.pad);
      const bottom = Math.max(existing ? existing.y + existing.height : -Infinity, y + item.height + 50);
      frames.set(group, { x: left, y: top, width: right - left, height: bottom - top });
    }
  }
  for (const item of pinned) place(item, ...item.pin);

  for (const item of items) {
    if (item.pin) continue;
    const [dx, dy] = offset.get(item) ?? [0, 0];
    const groups = ownedGroups.get(item);
    const minX = groups.reduce((bound, group) => Math.max(bound, group.pad + clearance), canvasMargin);
    const minY = groups.reduce((bound, group) => Math.max(bound, group.topPad + clearance), canvasMargin);
    const x = Math.max(minX, item.x + dx);
    const y = Math.max(minY, item.y + dy);
    const blockedBy = (other, group) => ({
      left: other.x - item.width - clearance - (group?.pad ?? 0),
      right: other.x + other.width + clearance + (group?.pad ?? 0),
      top: other.y - item.height - clearance - (group ? 50 : 0),
      bottom: other.y + other.height + clearance + (group?.topPad ?? 0),
    });
    const basic = [...placed.values(), ...authoredGeometry].map((box) => blockedBy(box));
    const obstacles = [...basic];
    for (const [group, frame] of frames) {
      if (!group.members.has(item)) obstacles.push(blockedBy(frame));
    }
    for (const group of groups) {
      const current = frames.get(group);
      for (const [other, box] of placed) {
        if (group.members.has(other)) continue;
        const excluded = blockedBy(box, group);
        if (!current) {
          obstacles.push(excluded);
          continue;
        }
        // An expanding frame can stay separate only on an axis where it is
        // separate already. If fixed members already cross the outsider, let
        // validation describe that authored conflict.
        const left = current.x + current.width <= box.x;
        const right = current.x >= box.x + box.width;
        const above = current.y + current.height <= box.y;
        const below = current.y >= box.y + box.height;
        if (!left && !right && !above && !below) continue;
        obstacles.push({
          left: left ? excluded.left : -Infinity,
          right: right ? excluded.right : Infinity,
          top: above ? excluded.top : -Infinity,
          bottom: below ? excluded.bottom : Infinity,
        });
      }
    }
    // Prefer a clear slot on the authored canvas. Retain the unbounded
    // fallback so genuinely impossible constraints still reach validation.
    const bounded = viewBox ? [viewBox[0] - item.width, viewBox[1] - item.height] : [];
    [item.x, item.y] = nearestFreePosition(x, y, minX, minY, obstacles, ...bounded)
      ?? nearestFreePosition(x, y, minX, minY, basic, ...bounded)
      ?? (viewBox ? nearestFreePosition(x, y, minX, minY, obstacles) : undefined)
      ?? (viewBox ? nearestFreePosition(x, y, minX, minY, basic) : undefined) ?? [x, y];
    place(item, item.x, item.y);
  }
}

export function automaticComponentPositions(arch, defaultSize = [120, 60]) {
  const byId = new Map(asArray(arch.components).filter(Boolean).map((component, index) => {
    const [width, height] = isPoint(component.size) ? component.size : defaultSize;
    const pin = isPoint(component.pos) ? component.pos : undefined;
    return [component.id, { index, width, height, pin }];
  }));
  if ([...byId.values()].every((item) => item.pin)) {
    return new Map([...byId].map(([id, item]) => [id, item.pin]));
  }
  const boundaries = asArray(arch.boundaries).filter(Boolean);
  const root = boundaryHierarchy(boundaries, byId);
  const connections = asArray(arch.connections);
  distributeEdges(byId, connections);
  const allowParallel = !arch.meta?.viewBox && [...byId.values()].every((item) => !item.pin)
    && connections.every((edge) => !edge?.fromSide && !edge?.toSide && !edge?.via
      && !edge?.labelAt && edge?.labelDx == null && edge?.labelDy == null && edge?.labelSegment == null
      && (!edge?.route || edge.route === 'auto'));
  const viewBox = isPoint(arch.meta?.viewBox) ? arch.meta.viewBox : undefined;
  idealPositions(root, { allowParallel, viewBox, relocatesLabels: arch.meta?.quality_profile === 'showcase' });
  avoidPinnedComponents(byId, connections, boundaries, viewBox);
  return new Map([...byId].map(([id, item]) => [id, item.pin ?? [item.x, item.y]]));
}
