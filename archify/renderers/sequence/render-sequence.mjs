import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderCards, applyTemplate } from '../shared/utils.mjs';
import { validateSchema } from '../shared/validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const inputPath = path.resolve(process.argv[2] || path.join(skillRoot, 'examples/cache-miss-request.sequence.json'));
const sequence = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
validateSchema('sequence', sequence);

const templatePath = path.join(skillRoot, 'assets/template.html');
const template = fs.readFileSync(templatePath, 'utf8');
const outPath = path.resolve(process.cwd(), process.argv[3] || sequence.meta.output || 'sequence.html');

const viewBox = sequence.meta.viewBox || [920, 760];
const layout = {
  topY: 72,
  participantW: 86,
  participantH: 54,
  lifelineTop: 142,
  lifelineBottom: 695,
  leftX: 62,
  colGap: 108,
  labelH: 16
};

const typeClass = {
  frontend: 'c-frontend',
  backend: 'c-backend',
  database: 'c-database',
  cloud: 'c-cloud',
  security: 'c-security',
  messagebus: 'c-messagebus',
  external: 'c-external'
};

const textClass = {
  frontend: 't-frontend',
  backend: 't-backend',
  database: 't-database',
  cloud: 't-cloud',
  security: 't-security',
  messagebus: 't-messagebus',
  external: 't-external'
};

const arrowClass = {
  default: ['a-default', 'arrowhead'],
  emphasis: ['a-emphasis', 'arrowhead-emphasis'],
  security: ['a-security', 'arrowhead-security'],
  dashed: ['a-dashed', 'arrowhead-dashed'],
  return: ['a-default', 'arrowhead']
};

function participantX(index) {
  return layout.leftX + index * layout.colGap;
}

const participants = new Map(sequence.participants.map((participant, index) => [
  participant.id,
  {
    ...participant,
    index,
    cx: participantX(index),
    x: participantX(index) - layout.participantW / 2
  }
]));

