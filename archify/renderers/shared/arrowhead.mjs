import { rectsOverlap } from './geometry.mjs';

// Architecture uses a stroke-scaled marker with refX 9, refY 3.5 and
// vertices (0,0), (10,3.5), (0,7). The SVG endpoint is its reference point.
export function arrowheadTriangle(tip, before, stroke) {
  if (!tip || !before) return null;
  const dx = tip[0] - before[0];
  const dy = tip[1] - before[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const x = dx * stroke / length;
  const y = dy * stroke / length;
  const base = [tip[0] - 9 * x, tip[1] - 9 * y];
  const points = [[base[0] - 3.5 * y, base[1] + 3.5 * x], [tip[0] + x, tip[1] + y],
    [base[0] + 3.5 * y, base[1] - 3.5 * x]];
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return { points, bounds: { x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } };
}

// The box supplies the rectangle's two separating axes. Check the other
// axes against the three sides of the triangle.
export function maskCoversArrowhead(rect, marker) {
  if (!marker || !rectsOverlap(rect, marker.bounds)) return false;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const corners = [[rect.x, rect.y], [right, rect.y], [right, bottom], [rect.x, bottom]];
  return marker.points.every(([x, y], index) => {
    const tip = marker.points[(index + 1) % 3];
    const project = ([a, b]) => (tip[0] - x) * (b - y) - (tip[1] - y) * (a - x);
    const sign = Math.sign(project(marker.points[(index + 2) % 3]));
    return corners.some(point => sign * project(point) > 1e-7);
  });
}
