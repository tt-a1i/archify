import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, measureLegend, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { componentFill, arrowClassMap, rectsOverlap, cleanFlowProblems, cleanCrossingProblems, cleanAmbiguousCorridorProblems, cleanBorderRunProblems, cleanRouteRhythmProblems, cleanLabelRouteClearanceProblems, cleanLabelCanvasContainmentProblems, routePointsValue, asArray, isFinitePoint, edgeLabelAccent } from '../shared/geometry.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { DESKTOP_READER_DIAGRAM_WIDTH, MIN_PROJECTED_NODE_TEXT_PX, minimumReadableSourceTextPx } from '../shared/desktop-readability.mjs';

const participantTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: sequence, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'sequence',
  defaultExample: 'cache-miss-request.sequence.json'
});

const LEGEND_CATALOG = [
  { kind: 'emphasis', className: 'a-emphasis', marker: 'arrowhead-emphasis', strokeWidth: 1.8 },
  { kind: 'return', className: 'a-default', marker: 'arrowhead', dash: '3,5' },
  { kind: 'security', className: 'a-security', marker: 'arrowhead-security' },
  { kind: 'dashed', className: 'a-dashed', marker: 'arrowhead-dashed' },
  { kind: 'default', className: 'a-default', marker: 'arrowhead' },
].map((entry) => ({
  ...entry,
  interactive: false,
  swatchWidth: 34,
  swatchGap: 9,
  label: i18nText(sequence.meta.locale, `legend.sequence.${entry.kind}`),
}));

function legendEntries() {
  const presentKinds = new Set(asArray(sequence.messages).map((message) => message.variant || 'default'));
  return resolveLegend(sequence.meta?.legend, LEGEND_CATALOG, presentKinds);
}

// The legend sits below the timeline content: the last message and its note,
// activation bars, and segment frames. Its block starts LEGEND_CONTENT_GAP
// below that content; from the block top to the canvas bottom a one-row legend
// needs LEGEND_BLOCK_HEIGHT (title glyphs, row, and the 54px baseline inset).
const LEGEND_CONTENT_GAP = 12;
const LEGEND_BLOCK_HEIGHT = 86;
const contentBottom = Math.max(
  0,
  ...asArray(sequence.messages).map((message) => message.y + (message.note ? 22 : 6)),
  ...asArray(sequence.activations).map((activation) => activation.to),
  ...asArray(sequence.segments).map((segment) => segment.to),
);
function legendRequiredHeight(width) {
  const entries = legendEntries();
  if (!entries.length) return 0;
  return Math.ceil(contentBottom + LEGEND_CONTENT_GAP + LEGEND_BLOCK_HEIGHT
    + legendFootprint(entries, { width: width - 80 }).extraHeight);
}
// A renderer-sized spread canvas widens until every participant label fits,
// but never past the width where 7px sublabels would project below the
// desktop reading minimum; an inherently crowded row still fails below.
const spreadParticipantWidth = (canvasWidth) => Math.max(86,
  Math.min(190, Math.round((canvasWidth - 124) / Math.max(1, asArray(sequence.participants).length)) - 24));
