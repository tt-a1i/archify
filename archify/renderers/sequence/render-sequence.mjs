import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { componentFill, arrowClassMap, rectsOverlap, cleanFlowProblems, cleanCrossingProblems, cleanAmbiguousCorridorProblems, cleanBorderRunProblems, cleanRouteRhythmProblems, cleanLabelRouteClearanceProblems, routePointsValue, asArray, isFinitePoint } from '../shared/geometry.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';

const participantTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: sequence, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'sequence',
  defaultExample: 'cache-miss-request.sequence.json'
});

const viewBox = sequence.meta?.viewBox || [920, 760];
// The timeline scales with viewBox height: a taller viewBox gains message room,
// a shorter one shrinks the readable band (validated below) instead of clipping.
// `column_fit: "spread"` widens the lanes with the viewBox instead of keeping
// the fixed 108px gap, so a wide canvas gains column distance and label room
// rather than dead space on the right. The default stays "fixed" so existing
// diagrams keep their coordinates.
const columnFit = sequence.meta?.column_fit === 'spread' ? 'spread' : 'fixed';
const participantCount = Math.max(1, asArray(sequence.participants).length);
const sideMargin = 62;
const participantW = columnFit === 'spread'
  ? Math.max(86, Math.min(190, Math.round((viewBox[0] - sideMargin * 2) / participantCount) - 24))
  : 86;
const colGap = columnFit === 'spread' && participantCount > 1
  ? Math.max(108, (viewBox[0] - 40 - sideMargin - participantW) / (participantCount - 1))
  : 108;

const layout = {
  topY: 72,
  participantW,
  participantH: 54,
  lifelineTop: 142,
  lifelineBottom: viewBox[1] - 65,
  legendY: viewBox[1] - 54,
  leftX: columnFit === 'spread' ? sideMargin + participantW / 2 : sideMargin,
  colGap,
  labelH: 16
};

const participantBoxWidthNote = columnFit === 'spread'
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
  const width = Math.max(34, textUnits(message.label) * 5.2 + 12);
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

