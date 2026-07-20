#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectBorderRuns, collectRouteRhythmIssues, routeBudgetMetrics } from '../renderers/shared/geometry.mjs';

const input = process.argv[2];

if (!input || input === '-h' || input === '--help') {
  console.error('Usage: node scripts/check-render-output.mjs <diagram.html>');
  process.exit(input ? 0 : 2);
}

const htmlPath = path.resolve(input);
let html;
try {
  html = fs.readFileSync(htmlPath, 'utf8');
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    file: htmlPath,
    checks: [{ name: 'file_readable', ok: false, details: [err.message] }],
  }, null, 2));
  process.exit(1);
}

const checks = [];
let composition = {
  schemaVersion: 1,
  profile: 'standard',
  status: 'pass',
  summary: { errors: 0, warnings: 0 },
  metrics: {
    properCrossings: 0,
    containerBorderRuns: 0,
    maxBends: 0,
    routesOverSuggestedBends: 0,
    maxStretch: null,
    routesOverSuggestedStretch: 0,
    minSegmentPx: null,
    minInteriorSegmentPx: null,
    shortSegmentCount: 0,
    shortEndpointSegmentCount: 0,
    shortInteriorSegmentCount: 0,
    microSegmentCount: 0,
  },
  suggestedLimits: { bendsPerRelationship: 2, stretch: 1.35, segmentPx: 16, microSegmentPx: 8 },
  issues: [],
};

function addCheck(name, ok, details = []) {
  checks.push({ name, ok, details });
}

const svgMatches = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)];
addCheck('single_svg', svgMatches.length === 1, [`found ${svgMatches.length} <svg> block(s)`]);

