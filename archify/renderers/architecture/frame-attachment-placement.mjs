const attachmentGap = 40;

function placeLeavesByAttachment(frames, links, layout, adjustedPeers, axes) {
  const [across, span, inset, along, depth] = axes;
  const ranks = new Map();
  for (const [item, attachments] of links) {
    if (item.children || attachments.length !== 1) continue;
    const [{ member, peer, target }] = attachments;
    if (!frames.includes(peer) || adjustedPeers.has(peer) || member !== item || target.parent !== peer) continue;
    if (!ranks.has(peer)) ranks.set(peer, new Map());
    const key = `${item[along]}:${item[depth]}:${item[span]}`;
    const byRank = ranks.get(peer);
    if (!byRank.has(key)) byRank.set(key, []);
    const desired = peer[across] + peer[inset] + target[across] + (target[span] - item[span]) / 2;
    byRank.get(key).push({ item, desired });
  }

  // Keep the rank and card sizes. Allocate its existing slots in the same
  // order as the real attachment points, then translate the rank as a unit.
  const sameSizeRanks = Array.from(ranks.values(), (byRank) => [...byRank.values()]).flat();
  for (const leaves of sameSizeRanks) {
    if (leaves.length < 2 || leaves.every(({ desired }) => desired === leaves[0].desired)) continue;
    const byPosition = leaves.sort((a, b) => a.item[across] - b.item[across]);
    const slots = byPosition.map(({ item }) => item[across]);
    const ordered = [...byPosition].sort((a, b) => a.desired - b.desired);
    const [{ item }] = ordered;
    const items = new Set(ordered.map((leaf) => leaf.item));
    const blockers = [...links.keys()].filter((other) => !items.has(other)
      && other[along] < item[along] + item[depth] + attachmentGap
      && other[along] + other[depth] + attachmentGap > item[along]);

    const lower = -slots[0];
    const upper = layout[span] - slots.at(-1) - item[span];
    const candidates = [0, lower, upper, ...ordered.map(({ desired }, i) => desired - slots[i])];
    for (const other of blockers) {
      for (const slot of slots) {
        candidates.push(other[across] - attachmentGap - item[span] - slot, other[across] + other[span] + attachmentGap - slot);
      }
    }
    const initial = byPosition.reduce((sum, leaf, index) => sum + Math.abs(leaf.desired - slots[index]), 0);
    let bestOffset = 0;
    let bestCost = Infinity;
    for (const offset of candidates) {
      if (offset < lower || offset > upper || slots.some((slot) => blockers.some((other) =>
        slot + offset + item[span] + attachmentGap > other[across] && slot + offset < other[across] + other[span] + attachmentGap))) continue;
      const cost = ordered.reduce((sum, leaf, index) => sum + Math.abs(leaf.desired - slots[index] - offset), 0);
      if (cost < bestCost || (cost === bestCost && Math.abs(offset) < Math.abs(bestOffset))) {
        bestCost = cost;
        bestOffset = offset;
      }
    }
    if (bestCost >= initial) continue;
    for (const [index, leaf] of ordered.entries()) leaf.item[across] = slots[index] + bestOffset;
  }
}

// The parent layout measures frames as boxes. The original endpoints let
// a shallow peer face the part of a frame it actually connects to.
export function placeFrameAttachments(group, layout, leadingAllowance) {
  if (group.children.length > 24 || group.edges.length > 36) return;
  const frames = group.children.filter((item) => item.children && item.children.length <= 64);
  if (!frames.length) return;

  const axes = layout.vertical
    ? ['x', 'width', 'leftInset', 'y', 'height']
    : ['y', 'height', 'topPad', 'x', 'width'];
  const [across, span, inset, along, depth] = axes;
  const links = new Map(group.children.map((item) => [item, []]));
  for (const edge of group.edges) {
    const { from, to, originalFrom, originalTo, variant } = edge;
    links.get(from).push({ member: originalFrom, target: originalTo, peer: to, variant });
    links.get(to).push({ member: originalTo, target: originalFrom, peer: from, variant });
  }

  const localCenter = (item) => item[across] + item[span] / 2;
  const frameOrigin = (item) => item[across] + item[inset];
  const adjustedPeers = new Set();
  for (const frame of frames) {
    const attachments = links.get(frame);
    if (frame.parallel || attachments.length < 2 || frame.children.some((item) => item.children)) continue;
    const [{ peer }] = attachments;
    if (!frames.includes(peer) || peer.children.length <= frame.children.length ||
      attachments.some((link) => link.peer !== peer || link.member.parent !== frame || link.target.parent !== peer)) continue;

    const near = Math.min(...frame.children.map((item) => item[across]));
    const far = Math.max(...frame.children.map((item) => item[across] + item[span]));
    const origin = frameOrigin(frame);
    let improvement = 0;
    for (const { member, target } of attachments) {
      const center = localCenter(member);
      const destination = frameOrigin(peer) + localCenter(target);
      improvement += Math.abs(origin + center - destination)
        - Math.abs(origin + near + far - center - destination);
    }
    // Reflect across the occupied extent to keep the frame and rank the same size.
    if (improvement < 48) continue;
    for (const item of frame.children) item[across] = near + far - item[across] - item[span];
    adjustedPeers.add(peer);
  }
  placeLeavesByAttachment(frames, links, layout, adjustedPeers, axes);
  if (adjustedPeers.size) placeIsolatedPeers(group, layout, axes, links, adjustedPeers);
  if (group.members || !leadingAllowance || layout.parallel) return;
  placeOptionalFrames(group, layout, axes, leadingAllowance);
  placeTerminalCards(group, layout, axes, links);
}

