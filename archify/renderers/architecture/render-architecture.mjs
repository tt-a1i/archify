import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { componentBox, boundaryBox, connectionPath } from '../shared/layout-report.mjs';
import { rendererFailure, throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, relationshipLegendObstacles, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { minimumReadableSourceTextPx } from '../shared/desktop-readability.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { gridLayout, resolveComponentPos, validateGridPlacement } from './grid.mjs';
import { createRouter } from '../shared/orthogonal-router.mjs';
import { placeAutomaticLabels, reservedLabelRect } from './labels.mjs';
import { cleanRouteDetourProblems } from '../shared/route-quality.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  cleanLabelCanvasContainmentProblems,
  suggestLabelObstacleFix,
  suggestComponentSeparation,
  polylinePath,
  routePointsValue,
  authoredStraightRouteAttrs,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  edgeLabelAccent,
} from '../shared/geometry.mjs';

const componentTextFit = {
  sublabelPreferred: 9,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

const grid = gridLayout(arch);

const layout = {
  defaultW: 120,
  defaultH: 60,
  margin: 40,
  // Boundary padding — the 30/50 rule that was a hand-arithmetic footgun
  // (CHANGELOG v2.2.1): 30px on top/left/right, plus 20px extra at the bottom.
  boundaryPad: 30,
  boundaryExtraBottom: 20,
  boundaryLabelBaseline: 18,
  boundaryLabelClearance: 4,
  boundaryLabelFontPreferred: 9,
  boundaryLabelFontMinimum: 6,
  boundaryLabelMaskHeight: 16,
  boundaryLabelRailGap: 2,
  boundaryLabelFrameInset: 4,
  legendH: 28,
};

const LEGEND_CATALOG = [
  'frontend',
  'backend',
  'database',
  'cloud',
  'security',
  'messagebus',
  'external',
].map((kind) => ({ kind, label: i18nText(arch.meta.locale, `legend.architecture.${kind}`) }));

// ---- Measure components from free coordinates --------------------------------
function measureComponent(c) {
  const [x, y] = resolveComponentPos(c, grid);
  const [w, h] = Array.isArray(c.size) ? c.size : [layout.defaultW, layout.defaultH];
  return { ...c, x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

const components = new Map(asArray(arch.components).map((c) => [c.id, measureComponent(c)]));
const enforcesBoundaryTitleComposition = Boolean(arch.meta?.quality_profile);
const componentSteps = new Map();
for (const [index, conn] of asArray(arch.connections).entries()) {
  if (!componentSteps.has(conn.from)) componentSteps.set(conn.from, index);
  if (!componentSteps.has(conn.to)) componentSteps.set(conn.to, index + 1);
}
for (const [index, c] of asArray(arch.components).entries()) {
  if (!componentSteps.has(c.id)) componentSteps.set(c.id, index);
}

// ---- Boundaries computed from the `wraps` id list ---------------------------
function boundaryRect(boundary) {
  const members = asArray(boundary.wraps).map((id) => components.get(id)).filter(Boolean);
  if (!members.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const member of members) {
    minX = Math.min(minX, member.x);
    minY = Math.min(minY, member.y);
    maxX = Math.max(maxX, member.x + member.width);
    maxY = Math.max(maxY, member.y + member.height);
  }
  const pad = boundary.pad ?? layout.boundaryPad;
  const topPad = Math.max(
    pad,
    layout.boundaryLabelBaseline + layout.boundaryLabelClearance,
  );
  return {
    ...boundary,
    x: minX - pad,
    y: minY - topPad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + topPad + layout.boundaryExtraBottom,
    memberTop: minY,
  };
}

function rectContains(outer, inner) {
  const epsilon = 1e-9;
  return outer.x <= inner.x + epsilon
    && outer.y <= inner.y + epsilon
    && outer.x + outer.width + epsilon >= inner.x + inner.width
    && outer.y + outer.height + epsilon >= inner.y + inner.height;
}

function boundaryLabelWidth(label, fontSize) {
  return Math.max(30, textUnits(label) * fontSize * 0.6 + 10);
}

const architectureLegendEntries = resolveLegend(
  arch.meta?.legend,
  LEGEND_CATALOG,
  new Set([...components.values()].map((component) => component.type)),
);

// One source for connection label geometry: the rect the containment rule
// measures is the rect the SVG mask draws, the auto canvas covers, the legend
// avoids, and the layout report publishes.
const resolvedLabelPoints = new Map();
function connectionLabelBox(conn) {
  if (!conn.label) return null;
  return connectionLabelBoxAt(conn, resolvedLabelPoints.get(conn) || labelPoint(conn, pathFor(conn).points));
}

function connectionLabelBoxAt(conn, [lx, ly]) {
  const width = Math.max(30, textUnits(conn.label) * 4.8 + 10);
  return { x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly };
}

function connectionLabelRects() {
  const rects = [];
  for (const [relationIndex, conn] of asArray(arch.connections).entries()) {
    if (!components.has(conn.from) || !components.has(conn.to)) continue;
    const box = connectionLabelBox(conn);
    if (!box) continue;
    rects.push({ relation: conn, relationIndex, label: conn.label, ...box });
  }
  return rects;
}

function autoViewBoxFor(candidateBoundaries, extraRects = []) {
  let maxX = 0;
  let maxY = 0;
  for (const rects of [components.values(), candidateBoundaries, extraRects]) {
    for (const rect of rects) {
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
  }
  let width = Math.ceil(maxX + layout.margin);
  let footprint = legendFootprint(architectureLegendEntries, {
    width: Math.max(1, width - layout.margin * 2),
  });
  if (footprint.minWidth > width - layout.margin * 2) {
    width = Math.ceil(footprint.minWidth + layout.margin * 2);
    footprint = legendFootprint(architectureLegendEntries, {
      width: width - layout.margin * 2,
    });
  }
  return [
    width,
    Math.ceil(maxY + layout.margin + layout.legendH + footprint.extraHeight),
  ];
}

function resolvedViewBoxWidth(candidateBoundaries) {
  if (Array.isArray(arch.meta?.viewBox) && Number.isFinite(arch.meta.viewBox[0])) {
    return arch.meta.viewBox[0];
  }
  return autoViewBoxFor(candidateBoundaries, connectionGeometry)[0];
}

function expandBoundaryForReadableTitle(boundary, minimumFontSize) {
  if (!enforcesBoundaryTitleComposition) return boundary;
  const requiredWidth = boundaryLabelWidth(boundary.label, minimumFontSize)
    + layout.boundaryLabelFrameInset * 2;
  const extra = Math.max(0, requiredWidth - boundary.width);
  if (!extra) return boundary;
  return {
    ...boundary,
    x: boundary.x - extra / 2,
    width: boundary.width + extra,
  };
}

function measureBoundaryTitle(boundary, minimumFontSize) {
  const availableWidth = Math.max(0, boundary.width - layout.boundaryLabelFrameInset * 2);
  const units = textUnits(boundary.label);
  const fitted = units > 0
    ? (availableWidth - 10) / (units * 0.6)
    : layout.boundaryLabelFontPreferred;
  const preferredFontSize = Math.max(layout.boundaryLabelFontPreferred, minimumFontSize);
  const fontSize = Math.max(
    minimumFontSize,
    Math.min(preferredFontSize, fitted),
  );
  const desiredWidth = boundaryLabelWidth(boundary.label, fontSize);
  const height = Math.max(layout.boundaryLabelMaskHeight, Math.ceil(fontSize + 7));
  return {
    x: boundary.x + layout.boundaryLabelFrameInset,
    y: boundary.memberTop
      - layout.boundaryLabelClearance
      - height,
    width: Math.min(availableWidth, desiredWidth),
    height,
    fontSize,
    minimumFontSize,
    baselineOffset: fontSize + 4,
    availableWidth,
    minimumWidth: boundaryLabelWidth(boundary.label, minimumFontSize),
  };
}

function horizontalOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x;
}

function layoutBoundaryTitles(rawBoundaries, minimumFontSize) {
  const placedTitles = [];
  const measured = new Map();
  const ordered = rawBoundaries
    .map((boundary, index) => ({ boundary, index }))
    .sort((left, right) => {
      const areaDelta = left.boundary.width * left.boundary.height
        - right.boundary.width * right.boundary.height;
      return areaDelta || left.index - right.index;
    });

  for (const entry of ordered) {
    const { index } = entry;
    const boundary = expandBoundaryForReadableTitle(entry.boundary, minimumFontSize);
    const title = measureBoundaryTitle(boundary, minimumFontSize);
    let guard = 0;
    while (guard < rawBoundaries.length + components.size + 1) {
      guard += 1;
      const blockers = [
        ...placedTitles,
        ...components.values(),
      ].filter((candidate) => horizontalOverlap(title, candidate) && rectsOverlap(title, candidate));
      if (!blockers.length) break;
      title.y = blockers.reduce(
        (min, blocker) => Math.min(min, blocker.y - layout.boundaryLabelRailGap - title.height),
        Infinity,
      );
    }
    placedTitles.push(title);
    measured.set(index, { boundary, title });
  }

  return rawBoundaries.map((_boundary, index) => {
    const { boundary, title } = measured.get(index);
    const bottom = boundary.y + boundary.height;
    // Profile-less schema-v1 inputs keep their legacy boundary geometry. A
    // quality profile opts into the stricter title-composition contract and
    // may expand the frame to contain an adapted title rail.
    const y = enforcesBoundaryTitleComposition
      ? Math.min(boundary.y, title.y - layout.boundaryLabelFrameInset)
      : boundary.y;
    return {
      ...boundary,
      y,
      height: bottom - y,
      title,
    };
  });
}

// ---- Routing state ----------------------------------------------------------
// Initialized before the boundary-title work below: connection label rects are
// part of the derived canvas, so the title convergence must measure the same
// width the diagram actually renders into (a title sized for a narrower canvas
// would fall below the desktop-readability floor once labels grow it). Routing
// reads components, connections and the member-derived boundary frames (so an
// automatic route never borrows a frame border as its corridor), never the
// title-expanded frames or the viewBox.
const rawBoundaries = asArray(arch.boundaries).map(boundaryRect).filter(Boolean);
const { pathFor, connectionSides, connectionEndpointSide } = createRouter(components, arch.connections, {
  frames: rawBoundaries.map((boundary) => ({
    ...boundary,
    radius: boundary.kind === 'security-group' ? 8 : 12,
  })),
  labelRectFor: (conn, points, { routes, labels }) => (conn.label ? reservedLabelRect({
    label: { relation: conn, label: conn.label, ...connectionLabelBoxAt(conn, labelPoint(conn, points)) },
    points,
    routes: routes.map((route, index) => ({ relationIndex: index, points: route })),
    labels,
    components: [...components.values()],
  }) : null),
});
function hasAutomaticRouteGeometry(connection) {
  return !Array.isArray(connection?.via)
    && (!connection?.route || connection.route === 'auto')
    && connection?.channelX === undefined
    && connection?.channelY === undefined;
}
// The auto canvas has to cover these rects; an authored viewBox is never
// resized to fit them — there the containment rule reports the clipping.
let connectionLabels = connectionLabelRects();
// Unlabelled outer corridors are geometry too. Fitting only nodes and labels
// can clip a valid explicit via route while every browser overflow check passes.
const connectionGeometry = [
  ...connectionLabels,
  ...asArray(arch.connections)
    .filter((conn) => components.has(conn.from) && components.has(conn.to))
    .flatMap((conn) => pathFor(conn).points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))),
];

function resolveBoundaryTitles() {
  if (!enforcesBoundaryTitleComposition || rawBoundaries.length === 0) {
    return {
      boundaries: layoutBoundaryTitles(rawBoundaries, layout.boundaryLabelFontMinimum),
      readabilityProblem: null,
    };
  }

  const maximumIterations = 32;
  let candidateBoundaries = rawBoundaries;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const budgetViewBoxWidth = resolvedViewBoxWidth(candidateBoundaries);
    const minimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(budgetViewBoxWidth) + 1e-6,
    );
    const nextBoundaries = layoutBoundaryTitles(rawBoundaries, minimumFontSize);
    const finalViewBoxWidth = resolvedViewBoxWidth(nextBoundaries);
    const finalMinimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(finalViewBoxWidth),
    );
    if (minimumFontSize >= finalMinimumFontSize) {
      return { boundaries: nextBoundaries, readabilityProblem: null };
    }
    candidateBoundaries = nextBoundaries;
  }

  const finalViewBoxWidth = resolvedViewBoxWidth(candidateBoundaries);
  return {
    boundaries: candidateBoundaries,
    readabilityProblem: `[composition/desktop-readability] Boundary title layout did not converge after ${maximumIterations} iterations for the final ${finalViewBoxWidth}px viewBox — shorten boundary labels, provide a wider authored viewBox, or move wrapped components closer to the left edge.`,
  };
}

