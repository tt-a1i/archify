import { properSegmentIntersection, rectsOverlap, segmentIntersectsRect } from '../shared/geometry.mjs';

const gap = 40;

function position(box, cx, cy) {
  return { ...box, cx, cy, x: cx - box.width / 2, y: cy - box.height / 2 };
}

// Rank inexpensive geometric proxies first. The caller routes only a few
// proposals and checks the finished scene, including labels and frame titles.
export function frameLanePlacements({ boxes, titles, viewBox }, connections, affected, boundsFor) {
  const neighbors = new Map([...boxes.keys()].map(id => [id, new Set()]));
  for (const { from, to } of connections) {
    if (from === to) continue;
    neighbors.get(from).add(to);
    neighbors.get(to).add(from);
  }
  const scope = new Map([...boxes.keys()].map(id => [
    id, titles.boundaries.map(frame => Number(frame.wraps.includes(id))).join(''),
  ]));
  const sameScope = (a, b) => scope.get(a.id) === scope.get(b.id);
  const directlyLinked = (a, b) => neighbors.get(a.id).has(b.id);
  function score(moved) {
    let cost = 0;
    const segments = connections.map(({ from, to }) => {
      const a = moved.get(from);
      const b = moved.get(to);
      return { a, b, start: [a.cx, a.cy], end: [b.cx, b.cy] };
    });
    for (const [index, segment] of segments.entries()) {
      const { a, b, start, end } = segment;
      cost += Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
      for (const box of moved.values()) {
        if (box !== a && box !== b && segmentIntersectsRect(segment, box, 8)) cost += 180;
      }
      for (let other = 0; other < index; other += 1) {
        if (properSegmentIntersection(start, end, segments[other].start, segments[other].end)) cost += 300;
      }
    }
    return cost;
  }
  const signature = moved => JSON.stringify([...moved.values()].map(({ x, y }) => [x, y]));
  const seen = new Set([signature(boxes)]);
  function proposals(current) {
    const moves = [];
    function offer(...replacements) {
      const moved = new Map(current);
      for (const box of replacements) moved.set(box.id, box);
      for (const box of replacements) {
        if (box.x < 24 || box.y < 24 || box.x + box.width > viewBox[0] - 24 || box.y + box.height > viewBox[1] - 24
            || [...moved.values()].some(other => other !== box && rectsOverlap(box, other, 24))) return;
        // Keep the reading direction of links that were aligned before the move.
        const previous = boxes.get(box.id);
        for (const id of neighbors.get(box.id)) {
          const old = boxes.get(id);
          const peer = moved.get(id);
          if (!sameScope(previous, old)) continue;
          if ((previous.cx === old.cx && (previous.cy - old.cy) * (box.cy - peer.cy) <= 0)
              || (previous.cy === old.cy && (previous.cx - old.cx) * (box.cx - peer.cx) <= 0)) return;
        }
      }
      const key = signature(moved);
      if (seen.has(key)) return;
      seen.add(key);
      if (boundsFor(moved).some(frame => [...moved.values()].some(box =>
        !frame.wraps.includes(box.id) && rectsOverlap(box, frame, 12)))) return;
      moves.push({ moved, cost: score(moved) });
    }
    const frames = boundsFor(current);
    for (const id of affected) {
      const box = current.get(id);
      const peers = [...neighbors.get(id)].map(peer => current.get(peer));
      for (const other of current.values()) {
        if (other === box || directlyLinked(box, other) || !sameScope(box, other)) continue;
        if (Math.abs(box.cx - other.cx) > 8 && Math.abs(box.cy - other.cy) > 8) continue;
        offer(position(box, other.cx, other.cy), position(other, box.cx, box.cy));
      }
      for (const peer of peers) {
        offer(position(box, box.cx, peer.cy));
        offer(position(box, peer.cx, box.cy));
      }
      for (const frame of frames) {
        if (frame.wraps.includes(id) || !peers.some(peer => frame.wraps.includes(peer.id))) continue;
        for (const peer of peers) {
          if (!frame.wraps.includes(peer.id)) continue;
          offer(position(box, frame.x - gap - box.width / 2, peer.cy));
          // Align along the existing side as well, keeping its label corridor.
          if (box.x + box.width <= frame.x || box.x >= frame.x + frame.width) offer(position(box, box.cx, peer.cy));
          if (box.y + box.height <= frame.y || box.y >= frame.y + frame.height) offer(position(box, peer.cx, box.cy));
          offer(position(box, frame.x + frame.width + gap + box.width / 2, peer.cy));
          offer(position(box, peer.cx, frame.y - gap - box.height / 2));
          offer(position(box, peer.cx, frame.y + frame.height + gap + box.height / 2));
        }
      }
    }
    return moves;
  }
  let beam = [{ moved: boxes }];
  const ordered = [];
  for (let round = 0; round < 4; round += 1) {
    const next = beam.flatMap(({ moved }) => proposals(moved)).sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, 6);
    ordered.push(...beam);
  }
  return ordered.sort((a, b) => a.cost - b.cost).map(({ moved }) => moved);
}