if (svgMatches.length === 1) {
  const svg = svgMatches[0][0];
  const svgRoot = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const qualityProfile = parseAttrs(svgRoot)['data-quality-profile'] || 'standard';
  addCheck('finite_svg', !/\b(?:NaN|undefined|Infinity|-Infinity)\b/.test(svg));
  const legendStart = svg.indexOf('<!-- Legend -->');
  const beforeLegend = legendStart >= 0 ? svg.slice(0, legendStart) : svg;
  const arrows = collectArrows(beforeLegend);
  const diagonal = arrows.filter((arrow) => isTwoPointDiagonal(arrow));
  addCheck(
    'orthogonal_arrows',
    diagonal.length === 0,
    diagonal.map((arrow) => `${arrow.kind} ${arrow.index}: ${arrow.raw}`),
  );
  const relationshipCrossings = collectRelationshipCrossings(arrows);
  const compositionFrames = collectCompositionFrames(beforeLegend);
  const containerBorderRuns = collectBorderRuns({
    routedRelations: arrows
      .filter((arrow) => arrow.from && arrow.to && arrow.borderSegments.length)
      .map((arrow) => ({
        relation: arrow,
        relationIndex: arrow.index,
        segments: arrow.borderSegments,
      })),
    frames: compositionFrames,
  });
  const routedRelationships = arrows
    .filter((arrow) => arrow.from && arrow.to && arrow.routePoints.length)
    .map((arrow) => ({ relation: arrow, relationIndex: arrow.index, points: arrow.routePoints }));
  const routeMetrics = routeBudgetMetrics({ routedRelations: routedRelationships });
  const routeRhythmIssues = collectRouteRhythmIssues({ routedRelations: routedRelationships });
  const crossingIsError = qualityProfile === 'showcase';
  const rhythmIsError = qualityProfile === 'showcase';
  const compositionErrors = containerBorderRuns.length
    + (crossingIsError ? relationshipCrossings.length : 0)
    + (rhythmIsError ? routeRhythmIssues.length : 0);
  const compositionWarnings = (crossingIsError ? 0 : relationshipCrossings.length)
    + (rhythmIsError ? 0 : routeRhythmIssues.length);
  composition = {
    schemaVersion: 1,
    profile: qualityProfile,
    status: compositionErrors ? 'fail' : 'pass',
    summary: {
      errors: compositionErrors,
      warnings: compositionWarnings,
    },
    metrics: {
      properCrossings: relationshipCrossings.length,
      containerBorderRuns: containerBorderRuns.length,
      ...roundedRouteMetrics(routeMetrics),
    },
    suggestedLimits: { bendsPerRelationship: 2, stretch: 1.35, segmentPx: 16, microSegmentPx: 8 },
    issues: [
      ...containerBorderRuns.map((hit) => ({
        severity: 'error',
        code: 'composition/container-border-run',
        relationship: relationshipRecord(hit.relation),
        frame: frameRecord(hit.frame),
        side: hit.side,
        segmentIndex: hit.segmentIndex,
        overlapLength: Math.round(hit.overlapLength * 10) / 10,
        from: hit.overlapStart.map((value) => Math.round(value * 10) / 10),
        to: hit.overlapEnd.map((value) => Math.round(value * 10) / 10),
      })),
      ...relationshipCrossings.map((hit) => ({
        severity: crossingIsError ? 'error' : 'warning',
        code: 'composition/proper-crossing',
        relationship: relationshipRecord(hit.left),
        otherRelationship: relationshipRecord(hit.right),
        point: hit.point.map((value) => Math.round(value * 10) / 10),
      })),
      ...routeRhythmIssues.map((hit) => ({
        severity: rhythmIsError ? 'error' : 'warning',
        code: hit.code,
        relationship: relationshipRecord(hit.relation),
        segmentIndex: hit.segmentIndex,
        position: hit.position,
        length: Math.round(hit.length * 10) / 10,
        from: hit.start.map((value) => Math.round(value * 10) / 10),
        to: hit.end.map((value) => Math.round(value * 10) / 10),
      })),
    ],
  };
  addCheck(
    'relationship_crossings',
    !crossingIsError || relationshipCrossings.length === 0,
    relationshipCrossings.map((hit) => (
      `[composition/proper-crossing] ${qualityProfile} ${relationshipName(hit.left)} crosses ${relationshipName(hit.right)} at [${formatPoint(hit.point)}]`
    )),
  );
  addCheck(
    'container_border_runs',
    containerBorderRuns.length === 0,
    containerBorderRuns.map((hit) => (
      `[composition/container-border-run] ${relationshipName(hit.relation)} follows ${frameName(hit.frame)} ${hit.side} border for ${Math.round(hit.overlapLength * 10) / 10}px on segment ${hit.segmentIndex} [${formatPoint(hit.overlapStart)}] -> [${formatPoint(hit.overlapEnd)}]`
    )),
  );
  addCheck(
    'route_rhythm',
    !rhythmIsError || routeRhythmIssues.length === 0,
    routeRhythmIssues.map((hit) => (
      `[${hit.code}] ${qualityProfile} ${relationshipName(hit.relation)} has a ${Math.round(hit.length * 10) / 10}px ${hit.position} segment ${hit.segmentIndex} [${formatPoint(hit.start)}] -> [${formatPoint(hit.end)}]`
    )),
  );

  if (legendStart >= 0) {
    const legendFragment = svg.slice(legendStart);
    const legendBoxes = collectLegendBoxes(legendFragment);
    const collisions = collectLegendCollisions(arrows, legendBoxes);
    addCheck(
      'legend_clearance',
      collisions.length === 0,
      collisions.map((hit) => `${hit.arrow.kind} ${hit.arrow.index} crosses legend ${hit.box.label}`),
    );
  } else {
    addCheck('legend_clearance', true, ['no legend marker found']);
  }
}

const ok = checks.every((check) => check.ok) && composition.status !== 'fail';
console.log(JSON.stringify({ ok, file: htmlPath, checks, composition }, null, 2));
process.exit(ok ? 0 : 1);

function collectArrows(fragment) {
  const arrows = [];
  let index = 0;

  for (const tag of fragment.matchAll(/<(path|line)\b[^>]*>/gi)) {
    const raw = tag[0];
    if (!/\bclass="[^"]*\ba-(?:default|emphasis|security|dashed)\b/.test(raw)) continue;
    if (!/\bmarker-end=/.test(raw)) continue;
    const attrs = parseAttrs(raw);
    const segments = tag[1].toLowerCase() === 'line'
      ? lineSegments(attrs)
      : pathSegments(attrs.d || '');
    const borderSegments = tag[1].toLowerCase() === 'line'
      ? segments
      : straightPathSegments(attrs.d || '');
    arrows.push({
      kind: tag[1].toLowerCase(),
      index: index += 1,
      raw,
      segments,
      borderSegments,
      routePoints: parseRoutePoints(attrs['data-composition-points']) || (
        borderSegments.length ? [borderSegments[0].start, ...borderSegments.map((segment) => segment.end)] : []
      ),
      from: attrs['data-edge-from'] || attrs['data-composition-edge-from'],
      to: attrs['data-edge-to'] || attrs['data-composition-edge-to'],
      id: attrs['data-edge-id'] || attrs['data-composition-edge-id'],
    });
  }

  return arrows;
}