const resolvedBoundaryTitles = resolveBoundaryTitles();
const boundaries = resolvedBoundaryTitles.boundaries;
const compositionFrames = boundaries.map((boundary, index) => ({
  ...boundary,
  id: boundary.id || index,
  kind: boundary.kind || 'boundary',
  radius: boundary.kind === 'security-group' ? 8 : 12,
}));

function componentContext(component) {
  const scopes = boundaries
    .filter((boundary) => asArray(boundary.wraps).includes(component.id))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .map((boundary) => boundary.label);
  return scopes.length ? scopes.join(' › ') : i18nText(arch.meta.locale, 'node.context.architecture');
}

// ---- Auto viewBox: fit all geometry + the measured resolved legend ----------
// Connection labels are diagram content, so an auto canvas that stopped at the
// component/boundary bbox would clip them; the label rects join the fit here
// and in the title convergence above, which sizes fonts for this same width.
const viewBox = arch.meta?.viewBox || autoViewBoxFor(boundaries, connectionGeometry);
const legendY = () => viewBox[1] - 16;

// Fit titles and canvas from the original geometry first. Fallback labels must
// fit inside that canvas, so moving a label cannot trigger title reflow or a
// canvas/label feedback loop. Keep standard and every authored label control.
if (arch.meta?.quality_profile === 'showcase') {
  connectionLabels = placeAutomaticLabels({
    labels: connectionLabels,
    routes: asArray(arch.connections).flatMap((conn, relationIndex) => (
      components.has(conn.from) && components.has(conn.to)
        ? [{ relationIndex, points: pathFor(conn).points }] : []
    )),
    components: [...components.values()],
    titles: boundaries.map(boundary => boundary.title),
    viewBox,
    // Leave the resolved legend band available; moving a label must not hide
    // an otherwise visible legend. Existing labels keep their placement.
    placementBottom: architectureLegendEntries.length
      ? legendY() - 32 - legendFootprint(architectureLegendEntries, { width: viewBox[0] - layout.margin * 2 }).extraHeight
      : viewBox[1],
  });
  for (const rect of connectionLabels) resolvedLabelPoints.set(rect.relation, [rect.lx, rect.ly]);
}