function segmentLabelBox(segment) {
  const labelW = Math.max(42, textUnits(segment.label) * 5.2 + 14);
  const occupied = asArray(sequence.messages)
    .flatMap((message) => [messageLabelBox(message), messageRouteBox(message)])
    .filter(Boolean);
  const label = { x: 56, y: segment.from - 22, width: labelW, height: 18 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!occupied.some((rect) => rectsOverlap(label, rect, 2))) break;
    label.y -= 22;
  }
  return label;
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
  if (participants.size !== asArray(sequence.participants).length) problems.push('Participant ids must be unique.');

  if (layout.lifelineBottom - layout.lifelineTop < 120) {
    problems.push(`viewBox height ${viewBox[1]} leaves under 120px of timeline — set meta.viewBox[1] to at least ${layout.lifelineTop + 120 + 65}.`);
  }

  for (const participant of participants.values()) {
    const estLabelW = textUnits(participant.label) * 6.8;
    if (estLabelW > layout.participantW + 6) {
      problems.push(`Label "${participant.label}" (~${Math.round(estLabelW)}px) is wider than the ${layout.participantW}px participant box — shorten it.`);
    }
    const brandRailProblem = brandTopRailProblem(participant, layout.participantW, 8, 'Participant');
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel renders as a single unwrapped <text>; shrink-to-fit handles the
    // ordinary case, this rejects what it cannot rescue.
    if (participant.sublabel) {
      const availableTextW = availableNodeTextWidth(layout.participantW);
      const minimumW = minimumNodeTextWidth(participant.sublabel, participantTextFit.sublabelMinimum);
      if (minimumW > availableTextW) {
        problems.push(`Sublabel "${participant.sublabel}" needs ~${Math.ceil(minimumW)}px at the ${participantTextFit.sublabelMinimum}px legible minimum, but participant "${participant.id}" provides ${availableTextW}px — shorten the sublabel (${participantBoxWidthNote}).`);
      }
    }
  }

  for (const message of asArray(sequence.messages)) {
    if (!participants.has(message.from)) problems.push(`Message "${message.label}" references unknown source "${message.from}".`);
    if (!participants.has(message.to)) problems.push(`Message "${message.label}" references unknown target "${message.to}".`);
    if (typeof message.y !== 'number') problems.push(`Message "${message.label}" must provide a numeric y.`);
    if (message.y < layout.lifelineTop + 18 || message.y > layout.lifelineBottom - 18) {
      problems.push(`Message "${message.label}" sits outside the readable timeline — keep y between ${layout.lifelineTop + 18} and ${layout.lifelineBottom - 18}.`);
    }
    if (participants.has(message.from) && participants.has(message.to)) {
      const distance = Math.abs(participants.get(message.to).cx - participants.get(message.from).cx);
      if (distance < 60) problems.push(`Message "${message.label}" spans ${Math.round(distance)}px (minimum 60px) — give its participants more column distance.`);
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

  for (const segment of asArray(sequence.segments)) {
    if (segment.to <= segment.from) {
      problems.push(`Segment "${segment.label}" has invalid y range (from ${segment.from} to ${segment.to}) — "to" must be greater than "from".`);
    }
    if (segment.from < layout.topY || segment.to > layout.lifelineBottom + 20) {
      problems.push(`Segment "${segment.label}" extends outside the canvas — keep its y range between ${layout.topY} and ${layout.lifelineBottom + 20}.`);
    }
    const labelBox = segmentLabelBox(segment);
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

  if (problems.length) {
    throwDiagnosticProblems('Sequence layout validation failed', problems, {
      subject: { diagramType: 'sequence' },
    });
  }
}

function renderParticipant(participant) {
  const fill = componentFill[participant.type] || 'c-external';
  const hasSub = participant.sublabel != null && participant.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${participant.cx}" y="${layout.topY + 39}" class="t-muted" font-size="${fittedNodeFontSize(participant.sublabel, layout.participantW, participantTextFit.sublabelPreferred, participantTextFit.sublabelMinimum)}" text-anchor="middle">${esc(participant.sublabel)}</text>`
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
          ${renderSemanticSigil(participant.type, { x: participant.x + 6, y: layout.topY + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${participant.cx}" y="${layout.topY + 22}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(participant.label)}</text>${sub}
        </g>`;
}

function renderLifeline(participant) {
  return `        <path d="M ${participant.cx} ${layout.lifelineTop} L ${participant.cx} ${layout.lifelineBottom}" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>`;
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
  const labelW = box?.width || Math.max(34, textUnits(message.label) * 5.2 + 12);
  const accent = message.variant === 'security'
    ? 't-security'
    : message.variant === 'dashed'
      ? 't-messagebus'
      : message.variant === 'return'
        ? 't-muted'
        : 't-backend';
  return `        <g data-detail="context">
          <rect x="${center - labelW / 2}" y="${y - 10}" width="${labelW}" height="${layout.labelH}" rx="3" class="c-mask"/>
          <text x="${center}" y="${y}" class="${accent}" font-size="9" text-anchor="middle">${esc(message.label)}</text>
        </g>`;
}

function renderMessage(message, index) {
  const { start, end } = messageGeometry(message);
  const [cls, marker] = arrowClass[message.variant || 'default'] || arrowClass.default;
  const strokeWidth = message.variant === 'emphasis' ? 1.8 : 1.4;
  const dash = message.variant === 'return' ? ' stroke-dasharray="3,5"' : '';
  const note = message.note
    ? `\n        <text data-detail="fine" x="${Math.min(start, end) + 12}" y="${message.y + 18}" class="t-dim" font-size="7">${esc(message.note)}</text>`
    : '';
  return `        <g ${focusEdgeAttrs(message.from, message.to, message.label, index, message.id)}>
          <path data-composition-edge-from="${esc(message.from)}" data-composition-edge-to="${esc(message.to)}"${message.id ? ` data-composition-edge-id="${esc(message.id)}"` : ''} data-composition-points="${routePointsValue([[start, message.y], [end, message.y]])}" d="M ${start} ${message.y} L ${end} ${message.y}" class="${cls}"${animateAttr(sequence.meta, 'edge', index)} stroke-width="${strokeWidth}"${dash} marker-end="url(#${marker})"/>
${messageLabel(message, start, end)}${note}
        </g>`;
}

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

function renderLegend() {
  const presentKinds = new Set(asArray(sequence.messages).map((message) => message.variant || 'default'));
  const entries = resolveLegend(sequence.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: sequence.meta.locale,
    layout: {
      x: 40,
      baselineY: layout.legendY,
      width: viewBox[0] - 80,
      minTitleY: layout.legendY - 30,
      unfit: sequence.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'sequence',
    },
    renderSwatch: (entry) => `<path d="M ${entry.x} ${entry.baseline - 3} L ${entry.x + 34} ${entry.baseline - 3}" class="${entry.className}" stroke-width="${entry.strokeWidth || 1.4}"${entry.dash ? ` stroke-dasharray="${entry.dash}"` : ''} marker-end="url(#${entry.marker})"/>`,
  });
}

function renderSvg() {
  const participantList = [...participants.values()];
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(sequence.meta)}>
${svgAccessibleText(sequence.meta, 'sequence')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Time Segments -->
${asArray(sequence.segments).map(renderSegment).join('\n\n')}

        <!-- Lifelines -->
${participantList.map(renderLifeline).join('\n')}

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
});