function roundedRouteMetrics(metrics) {
  return {
    ...metrics,
    maxStretch: metrics.maxStretch == null ? null : Math.round(metrics.maxStretch * 1000) / 1000,
    minSegmentPx: metrics.minSegmentPx == null ? null : Math.round(metrics.minSegmentPx * 10) / 10,
    minInteriorSegmentPx: metrics.minInteriorSegmentPx == null ? null : Math.round(metrics.minInteriorSegmentPx * 10) / 10,
  };
}

function parseRoutePoints(value) {
  if (!value) return null;
  const points = value.split(';').map((pair) => pair.split(',').map(Number));
  return points.length >= 2 && points.every(isPoint) ? points : null;
}

function collectRelationshipCrossings(arrows) {
  const relationships = arrows.filter((arrow) => arrow.from && arrow.to && arrow.segments.length);
  const crossings = [];
  for (let leftIndex = 0; leftIndex < relationships.length; leftIndex += 1) {
    const left = relationships[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < relationships.length; rightIndex += 1) {
      const right = relationships[rightIndex];
      if ([left.from, left.to].some((id) => id === right.from || id === right.to)) continue;
      let point = null;
      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          point = properSegmentIntersection(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end);
          if (point) break;
        }
        if (point) break;
      }
      if (point) crossings.push({ left, right, point });
    }
  }
  return crossings;
}

function relationshipName(arrow) {
  return arrow.id
    ? `relationship id "${arrow.id}" ("${arrow.from}" -> "${arrow.to}")`
    : `relationship "${arrow.from}" -> "${arrow.to}"`;
}

function relationshipRecord(arrow) {
  return {
    id: arrow.id,
    from: arrow.from,
    to: arrow.to,
    artifactIndex: arrow.index,
  };
}

function collectCompositionFrames(fragment) {
  const frames = [];
  for (const match of fragment.matchAll(/<(rect|path|line)\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const kind = attrs['data-composition-frame-kind'];
    if (!kind) continue;
    const identity = attrs['data-composition-frame-id'] || frames.length;
    if (match[1].toLowerCase() === 'rect') {
      const frame = {
        kind,
        id: identity,
        x: numberAttr(attrs, 'x'),
        y: numberAttr(attrs, 'y'),
        width: numberAttr(attrs, 'width'),
        height: numberAttr(attrs, 'height'),
        radius: numberAttr(attrs, 'rx') || 0,
      };
      if ([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) frames.push(frame);
      continue;
    }
    const segments = match[1].toLowerCase() === 'line'
      ? lineSegments(attrs)
      : pathSegments(attrs.d || '');
    for (const [segmentIndex, segment] of segments.entries()) {
      frames.push({
        kind,
        id: segments.length > 1 ? `${identity}:${segmentIndex}` : identity,
        shape: 'line',
        start: segment.start,
        end: segment.end,
      });
    }
  }
  return frames;
}

function frameName(frame) {
  return `${frame.kind || 'frame'} "${frame.id}"`;
}

function frameRecord(frame) {
  return { kind: frame.kind, id: frame.id };
}

function formatPoint(point) {
  return point.map((value) => Math.round(value * 10) / 10).join(', ');
}

function lineSegments(attrs) {
  const start = [numberAttr(attrs, 'x1'), numberAttr(attrs, 'y1')];
  const end = [numberAttr(attrs, 'x2'), numberAttr(attrs, 'y2')];
  if (!isPoint(start) || !isPoint(end)) return [];
  return [{ start, end }];
}

function pathSegments(d) {
  const points = pointsFromPath(d);
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    segments.push({ start: points[i - 1], end: points[i] });
  }
  return segments;
}

// Border runs use exact visible primitives. Non-collinear Q curves are never
// flattened into chords here: a tangent or sampled near-horizontal curve is
// not a structural border run. A fully collinear Q remains a straight visible
// primitive and is included.
function straightPathSegments(d) {
  const tokens = d.match(/[MLHVQZmlhvqz]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) || [];
  const segments = [];
  let i = 0;
  let command = '';
  let current = [0, 0];
  let start = null;
  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    if (!command) break;
    const absolute = command === command.toUpperCase();
    switch (command.toUpperCase()) {
      case 'M':
      case 'L': {
        let first = true;
        while (i + 1 < tokens.length && !isCommand(tokens[i])) {
          const point = [Number.parseFloat(tokens[i++]), Number.parseFloat(tokens[i++])];
          if (!point.every(Number.isFinite)) break;
          const next = absolute ? point : [current[0] + point[0], current[1] + point[1]];
          if (command.toUpperCase() === 'L' || !first) segments.push({ start: current, end: next });
          current = next;
          if (!start) start = current;
          first = false;
        }
        break;
      }
      case 'H': {
        while (i < tokens.length && !isCommand(tokens[i])) {
          const value = Number.parseFloat(tokens[i++]);
          if (!Number.isFinite(value)) break;
          const next = [absolute ? value : current[0] + value, current[1]];
          segments.push({ start: current, end: next });
          current = next;
        }
        break;
      }
      case 'V': {
        while (i < tokens.length && !isCommand(tokens[i])) {
          const value = Number.parseFloat(tokens[i++]);
          if (!Number.isFinite(value)) break;
          const next = [current[0], absolute ? value : current[1] + value];
          segments.push({ start: current, end: next });
          current = next;
        }
        break;
      }
      case 'Q': {
        while (i + 3 < tokens.length && !isCommand(tokens[i])) {
          const values = [0, 0, 0, 0].map(() => Number.parseFloat(tokens[i++]));
          if (!values.every(Number.isFinite)) break;
          const control = absolute ? values.slice(0, 2) : [current[0] + values[0], current[1] + values[1]];
          const end = absolute ? values.slice(2, 4) : [current[0] + values[2], current[1] + values[3]];
          if (Math.abs(crossProduct(current, control, end)) <= 1e-9) segments.push({ start: current, end });
          current = end;
        }
        break;
      }
      case 'Z':
        if (start) segments.push({ start: current, end: start });
        current = start || current;
        command = '';
        break;
      default:
        return [];
    }
  }
  return segments.filter(({ start: a, end: b }) => isPoint(a) && isPoint(b));
}

