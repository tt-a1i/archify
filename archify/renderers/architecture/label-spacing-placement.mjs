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