function spreadColumnGeometry(canvasWidth) {
  const count = Math.max(1, asArray(sequence.participants).length);
  const width = spreadParticipantWidth(canvasWidth);
  const span = count * width + (count - 1) * 16;
  const margin = Math.max(40, Math.min(62, canvasWidth - 40 - span));
  return { width, margin, gap: count > 1 ? Math.max(width + 16, (canvasWidth - 40 - margin - width) / (count - 1)) : 108 };
}
// Evaluate the same spread coordinates and full masks used by the renderer;
// short participant names alone do not imply a compact timeline will fit.
function timelineLabelsFit(canvasWidth) {
  const { width, margin, gap } = spreadColumnGeometry(canvasWidth);
  const centers = new Map(asArray(sequence.participants).map((participant, index) => [participant.id, margin + width / 2 + index * gap]));
  const unitWidth = sequence.meta?.quality_profile === 'showcase' ? 6.6 : 5.2;
  return asArray(sequence.messages).every((message) => {
    if (!centers.has(message.from) || !centers.has(message.to)) return true;
    const center = (centers.get(message.from) + centers.get(message.to)) / 2;
    const halfWidth = Math.max(34, textUnits(message.label) * unitWidth + 12) / 2;
    return center - halfWidth >= 0 && center + halfWidth <= canvasWidth;
  }) && asArray(sequence.segments).every((segment) => 56 + Math.max(42, textUnits(segment.label) * 5.2 + 14) <= canvasWidth - 48);
}
const readableCanvasWidth = Math.floor(DESKTOP_READER_DIAGRAM_WIDTH * participantTextFit.sublabelPreferred / MIN_PROJECTED_NODE_TEXT_PX);
function automaticCanvasWidth() {
  const participantsFit = (width) => asArray(sequence.participants).every((participant) => (
    textUnits(participant.label) * 6.8 <= width + 6
    && (!participant.sublabel || minimumNodeTextWidth(participant.sublabel, participantTextFit.sublabelMinimum) <= availableNodeTextWidth(width))
  ));
  const count = Math.max(1, asArray(sequence.participants).length);
  const columnFitMode = sequence.meta?.column_fit || 'spread';
  if (columnFitMode !== 'spread') return 920;
  if (participantsFit(spreadParticipantWidth(920))) {
    // Few-participant automatic canvases: keep readable box sizes but drop the
    // empty gutters a 920px spread leaves beside 2–3 lifelines. Authored
    // viewBoxes and the widen-for-labels path below are unchanged.
    if (count <= 3) {
      for (const candidate of [560, 640, 720, 800, 920]) {
        const box = spreadParticipantWidth(candidate);
        const span = count * box + (count - 1) * 16;
        if (box >= 86 && participantsFit(box) && candidate - 80 >= span && timelineLabelsFit(candidate)) return candidate;
      }
    }
    return 920;
  }
  const needed = Math.max(...asArray(sequence.participants).map((participant) => Math.max(
    textUnits(participant.label) * 6.8 - 6,
    participant.sublabel ? minimumNodeTextWidth(participant.sublabel, participantTextFit.sublabelPreferred) + 86 - availableNodeTextWidth(86) : 0,
  )));
  return Math.min(readableCanvasWidth, Math.max(920, Math.ceil((Math.min(190, needed) + 25) * count + 124)));
}
// A renderer-sized canvas grows to keep the legend clear of late messages and
// shrinks when the timeline is short: the old 760px floor left ~600px of empty
// lifeline under typical 4–8 message drafts. Keep a readable minimum band
// (lifelineTop 142 + 120px timeline + 65px footer = 327) so short diagrams stay
// usable; an authored viewBox is honored and validated below.
const SEQUENCE_MIN_AUTO_HEIGHT = 327;
const automaticWidth = sequence.meta?.viewBox ? null : automaticCanvasWidth();
// Timeline clearance is independent of legend visibility. Messages need 18px
// before the lifeline bottom; notes, activations and frames need their footer.
const timelineRequiredHeight = Math.max(contentBottom + 65,
  ...asArray(sequence.messages).map((message) => message.y + 18 + 65));
const automaticHeight = Math.max(SEQUENCE_MIN_AUTO_HEIGHT, timelineRequiredHeight, legendRequiredHeight(automaticWidth));
const viewBox = sequence.meta?.viewBox || [automaticWidth, automaticHeight];
// The timeline scales with viewBox height: a taller viewBox gains message room,
// a shorter one shrinks the readable band (validated below) instead of clipping.
// `column_fit: "spread"` widens the lanes with the viewBox instead of keeping
// the fixed 108px gap, so a wide canvas gains column distance and label room
// rather than dead space on the right. Spread is the default on both automatic
// and authored canvases; explicit fixed retains historical coordinates.
const columnFit = sequence.meta?.column_fit || 'spread';
const participantCount = Math.max(1, asArray(sequence.participants).length);
const preferredSideMargin = 62;
const spreadGeometry = spreadColumnGeometry(viewBox[0]);
const participantW = columnFit === 'spread' ? spreadGeometry.width : 86;
// Narrow feasible frames can reduce the left margin, while ordinary frames
// keep 62px. Compute card width first so this does not change its sizing rule.
const sideMargin = columnFit === 'spread'
  ? spreadGeometry.margin
  : preferredSideMargin;
// Fit the authored width when feasible, preserving a real 16px card gutter.
// Infeasible frames retain that minimum and fail the capacity check below.
const colGap = columnFit === 'spread' && participantCount > 1
  ? spreadGeometry.gap
  : 108;

// Showcase is the fast-authoring default; standard retains legacy label geometry.
const readableMessages = sequence.meta?.quality_profile === 'showcase';
const messageFontSize = readableMessages ? 11 : 9;
const messageUnitWidth = readableMessages ? 6.6 : 5.2;
const layout = {
  topY: 72,
  participantW,
  // Keep a separate top rail for the 11px semantic sigil and 16px brand mark.
  // Literal labels retain their fitted font size and full authored wording.
  participantH: 60,
  participantLabelY: 36,
  participantSublabelY: 50,
  lifelineTop: 142,
  lifelineBottom: viewBox[1] - 65,
  legendY: viewBox[1] - 54,
  leftX: columnFit === 'spread' ? sideMargin + participantW / 2 : sideMargin,
  colGap,
  labelH: readableMessages ? 18 : 16,
  noteFontSize: 7,
  noteBaselineOffset: 18,
};

