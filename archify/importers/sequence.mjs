/**
 * Mermaid `sequenceDiagram` importer for Archify.
 *
 * Parses a documented subset of Mermaid sequence syntax and produces typed
 * Archify Sequence IR that passes `archify validate sequence`. The importer
 * treats Mermaid as an interaction trace — participants, ordered messages,
 * direction, request/return distinction, activation, and notes — and never
 * copies Mermaid layout, theming, or styling.
 *
 * Mermaid source is untrusted text. Labels keep their original characters as
 * literal text (never interpreted as markup), identifiers are re-derived
 * against the Archify id pattern, and text that cannot be represented safely
 * is rejected instead of being repaired silently.
 *
 * Every construct outside the supported subset fails with a stable named
 * diagnostic and a source location; no participant, message, or note is ever
 * silently discarded.
 *
 * The supported subset is documented in
 * `archify/references/mermaid-sequence-import.md`.
 */

import { textUnits } from '../renderers/shared/utils.mjs';

// --- Supported grammar ---------------------------------------------------

// Mermaid's only per-message signal is line style plus arrow head. Solid means
// a forward call, dotted means a reply, and the open/cross heads mean the
// sender does not wait. Those three facts are mapped onto the Sequence schema's
// visual kinds; `emphasis` and `security` are authoring judgements that Mermaid
// does not encode, so the importer never invents them.
const ARROW_KINDS = [
  { token: '<<-->>', kind: null, description: 'bidirectional dotted' },
  { token: '<<->>', kind: null, description: 'bidirectional solid' },
  { token: '-->>', kind: 'return', description: 'dotted line with arrowhead' },
  { token: '--)', kind: 'dashed', description: 'dotted line with open arrowhead' },
  { token: '--x', kind: 'dashed', description: 'dotted line with cross head' },
  { token: '-->', kind: 'return', description: 'dotted line without arrowhead' },
  { token: '->>', kind: 'default', description: 'solid line with arrowhead' },
  { token: '-)', kind: 'dashed', description: 'solid line with open arrowhead' },
  { token: '-x', kind: 'dashed', description: 'solid line with cross head' },
  { token: '->', kind: 'default', description: 'solid line without arrowhead' },
];