function isTwoPointDiagonal(arrow) {
  if (arrow.segments.length !== 1) return false;
  const { start, end } = arrow.segments[0];
  return Math.abs(start[0] - end[0]) > 0.01 && Math.abs(start[1] - end[1]) > 0.01;
}

function collectLegendBoxes(fragment) {
  const boxes = [];

  for (const match of fragment.matchAll(/<rect\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const x = numberAttr(attrs, 'x');
    const y = numberAttr(attrs, 'y');
    const width = numberAttr(attrs, 'width');
    const height = numberAttr(attrs, 'height');
    if ([x, y, width, height].every(Number.isFinite)) {
      boxes.push({ x1: x, y1: y, x2: x + width, y2: y + height, label: `rect@${x},${y}` });
    }
  }

  for (const match of fragment.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = parseAttrs(match[1]);
    const box = textBox(attrs, stripTags(match[2]).trim());
    if (box) boxes.push(box);
  }

  return boxes;
}

function collectLegendCollisions(arrows, boxes) {
  const collisions = [];
  for (const arrow of arrows) {
    for (const segment of arrow.segments) {
      for (const box of boxes) {
        if (segmentIntersectsBox(segment, padBox(box, 2))) {
          collisions.push({ arrow, box });
        }
      }
    }
  }
  return collisions;
}

function textBox(attrs, text) {
  const x = numberAttr(attrs, 'x');
  const y = numberAttr(attrs, 'y');
  const fontSize = Number.parseFloat(attrs['font-size'] || '10');
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(fontSize)) return null;
  const width = estimatedTextWidth(text, fontSize);
  const anchor = attrs['text-anchor'] || 'start';
  let x1 = x;
  if (anchor === 'middle') x1 = x - width / 2;
  if (anchor === 'end') x1 = x - width;
  return {
    x1,
    y1: y - fontSize,
    x2: x1 + width,
    y2: y + fontSize * 0.25,
    label: text || `text@${x},${y}`,
  };
}

function estimatedTextWidth(text, fontSize) {
  let units = 0;
  for (const char of text) units += char.charCodeAt(0) > 255 ? 1.8 : 0.62;
  return Math.max(fontSize, units * fontSize);
}

