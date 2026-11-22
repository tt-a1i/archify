// Test visible path commands, including the quadratic arcs used for corner
// rounding. A junction between commands is interior to the path.
const EPSILON = 1e-7;
const subtract = ([x, y], [a, b]) => [x - a, y - b];
const cross = ([x, y], [a, b]) => x * b - y * a;
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const inUnit = t => t >= -EPSILON && t <= 1 + EPSILON;
const coincides = (a, b) => Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;

function box({ start, control, end }) {
  const mid = control || start;
  return [Math.min(start[0], mid[0], end[0]), Math.min(start[1], mid[1], end[1]),
    Math.max(start[0], mid[0], end[0]), Math.max(start[1], mid[1], end[1])];
}

function overlaps(a, b) {
  return a[0] <= b[2] + EPSILON && b[0] <= a[2] + EPSILON
    && a[1] <= b[3] + EPSILON && b[1] <= a[3] + EPSILON;
}

export function prepareCrossingPath(commands) {
  const segments = commands.filter(({ start, end, control }) => !coincides(start, end) || (control && !coincides(start, control)))
    .map(command => ({ ...command, box: box(command) }));
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { box: [l, t, r, b] } of segments) {
    bounds[0] = Math.min(bounds[0], l);
    bounds[1] = Math.min(bounds[1], t);
    bounds[2] = Math.max(bounds[2], r);
    bounds[3] = Math.max(bounds[3], b);
  }
  return { segments, bounds };
}

function lineRoots(a, b) {
  const u = subtract(a.end, a.start);
  const v = subtract(b.end, b.start);
  const den = cross(u, v);
  if (Math.abs(den) < EPSILON * Math.hypot(...u) * Math.hypot(...v)) return [];
  const delta = subtract(b.start, a.start);
  const t = cross(delta, v) / den;
  const s = cross(delta, u) / den;
  return inUnit(t) && inUnit(s) ? [[t, s]] : [];
}

function pointAt(segment, t) {
  if (!segment.control) return interpolate(segment.start, segment.end, t);
  return interpolate(interpolate(segment.start, segment.control, t), interpolate(segment.control, segment.end, t), t);
}

function lineCurveRoots(line, curve) {
  const u = subtract(line.end, line.start);
  const [a, b, c] = [curve.start, curve.control, curve.end].map(point => cross(u, subtract(point, line.start)));
  const quadratic = a - 2 * b + c;
  const linear = 2 * (b - a);
  const discriminant = linear * linear - 4 * quadratic * a;
  let roots = [];
  if (Math.abs(quadratic) < EPSILON) {
    if (Math.abs(linear) >= EPSILON) roots = [-a / linear];
  } else if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const stable = -0.5 * (linear + (linear < 0 ? -root : root));
    roots = stable ? [stable / quadratic, a / stable] : [-linear / (2 * quadratic)];
  }
  const axis = Math.abs(u[0]) >= Math.abs(u[1]) ? 0 : 1;
  return roots.filter(inUnit).flatMap(t => {
    const s = (pointAt(curve, t)[axis] - line.start[axis]) / u[axis];
    return inUnit(s) ? [[s, t]] : [];
  });
}

function curveRoots(first, second) {
  const parallel = coincides(first.control, second.control)
    && ((coincides(first.start, second.start) && coincides(first.end, second.end))
      || (coincides(first.start, second.end) && coincides(first.end, second.start)));
  if (parallel) return [];
  const hits = [];
  const deviation = ({ start, end, control }) => Math.hypot(...subtract(control, interpolate(start, end, 0.5))) / 2;
  function narrow(a, b, ta, tb, sizeA, sizeB, depth) {
    if (!overlaps(box(a), box(b))) return;
    const flatA = deviation(a);
    const flatB = deviation(b);
    // Curves only need subdivision against another curve. Line/curve pairs
    // solve the polynomial directly. Limit the remaining chord error to
    // 1/10,000 unit, with a depth bound for hostile artifact coordinates.
    if (Math.max(flatA, flatB) <= 0.0001 || depth === 26) {
      for (const [t, s] of lineRoots(a, b)) hits.push([ta + sizeA * t, tb + sizeB * s]);
      return;
    }
    const [segment, half] = flatA >= flatB ? [a, sizeA / 2] : [b, sizeB / 2];
    const left = interpolate(segment.start, segment.control, 0.5);
    const right = interpolate(segment.control, segment.end, 0.5);
    const middle = interpolate(left, right, 0.5);
    const before = { start: segment.start, control: left, end: middle };
    const after = { start: middle, control: right, end: segment.end };
    if (flatA >= flatB) {
      narrow(before, b, ta, tb, half, sizeB, depth + 1);
      narrow(after, b, ta + half, tb, half, sizeB, depth + 1);
    } else {
      narrow(a, before, ta, tb, sizeA, half, depth + 1);
      narrow(a, after, ta, tb + half, sizeA, half, depth + 1);
    }
  }
  narrow(first, second, 0, 0, 1, 1, 0);
  return hits;
}

function raysAt(segments, index, t) {
  const { start, control, end } = segments[index];
  const into = segment => {
    const point = segment.control || segment.start;
    return subtract(coincides(point, segment.end) ? segment.start : point, segment.end);
  };
  const out = segment => {
    const point = segment.control || segment.end;
    return subtract(coincides(point, segment.start) ? segment.end : point, segment.start);
  };
  if (t <= EPSILON) return index ? [into(segments[index - 1]), out(segments[index])] : null;
  if (t >= 1 - EPSILON) return segments[index + 1] ? [into(segments[index]), out(segments[index + 1])] : null;
  const direction = control ? interpolate(subtract(control, start), subtract(end, control), t) : subtract(end, start);
  return [direction, [-direction[0], -direction[1]]];
}

function alternating(left, right) {
  if (!left || !right) return false;
  const rays = [...left, ...right].map(([x, y], index) => ({ angle: Math.atan2(y, x), left: index < 2 }))
    .sort((a, b) => a.angle - b.angle);
  return rays.every((ray, index) => {
    const next = rays[(index + 1) % 4];
    return ray.left !== next.left && next.angle - ray.angle + (index === 3 ? 2 * Math.PI : 0) > EPSILON;
  });
}

export function visibleCrossings(left, right, limit = Infinity, consume = null) {
  const hits = [];
  if (!overlaps(left.bounds, right.bounds)) return hits;
  for (const [i, a] of left.segments.entries()) {
    for (const [j, b] of right.segments.entries()) {
      if (consume && !consume()) return hits;
      if (!overlaps(a.box, b.box)) continue;
      const roots = a.control && b.control ? curveRoots(a, b)
        : b.control ? lineCurveRoots(a, b) : a.control ? lineCurveRoots(b, a).map(([s, t]) => [t, s]) : lineRoots(a, b);
      for (const [t, s] of roots) {
        // Interior transverse straight segments cannot be tangential. The
        // remaining cases need both rays of each path at the intersection.
        const direct = !a.control && !b.control && t > EPSILON && t < 1 - EPSILON && s > EPSILON && s < 1 - EPSILON;
        if (!direct && !alternating(raysAt(left.segments, i, t), raysAt(right.segments, j, s))) continue;
        const point = pointAt(a, t);
        if (hits.some(hit => coincides(point, hit.point))) continue;
        hits.push({ point, leftSegment: i, rightSegment: j });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
