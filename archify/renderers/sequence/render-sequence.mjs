import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagram, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { componentFill, arrowClassMap, rectsOverlap, cleanFlowProblems, cleanCrossingProblems, cleanBorderRunProblems, cleanRouteRhythmProblems, routePointsValue, asArray, isFinitePoint } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: sequence, template, outPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'sequence',
  defaultExample: 'cache-miss-request.sequence.json'
});

const viewBox = sequence.meta?.viewBox || [920, 760];
// The timeline scales with viewBox height: a taller viewBox gains message room,
// a shorter one shrinks the readable band (validated below) instead of clipping.
const layout = {
  topY: 72,
  participantW: 86,
  participantH: 54,
  lifelineTop: 142,
  lifelineBottom: viewBox[1] - 65,
  legendY: viewBox[1] - 54,
  leftX: 62,
  colGap: 108,
  labelH: 16
};

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
  if (sequence.schema_version !== 1) problems.push('Sequence files must set "schema_version": 1.');
  if (sequence.diagram_type !== 'sequence') problems.push('Sequence files must set "diagram_type": "sequence".');
  if (!sequence.meta?.title) problems.push('Sequence files must include meta.title.');
  if (!Array.isArray(sequence.participants) || sequence.participants.length < 2) {
    problems.push('Sequence diagrams need at least two participants.');
  }
  if (participants.size !== asArray(sequence.participants).length) problems.push('Participant ids must be unique.');
  if (!Array.isArray(sequence.messages) || sequence.messages.length < 1) {
    problems.push('Sequence diagrams need at least one message.');
  }
  if (sequence.cards !== undefined && !Array.isArray(sequence.cards)) problems.push('Sequence "cards" must be an array.');
  for (const arr of ['segments', 'activations']) {
    if (sequence[arr] !== undefined && !Array.isArray(sequence[arr])) problems.push(`Sequence "${arr}" must be an array.`);
  }

  if (layout.lifelineBottom - layout.lifelineTop < 120) {
    problems.push(`viewBox height ${viewBox[1]} leaves under 120px of timeline — set meta.viewBox[1] to at least ${layout.lifelineTop + 120 + 65}.`);
  }

  for (const participant of participants.values()) {
    const estLabelW = textUnits(participant.label) * 6.8;
    if (estLabelW > layout.participantW + 6) {
      problems.push(`Label "${participant.label}" (~${Math.round(estLabelW)}px) is wider than the ${layout.participantW}px participant box — shorten it or move detail to sublabel.`);
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
    endpointIds: new Set(participants.keys()),
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
  problems.push(...cleanBorderRunProblems({
    relations: sequence.messages,
    endpointIds: new Set(participants.keys()),
    frames: compositionFrames,
    pathFor: messagePath,
    diagramType: 'sequence',
    relationCollection: 'messages',
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
    .filter((m) => participants.has(m.from) && participants.has(m.to) && typeof m.y === 'number')
    .map((m) => {
      const x1 = participants.get(m.from).cx;
      const x2 = participants.get(m.to).cx;
      const width = Math.max(34, textUnits(m.label) * 5.2 + 12);
      return { label: m.label, x: (x1 + x2) / 2 - width / 2, y: m.y - 20, width, height: layout.labelH };
    });
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — spread their message y values or shorten the labels.`);
      }
    }
  }

  for (const segment of asArray(sequence.segments)) {
    if (segment.to <= segment.from) {
      problems.push(`Segment "${segment.label}" has invalid y range (from ${segment.from} to ${segment.to}) — "to" must be greater than "from".`);
    }
    if (segment.from < layout.topY || segment.to > layout.lifelineBottom + 20) {
      problems.push(`Segment "${segment.label}" extends outside the canvas — keep its y range between ${layout.topY} and ${layout.lifelineBottom + 20}.`);
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
    throw new Error(`Sequence layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function renderParticipant(participant) {
  const fill = componentFill[participant.type] || 'c-external';
  const hasSub = participant.sublabel != null && participant.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${participant.cx}" y="${layout.topY + 39}" class="t-muted" font-size="7" text-anchor="middle">${esc(participant.sublabel)}</text>`
    : '';
  const passport = { kind: participant.type, sublabel: participant.sublabel, context: 'Sequence participant' };
  return `        <g ${focusNodeAttrs(participant.id, participant.label, passport)}>
          ${focusNodeTitle(participant.label, passport)}
          <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="c-mask"/>
          <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="${fill}"${animateAttr(sequence.meta, 'node', participant.index)} stroke-width="1.5"/>
          ${renderSemanticSigil(participant.type, { x: participant.x + 6, y: layout.topY + 6 })}
          <text${hasSub ? ' data-detail-anchor' : ''} x="${participant.cx}" y="${layout.topY + 22}" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">${esc(participant.label)}</text>${sub}
        </g>`;
}

function renderLifeline(participant) {
  return `        <path d="M ${participant.cx} ${layout.lifelineTop} L ${participant.cx} ${layout.lifelineBottom}" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>`;
}

function renderSegment(segment, index) {
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="segment" data-composition-frame-id="${index}" x="48" y="${segment.from}" width="${viewBox[0] - 96}" height="${segment.to - segment.from}" rx="10" class="c-lane" stroke-width="1"/>
        <text x="62" y="${segment.from + 18}" class="t-dim" font-size="9" font-weight="600">${esc(segment.label)}</text>`;
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
  const center = (x1 + x2) / 2;
  const y = message.y - 10;
  const labelW = Math.max(34, textUnits(message.label) * 5.2 + 12);
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
  const from = participants.get(message.from);
  const to = participants.get(message.to);
  const direction = to.cx > from.cx ? 1 : -1;
  const start = from.cx + direction * 7;
  const end = to.cx - direction * 7;
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

function renderLegend() {
  const y = layout.legendY;
  return `        <text x="150" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <path d="M 150 ${y} L 184 ${y}" class="a-emphasis" stroke-width="1.8" marker-end="url(#arrowhead-emphasis)"/>
        <text x="193" y="${y + 3}" class="t-muted" font-size="8">request</text>
        <path d="M 270 ${y} L 304 ${y}" class="a-default" stroke-width="1.4" stroke-dasharray="3,5" marker-end="url(#arrowhead)"/>
        <text x="313" y="${y + 3}" class="t-muted" font-size="8">return</text>
        <path d="M 385 ${y} L 419 ${y}" class="a-security" stroke-width="1.4" marker-end="url(#arrowhead-security)"/>
        <text x="428" y="${y + 3}" class="t-muted" font-size="8">security</text>
        <path d="M 530 ${y} L 564 ${y}" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
        <text x="573" y="${y + 3}" class="t-muted" font-size="8">async trace</text>`;
}

function renderSvg() {
  const participantList = [...participants.values()];
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(sequence.meta, 'sequence diagram')}>
${svgAccessibleText(sequence.meta, 'sequence diagram')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Time Segments -->
${asArray(sequence.segments).map(renderSegment).join('\n\n')}

        <!-- Lifelines -->
${participantList.map(renderLifeline).join('\n')}

        <!-- Messages -->
${asArray(sequence.messages).map(renderMessage).join('\n\n')}

        <!-- Activations -->
${asArray(sequence.activations).map(renderActivation).join('\n')}

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
  meta: sequence.meta,
  footerLabel: 'Sequence diagram',
  svg: renderSvg(),
  cards: sequence.cards,
});