function pointsFromPath(d) {
  const tokens = d.match(/[MLHVQZmlhvqz]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) || [];
  const points = [];
  let i = 0;
  let command = '';
  let current = [0, 0];
  let start = null;

  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    if (!command) break;

    const absolute = command === command.toUpperCase();
    switch (command.toUpperCase()) {
      case 'M':
      case 'L': {
        while (i + 1 < tokens.length && !isCommand(tokens[i])) {
          const x = Number.parseFloat(tokens[i++]);
          const y = Number.parseFloat(tokens[i++]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) break;
          current = absolute ? [x, y] : [current[0] + x, current[1] + y];
          points.push(current);
          if (!start) start = current;
        }
        break;
      }
      case 'H': {
        while (i < tokens.length && !isCommand(tokens[i])) {
          const x = Number.parseFloat(tokens[i++]);
          if (!Number.isFinite(x)) break;
          current = absolute ? [x, current[1]] : [current[0] + x, current[1]];
          points.push(current);
        }
        break;
      }
      case 'V': {
        while (i < tokens.length && !isCommand(tokens[i])) {
          const y = Number.parseFloat(tokens[i++]);
          if (!Number.isFinite(y)) break;
          current = absolute ? [current[0], y] : [current[0], current[1] + y];
          points.push(current);
        }
        break;
      }
      case 'Q': {
        while (i + 3 < tokens.length && !isCommand(tokens[i])) {
          const controlX = Number.parseFloat(tokens[i++]);
          const controlY = Number.parseFloat(tokens[i++]);
          const endX = Number.parseFloat(tokens[i++]);
          const endY = Number.parseFloat(tokens[i++]);
          if (![controlX, controlY, endX, endY].every(Number.isFinite)) break;
          const control = absolute
            ? [controlX, controlY]
            : [current[0] + controlX, current[1] + controlY];
          const end = absolute
            ? [endX, endY]
            : [current[0] + endX, current[1] + endY];
          const startPoint = current;
          for (let step = 1; step <= 8; step += 1) {
            const amount = step / 8;
            const remaining = 1 - amount;
            points.push([
              remaining * remaining * startPoint[0] + 2 * remaining * amount * control[0] + amount * amount * end[0],
              remaining * remaining * startPoint[1] + 2 * remaining * amount * control[1] + amount * amount * end[1],
            ]);
          }
          current = end;
        }
        break;
      }
      case 'Z': {
        if (start) points.push(start);
        break;
      }
      default:
        return [];
    }
  }

  return points.filter(isPoint);
}

function properSegmentIntersection(a, b, c, d) {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  const epsilon = 1e-9;
  const opposite = (left, right) => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (!opposite(abC, abD) || !opposite(cdA, cdB)) return null;
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < epsilon) return null;
  const ab = a[0] * b[1] - a[1] * b[0];
  const cd = c[0] * d[1] - c[1] * d[0];
  return [
    (ab * (c[0] - d[0]) - (a[0] - b[0]) * cd) / denominator,
    (ab * (c[1] - d[1]) - (a[1] - b[1]) * cd) / denominator,
  ];
}

function crossProduct(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentIntersectsBox(segment, box) {
  const { start, end } = segment;
  if (pointInsideBox(start, box) || pointInsideBox(end, box)) return true;
  const edges = [
    [[box.x1, box.y1], [box.x2, box.y1]],
    [[box.x2, box.y1], [box.x2, box.y2]],
    [[box.x2, box.y2], [box.x1, box.y2]],
    [[box.x1, box.y2], [box.x1, box.y1]],
  ];
  return edges.some(([a, b]) => segmentsIntersect(start, end, a, b));
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) + 1e-9
    && b[0] + 1e-9 >= Math.min(a[0], c[0])
    && b[1] <= Math.max(a[1], c[1]) + 1e-9
    && b[1] + 1e-9 >= Math.min(a[1], c[1]);
}

function pointInsideBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
}

function padBox(box, padding) {
  return {
    ...box,
    x1: box.x1 - padding,
    y1: box.y1 - padding,
    x2: box.x2 + padding,
    y2: box.y2 + padding,
  };
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

function numberAttr(attrs, name) {
  return Number.parseFloat(attrs[name]);
}

function isCommand(token) {
  return /^[A-Za-z]$/.test(token);
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}