function placeIsolatedPeers(group, layout, axes, links, adjustedPeers) {
  const [across, span, inset, along, depth] = axes;
  const localCenter = (item) => item[across] + item[span] / 2;
  const frameOrigin = (item) => item[across] + item[inset];

  const isolated = [];
  for (const [item, attachments] of links) {
    if (!attachments.length || (item.children && item.children.length !== 1)) continue;
    const [{ member, peer }] = attachments;
    if (!adjustedPeers.has(peer) ||
      attachments.some((link) => link.peer !== peer || link.target.parent !== peer || link.member !== member)) continue;
    const average = attachments.reduce((total, { target }) => total + localCenter(target), 0) / attachments.length;
    const anchor = member === item ? item[span] / 2 : item[inset] + localCenter(member);
    const emphasized = attachments.some(({ variant }) => variant === 'emphasis');
    isolated.push({ item, desired: frameOrigin(peer) + average - anchor, emphasized });
  }
  isolated.sort((a, b) => Number(b.emphasized) - Number(a.emphasized));

  // Keep each isolated peer on its rank. Move it only to an open slot with
  // enough room for routes, and keep the strongest flow nearest its endpoint.
  const limit = layout[span];
  for (const { item, desired } of isolated) {
    const blockers = group.children.filter((other) => other !== item
      && other[along] < item[along] + item[depth] + attachmentGap
      && other[along] + other[depth] + attachmentGap > item[along]);
    const clamped = Math.min(Math.max(0, desired), limit - item[span]);
    const slots = [clamped, ...blockers.flatMap((other) => [
      other[across] - item[span] - attachmentGap, other[across] + other[span] + attachmentGap,
    ])];
    let best = item[across];
    for (const position of slots) {
      if (position < 0 || position + item[span] > limit ||
        Math.abs(position - desired) >= Math.abs(best - desired)) continue;
      if (blockers.every((other) => position + item[span] + attachmentGap <= other[across]
        || position >= other[across] + other[span] + attachmentGap)) best = position;
    }
    if (Math.abs(item[across] - desired) > Math.abs(best - desired) + attachmentGap) item[across] = best;
  }
}

// An optional terminal frame may be ranked below its source frame even
// though the attachment is beside that source's incoming edges. Reuse
// space on the leading side when the endpoint is clear in that direction.
function placeOptionalFrames(group, layout, axes, leadingAllowance) {
  const [across, span, inset, along, depth] = axes;
  const depthInset = layout.vertical ? 'topPad' : 'leftInset';
  for (const edge of group.edges) {
    const { from: peer, to: frame, originalFrom: member, originalTo, variant } = edge;
    if (variant !== 'dashed' || !peer.children || frame.children?.length !== 1
      || member.parent !== peer || originalTo.parent !== frame || frame[along] < peer[along] + peer[depth]
      || group.edges.some((other) => other !== edge && (other.from === frame || other.to === frame))) continue;

    const center = (box, axis, size) => box[axis] + box[size] / 2;
    const track = center(member, across, span);
    const leading = peer[along] - frame[depth];
    if (leading < -leadingAllowance || peer.children.some((other) => other !== member
      && other[along] < member[along] && track >= other[across] && track <= other[across] + other[span])) continue;

    const onlyChild = frame.children[0];
    const target = peer[across] + peer[inset] + track;
    const anchor = frame[inset] + center(onlyChild, across, span);
    const memberAlong = peer[along] + peer[depthInset] + center(member, along, depth);
    const childAlong = frame[depthInset] + center(onlyChild, along, depth);
    const oldDistance = Math.abs(frame[across] + anchor - target) + Math.abs(frame[along] + childAlong - memberAlong);
    const desired = target - anchor;
    const blockers = group.children.filter((other) => other !== frame
      && other[along] < leading + frame[depth] && other[along] + other[depth] > leading);
    const candidates = [desired, ...blockers.flatMap((other) => [
      other[across] - frame[span] - attachmentGap, other[across] + other[span] + attachmentGap,
    ])];
    let best;
    let bestDistance = oldDistance / 2;
    for (const candidate of candidates) {
      if (candidate < 0 || candidate + frame[span] > layout[span]
        || blockers.some((other) => candidate < other[across] + other[span] + attachmentGap
          && candidate + frame[span] + attachmentGap > other[across])) continue;
      const distance = Math.abs(candidate - desired) + Math.abs(leading + childAlong - memberAlong);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best !== undefined) {
      frame[across] = best;
      frame[along] = leading;
    }
  }
}

// Bring a detached card to a clear exit on the side that already faces it.
function placeTerminalCards(group, layout, axes, links) {
  const [across, span, inset, along, depth] = axes;
  for (const { from: peer, to: card, originalFrom: member, variant } of group.edges) {
    if (variant !== 'dashed' || !peer.children || card.children || member.parent !== peer
      || links.get(card).length !== 1 || card[along] < peer[along] + peer[depth]) continue;
    const track = member[across] + member[span] / 2;
    if (peer.children.some((other) => other !== member && other[along] > member[along]
      && track >= other[across] - 8 && track <= other[across] + other[span] + 8)) continue;
    const desired = peer[across] + peer[inset] + track - card[span] / 2;
    const exit = peer[along] + peer[depth];
    if (desired < 0 || desired + card[span] > layout[span]
      || card[along] - exit + Math.abs(card[across] - desired) < 2 * attachmentGap) continue;
    if (group.children.some((other) => other !== card && other !== peer
      && other[along] < exit + card[depth] && other[along] + other[depth] > exit
      && other[across] < desired + card[span] + attachmentGap
      && other[across] + other[span] + attachmentGap > desired)) continue;
    card[across] = desired;
    card[along] = exit;
  }
}
