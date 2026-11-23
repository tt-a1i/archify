import { segmentRectClearanceWithin } from '../shared/geometry.mjs';
import { facingPortCorridor } from './routing.mjs';

const endpointClearance = 14;
const frameClearance = 2;
const epsilon = 0.0001;

export function labelBesideStraightShaft(route, label) {
  if (!label || route?.points.length !== 2) return false;
  const { points } = route;
  const [start, end] = points;
  const horizontal = start[1] === end[1];
  if (!horizontal && start[0] !== end[0]) return false;
  const axis = horizontal ? 0 : 1;
  const low = horizontal ? label.x : label.y;
  const high = low + (horizontal ? label.width : label.height);
  if (low < Math.min(start[axis], end[axis]) - epsilon
      || high > Math.max(start[axis], end[axis]) + epsilon) return false;
  const gap = segmentRectClearanceWithin({ start, end }, label, 6 + epsilon);
  return gap > 0 && gap <= 6 + epsilon;
}

function openBands(boxes, axis, size) {
  const bands = [];
  let end = -Infinity;
  for (const box of [...boxes.values()].sort((a, b) => a[axis] - b[axis])) {
    if (Number.isFinite(end) && end < box[axis]) bands.push((end + box[axis]) / 2);
    end = Math.max(end, box[axis] + box[size]);
  }
  return bands;
}

function availableSlots(frames, along, size, across, breadth, track, near, far) {
  const borders = [];
  for (const frame of frames) {
    if (track < frame[across] || track > frame[across] + frame[breadth]) continue;
    for (const edge of [frame[along], frame[along] + frame[size]]) {
      if (edge > near && edge < far) borders.push(edge);
    }
  }
  borders.sort((a, b) => a - b);
  const slots = [];
  let start = near;
  let inset = endpointClearance;
  for (const edge of [...borders, far]) {
    const exitInset = edge === far ? endpointClearance : frameClearance;
    slots.push({ start, end: edge, capacity: edge - start - inset - exitInset });
    start = edge;
    inset = frameClearance;
  }
  return slots;
}

export function sideCardPortPreferences({ boxes, routes }, relations) {
  const incident = new Map();
  for (const { relation } of routes) {
    if (relation.from === relation.to) continue;
    for (const [id, peer, endpoint] of [[relation.from, relation.to, 'source'], [relation.to, relation.from, 'target']]) {
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push({ relation, peer: boxes.get(peer), endpoint });
    }
  }
  const preferences = new Map();
  function prefer(relation, endpoint, side) {
    if (!preferences.has(relation)) preferences.set(relation, {});
    preferences.get(relation)[endpoint] = side;
  }
  for (const relation of relations) {
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const facing = facingPortCorridor(from, to);
    if (facing?.axis !== 1) continue;
    for (const [side, level, toward, facingSide] of [
      [from, to, 'source', facing.fromSide], [to, from, 'target', facing.toSide],
    ]) {
      const inColumn = peer => {
        const lane = facingPortCorridor(level, peer);
        return lane?.axis === 0 && lane.low <= lane.high;
      };
      if (!incident.get(level.id).some(({ peer }) => inColumn(peer))) continue;
      const peers = incident.get(side.id).filter(({ peer }) => inColumn(peer));
      if (!peers.length) continue;
      const entrySide = toward === 'source' ? facing.toSide : facing.fromSide;
      prefer(relation, toward, facingSide);
      prefer(relation, toward === 'source' ? 'target' : 'source', entrySide);
      // Widening the column gap changes the dominant axis. Keep links to
      // other rows on the near vertical face of the side card, with a
      // sideways approach to the chain so its vertical ports stay free.
      for (const { relation: peerRelation, peer, endpoint } of peers) {
        if (peer.x < side.x + side.width && side.x < peer.x + peer.width) continue;
        prefer(peerRelation, endpoint, peer.cy < side.cy ? 'top' : 'bottom');
        prefer(peerRelation, endpoint === 'source' ? 'target' : 'source', entrySide);
      }
    }
  }
  if (preferences.size) return (relation, endpoint) => preferences.get(relation)?.[endpoint];
}

// Use the finished placement so rank rotation, frame attachments and
// later placement candidates all reserve space in the same coordinates.
export function facingLabelSpacingCandidate({ boxes, routes, labels, titles }, horizontal) {
  const [axis, size, center, across, breadth] = horizontal
    ? ['x', 'width', 'cx', 'y', 'height'] : ['y', 'height', 'cy', 'x', 'width'];
  const byRelation = new Map(labels.map(label => [label.relation, label]));
  const demands = [];
  for (const route of routes) {
    const { relation } = route;
    const label = byRelation.get(relation);
    if (!label || labelBesideStraightShaft(route, label)) continue;
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const corridor = facingPortCorridor(from, to);
    if (!corridor || corridor.axis !== Number(horizontal) || corridor.high < corridor.low) continue;
    const [first, last] = from[axis] < to[axis] ? [from, to] : [to, from];
    const near = first[axis] + first[size];
    const far = last[axis];
    const track = (corridor.low + corridor.high) / 2;
    const length = label[size];
    const slots = availableSlots(titles.boundaries, axis, size, across, breadth, track, near, far);
    slots.sort((a, b) => b.capacity - a.capacity);
    const slot = slots[0];
    if (slot.capacity >= length - epsilon) continue;
    const segment = horizontal ? { start: [near, track], end: [far, track] }
      : { start: [track, near], end: [track, far] };
    if ([...boxes.values()].some(box => box !== from && box !== to
        && segmentRectClearanceWithin(segment, box, 8) < 8)) continue;
    demands.push({ relation, slot, missing: length - slot.capacity });
  }
  if (!demands.length) return;

  // Prefer whitespace that already spans the whole placement. In a staggered
  // layout another row can straddle that space, so keep the card center order.
  // Moving later centers farther away preserves every existing card separation.
  const bands = openBands(boxes, axis, size);
  const increases = new Map();
  demands.sort((a, b) => a.slot.end - b.slot.end);
  for (const { slot: { start, end }, missing } of demands) {
    let remaining = missing;
    for (const [cut, increase] of increases) {
      if (cut >= start && cut <= end) remaining -= increase;
    }
    if (remaining <= epsilon) continue;
    const cut = bands.findLast(band => band > start && band < end) ?? (start + end) / 2;
    increases.set(cut, (increases.get(cut) ?? 0) + remaining);
  }
  const moved = new Map(boxes);
  for (const [id, box] of boxes) {
    let shift = 0;
    for (const [cut, increase] of increases) {
      if (box[center] >= cut) shift += increase;
    }
    if (shift) moved.set(id, { ...box, [axis]: box[axis] + shift, [center]: box[center] + shift });
  }
  return { moved, relations: new Set(demands.map(({ relation }) => relation)) };
}
