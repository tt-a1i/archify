// Test visible path commands, including the quadratic arcs used for corner
// rounding. A junction between commands is interior to the path.
const EPSILON = 1e-9;
const ROUND_OFF = 16 * Number.EPSILON;
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
  const segments = commands.flatMap(command => {
    const { start, end, control } = command;
    const chord = subtract(end, start);
    const direction = control && subtract(control, start);
    const length = Math.hypot(...chord);
    if (!direction) return length ? [command] : [];
    if (!length && coincides(start, control)) return [];
    if (length && Math.abs(cross(chord, direction)) > ROUND_OFF * length * Math.hypot(...direction)) return [command];

    // A straight quadratic with a monotone trace has the same centerline
    // as a line, including when it came from an explicit via.
    const axis = Math.abs(chord[0]) >= Math.abs(chord[1]) ? 0 : 1;
    const fraction = length ? direction[axis] / chord[axis] : Infinity;
    if (fraction >= 0 && fraction <= 1) {
      return [{ ...command, control: undefined }];
    }
    const turn = length ? fraction / (2 * fraction - 1) : 0.5;
    const middle = pointAt(command, turn);
    return [{ ...command, end: middle, control: undefined }, { ...command, start: middle, control: undefined }];
  }).map(command => ({ ...command, box: box(command) }));
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
  if (Math.abs(den) <= ROUND_OFF * Math.hypot(...u) * Math.hypot(...v)) return [];
  const delta = subtract(b.start, a.start);
  const t = cross(delta, v) / den;
  const s = cross(delta, u) / den;
  return inUnit(t) && inUnit(s) ? [[t, s]] : [];
}

function pointAt(segment, t) {
  if (!segment.control) return interpolate(segment.start, segment.end, t);
  return interpolate(interpolate(segment.start, segment.control, t), interpolate(segment.control, segment.end, t), t);
}

// Isolate real roots by partitioning at the derivative's extrema.
// A degree-four polynomial has only a constant number of monotone intervals.
// Endpoint roots still need the incoming and outgoing path directions below.
function polynomialRoots(coefficients, consume, includeTouches = true) {
  const norm = coefficients.reduce((sum, value) => sum + Math.abs(value), 0);
  if (!norm) return [];
  const terms = coefficients.map(value => value / norm);
  while (terms.length && Math.abs(terms.at(-1)) <= ROUND_OFF) terms.pop();
  if (terms.length < 2) return [];
  if (consume && !consume()) return [];
  if (terms.length === 2) {
    const root = -terms[0] / terms[1];
    return inUnit(root) ? [[Math.max(0, Math.min(1, root)), true]] : [];
  }

  const derivative = terms.slice(1).map((value, index) => value * (index + 1));
  const cuts = [0, ...polynomialRoots(derivative, consume, false).map(([t]) => t).filter(t => t > 0 && t < 1), 1];
  const evaluate = t => terms.reduceRight((value, term) => value * t + term, 0);
  const signs = cuts.map(t => {
    const value = evaluate(t);
    return Math.abs(value) <= ROUND_OFF ? 0 : Math.sign(value);
  });
  const roots = [];
  for (let i = 0; i < cuts.length; i++) {
    if (consume && !consume()) return roots;
    const changesSide = signs[i - 1] * signs[i + 1] < 0;
    if (!signs[i] && (includeTouches || changesSide || i === 0 || i === cuts.length - 1)) {
      roots.push([cuts[i], changesSide]);
    }
    if (signs[i] * signs[i + 1] !== -1) continue;
    let low = cuts[i];
    let high = cuts[i + 1];
    for (let step = 0; step < 52 && high - low > 8 * Number.EPSILON; step++) {
      if (consume && !consume()) return roots;
      const mid = (low + high) / 2;
      const value = evaluate(mid);
      if (!value) { low = high = mid; break; }
      if (Math.sign(value) === signs[i]) low = mid;
      else high = mid;
    }
    roots.push([(low + high) / 2, true]);
  }
  return roots;
}

function curveTerms({ start, control, end }) {
  const first = subtract(control, start);
  const last = subtract(end, control);
  return [first.map(value => 2 * value), subtract(last, first)];
}

function lineCurveRoots(line, curve, consume) {
  const u = subtract(line.end, line.start);
  const axis = Math.abs(u[0]) >= Math.abs(u[1]) ? 0 : 1;
  const terms = [subtract(curve.start, line.start), ...curveTerms(curve)].map(vector => cross(u, vector));
  return polynomialRoots(terms, consume).flatMap(([t, changesSide]) => {
    const s = (pointAt(curve, t)[axis] - line.start[axis]) / u[axis];
    return inUnit(s) ? [[s, t, changesSide]] : [];
  });
}