// ---- Validation: mechanical correctness, never layout taste -----------------
function validateArchitecture() {
  const problems = [];
  const diagnostics = [];
  if (resolvedBoundaryTitles.readabilityProblem) {
    problems.push(resolvedBoundaryTitles.readabilityProblem);
  }
  const requiresNestedBoundaryMembership = arch.meta?.engineering_profile === 'deployment-ownership';
  if (components.size !== asArray(arch.components).length) problems.push('Component ids must be unique.');
  if (grid) {
    validateGridPlacement(arch, grid, problems);
  } else {
    for (const c of asArray(arch.components)) {
      if (!Array.isArray(c.pos) || c.pos.length !== 2) {
        problems.push(`Component "${c.id}" must include pos [x, y] when layout.mode is omitted (free placement).`);
      }
    }
  }

  for (const c of components.values()) {
    if (!isFinitePoint(c.x, c.y, c.width, c.height)) {
      problems.push(`Component "${c.id}" has non-finite pos/size — pos and size must be [number, number].`);
      continue;
    }
    if (c.width <= 0 || c.height <= 0) {
      problems.push(`Component "${c.id}" has invalid size ${c.width}x${c.height} — width and height must be greater than 0.`);
      continue;
    }
    if (c.x < 0 || c.y < 0 || c.x + c.width > viewBox[0] || c.y + c.height > viewBox[1]) {
      problems.push(`Component "${c.id}" falls outside the viewBox ${viewBox[0]}x${viewBox[1]} — adjust pos/size or set a larger meta.viewBox.`);
    }
    const estLabelW = textUnits(c.label) * 6.6;
    if (estLabelW > c.width + 8) {
      problems.push(`Label "${c.label}" (~${Math.round(estLabelW)}px) is wider than component "${c.id}" (${c.width}px) — shorten the label or widen size.`);
    }
    const brandRailProblem = brandTopRailProblem(c, c.width, 8, 'Component');
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(c.width);
    for (const [field, value, minimum] of [
      ['Sublabel', c.sublabel, componentTextFit.sublabelMinimum],
      ['Tag', c.tag, componentTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but component "${c.id}" provides ${availableTextW}px — shorten the ${field.toLowerCase()} or widen size.`);
      }
    }
  }

  // Component overlap — the highest-traffic hand-placement failure mode.
  const list = [...components.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (rectsOverlap(list[i], list[j], 8)) {
        problems.push(`Components "${list[i].id}" and "${list[j].id}" are less than 8px apart — move one or shrink its size.\n${suggestComponentSeparation(list[i], list[j], 8)}`);
      }
    }
  }

  // Boundaries: every wrapped id must exist; the computed box must stay in view.
  for (const boundary of asArray(arch.boundaries)) {
    for (const id of asArray(boundary.wraps)) {
      if (!components.has(id)) problems.push(`Boundary "${boundary.label}" wraps unknown component "${id}".`);
    }
  }
  const viewBoxRect = { x: 0, y: 0, width: viewBox[0], height: viewBox[1] };
  for (const boundary of boundaries) {
    if (!enforcesBoundaryTitleComposition) continue;
    if (boundary.title.minimumWidth > boundary.title.availableWidth) {
      problems.push(
        `Boundary label "${boundary.label}" needs ~${Math.ceil(boundary.title.minimumWidth)}px to fit at the `
        + `${Number(boundary.title.minimumFontSize.toFixed(2))}px desktop-readable source minimum, but its frame provides ${Math.floor(boundary.title.availableWidth)}px — `
        + 'shorten the boundary label, increase pad, or widen the wrapped component layout.',
      );
    }
    if (!rectContains(boundary, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside its final frame — shorten the label or increase boundary pad.`,
      );
    }
    if (!rectContains(viewBoxRect, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside the viewBox — move wrapped components away from the canvas edge, shorten the label, or increase the viewBox.`,
      );
    }
    for (const component of components.values()) {
      if (!rectsOverlap(boundary.title, component)) continue;
      problems.push(
        `Boundary label "${boundary.label}" overlaps component "${component.id}" — move the component, increase boundary title space, or shorten the label.`,
      );
    }
  }
  for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
    const left = boundaries[leftIndex];
    const leftMembers = new Set(asArray(left.wraps));
    for (let rightIndex = leftIndex + 1; rightIndex < boundaries.length; rightIndex += 1) {
      const right = boundaries[rightIndex];
      if (enforcesBoundaryTitleComposition && rectsOverlap(left.title, right.title)) {
        problems.push(
          `Boundary labels "${left.label}" and "${right.label}" overlap — shorten a label or increase boundary title space.`,
        );
      }
      // Ordinary architecture boundaries are sets, not an implied ownership
      // tree: orthogonal scopes such as runtime and compliance may share some
      // components while each contains others. The opt-in deployment profile
      // does promise hierarchical region/private-scope membership, so only it
      // receives the stricter membership-to-frame containment contract.
      if (!requiresNestedBoundaryMembership) continue;
      const rightMembers = new Set(asArray(right.wraps));
      const shared = [...leftMembers].filter((id) => rightMembers.has(id));
      const leftNested = [...leftMembers].every((id) => rightMembers.has(id));
      const rightNested = [...rightMembers].every((id) => leftMembers.has(id));
      if (shared.length && !leftNested && !rightNested) {
        const leftOnly = [...leftMembers].filter((id) => !rightMembers.has(id));
        const rightOnly = [...rightMembers].filter((id) => !leftMembers.has(id));
        problems.push(
          `Boundary "${left.label}" crosses boundary "${right.label}" because their memberships partially overlap `
          + `(shared: ${shared.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${left.label}": ${leftOnly.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${right.label}": ${rightOnly.map((id) => `"${id}"`).join(', ')}) — `
          + 'keep one boundary fully nested by removing outside members, or split the boundary.',
        );
        continue;
      }

      if (!rectsOverlap(left, right)) continue;
      const leftContainsRight = rectContains(left, right);
      const rightContainsLeft = rectContains(right, left);
      if (!leftContainsRight && !rightContainsLeft) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames partially overlap — `
          + 'adjust wraps, pad, or component positions so the frames are disjoint or one fully contains the other.',
        );
        continue;
      }

      if (!shared.length) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames overlap even though their memberships are disjoint — `
          + 'adjust pad or component positions so the frames are disjoint, or make wraps express the intended nesting.',
        );
        continue;
      }

      const containmentMatchesMembership = (leftNested && rightContainsLeft)
        || (rightNested && leftContainsRight);
      if (!containmentMatchesMembership) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frame containment contradicts their wraps membership — `
          + 'reduce the inner boundary pad, move its components, or correct wraps so geometry and nesting agree.',
        );
      }
    }
  }
  for (const b of boundaries) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > viewBox[0] || b.y + b.height > viewBox[1]) {
      const overflow = {
        left: Math.max(0, -b.x),
        top: Math.max(0, -b.y),
        right: Math.max(0, b.x + b.width - viewBox[0]),
        bottom: Math.max(0, b.y + b.height - viewBox[1]),
      };
      const sides = Object.entries(overflow).filter(([, pixels]) => pixels > 0)
        .map(([side, pixels]) => `${side} by ${Math.ceil(pixels)}px`).join(', ');
      const supportedFixes = [];
      if (overflow.left || overflow.top) {
        supportedFixes.push(`move the wrapped components right by at least ${Math.ceil(overflow.left)}px and down by at least ${Math.ceil(overflow.top)}px, then revalidate connected routes and the opposite canvas sides; enlarging meta.viewBox cannot fix left/top overflow`);
      }
      if (overflow.right || overflow.bottom) {
        supportedFixes.push(`increase meta.viewBox to at least [${Math.ceil(Math.max(viewBox[0], b.x + b.width))}, ${Math.ceil(Math.max(viewBox[1], b.y + b.height))}] for right/bottom overflow, or move the wrapped components inward; revalidate desktop readability`);
      }
      const message = `Boundary "${b.label}" extends outside the viewBox (${sides}) — preserve wraps membership and repair the measured canvas side.`;
      diagnostics.push({
        code: 'layout/boundary-out-of-bounds',
        severity: 'error',
        message,
        subject: { diagramType: 'architecture', boundary: { kind: b.kind, label: b.label, wraps: b.wraps } },
        evidence: {
          bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
          viewBox: [...viewBox],
          overflow,
          members: asArray(b.wraps).map((id) => components.get(id)).filter(Boolean).map(componentBox),
        },
        supportedFixes,
      });
      problems.push(message);
    }
  }

  for (const conn of asArray(arch.connections)) {
    if (!components.has(conn.from)) problems.push(`Connection "${conn.label || conn.from}" references unknown source "${conn.from}".`);
    if (!components.has(conn.to)) problems.push(`Connection "${conn.label || conn.to}" references unknown target "${conn.to}".`);
    if (components.has(conn.from) && components.has(conn.to)) {
      const routed = pathFor(conn);
      const outsidePoints = routed.points.filter(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1]);
      if (arch.meta?.quality_profile === 'showcase' && outsidePoints.length) {
        const message = `Connection "${conn.id || `${conn.from}->${conn.to}`}" extends outside the viewBox — move the measured outside route points inward or enlarge an authored viewBox for right/bottom overflow.`;
        diagnostics.push({
          code: 'layout/route-out-of-bounds', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { viewBox: [...viewBox], outsidePoints, points: routed.points },
          supportedFixes: ['move negative route coordinates inside the canvas; for right/bottom overflow, enlarge meta.viewBox or reroute inward; preserve endpoints, direction and labels, then revalidate'],
        });
        problems.push(message);
      }
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 24 && conn.from === conn.to) {
        // "Move the components apart" cannot be executed for a self-loop; the
        // ports sit on one component and the sides decide how far apart.
        const message = `Self-loop "${conn.id || conn.label || conn.from}" on component "${conn.from}" has its two ports only ${Math.round(distance)}px apart (minimum 24px) — remove fromSide/toSide so the renderer can choose the loop's sides, or set fromSide and toSide to different sides.`;
        diagnostics.push({
          code: 'layout/self-loop-ports', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { distancePx: Math.round(distance), minimumPx: 24, fromSide: connectionEndpointSide(conn, 'source'), toSide: connectionEndpointSide(conn, 'target'), points: routed.points },
          supportedFixes: ['remove fromSide/toSide from the self-loop', 'set fromSide and toSide to different sides of the component'],
        });
        problems.push(message);
      } else if (distance < 24) {
        problems.push(`Connection "${conn.label || `${conn.from}->${conn.to}`}" is too short (${Math.round(distance)}px; minimum 24px) — place its components farther apart.`);
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    routeHint: 'keep automatic routing so the renderer can use a side-aware bridge, or set truthful fromSide/toSide with perpendicular via segments',
  }));
  problems.push(...cleanFlowProblems({
    relations: arch.connections,
    obstacles: components.values(),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    obstacleKind: 'component',
    routeHint: 'adjust fromSide/toSide, set route/via, or move the component'
  }));
  problems.push(...cleanCrossingProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    // Automatic architecture routes render with an opaque crossover halo.
    // That makes a proper X visually unambiguous while explicit authored
    // crossings remain a blocking composition error.
    crossingResolved: (left, right) => (
      hasAutomaticRouteGeometry(left) && hasAutomaticRouteGeometry(right)
    ),
    routeHint: 'adjust route/via or fromSide/toSide so the connections use separate corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so unrelated connections do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    frames: compositionFrames,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the connection crosses the boundary perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'move route/via points into a wider corridor or move the component so every turn has room to read'
  }));
  problems.push(...cleanRouteDetourProblems({
    relations: arch.connections,
    obstacles: components.values(),
    contentRects: [...components.values(), ...boundaries],
    endpointIds: new Set(components.keys()),
    pathFor,
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));

  // Connection labels must not land on top of components.
  const labelRects = connectionLabels;
  for (const rect of labelRects) {
    for (const c of components.values()) {
      if (rectsOverlap(rect, c, -2)) {
        problems.push(`Label "${rect.label}" overlaps component "${c.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, c, 'component', viewBox, components.values())}`);
      }
    }
    if (enforcesBoundaryTitleComposition) {
      for (const boundary of boundaries) {
        if (!rectsOverlap(boundary.title, rect)) continue;
        problems.push(
          `Boundary label "${boundary.label}" overlaps connection label "${rect.label}" — move the boundary title rail by adjusting wrapped component positions, or move the connection label with labelAt/labelDx/labelDy/labelSegment.`,
        );
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: arch.connections,
    labels: labelRects,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));
  // See collectLabelCanvasOverflow in shared/geometry.mjs. An auto canvas now
  // covers these rects, so this reports authored viewBoxes and the origin side,
  // which growth cannot reach.
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Architecture layout validation failed', problems, {
      subject: { diagramType: 'architecture' },
      diagnostics,
    });
  }
}