function validateSequence() {
  const problems = [];
  if (sequence.schema_version !== 1) problems.push('Sequence files must set "schema_version": 1.');
  if (sequence.diagram_type !== 'sequence') problems.push('Sequence files must set "diagram_type": "sequence".');
  if (!sequence.meta?.title) problems.push('Sequence files must include meta.title.');
  if (!Array.isArray(sequence.participants) || sequence.participants.length < 2) {
    problems.push('Sequence diagrams need at least two participants.');
  }
  if (participants.size !== sequence.participants.length) problems.push('Participant ids must be unique.');

  for (const message of sequence.messages || []) {
    if (!participants.has(message.from)) problems.push(`Message "${message.label}" references unknown source "${message.from}".`);
    if (!participants.has(message.to)) problems.push(`Message "${message.label}" references unknown target "${message.to}".`);
    if (typeof message.y !== 'number') problems.push(`Message "${message.label}" must provide a numeric y.`);
    if (message.y < layout.lifelineTop + 18 || message.y > layout.lifelineBottom - 18) {
      problems.push(`Message "${message.label}" sits outside the readable timeline.`);
    }
    if (participants.has(message.from) && participants.has(message.to)) {
      const distance = Math.abs(participants.get(message.to).cx - participants.get(message.from).cx);
      if (distance < 60) problems.push(`Message "${message.label}" is too short to read cleanly.`);
    }
  }

  const sorted = [...(sequence.messages || [])].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < 28) {
      problems.push(`Messages "${sorted[i - 1].label}" and "${sorted[i].label}" are too close vertically.`);
    }
  }

  for (const activation of sequence.activations || []) {
    if (!participants.has(activation.participant)) problems.push(`Activation references unknown participant "${activation.participant}".`);
    if (activation.to <= activation.from) problems.push(`Activation for "${activation.participant}" has invalid time range.`);
  }

  const lastParticipant = sequence.participants[sequence.participants.length - 1];
  if (lastParticipant && participants.get(lastParticipant.id).cx + layout.participantW / 2 > viewBox[0] - 40) {
    problems.push('Participants exceed viewBox width.');
  }

  if (problems.length) {
    throw new Error(`Sequence layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function renderParticipant(participant) {
  const fill = typeClass[participant.type] || 'c-external';
  return `        <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="c-mask"/>
        <rect x="${participant.x}" y="${layout.topY}" width="${layout.participantW}" height="${layout.participantH}" rx="6" class="${fill}" stroke-width="1.5"/>
        <text x="${participant.cx}" y="${layout.topY + 22}" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">${esc(participant.label)}</text>
        <text x="${participant.cx}" y="${layout.topY + 39}" class="t-muted" font-size="7" text-anchor="middle">${esc(participant.sublabel)}</text>`;
}

function renderLifeline(participant) {
  return `        <path d="M ${participant.cx} ${layout.lifelineTop} L ${participant.cx} ${layout.lifelineBottom}" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>`;
}

function renderSegment(segment) {
  return `        <rect x="48" y="${segment.from}" width="${viewBox[0] - 96}" height="${segment.to - segment.from}" rx="10" class="c-lane" stroke-width="1"/>
        <text x="62" y="${segment.from + 18}" class="t-dim" font-size="9" font-weight="600">${esc(segment.label)}</text>`;
}

function renderActivation(activation) {
  const participant = participants.get(activation.participant);
  const fill = typeClass[activation.type] || typeClass[participant.type] || 'c-external';
  const x = participant.cx - 5;
  const height = activation.to - activation.from;
  return `        <rect x="${x}" y="${activation.from}" width="10" height="${height}" rx="3" class="c-mask"/>
        <rect x="${x}" y="${activation.from}" width="10" height="${height}" rx="3" class="${fill}" stroke-width="1"/>`;
}

function messageLabel(message, x1, x2) {
  const center = (x1 + x2) / 2;
  const y = message.y - 10;
  const labelW = Math.max(34, message.label.length * 5.2 + 12);
  const accent = message.variant === 'security'
    ? 't-security'
    : message.variant === 'dashed'
      ? 't-messagebus'
      : message.variant === 'return'
        ? 't-muted'
        : 't-backend';
  return `        <rect x="${center - labelW / 2}" y="${y - 10}" width="${labelW}" height="${layout.labelH}" rx="3" class="c-mask"/>
        <text x="${center}" y="${y}" class="${accent}" font-size="9" text-anchor="middle">${esc(message.label)}</text>`;
}

function renderMessage(message) {
  const from = participants.get(message.from);
  const to = participants.get(message.to);
  const direction = to.cx > from.cx ? 1 : -1;
  const start = from.cx + direction * 7;
  const end = to.cx - direction * 7;
  const [cls, marker] = arrowClass[message.variant || 'default'] || arrowClass.default;
  const strokeWidth = message.variant === 'emphasis' ? 1.8 : 1.4;
  const dash = message.variant === 'return' ? ' stroke-dasharray="3,5"' : '';
  const note = message.note
    ? `\n        <text x="${Math.min(start, end) + 12}" y="${message.y + 18}" class="t-dim" font-size="7">${esc(message.note)}</text>`
    : '';
  return `        <path d="M ${start} ${message.y} L ${end} ${message.y}" class="${cls}" stroke-width="${strokeWidth}"${dash} marker-end="url(#${marker})"/>
${messageLabel(message, start, end)}${note}`;
}

function renderLegend() {
  const y = 706;
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
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Time Segments -->
${(sequence.segments || []).map(renderSegment).join('\n\n')}

        <!-- Lifelines -->
${participantList.map(renderLifeline).join('\n')}

        <!-- Messages -->
${(sequence.messages || []).map(renderMessage).join('\n\n')}

        <!-- Activations -->
${(sequence.activations || []).map(renderActivation).join('\n')}

        <!-- Participants -->
${participantList.map(renderParticipant).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateSequence();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, applyTemplate(template, {
  title: sequence.meta.title,
  subtitle: sequence.meta.subtitle,
  footer: 'Sequence diagram &bull; Built with Archify &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export',
  svg: renderSvg(),
  cards: renderCards(sequence.cards),
}));
console.log(outPath);