// Automatic showcase spread can guarantee a readable fit within its bounded
// canvas. Standard, fixed columns and authored canvases retain historical text
// sizing; composition reports their projected readability under its own policy.
const readableAutomaticSublabel = readableMessages && automaticWidth !== null && columnFit === 'spread';
const readableSublabelMinimum = readableAutomaticSublabel
  ? Math.max(participantTextFit.sublabelMinimum, Math.ceil(minimumReadableSourceTextPx(viewBox[0]) * 10) / 10)
  : participantTextFit.sublabelMinimum;
const readableSublabelPreferred = Math.max(participantTextFit.sublabelPreferred, readableSublabelMinimum);

const participantBoxWidthNote = automaticWidth
  ? `participant boxes are ${participantW}px: the automatic ${viewBox[0]}px canvas cannot widen further without its 7px sublabels falling below the desktop reading minimum, so keep meta.viewBox omitted`
  : columnFit === 'spread'
    ? `participant boxes are ${participantW}px for this viewBox width and ${participantCount} participants`
    : `participant boxes are a fixed ${participantW}px unless meta.column_fit is "spread"`;

const arrowClass = {
  ...arrowClassMap,
  return: ['a-default', 'arrowhead']
};

function participantX(index) {
  return layout.leftX + index * layout.colGap;
}

const participants = new Map(asArray(sequence.participants).map((participant, index) => [
  participant.id,
  {
    ...participant,
    index,
    cx: participantX(index),
    x: participantX(index) - layout.participantW / 2,
    y: layout.topY,
    width: layout.participantW,
    height: layout.participantH,
    cy: layout.topY + layout.participantH / 2
  }
]));

function messageGeometry(message) {
  const from = participants.get(message.from);
  const to = participants.get(message.to);
  if (!from || !to || typeof message.y !== 'number') return null;
  const direction = to.cx > from.cx ? 1 : -1;
  const start = from.cx + direction * 7;
  const end = to.cx - direction * 7;
  return { start, end, center: (start + end) / 2 };
}

function messageLabelBox(message, relationIndex = null) {
  const geometry = messageGeometry(message);
  if (!geometry) return null;
  const width = Math.max(34, textUnits(message.label) * messageUnitWidth + 12);
  return {
    relation: message,
    relationIndex,
    label: message.label,
    x: geometry.center - width / 2,
    y: message.y - 20,
    width,
    height: layout.labelH,
  };
}

function messageRouteBox(message) {
  const geometry = messageGeometry(message);
  if (!geometry) return null;
  return {
    x: Math.min(geometry.start, geometry.end),
    y: message.y - 2,
    width: Math.abs(geometry.end - geometry.start),
    height: 4,
  };
}

function messageNoteBox(message) {
  const geometry = messageGeometry(message);
  if (!message.note || !geometry) return null;
  const font = layout.noteFontSize;
  const baseline = message.y + layout.noteBaselineOffset;
  return {
    x: Math.min(geometry.start, geometry.end) + 12,
    // Include conservative ascent/descent for CJK and fallback fonts, as in
    // the shared node text geometry. Rendering uses this same baseline/font.
    y: baseline - font * 1.2,
    width: minimumNodeTextWidth(message.note, font),
    height: font * 1.5,
    baseline,
    font,
  };
}

function segmentLabelBox(segment) {
  const labelW = Math.max(42, textUnits(segment.label) * 5.2 + 14);
  const occupied = asArray(sequence.messages)
    .flatMap((message) => [messageLabelBox(message), messageRouteBox(message), messageNoteBox(message)])
    .filter(Boolean);
  const label = { x: 56, y: segment.from - 22, width: labelW, height: 18 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!occupied.some((rect) => rectsOverlap(label, rect, 2))) break;
    label.y -= 22;
  }
  if (!segmentLabelMisplaced(label, segment)) return label;
  // Abutting segments can leave no room on the border: the badge climbed
  // behind the participant headers or into the previous segment, where it
  // names the wrong phase. Its own frame's top-left corner, clear of messages,
  // names the right one.
  // Another segment's title normally sits on that segment's own top border,
  // so its strip is taken too.
  const otherTitles = asArray(sequence.segments).filter((other) => other !== segment)
    .map((other) => ({ x: 56, y: other.from - 22, width: Math.max(42, textUnits(other.label) * 5.2 + 14), height: 18 }));
  const inside = { x: 56, y: segment.from + 4, width: labelW, height: 18 };
  for (let attempt = 0; attempt < 4 && inside.y + inside.height <= segment.to - 2; attempt += 1) {
    if (![...occupied, ...otherTitles, ...participants.values()].some((rect) => rectsOverlap(inside, rect, 2))) return inside;
    inside.y += 22;
  }
  return label;
}

