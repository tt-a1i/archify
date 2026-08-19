/** Serialize computed layout for dry-run / inspect (#9). */

export function componentBox(c) {
  return {
    id: c.id,
    type: c.type,
    label: c.label,
    x: Math.round(c.x),
    y: Math.round(c.y),
    width: c.width,
    height: c.height,
    ...(Number.isInteger(c.row) ? { row: c.row } : {}),
    ...(Number.isInteger(c.col) ? { col: c.col } : {}),
    ...(Array.isArray(c.pos) ? { pos: c.pos.map(Math.round) } : {}),
  };
}

export function boundaryBox(b) {
  return {
    kind: b.kind,
    label: b.label,
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
    wraps: b.wraps,
  };
}

export function connectionPath(conn, routed, labelAt) {
  return {
    from: conn.from,
    to: conn.to,
    label: conn.label ?? null,
    variant: conn.variant ?? 'default',
    route: conn.route ?? 'auto',
    points: routed.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
    ...(labelAt ? { labelAt: labelAt.map(Math.round) } : {}),
  };
}
