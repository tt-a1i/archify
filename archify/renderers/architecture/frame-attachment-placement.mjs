// The parent layout measures frames as boxes. The original endpoints let
// a shallow peer face the part of a frame it actually connects to.
export function placeFrameAttachments(group, layout) {
  if (group.children.length > 24 || group.edges.length > 36) return;
  const frames = group.children.filter((item) => item.children && item.children.length <= 64);
  if (frames.length < 2) return;

  const [across, span, inset, along, depth] = layout.vertical
    ? ['x', 'width', 'leftInset', 'y', 'height']
    : ['y', 'height', 'topPad', 'x', 'width'];
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
  if (!adjustedPeers.size) return;

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
  const gap = 40;
  const limit = layout[span];
  for (const { item, desired } of isolated) {
    const blockers = group.children.filter((other) => other !== item
      && other[along] < item[along] + item[depth] + gap
      && other[along] + other[depth] + gap > item[along]);
    const clamped = Math.min(Math.max(0, desired), limit - item[span]);
    const slots = [clamped, ...blockers.flatMap((other) => [
      other[across] - item[span] - gap, other[across] + other[span] + gap,
    ])];
    let best = item[across];
    for (const position of slots) {
      if (position < 0 || position + item[span] > limit ||
        Math.abs(position - desired) >= Math.abs(best - desired)) continue;
      if (blockers.every((other) => position + item[span] + gap <= other[across]
        || position >= other[across] + other[span] + gap)) best = position;
    }
    if (Math.abs(item[across] - desired) > Math.abs(best - desired) + gap) item[across] = best;
  }
}