function buildLayoutReport() {
  const labels = connectionLabels.map((rect) => ({
    text: rect.label,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: 14,
    labelAt: [Math.round(rect.lx), Math.round(rect.ly)],
  }));
  return {
    ok: true,
    diagram_type: 'architecture',
    layout: grid ? { mode: 'grid', ...grid } : { mode: 'free' },
    viewBox,
    components: [...components.values()].map(componentBox),
    boundaries: boundaries.map(boundaryBox),
    connections: asArray(arch.connections)
      .filter((conn) => components.has(conn.from) && components.has(conn.to))
      .map((conn) => {
        const routed = pathFor(conn);
        const labelAt = conn.label ? resolvedLabelPoints.get(conn) || labelPoint(conn, routed.points) : null;
        return connectionPath(conn, routed, labelAt);
      }),
    labels,
  };
}

// ---- Rendering ---------------------------------------------------------------
function renderBoundaryFrame(b, index) {
  const cls = b.kind === 'security-group' ? 'c-security-group' : 'c-region';
  const rx = b.kind === 'security-group' ? 8 : 12;
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-id="${index}" data-composition-frame-label="${esc(b.label)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" class="${cls}" stroke-width="1"/>`;
}

function renderBoundaryLabel(b, index) {
  const labelCls = b.kind === 'security-group' ? 't-security' : 't-cloud';
  return `        <g data-graph-role="structural-frame-label" data-composition-frame-id="${index}" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-label="${esc(b.label)}">
          <rect data-graph-role="structural-frame-label-mask" x="${b.title.x}" y="${b.title.y}" width="${b.title.width}" height="${b.title.height}" rx="3" class="c-mask"/>
          <text data-boundary-label="" x="${b.title.x + 4}" y="${b.title.y + b.title.baselineOffset}" class="${labelCls}" font-size="${b.title.fontSize}" font-weight="600">${esc(b.label)}</text>
        </g>`;
}

function renderConnectionPath(conn, index) {
  const [cls, marker] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(conn);
  const strokeWidth = conn.width || (conn.variant === 'emphasis' ? 1.8 : 1.5);
  const automaticRoute = hasAutomaticRouteGeometry(conn);
  const underlay = automaticRoute
    ? `          <path data-graph-role="automatic-crossover-underlay" d="${routed.d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>\n`
    : '';
  const crossover = automaticRoute ? ' data-composition-crossover="halo"' : '';
  const edge = `        <path ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)} data-composition-points="${routePointsValue(routed.points)}"${crossover}${authoredStraightRouteAttrs(conn, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(arch.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
  if (!automaticRoute) return edge;
  // The wrapper is presentation-only: viewer state remains on the one semantic
  // edge, while CSS can keep its preceding mask underlay at the same opacity.
  return `        <g data-graph-role="automatic-crossover" style="--step:${index}">\n${underlay}${edge.replace(/^        /, '          ')}\n        </g>`;
}

function renderConnectionLabel(conn, index) {
  const box = connectionLabelBox(conn);
  if (!box) return '';
  return `        <g data-detail="context" ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)}>
          <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="3" class="c-mask"/>
          <text x="${box.lx}" y="${box.ly}" class="${edgeLabelAccent(conn.variant)}" font-size="8" text-anchor="middle">${esc(conn.label)}</text>
        </g>`;
}

function renderComponent(c) {
  const fill = componentFill[c.type] || 'c-external';
  const accent = componentText[c.type] || 't-muted';
  const cx = c.cx;
  const hasSub = c.sublabel != null && c.sublabel !== '';
  const labelY = hasSub ? c.y + c.height / 2 - 2 : c.y + c.height / 2 + 4;
  const sub = hasSub
    ? `\n        <text data-detail="context" x="${cx}" y="${c.y + c.height / 2 + 14}" class="t-muted" font-size="${fittedNodeFontSize(c.sublabel, c.width, componentTextFit.sublabelPreferred, componentTextFit.sublabelMinimum)}" text-anchor="middle">${esc(c.sublabel)}</text>`
    : '';
  const tag = c.tag
    ? `\n        <text data-detail="fine" x="${cx}" y="${c.y + c.height - 8}" class="${accent}" font-size="${fittedNodeFontSize(c.tag, c.width, componentTextFit.tagPreferred, componentTextFit.tagMinimum)}" text-anchor="middle">${esc(c.tag)}</text>`
    : '';
  const brand = renderBrandMark(c, { x: c.x + c.width - 22, y: c.y + 6 });
  const labelFontSize = fittedNodeFontSize(c.label, brandLabelFitWidth(c, c.width), 11, 8);
  const passport = { kind: c.type, sublabel: c.sublabel, tag: c.tag, context: componentContext(c), ...brandMetadataFor(c) };
  return `        <g ${focusNodeAttrs(c.id, c.label, passport, arch.meta.locale)}>
          ${focusNodeTitle(c.label, passport)}
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" class="c-mask"/>
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" class="${fill}"${animateAttr(arch.meta, 'node', componentSteps.get(c.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(c.type, { icon: c.icon, x: c.x + 6, y: c.y + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${cx}" y="${labelY}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(c.label)}</text>${sub}${tag}
        </g>`;
}

function renderLegend() {
  const entries = architectureLegendEntries;
  const relationshipObstacles = relationshipLegendObstacles(arch.connections, {
    pointsFor: (connection) => pathFor(connection).points,
    labelRectFor: connectionLabelBox,
  });
  let contentBottom = 0;
  for (const component of components.values()) {
    contentBottom = Math.max(contentBottom, component.y + component.height);
  }
  for (const boundary of boundaries) {
    contentBottom = Math.max(contentBottom, boundary.y + boundary.height);
  }
  return renderResolvedLegend({
    entries,
    locale: arch.meta.locale,
    layout: {
      x: layout.margin,
      baselineY: legendY(),
      width: viewBox[0] - layout.margin * 2,
      minTitleY: contentBottom + 8,
      obstacles: relationshipObstacles,
      unfit: arch.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'architecture',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 9}" width="16" height="10" rx="2.5" class="${componentFill[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  // An automatic architecture canvas is compiler-measured geometry. Let the
  // Reader spend the real desktop height budget on it, including when an
  // outer route makes the canvas taller than the ordinary wide-diagram
  // threshold. Authored viewBoxes remain authoritative and keep the
  // established Viewer contract.
  const readerFit = arch.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height"';
  // A complete repository architecture is allowed to use normal page scroll;
  // keep its common-desktop text at a comfortable reading size instead of
  // shrinking a semantically rich graph to the universal emergency floor.
  const readerMinimumText = arch.meta?.viewBox ? '' : ' data-reader-min-text="7.5"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(arch.meta)}${readerFit}${readerMinimumText}>
${svgAccessibleText(arch.meta, 'architecture')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Boundaries (behind everything) -->
${boundaries.map(renderBoundaryFrame).join('\n\n')}

        <!-- Connection paths (before components for correct z-order) -->
${asArray(arch.connections).map(renderConnectionPath).join('\n')}

        <!-- Components -->
${[...components.values()].map(renderComponent).join('\n\n')}

        <!-- Connection labels -->
${asArray(arch.connections).map(renderConnectionLabel).join('\n')}

        <!-- Boundary labels (foreground masks keep routes out of titles) -->
${boundaries.map(renderBoundaryLabel).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

if (layoutJsonMode) {
  try {
    validateArchitecture();
  } catch (error) {
    // A rejected layout is still useful repair evidence. Input/implementation
    // failures must retain their existing failure boundary, not partial geometry.
    if (!error.archifyDiagnostics?.length) throw error;
    console.log(JSON.stringify({
      ...buildLayoutReport(),
      ...rendererFailure(error),
      contract: 'archify-architecture-layout-v1',
    }, null, 2));
    process.exitCode = 1;
  }
  if (!process.exitCode) console.log(JSON.stringify(buildLayoutReport(), null, 2));
} else {
  validateArchitecture();
  writeDiagram({
    outPath,
    template,
    diagramType: 'architecture',
    meta: arch.meta,
    svg: renderSvg(),
    cards: arch.cards,
    sourceEvidence,
  });
}