// A badge on its frame's top border is the intended title. It stops naming
// that frame once it hides mostly behind the participant headers, or once
// message labels pushed it up into another segment.
function segmentLabelMisplaced(label, segment) {
  const half = label.height / 2;
  if (layout.topY + layout.participantH - label.y > half) return true;
  if (label.y >= segment.from - 22) return false;
  return asArray(sequence.segments).some((other) => other !== segment
    && Math.min(label.y + label.height, other.to) - Math.max(label.y, other.from) > half);
}

const compositionFrames = asArray(sequence.segments).map((segment, index) => ({
  id: index,
  label: segment.label,
  kind: 'segment',
  x: 48,
  y: segment.from,
  width: viewBox[0] - 96,
  height: segment.to - segment.from,
  radius: 10,
}));

function messagePath(message) {
  return {
    points: participants.has(message.from) && participants.has(message.to)
      ? [[participants.get(message.from).cx, message.y], [participants.get(message.to).cx, message.y]]
      : []
  };
}

function validateSequence() {
  const problems = [];
  const diagnostics = [];
  if (participants.size !== asArray(sequence.participants).length) problems.push('Participant ids must be unique.');

  if (layout.lifelineBottom - layout.lifelineTop < 120) {
    problems.push(`viewBox height ${viewBox[1]} leaves under 120px of timeline — set meta.viewBox[1] to at least ${layout.lifelineTop + 120 + 65}.`);
  }

  for (const participant of participants.values()) {
    const participantIndex = asArray(sequence.participants).findIndex((entry) => entry.id === participant.id);
    const participantProblem = (field, message, evidence, supportedFixes) => {
      problems.push(message);
      diagnostics.push({
        code: `sequence/participant-${field}-overflow`, severity: 'error', message,
        subject: { diagramType: 'sequence', nodeId: participant.id, path: `/participants/${participantIndex}/${field}` },
        evidence: { viewBoxWidth: viewBox[0], participantWidth: layout.participantW, ...evidence },
        supportedFixes,
      });
    };
    const estLabelW = textUnits(participant.label) * 6.8;
    if (estLabelW > layout.participantW + 6) {
      const message = automaticWidth
        ? `Label "${participant.label}" (~${Math.round(estLabelW)}px) is wider than component "${participant.id}" — shorten it to at most ${Math.floor((layout.participantW + 6) / 6.8)} text units (CJK counts 2; ${participantBoxWidthNote}).`
        : `Label "${participant.label}" (~${Math.round(estLabelW)}px) is wider than component "${participant.id}" (${layout.participantW}px) — shorten the label or widen the participant box.`;
      participantProblem('label', message, { text: participant.label, requiredWidth: estLabelW, availableWidth: layout.participantW + 6 },
        ['shorten the participant label while preserving its role', ...(columnFit === 'fixed' ? ['set meta.column_fit to "spread" if fixed coordinates are not required'] : [])]);
    }
    const brandRailProblem = brandTopRailProblem(participant, layout.participantW, 8, 'Participant');
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel renders as a single unwrapped <text>; shrink-to-fit handles the
    // ordinary case, this rejects what it cannot rescue.
    if (participant.sublabel) {
      const availableTextW = availableNodeTextWidth(layout.participantW);
      const minimumW = minimumNodeTextWidth(participant.sublabel, readableSublabelMinimum);
      if (minimumW > availableTextW) {
        const minimumDescription = readableAutomaticSublabel
          ? `${readableSublabelMinimum}px minimum that stays readable on this ${viewBox[0]}px canvas`
          : `${readableSublabelMinimum}px legible minimum`;
        const message = `Sublabel "${participant.sublabel}" needs ~${Math.ceil(minimumW)}px at the ${minimumDescription}, but participant "${participant.id}" provides ${availableTextW}px — shorten the sublabel (${participantBoxWidthNote}).`;
        participantProblem('sublabel', message, { text: participant.sublabel, requiredWidth: minimumW, availableWidth: availableTextW, minimumFontPx: readableSublabelMinimum },
          ['shorten the participant sublabel while preserving its role or protocol; move supplementary detail into a card', ...(columnFit === 'fixed' ? ['set meta.column_fit to "spread" if fixed coordinates are not required'] : [])]);
      }
    }
  }

  const messageList = asArray(sequence.messages);
  const participantList = asArray(sequence.participants);
  const participantOrder = new Map(participantList.map((p, index) => [p.id, index]));
  for (const message of messageList) {
    const messageIndex = messageList.indexOf(message);
    for (const [field, endpoint] of [['from', 'source'], ['to', 'target']]) {
      if (participants.has(message[field])) continue;
      const problem = `Message "${message.label}" references unknown ${endpoint} "${message[field]}".`;
      const otherField = field === 'from' ? 'to' : 'from';
      const anchorOrder = participantOrder.get(message[otherField]) ?? 0;
      const candidates = [...participantOrder.keys()]
        .filter((id) => id !== message[otherField])
        .sort((a, b) => Math.abs(participantOrder.get(a) - anchorOrder) - Math.abs(participantOrder.get(b) - anchorOrder));
      diagnostics.push({
        code: 'sequence/unknown-endpoint', severity: 'error', message: problem,
        subject: {
          diagramType: 'sequence',
          message: message.label ?? null,
          path: `/messages/${messageIndex}/${field}`,
          from: message.from,
          to: message.to,
        },
        evidence: { endpoint, unknownNodeId: message[field], availableNodeIds: candidates },
        supportedFixes: candidates.slice(0, 3).map((id) => `set /messages/${messageIndex}/${field} to verified node id "${id}"`),
      });
      problems.push(problem);
    }
    if (typeof message.y !== 'number') problems.push(`Message "${message.label}" must provide a numeric y.`);
    if (message.y < layout.lifelineTop + 18 || message.y > layout.lifelineBottom - 18) {
      problems.push(`Message "${message.label}" sits outside the readable timeline — keep y between ${layout.lifelineTop + 18} and ${layout.lifelineBottom - 18}.`);
    }
    if (participants.has(message.from) && participants.has(message.to)) {
      if (message.from === message.to) {
        const problem = `Message "${message.label}" is a self-message on participant "${message.from}"; this Sequence renderer supports only messages between distinct participants. Participant spacing cannot repair it. Preserve the internal step's meaning and order in a supported representation such as a note on a real message or a card; do not invent a participant.`;
        diagnostics.push({
          code: 'sequence/self-message-unsupported', severity: 'error', message: problem,
          subject: {
            diagramType: 'sequence',
            message: message.label,
            collection: 'messages',
            index: messageIndex,
            path: `/messages/${messageIndex}`,
            ...(message.id ? { id: message.id } : {}),
            from: message.from,
            to: message.to,
            fromPath: `/messages/${messageIndex}/from`,
            toPath: `/messages/${messageIndex}/to`,
          },
          evidence: {
            participant: message.from,
            participantPath: `/participants/${participantOrder.get(message.from)}`,
            y: message.y,
            supportedMessageGeometry: 'horizontal-between-distinct-participants',
          },
          supportedFixes: [],
        });
        problems.push(problem);
      } else {
        const distance = Math.abs(participants.get(message.to).cx - participants.get(message.from).cx);
        if (distance < 60) problems.push(`Message "${message.label}" spans ${Math.round(distance)}px (minimum 60px) — give its participants more column distance.`);
      }
    }
  }

  // Participant headers are opaque nodes. Lifelines, activation bars, and
  // segment bands remain intentional pass-through geometry and are excluded.
  problems.push(...cleanFlowProblems({
    relations: sequence.messages,
    obstacles: participants.values(),
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    obstacleKind: 'participant header',
    clearance: 0,
    routeHint: 'move the message y below the participant headers or reorder participants'
  }));
  problems.push(...cleanCrossingProblems({
    relations: sequence.messages,
    endpointIds: new Set(participants.keys()),
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'separate the message y values; lifeline crossings remain allowed'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: sequence.messages,
    endpointIds: new Set(participants.keys()),
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'separate the message y values so unrelated messages do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: sequence.messages,
    endpointIds: new Set(participants.keys()),
    frames: compositionFrames,
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'move the message y so it crosses a segment boundary perpendicularly or stays clearly inside the segment'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: sequence.messages,
    endpointIds: new Set(participants.keys()),
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'increase participant spacing or simplify message routing so every turn has room to read'
  }));

  // Vertical crowding only matters when the arrows share horizontal space;
  // disjoint arrows may legitimately run in parallel rows.
  const placed = asArray(sequence.messages)
    .filter((m) => participants.has(m.from) && participants.has(m.to))
    .map((m) => ({
      label: m.label,
      y: m.y,
      x1: Math.min(participants.get(m.from).cx, participants.get(m.to).cx),
      x2: Math.max(participants.get(m.from).cx, participants.get(m.to).cx)
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length && placed[j].y - placed[i].y < 28; j += 1) {
      if (placed[i].x1 < placed[j].x2 && placed[j].x1 < placed[i].x2) {
        problems.push(`Messages "${placed[i].label}" and "${placed[j].label}" are less than 28px apart and share horizontal space — spread their y values.`);
      }
    }
  }

  // Label masks can extend well past the arrow span, so check the actual
  // label rectangles too — tangent arrows with long labels still collide.
  const labelRects = asArray(sequence.messages)
    .map((m, messageIndex) => messageLabelBox(m, messageIndex))
    .filter(Boolean);
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — spread their message y values or shorten the labels.`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: sequence.messages,
    labels: labelRects,
    endpointIds: new Set(participants.keys()),
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'spread the message y values, shorten the label, or reorder participants so the adjacent route stays visible'
  }));
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
    diagramType: 'sequence',
    relationCollection: 'messages',
    profile: sequence.meta?.quality_profile,
    routeHint: 'shorten the label, reorder participants, or enlarge meta.viewBox',
  }));

  for (const segment of asArray(sequence.segments)) {
    if (segment.to <= segment.from) {
      problems.push(`Segment "${segment.label}" has invalid y range (from ${segment.from} to ${segment.to}) — "to" must be greater than "from".`);
    }
    if (segment.from < layout.topY || segment.to > layout.lifelineBottom + 20) {
      problems.push(`Segment "${segment.label}" extends outside the canvas — keep its y range between ${layout.topY} and ${layout.lifelineBottom + 20}.`);
    }
    // A frame edge may pass behind a masked message label, but an edge that
    // runs along the arrow itself leaves the reader unable to tell which phase
    // the message belongs to.
    if (sequence.meta?.quality_profile === 'showcase') {
      for (const edge of ['from', 'to']) {
        const border = segment[edge];
        const cut = asArray(sequence.messages).filter((message) => typeof message.y === 'number'
          && Math.abs(border - message.y) < 4);
        for (const message of cut) {
          const problem = `Segment "${segment.label}" ${edge === 'from' ? 'top' : 'bottom'} edge at y ${border} runs along message "${message.label}" (arrow at y ${message.y}) — move the edge to at least ${message.y + 4} to leave the message above it, or to at most ${message.y - 4} to leave it below.`;
          const segmentIndex = asArray(sequence.segments).indexOf(segment);
          problems.push(problem);
          diagnostics.push({
            code: 'sequence/segment-message-border-run', severity: 'error', message: problem,
            subject: { diagramType: 'sequence', collection: 'segments', index: segmentIndex, path: `/segments/${segmentIndex}/${edge}` },
            evidence: { segmentLabel: segment.label, edge, borderY: border, messageIndex: messageList.indexOf(message), messageLabel: message.label, messageY: message.y, minimumClearancePx: 4 },
            supportedFixes: [`set /segments/${segmentIndex}/${edge} to at least ${message.y + 4} to leave the message above it`, `set /segments/${segmentIndex}/${edge} to at most ${message.y - 4} to leave the message below it`],
          });
        }
      }
    }
    const labelBox = segmentLabelBox(segment);
    for (const other of asArray(sequence.segments)) {
      if (other === segment || asArray(sequence.segments).indexOf(other) < asArray(sequence.segments).indexOf(segment)) continue;
      if (rectsOverlap(labelBox, segmentLabelBox(other), 0)) {
        problems.push(`Segment labels "${segment.label}" and "${other.label}" overlap — leave more room between the segments' messages near their shared border, or shorten a label.`);
      }
    }
    const availableWidth = Math.max(0, viewBox[0] - 48 - labelBox.x);
    if (labelBox.x + labelBox.width > viewBox[0] - 48) {
      const requiredWidth = Math.ceil(labelBox.x + labelBox.width + 48);
      problems.push(`Segment "${segment.label}" label (~${Math.round(labelBox.width)}px) exceeds the segment frame's available width (${availableWidth}px) — shorten the label or increase meta.viewBox[0] to at least ${requiredWidth}.`);
    }
  }

  for (const activation of asArray(sequence.activations)) {
    if (!participants.has(activation.participant)) problems.push(`Activation references unknown participant "${activation.participant}".`);
    if (activation.to <= activation.from) problems.push(`Activation for "${activation.participant}" has invalid time range — "to" must be greater than "from".`);
  }

  const lastParticipant = asArray(sequence.participants)[asArray(sequence.participants).length - 1];
  if (lastParticipant && participants.get(lastParticipant.id).cx + layout.participantW / 2 > viewBox[0] - 40) {
    const requiredWidth = Math.ceil(participants.get(lastParticipant.id).cx + layout.participantW / 2 + 40);
    problems.push(`Participants exceed viewBox width — set meta.viewBox[0] to at least ${requiredWidth} or remove a participant.`);
  }

  // Showcase must not silently drop the implicit legend because late content
  // leaves no room for it; give the exact canvas height instead.
  const legendHeight = legendRequiredHeight(viewBox[0]);
  if (sequence.meta?.quality_profile === 'showcase' && sequence.meta?.legend === undefined
    && legendHeight > viewBox[1] && !measureLegend(legendEntries(), legendLayout())) {
    problems.push(`Sequence content ends at y=${contentBottom}, leaving no room for the legend below it — set meta.viewBox[1] to at least ${legendHeight} or omit meta.viewBox so the canvas grows.`);
  }

  if (problems.length) {
    throwDiagnosticProblems('Sequence layout validation failed', problems, {
      subject: { diagramType: 'sequence' },
      diagnostics,
    });
  }
}