function curveRoots(first, second, consume) {
  const [linear, quadratic] = curveTerms(first);
  const det = cross(linear, quadratic);
  const terms = [subtract(second.start, first.start), ...curveTerms(second)];
  // In the first curve's affine basis its coordinates are (t, t²).
  // Substituting the second curve into y - x² gives a univariate quartic.
  const x = terms.map(vector => cross(vector, quadratic) / det);
  const y = terms.map(vector => cross(linear, vector) / det);
  const implicit = Array.from({ length: 5 }, (_, degree) => {
    const parts = [y[degree] ?? 0, ...x.map((value, index) => -value * (x[degree - index] ?? 0))];
    const value = parts.reduce((sum, term) => sum + term, 0);
    const magnitude = parts.reduce((sum, term) => sum + Math.abs(term), 0);
    return Math.abs(value) <= ROUND_OFF * magnitude ? 0 : value;
  });
  return polynomialRoots(implicit, consume).flatMap(([s, changesSide]) => {
    const t = (x[2] * s + x[1]) * s + x[0];
    return inUnit(t) ? [[t, s, changesSide]] : [];
  });
}

function branch(segment, t, sign) {
  const [linear, quadratic] = segment.control ? curveTerms(segment) : [subtract(segment.end, segment.start), [0, 0]];
  const direction = linear.map((component, axis) => sign * (component + 2 * t * quadratic[axis]));
  const speed = Math.hypot(...direction);
  if (!speed) return { angle: Math.atan2(quadratic[1], quadratic[0]), curvature: 0, slope: 0 };
  const [x, y] = direction.map(component => component / speed);
  const curvature = cross([x, y], quadratic) / (speed * speed);
  const along = x * quadratic[0] + y * quadratic[1];
  return { angle: Math.atan2(y, x), curvature, slope: -2 * along * curvature / (speed * speed) };
}

function raysAt(segments, index, t) {
  const segment = segments[index];
  if (t <= EPSILON) return index ? [branch(segments[index - 1], 1, -1), branch(segment, 0, 1)] : null;
  if (t >= 1 - EPSILON) return segments[index + 1] ? [branch(segment, 1, -1), branch(segments[index + 1], 0, 1)] : null;
  return [branch(segment, t, -1), branch(segment, t, 1)];
}

function alternating(left, right) {
  if (!left || !right) return false;
  // Put the angular cut in the largest gap so coincident tangents sort
  // together. For a tangent, compare the first two normal coefficients as
  // a function of distance along the shared tangent. Equal coefficients
  // describe the same local line or parabola and do not separate the rays.
  const rays = [...left, ...right].map((ray, index) => ({ ...ray, left: index < 2 })).sort((a, b) => a.angle - b.angle);
  const turn = 2 * Math.PI;
  const gaps = rays.map((ray, index) => rays[(index + 1) % 4].angle - ray.angle + (index === 3 ? turn : 0));
  const origin = rays[(gaps.indexOf(Math.max(...gaps)) + 1) % 4].angle;
  const tolerance = (a, b) => Math.abs(a - b) <= ROUND_OFF * Math.max(Math.abs(a), Math.abs(b));
  const order = (a, b) => {
    const angle = ((a.angle - origin + turn) % turn) - ((b.angle - origin + turn) % turn);
    if (Math.abs(angle) > ROUND_OFF) return angle;
    if (!tolerance(a.curvature, b.curvature)) return a.curvature - b.curvature;
    return tolerance(a.slope, b.slope) ? 0 : a.slope - b.slope;
  };
  rays.sort(order);
  return rays.every((ray, index) => {
    const next = rays[(index + 1) % 4];
    return ray.left !== next.left && order(ray, next) !== 0;
  });
}

export function visibleCrossings(left, right, limit = Infinity, consume = null) {
  const hits = [];
  if (!overlaps(left.bounds, right.bounds)) return hits;
  for (const [i, a] of left.segments.entries()) {
    for (const [j, b] of right.segments.entries()) {
      if (consume && !consume()) return hits;
      if (!overlaps(a.box, b.box)) continue;
      const roots = a.control && b.control ? curveRoots(a, b, consume)
        : b.control ? lineCurveRoots(a, b, consume) : a.control ? lineCurveRoots(b, a, consume).map(([s, t, changesSide]) => [t, s, changesSide]) : lineRoots(a, b);
      for (const [t, s, changesSide = true] of roots) {
        // The solver admits interior roots only when the paths change
        // sides. At command boundaries use both adjacent directions.
        const direct = t > EPSILON && t < 1 - EPSILON && s > EPSILON && s < 1 - EPSILON;
        if (direct ? !changesSide : !alternating(raysAt(left.segments, i, t), raysAt(right.segments, j, s))) continue;
        const point = pointAt(a, t);
        if (hits.some(hit => coincides(point, hit.point))) continue;
        hits.push({
          point,
          leftSegment: (t > 0.5 ? a.nextSourceSegment : undefined) ?? a.sourceSegment ?? i,
          rightSegment: (s > 0.5 ? b.nextSourceSegment : undefined) ?? b.sourceSegment ?? j,
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