const ARROW_RE = new RegExp(
  ARROW_KINDS.map((arrow) => arrow.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

// Mermaid constructs that are valid sequence syntax but carry meaning the
// Sequence schema cannot express. Each one fails loudly rather than dropping
// the statements it wraps.
const UNSUPPORTED_KEYWORDS = new Map([
  ['loop', 'repetition block'],
  ['alt', 'alternative block'],
  ['else', 'alternative branch'],
  ['opt', 'optional block'],
  ['par', 'parallel block'],
  ['and', 'parallel branch'],
  ['critical', 'critical block'],
  ['option', 'critical branch'],
  ['break', 'break block'],
  ['rect', 'background rectangle'],
  ['box', 'participant grouping box'],
  ['create', 'participant creation'],
  ['destroy', 'participant destruction'],
  ['link', 'participant link'],
  ['links', 'participant links'],
  ['properties', 'participant properties'],
  ['details', 'participant details'],
  ['accTitle', 'accessibility title'],
  ['accDescr', 'accessibility description'],
]);

// --- Layout budget -------------------------------------------------------

// Mirrors the sequence renderer's layout contract (see
// `archify/renderers/sequence/README.md`) so generated coordinates are inside
// the readable timeline the renderer validates.
const LAYOUT = {
  firstMessageY: 180,
  messageStep: 42,
  minViewBox: 480,
  // The renderer accepts messages down to height - 83, but the legend title sits
  // at height - 86 and the artifact checker rejects an arrow that crosses it.
  bottomMargin: 100,
  sideMargin: 62,
  rightMargin: 40,
  fixedParticipantW: 86,
  maxParticipantW: 190,
  fixedColumnGap: 108,
  labelUnitPx: 6.8,
  labelSlackPx: 6,
  activationPad: 8,
  widthSearchLimit: 8000,
};

const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/;

// --- Diagnostics ---------------------------------------------------------

function diag(code, message, line, column, extras = {}) {
  return {
    code,
    severity: 'error',
    message,
    subject: { line, column, ...extras.subject },
    evidence: { source: { line, column }, ...extras.evidence },
    supportedFixes: extras.supportedFixes || [],
  };
}

// Source text is echoed back as evidence, so keep it short and free of the
// control characters that would corrupt a terminal or a JSON receipt reader.
function quoteEvidence(text) {
  const flattened = String(text ?? '').replace(/[\u0000-\u001F\u007F]/g, '\u2423');
  return flattened.length > 120 ? `${flattened.slice(0, 117)}...` : flattened;
}

function failure(diagnostic) {
  return { ok: false, diagnostics: [diagnostic] };
}

// --- Text safety ---------------------------------------------------------

function unquote(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

// Tabs are legal Mermaid indentation but collapse to nothing useful inside a
// single-line SVG label, so they become ordinary spaces.
function normalizeText(text) {
  return String(text ?? '').replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function unsafeTextProblem(text) {
  if (CONTROL_CHAR_RE.test(text)) return 'control character';
  if (LONE_SURROGATE_RE.test(text)) return 'unpaired surrogate';
  return null;
}

function checkSafeText(text, { code, role, line, column, fix }) {
  const problem = unsafeTextProblem(text);
  if (!problem) return null;
  return diag(
    code,
    `${role} contains a ${problem}, which cannot be carried into a safe Archify artifact.`,
    line,
    column,
    {
      subject: { role },
      evidence: { text: quoteEvidence(text), reason: problem },
      supportedFixes: [fix],
    },
  );
}

// Mermaid identifiers are free text; Archify ids are `^[a-zA-Z][a-zA-Z0-9_-]*$`.
// The Mermaid name stays visible as the label, so re-deriving the id loses no
// meaning, and the suffix keeps two different names from collapsing into one
// participant.
function deriveId(name, ordinal, used) {
  const base = String(name)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/-+$/, '');
  let candidate = base || `p${ordinal}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  for (let suffix = 2; ; suffix += 1) {
    candidate = `${base || `p${ordinal}`}-${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// --- Geometry ------------------------------------------------------------

// The three helpers below replicate the sequence renderer's column maths so the
// importer can pick a viewBox the renderer accepts instead of guessing.
function derivedParticipantWidth(viewBoxWidth, count) {
  return Math.max(
    LAYOUT.fixedParticipantW,
    Math.min(LAYOUT.maxParticipantW, Math.round((viewBoxWidth - LAYOUT.sideMargin * 2) / count) - 24),
  );
}

function derivedColumnGap(viewBoxWidth, count, participantW) {
  if (count < 2) return LAYOUT.fixedColumnGap;
  return Math.max(
    LAYOUT.fixedColumnGap,
    (viewBoxWidth - LAYOUT.rightMargin - LAYOUT.sideMargin - participantW) / (count - 1),
  );
}

function spreadFits(viewBoxWidth, count, requiredParticipantW) {
  const participantW = derivedParticipantWidth(viewBoxWidth, count);
  if (participantW < requiredParticipantW) return false;
  const gap = derivedColumnGap(viewBoxWidth, count, participantW);
  const lastCenter = LAYOUT.sideMargin + participantW / 2 + (count - 1) * gap;
  return lastCenter + participantW / 2 <= viewBoxWidth - LAYOUT.rightMargin;
}

// Participant labels render unwrapped inside their box, so the box has to be
// wide enough before the renderer measures it.
function requiredParticipantWidth(labels) {
  const widest = labels.reduce((maximum, label) => Math.max(maximum, textUnits(label)), 0);
  return Math.ceil(widest * LAYOUT.labelUnitPx) - LAYOUT.labelSlackPx;
}

function planColumns(participants) {
  const count = participants.length;
  const required = requiredParticipantWidth(participants.map((participant) => participant.label));
  if (required <= LAYOUT.fixedParticipantW) {
    const fixedLast = LAYOUT.sideMargin + (count - 1) * LAYOUT.fixedColumnGap;
    const width = Math.max(
      LAYOUT.minViewBox,
      Math.ceil(fixedLast + LAYOUT.fixedParticipantW / 2 + LAYOUT.rightMargin),
    );
    return { ok: true, columnFit: 'fixed', width };
  }
  if (required > LAYOUT.maxParticipantW) {
    return { ok: false, required };
  }
  const start = Math.max(
    LAYOUT.minViewBox,
    count * (required + 24) + LAYOUT.sideMargin * 2,
    LAYOUT.sideMargin + LAYOUT.rightMargin + required + LAYOUT.fixedColumnGap * (count - 1),
  );
  for (let width = start; width <= start + LAYOUT.widthSearchLimit; width += 1) {
    if (spreadFits(width, count, required)) return { ok: true, columnFit: 'spread', width };
  }
  return { ok: false, required };
}

// --- Parser --------------------------------------------------------------

/**
 * Parse Mermaid `sequenceDiagram` source into Archify Sequence IR.
 *
 * @param {string} source Mermaid sequence source text.
 * @returns {{ ok: true, ir: object, stats: object } | { ok: false, diagnostics: object[] }}
 */
export function parseSequence(source) {
  const lines = String(source ?? '').split(/\r?\n/);
  const participants = new Map();
  const usedIds = new Set();
  const messages = [];
  const activations = [];
  const openActivations = new Map();
  const pendingActivations = [];
  let declared = false;
  let title = null;
  let noteCount = 0;
  let autonumber = null;

  const known = (name) => participants.has(name);

  const registerParticipant = (name, { label, type, line, column }) => {
    const cleanName = normalizeText(name);
    const cleanLabel = normalizeText(label ?? name);
    if (!cleanName) {
      return failure(diag(
        'import/sequence-empty-participant-name',
        'A participant declaration has an empty name.',
        line,
        column,
        { supportedFixes: ['give the participant a name, for example "participant api as Orders API"'] },
      ));
    }
    if (!cleanLabel) {
      return failure(diag(
        'import/sequence-empty-participant-label',
        `Participant "${cleanName}" resolves to an empty label.`,
        line,
        column,
        {
          subject: { participant: cleanName },
          supportedFixes: ['give the participant a non-empty alias, for example "participant api as Orders API"'],
        },
      ));
    }
    const unsafe = checkSafeText(cleanLabel, {
      code: 'import/sequence-unsafe-label',
      role: `Participant label "${quoteEvidence(cleanLabel)}"`,
      line,
      column,
      fix: 'remove the control character from the participant label',
    });
    if (unsafe) return failure(unsafe);
    const participant = {
      id: deriveId(cleanName, participants.size + 1, usedIds),
      type,
      label: cleanLabel,
      mermaidName: cleanName,
      line,
    };
    participants.set(cleanName, participant);
    return { ok: true, participant };
  };

  // Mermaid creates a participant on first mention; the importer does the same
  // so an undeclared name is preserved instead of rejected.
  const resolveParticipant = (name, line, column) => {
    const cleanName = normalizeText(name);
    if (participants.has(cleanName)) return { ok: true, participant: participants.get(cleanName) };
    return registerParticipant(cleanName, { label: cleanName, type: 'backend', line, column });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNo = index + 1;
    const line = raw.trim();
    const column = raw.length - raw.trimStart().length + 1;

    if (line === '') continue;

    if (line.startsWith('%%{')) {
      return failure(diag(
        'import/unsupported-directive',
        'Mermaid init/config directives are not supported by the Archify sequence importer; Archify does not import Mermaid theming.',
        lineNo,
        column,
        {
          subject: { construct: 'directive' },
          evidence: { text: quoteEvidence(line) },
          supportedFixes: ['remove the "%%{init: ...}%%" directive; Archify styling comes from the diagram type, not the source'],
        },
      ));
    }
    if (line.startsWith('%%')) continue;

    if (!declared) {
      // A YAML front matter block may carry a title; nothing else in it has a
      // typed home, so anything further is rejected rather than dropped.
      if (line === '---' && index === 0) {
        let cursor = index + 1;
        let closed = false;
        for (; cursor < lines.length; cursor += 1) {
          const entry = lines[cursor].trim();
          if (entry === '---') { closed = true; break; }
          if (entry === '') continue;
          const titleMatch = entry.match(/^title\s*:\s*(.*)$/);
          if (titleMatch) {
            title = normalizeText(unquote(titleMatch[1]));
            continue;
          }
          return failure(diag(
            'import/sequence-unsupported-frontmatter',
            `Front matter key "${quoteEvidence(entry.split(':')[0].trim())}" is not supported; the Archify sequence importer reads only "title".`,
            cursor + 1,
            1,
            {
              subject: { construct: 'frontmatter' },
              evidence: { text: quoteEvidence(entry) },
              supportedFixes: ['remove the front matter key, or keep only "title:" in the front matter block'],
            },
          ));
        }
        if (!closed) {
          return failure(diag(
            'import/sequence-unclosed-frontmatter',
            'Front matter opened with "---" but was never closed.',
            lineNo,
            column,
            { supportedFixes: ['close the front matter block with a "---" line before "sequenceDiagram"'] },
          ));
        }
        index = cursor;
        continue;
      }
      if (/^sequenceDiagram\b/.test(line)) {
        declared = true;
        continue;
      }
      return failure(diag(
        'import/sequence-missing-declaration',
        'The first non-comment line must declare "sequenceDiagram".',
        lineNo,
        column,
        {
          evidence: { text: quoteEvidence(line) },
          supportedFixes: ['start the file with a "sequenceDiagram" line'],
        },
      ));
    }

    const keyword = line.match(/^([A-Za-z]+)\b/)?.[1];
    if (keyword && UNSUPPORTED_KEYWORDS.has(keyword)) {
      return failure(diag(
        `import/unsupported-keyword-${keyword.toLowerCase()}`,
        `Mermaid "${keyword}" (${UNSUPPORTED_KEYWORDS.get(keyword)}) is not supported by the Archify sequence importer; the Sequence schema has no typed home for it and dropping it would change what the diagram claims.`,
        lineNo,
        column,
        {
          subject: { construct: keyword },
          evidence: { text: quoteEvidence(line) },
          supportedFixes: [
            `remove the "${keyword}" block and keep the messages it contains as a flat ordered trace`,
            'author the conditional or repeated behaviour directly in Archify Sequence JSON',
          ],
        },
      ));
    }

    if (line === 'end') {
      return failure(diag(
        'import/sequence-unexpected-end',
        '"end" closes a Mermaid block, and the Archify sequence importer supports no block constructs.',
        lineNo,
        column,
        {
          subject: { construct: 'end' },
          supportedFixes: ['remove the "end" line together with the block statement that opened it'],
        },
      ));
    }

    const titleMatch = line.match(/^title\s*:?\s+(.+)$/);
    if (titleMatch) {
      const candidate = normalizeText(unquote(titleMatch[1]));
      const unsafe = checkSafeText(candidate, {
        code: 'import/sequence-unsafe-label',
        role: 'Diagram title',
        line: lineNo,
        column,
        fix: 'remove the control character from the title',
      });
      if (unsafe) return failure(unsafe);
      if (candidate) title = candidate;
      continue;
    }

    const autonumberMatch = line.match(/^autonumber\b\s*(.*)$/);
    if (autonumberMatch) {
      const args = autonumberMatch[1].trim();
      if (args === 'off') {
        autonumber = null;
        continue;
      }
      if (args === '') {
        autonumber = { next: 1, step: 1 };
        continue;
      }
      const numbers = args.split(/\s+/);
      if (numbers.length > 2 || numbers.some((value) => !/^\d+$/.test(value))) {
        return failure(diag(
          'import/sequence-invalid-autonumber',
          `"autonumber ${quoteEvidence(args)}" is not valid; autonumber accepts "off", a start value, or a start and a step.`,
          lineNo,
          column,
          {
            evidence: { text: quoteEvidence(line) },
            supportedFixes: ['use "autonumber", "autonumber 10", "autonumber 10 5", or "autonumber off"'],
          },
        ));
      }
      autonumber = { next: Number(numbers[0]), step: numbers.length > 1 ? Number(numbers[1]) : 1 };
      continue;
    }

    const declarationMatch = line.match(/^(participant|actor)\s+(.+)$/);
    if (declarationMatch) {
      const [, kind, body] = declarationMatch;
      const aliasMatch = body.match(/^(.*?)\s+as\s+(.*)$/);
      const name = unquote(aliasMatch ? aliasMatch[1] : body);
      const label = unquote(aliasMatch ? aliasMatch[2] : body);
      if (participants.has(normalizeText(name))) {
        return failure(diag(
          'import/sequence-duplicate-participant',
          `Participant "${quoteEvidence(normalizeText(name))}" is declared more than once; the later declaration would silently replace the first.`,
          lineNo,
          column,
          {
            subject: { participant: normalizeText(name) },
            evidence: { text: quoteEvidence(line), firstDeclaredOnLine: participants.get(normalizeText(name)).line },
            supportedFixes: ['remove the duplicate declaration, or give the second participant a distinct name'],
          },
        ));
      }
      // Mermaid distinguishes only "actor" from "participant"; anything finer
      // would be an invented fact.
      const registered = registerParticipant(name, {
        label,
        type: kind === 'actor' ? 'external' : 'backend',
        line: lineNo,
        column,
      });
      if (!registered.ok) return registered;
      continue;
    }

    const activationMatch = line.match(/^(activate|deactivate)\s+(.+)$/);
    if (activationMatch) {
      const [, verb, rawName] = activationMatch;
      const name = normalizeText(unquote(rawName));
      if (!known(name)) {
        return failure(diag(
          'import/sequence-unknown-participant',
          `"${verb} ${quoteEvidence(name)}" references a participant that was never declared or used in a message.`,
          lineNo,
          column,
          {
            subject: { participant: name, construct: verb },
            evidence: { text: quoteEvidence(line) },
            supportedFixes: [`declare "participant ${name}" before the "${verb}" statement`],
          },
        ));
      }
      const participant = participants.get(name);
      if (verb === 'activate') {
        pendingActivations.push({ participant, line: lineNo, column });
      } else {
        // A pending activation has not reached the timeline yet, so closing it
        // here would describe a bar with no height.
        if (pendingActivations.some((entry) => entry.participant.id === participant.id)) {
          return failure(diag(
            'import/sequence-empty-activation',
            `"activate ${quoteEvidence(name)}" and "deactivate ${quoteEvidence(name)}" have no message between them, so the activation has no span on the timeline.`,
            lineNo,
            column,
            {
              subject: { participant: name, construct: 'deactivate' },
              evidence: { text: quoteEvidence(line) },
              supportedFixes: ['remove the empty activate/deactivate pair, or move it around the messages it covers'],
            },
          ));
        }
        const stack = openActivations.get(participant.id);
        if (!stack || stack.length === 0) {
          return failure(diag(
            'import/sequence-unbalanced-deactivate',
            `"deactivate ${quoteEvidence(name)}" has no matching activation.`,
            lineNo,
            column,
            {
              subject: { participant: name, construct: 'deactivate' },
              evidence: { text: quoteEvidence(line) },
              supportedFixes: [`add "activate ${name}" (or an activating "->>+" message) before this line`],
            },
          ));
        }
        const open = stack.pop();
        open.to = messages[messages.length - 1].y + LAYOUT.activationPad;
      }
      continue;
    }

    const noteMatch = line.match(/^[Nn]ote\s+(left of|right of|over)\s+([^:]*):\s*(.*)$/);
    if (noteMatch) {
      const [, placement, targets, body] = noteMatch;
      const text = normalizeText(body);
      if (!text) {
        return failure(diag(
          'import/sequence-empty-note',
          'A note has no text.',
          lineNo,
          column,
          {
            subject: { construct: 'note' },
            evidence: { text: quoteEvidence(line) },
            supportedFixes: ['give the note text, for example "Note right of api: idempotency key required"'],
          },
        ));
      }
      const unsafe = checkSafeText(text, {
        code: 'import/sequence-unsafe-label',
        role: 'Note text',
        line: lineNo,
        column,
        fix: 'remove the control character from the note text',
      });
      if (unsafe) return failure(unsafe);
      for (const target of targets.split(',')) {
        const name = normalizeText(unquote(target));
        if (!name || !known(name)) {
          return failure(diag(
            'import/sequence-unknown-participant',
            `Note "${placement} ${quoteEvidence(name)}" references a participant that was never declared or used in a message.`,
            lineNo,
            column,
            {
              subject: { participant: name, construct: 'note' },
              evidence: { text: quoteEvidence(line) },
              supportedFixes: [`declare "participant ${name}" before the note`],
            },
          ));
        }
      }
      if (messages.length === 0) {
        return failure(diag(
          'import/sequence-unattached-note',
          'A note before the first message cannot be placed on the Archify timeline; Sequence notes annotate a message.',
          lineNo,
          column,
          {
            subject: { construct: 'note' },
            evidence: { text: quoteEvidence(line) },
            supportedFixes: ['move the note after the message it annotates, or drop it from the source deliberately'],
          },
        ));
      }
      const target = messages[messages.length - 1];
      target.note = target.note ? `${target.note} / ${text}` : text;
      noteCount += 1;
      continue;
    }

    const message = parseMessageLine(line, lineNo, column, known);
    if (!message.ok) return message;

    const from = resolveParticipant(message.from, lineNo, column);
    if (!from.ok) return from;
    const to = resolveParticipant(message.to, lineNo, column);
    if (!to.ok) return to;

    if (from.participant.id === to.participant.id) {
      return failure(diag(
        'import/sequence-self-message',
        `Self-message on "${quoteEvidence(from.participant.label)}" is not supported; an Archify sequence message needs two distinct lifelines.`,
        lineNo,
        column,
        {
          subject: { participant: from.participant.mermaidName, construct: 'self-message' },
          evidence: { text: quoteEvidence(line) },
          supportedFixes: [
            'send the message to a second participant that represents the internal step',
            'move the internal step into a note on the surrounding message',
          ],
        },
      ));
    }

    const unsafe = checkSafeText(message.label, {
      code: 'import/sequence-unsafe-label',
      role: `Message label "${quoteEvidence(message.label)}"`,
      line: lineNo,
      column,
      fix: 'remove the control character from the message label',
    });
    if (unsafe) return failure(unsafe);

    const y = LAYOUT.firstMessageY + messages.length * LAYOUT.messageStep;
    let label = message.label;
    if (autonumber) {
      label = `${autonumber.next}. ${label}`;
      autonumber.next += autonumber.step;
    }
    const emitted = { from: from.participant.id, to: to.participant.id, y, label, variant: message.variant };
    messages.push(emitted);

    // A standalone "activate" has no timeline position of its own; it opens on
    // the next message, which is where Mermaid draws the bar too.
    while (pendingActivations.length) {
      const pending = pendingActivations.shift();
      openActivation(openActivations, activations, pending.participant, y - LAYOUT.activationPad);
    }
    if (message.activates) {
      openActivation(openActivations, activations, to.participant, y - LAYOUT.activationPad);
    }
    if (message.deactivates) {
      const stack = openActivations.get(from.participant.id);
      if (!stack || stack.length === 0) {
        return failure(diag(
          'import/sequence-unbalanced-deactivate',
          `The "-" activation suffix deactivates the sender "${quoteEvidence(from.participant.label)}", which has no open activation.`,
          lineNo,
          column,
          {
            subject: { participant: from.participant.mermaidName, construct: 'deactivate' },
            evidence: { text: quoteEvidence(line) },
            supportedFixes: [`activate "${from.participant.mermaidName}" with a "->>+" message or an "activate" statement before this line`],
          },
        ));
      }
      stack.pop().to = y + LAYOUT.activationPad;
    }
  }

  if (!declared) {
    return failure(diag(
      'import/sequence-missing-declaration',
      'The source declares no "sequenceDiagram".',
      1,
      1,
      { supportedFixes: ['start the file with a "sequenceDiagram" line'] },
    ));
  }

  if (pendingActivations.length) {
    const pending = pendingActivations[0];
    return failure(diag(
      'import/sequence-dangling-activate',
      `"activate ${quoteEvidence(pending.participant.mermaidName)}" is not followed by any message, so the activation has no span on the timeline.`,
      pending.line,
      pending.column,
      {
        subject: { participant: pending.participant.mermaidName, construct: 'activate' },
        supportedFixes: ['move the "activate" statement above the message it covers, or remove it'],
      },
    ));
  }

  if (messages.length === 0) {
    return failure(diag(
      'import/sequence-no-messages',
      'The diagram declares no messages; an Archify sequence needs at least one.',
      lines.length,
      1,
      { supportedFixes: ['add at least one message, for example "web->>api: GET /orders"'] },
    ));
  }

  const ordered = [...participants.values()];
  if (ordered.length < 2) {
    return failure(diag(
      'import/sequence-too-few-participants',
      `The diagram uses ${ordered.length} participant; an Archify sequence needs at least two lifelines.`,
      lines.length,
      1,
      { supportedFixes: ['add the second participant the interaction talks to'] },
    ));
  }

  const lastY = messages[messages.length - 1].y;
  // An activation left open at the end of the source runs to the end of the
  // timeline, matching how Mermaid draws it.
  for (const stack of openActivations.values()) {
    for (const open of stack) {
      if (open.to === undefined) open.to = lastY + LAYOUT.activationPad;
    }
  }

  const columns = planColumns(ordered);
  if (!columns.ok) {
    const widest = ordered.reduce(
      (candidate, participant) => (textUnits(participant.label) > textUnits(candidate.label) ? participant : candidate),
      ordered[0],
    );
    return failure(diag(
      'import/sequence-participant-label-too-long',
      `Participant label "${quoteEvidence(widest.label)}" needs a ${columns.required}px box, but a sequence participant box tops out at ${LAYOUT.maxParticipantW}px.`,
      widest.line,
      1,
      {
        subject: { participant: widest.mermaidName },
        evidence: { requiredWidth: columns.required, maximumWidth: LAYOUT.maxParticipantW },
        supportedFixes: [`shorten the alias, for example "participant ${widest.mermaidName} as ${widest.label.split(/\s+/).slice(0, 2).join(' ')}"`],
      },
    ));
  }

  const meta = {
    title: title || 'Imported Sequence',
    viewBox: [columns.width, Math.max(LAYOUT.minViewBox, lastY + LAYOUT.bottomMargin)],
  };
  if (columns.columnFit === 'spread') meta.column_fit = 'spread';

  const ir = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta,
    participants: ordered.map((participant) => ({
      id: participant.id,
      type: participant.type,
      label: participant.label,
    })),
    messages: messages.map((message) => ({
      from: message.from,
      to: message.to,
      y: message.y,
      label: message.label,
      variant: message.variant,
      ...(message.note ? { note: message.note } : {}),
    })),
  };
  if (activations.length) {
    ir.activations = activations.map((activation) => ({
      participant: activation.participant,
      from: activation.from,
      to: activation.to,
      type: activation.type,
    }));
  }

  return {
    ok: true,
    ir,
    stats: {
      participants: ir.participants.length,
      messages: ir.messages.length,
      activations: activations.length,
      notes: noteCount,
    },
  };
}

function openActivation(openActivations, activations, participant, from) {
  const entry = { participant: participant.id, from, to: undefined, type: participant.type };
  activations.push(entry);
  if (!openActivations.has(participant.id)) openActivations.set(participant.id, []);
  openActivations.get(participant.id).push(entry);
  return entry;
}

// --- Message statement ---------------------------------------------------

function parseMessageLine(line, lineNo, column, known) {
  const separator = line.indexOf(':');
  const head = separator === -1 ? line : line.slice(0, separator);
  const arrows = [...head.matchAll(ARROW_RE)];

  if (arrows.length === 0) {
    return failure(diag(
      'import/sequence-unknown-statement',
      'This line is neither a supported statement nor a message; no Mermaid message arrow was found before the ":".',
      lineNo,
      column,
      {
        evidence: { text: quoteEvidence(line) },
        supportedFixes: [
          'write the message as "<source><arrow><target>: label", for example "web->>api: GET /orders"',
          'remove the line if it is not part of the interaction',
        ],
      },
    ));
  }

  // A hyphen inside a participant name can look like an arrow. Prefer the split
  // whose endpoints are already known participants before falling back to the
  // leftmost arrow, so "web-x-app->>api" stays one participant.
  const candidates = arrows.map((match) => ({
    token: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const resolved = candidates.find((candidate) => {
    const left = normalizeText(unquote(head.slice(0, candidate.start)));
    const right = normalizeText(unquote(head.slice(candidate.end).replace(/^[+-]/, '')));
    return known(left) && known(right);
  })
    || candidates.find((candidate) => known(normalizeText(unquote(head.slice(0, candidate.start)))))
    || candidates[0];

  const arrow = ARROW_KINDS.find((entry) => entry.token === resolved.token);
  if (!arrow.kind) {
    return failure(diag(
      'import/sequence-unsupported-arrow',
      `Mermaid arrow "${arrow.token}" (${arrow.description}) is not supported; an Archify sequence message carries one direction.`,
      lineNo,
      column + resolved.start,
      {
        subject: { construct: arrow.token },
        evidence: { text: quoteEvidence(line) },
        supportedFixes: ['split the bidirectional arrow into one message per direction'],
      },
    ));
  }

  if (separator === -1) {
    return failure(diag(
      'import/sequence-missing-message-separator',
      'A message needs a ":" between its arrow and its label.',
      lineNo,
      column,
      {
        evidence: { text: quoteEvidence(line) },
        supportedFixes: ['write the message as "<source><arrow><target>: label"'],
      },
    ));
  }

  const label = normalizeText(line.slice(separator + 1));
  if (!label) {
    return failure(diag(
      'import/sequence-empty-message-label',
      'A message has an empty label; an Archify sequence message must say what is being sent.',
      lineNo,
      column,
      {
        evidence: { text: quoteEvidence(line) },
        supportedFixes: ['give the message a label, for example "web->>api: GET /orders"'],
      },
    ));
  }

  const from = normalizeText(unquote(head.slice(0, resolved.start)));
  const tail = head.slice(resolved.end);
  const activationMarker = tail.match(/^[+-]/)?.[0] ?? '';
  const to = normalizeText(unquote(tail.slice(activationMarker.length)));

  if (!from || !to) {
    return failure(diag(
      'import/sequence-missing-message-endpoint',
      `Message "${quoteEvidence(label)}" is missing its ${from ? 'target' : 'source'} participant.`,
      lineNo,
      column,
      {
        evidence: { text: quoteEvidence(line) },
        supportedFixes: ['name a participant on both sides of the arrow'],
      },
    ));
  }

  return {
    ok: true,
    from,
    to,
    label,
    variant: arrow.kind,
    activates: activationMarker === '+',
    deactivates: activationMarker === '-',
  };
}

// --- Public API ----------------------------------------------------------

/**
 * Import Mermaid `sequenceDiagram` source and return typed Sequence IR plus a
 * machine-readable receipt. Called by `archify import sequence`.
 *
 * @param {string} source Mermaid sequence source text.
 * @returns {{ ok: true, ir: object, receipt: object } | { ok: false, diagnostics: object[] }}
 */
export function importSequence(source) {
  const result = parseSequence(source);
  if (!result.ok) return result;
  return {
    ok: true,
    ir: result.ir,
    receipt: {
      schemaVersion: 1,
      command: 'import',
      source: 'mermaid-sequence',
      ok: true,
      ...result.stats,
    },
  };
}