function renderParticipant(participant) {
  const fill = componentFill[participant.type] || 'c-external';
  const hasSub = participant.sublabel != null && participant.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${participant.cx}" y="${layout.topY + layout.participantSublabelY}" class="t-muted" font-size="${fittedNodeFontSize(participant.sublabel, layout.participantW, readableSublabelPreferred, readableSublabelMinimum)}" text-anchor="middle">${esc(participant.sublabel)}</text>`
    : '';
  const brand = renderBrandMark(participant, { x: participant.x + layout.participantW - 22, y: layout.topY + 6 });
  const labelFontSize = fittedNodeFontSize(participant.label, brandLabelFitWidth(participant, layout.participantW), 11, 8);
  const passport = {
    kind: participant.type,
    sublabel: participant.sublabel,
    context: i18nText(sequence.meta.locale, 'node.context.sequence'),
    ...brandMetadataFor(participant),
  };
  return `        <g ${focusNodeAttrs(participant.id, participant.label, passport, sequence.meta.locale)}>
          ${focusNodeTitle(participant.label, passport)}
          <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="c-mask"/>
          <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="${fill}"${animateAttr(sequence.meta, 'node', participant.index)} stroke-width="1.5"/>
          ${renderSemanticSigil(participant.type, { icon: participant.icon, x: participant.x + 6, y: layout.topY + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${participant.cx}" y="${layout.topY + layout.participantLabelY}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(participant.label)}</text>${sub}
        </g>`;
}

