const directions = {
  left: { opposite: 'right', vertical: false, reverse: true },
  right: { opposite: 'left', vertical: false, reverse: false },
  top: { opposite: 'bottom', vertical: true, reverse: true },
  bottom: { opposite: 'top', vertical: true, reverse: false },
};

export function straightChainPlacementDirection(items, edges) {
  // A directed chain can rotate or reverse as a unit without changing which
  // cards are neighbors. Pins still anchor the resolved chain after placement;
  // frame boxes, branches and cycles keep the ordinary placement path.
  if (items.some((item) => item.children) || edges.length !== items.length - 1) return null;
  const sources = new Set();
  const targets = new Set();
  let direction;
  for (const edge of edges) {
    if (sources.has(edge.from) || targets.has(edge.to)) return null;
    sources.add(edge.from);
    targets.add(edge.to);
    if (edge.route !== 'straight' || edge.via?.length || (!edge.fromSide && !edge.toSide)) continue;
    const candidate = edge.fromSide ? directions[edge.fromSide]
      : directions[directions[edge.toSide]?.opposite];
    if (!candidate || (edge.toSide && candidate.opposite !== edge.toSide)) return null;
    if (direction && candidate !== direction) return null;
    direction = candidate;
  }
  return direction ?? null;
}