// Lifelines never enter the legend band. The legend is placed below all
// timeline content, so stopping above its title still reaches every message.
function lifelineEnd() {
  const legend = measureLegend(legendEntries(), legendLayout());
  return legend?.titleY == null ? layout.lifelineBottom : Math.min(layout.lifelineBottom, legend.titleY - 22);
}

function renderLifeline(participant, end) {
  return `        <path d="M ${participant.cx} ${layout.lifelineTop} L ${participant.cx} ${end}" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>`;
}

function renderSegment(segment, index) {
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="segment" data-composition-frame-id="${index}" x="48" y="${segment.from}" width="${viewBox[0] - 96}" height="${segment.to - segment.from}" rx="10" class="c-lane" stroke-width="1"/>`;
}

function renderSegmentLabel(segment, index) {
  const label = segmentLabelBox(segment);
  return `        <g data-graph-role="segment-label" data-segment-id="${index}">
          <rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="3" class="c-mask"/>
          <text x="${label.x + 6}" y="${label.y + 13}" class="t-dim" font-size="9" font-weight="600">${esc(segment.label)}</text>
        </g>`;
}

function renderActivation(activation) {
  const participant = participants.get(activation.participant);
  const fill = componentFill[activation.type] || componentFill[participant.type] || 'c-external';
  const x = participant.cx - 5;
  const height = activation.to - activation.from;
  return `        <rect x="${x}" y="${activation.from}" width="10" height="${height}" rx="3" class="c-mask"/>
        <rect x="${x}" y="${activation.from}" width="10" height="${height}" rx="3" class="${fill}" stroke-width="1"/>`;
}

function messageLabel(message, x1, x2) {
  const box = messageLabelBox(message);
  const center = box ? box.x + box.width / 2 : (x1 + x2) / 2;
  const y = message.y - 10;
  const labelW = box?.width || Math.max(34, textUnits(message.label) * messageUnitWidth + 12);
  // A colored line gets a label in the same color, as in the legend swatches.
  // Gray lines (default and return) keep the readable muted text color.
  const accent = ['emphasis', 'security', 'dashed'].includes(message.variant) ? edgeLabelAccent(message.variant) : 't-muted';
  return `        <g data-detail="context">
          <rect x="${center - labelW / 2}" y="${y - 10}" width="${labelW}" height="${layout.labelH}" rx="3" class="c-mask"/>
          <text x="${center}" y="${y}" class="${accent}" font-size="${messageFontSize}" text-anchor="middle">${esc(message.label)}</text>
        </g>`;
}

function renderMessage(message, index) {
  const { start, end } = messageGeometry(message);
  const [cls, marker] = arrowClass[message.variant || 'default'] || arrowClass.default;
  const strokeWidth = message.variant === 'emphasis' ? 1.8 : 1.4;
  const dash = message.variant === 'return' ? ' stroke-dasharray="3,5"' : '';
  const noteBox = messageNoteBox(message);
  const note = noteBox
    ? `\n        <text data-detail="fine" x="${noteBox.x}" y="${noteBox.baseline}" class="t-dim" font-size="${noteBox.font}">${esc(message.note)}</text>`
    : '';
  return `        <g ${focusEdgeAttrs(message.from, message.to, message.label, index, message.id)}>
          <path data-composition-edge-from="${esc(message.from)}" data-composition-edge-to="${esc(message.to)}"${message.id ? ` data-composition-edge-id="${esc(message.id)}"` : ''} data-composition-points="${routePointsValue([[start, message.y], [end, message.y]])}" d="M ${start} ${message.y} L ${end} ${message.y}" class="${cls}"${animateAttr(sequence.meta, 'edge', index)} stroke-width="${strokeWidth}"${dash} marker-end="url(#${marker})"/>
${messageLabel(message, start, end)}${note}
        </g>`;
}


function legendLayout() {
  return {
    x: 40,
    baselineY: layout.legendY,
    width: viewBox[0] - 80,
    // The same content-based budget as legendRequiredHeight(): a wrapped
    // legend may use any rows it needs as long as it stays below the content.
    minTitleY: Math.max(layout.lifelineTop, contentBottom + LEGEND_CONTENT_GAP),
    unfit: sequence.meta?.legend === undefined ? 'hide' : 'error',
    diagramType: 'sequence',
  };
}

function renderLegend() {
  return renderResolvedLegend({
    entries: legendEntries(),
    locale: sequence.meta.locale,
    layout: legendLayout(),
    renderSwatch: (entry) => `<path d="M ${entry.x} ${entry.baseline - 3} L ${entry.x + 34} ${entry.baseline - 3}" class="${entry.className}" stroke-width="${entry.strokeWidth || 1.4}"${entry.dash ? ` stroke-dasharray="${entry.dash}"` : ''} marker-end="url(#${entry.marker})"/>`,
  });
}

function renderSvg() {
  const participantList = [...participants.values()];
  // Same default-canvas contract as lifecycle: 920x760 is below the 1.55 wide
  // ratio, so without intrinsic-height the desktop Reader can neither narrow
  // nor scroll it and every default sequence fails the browser gate.
  const readerFit = sequence.meta?.viewBox ? '' : ' data-reader-fit="width-first"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" data-sequence-column-fit="${columnFit}"${readerFit} ${svgRootAttrs(sequence.meta)}>
${svgAccessibleText(sequence.meta, 'sequence')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Time Segments -->
${asArray(sequence.segments).map(renderSegment).join('\n\n')}

        <!-- Lifelines -->
${participantList.map((participant) => renderLifeline(participant, lifelineEnd())).join('\n')}

        <!-- Activations -->
${asArray(sequence.activations).map(renderActivation).join('\n')}

        <!-- Messages -->
${asArray(sequence.messages).map(renderMessage).join('\n\n')}

        <!-- Segment Labels -->
${asArray(sequence.segments).map(renderSegmentLabel).join('\n')}

        <!-- Participants -->
${participantList.map(renderParticipant).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateSequence();
writeDiagram({
  outPath,
  template,
  diagramType: 'sequence',
  meta: sequence.meta,
  svg: renderSvg(),
  cards: sequence.cards,
  sourceEvidence,
});
