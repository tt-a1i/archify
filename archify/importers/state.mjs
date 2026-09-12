/**
 * Mermaid `stateDiagram` / `stateDiagram-v2` importer for Archify.
 *
 * Parses a documented subset of Mermaid state syntax and produces typed
 * Archify lifecycle IR. The importer treats Mermaid as state and transition
 * meaning — never as layout or styling: Mermaid's `direction`, class, and
 * style directives do not survive, because the lifecycle bands are a fixed
 * phase/event/outcome contract rather than a free canvas.
 *
 * Everything outside the documented subset fails with a stable named
 * diagnostic and the source line that produced it. No state, transition,
 * guard label, or note is ever silently dropped or invented.
 *
 * Mermaid text is untrusted input: it is normalized, checked for characters
 * that cannot survive XML/JSON round-tripping, and otherwise carried through
 * as literal text. Entity codes, angle brackets, and quotes stay text and are
 * escaped once by the renderer.
 */

import {
  anchor,
  labelPoint,
  rectsOverlap,
  routeHonorsEndpointSides,
  segmentIntersectsRect,
} from '../renderers/shared/geometry.mjs';
import { textUnits } from '../renderers/shared/utils.mjs';
import { availableNodeTextWidth, minimumNodeTextWidth } from '../renderers/shared/text-fit.mjs';

// --- Lifecycle layout contract -------------------------------------------
//
// These constants mirror `renderers/lifecycle/render-lifecycle.mjs`. The
// importer computes the exact geometry the renderer will compute, so an
// unplaceable state or route is reported here as an import diagnostic instead
// of surfacing later as a layout failure on generated output.

const VIEW_BOX = [980, 660];
const STATE_WIDTH = 118;

const BANDS = {
  phase: { lane: 'main', y: 126, height: 62, xs: [94, 248, 402, 556, 710] },
  event: { lane: 'events', y: 278, height: 58, xs: [402, 556, 710] },
  outcome: { lane: 'terminal', y: 450, height: 58, xs: [402, 556, 710] },
};

const LANE_LABELS = {
  main: 'Lifecycle phases',
  events: 'Interruptions',
  terminal: 'Terminal outcomes',
};

// Horizontal corridors that contain no state row, nearest-first per gap.
const HORIZONTAL_CORRIDORS = [212, 224, 236, 248, 372, 384, 396, 408, 88, 76, 64, 530, 542, 554];
// Vertical corridors that fall between state columns in every band.
const VERTICAL_CORRIDORS = [325, 479, 633, 170, 787, 845];

const ROUTE_BOUNDS = { minX: 24, maxX: VIEW_BOX[0] - 24, minY: 56, maxY: 566 };
// The renderer rejects transitions whose endpoints are closer than 32px.
const MIN_ENDPOINT_DISTANCE = 34;

const LABEL_OFFSETS = [
  [0, 0], [0, 52], [0, -45], [0, 66], [0, -62], [0, 84], [0, -80],
  [30, 52], [-30, 52], [30, -45], [-30, -45], [46, 0], [-46, 0],
];

// Label geometry the lifecycle renderer uses when it checks label collisions.
const LABEL_UNIT_WIDTH = 4.9;
const LABEL_PADDING = 12;
const LABEL_HEIGHT = 16;
const LABEL_BASELINE_OFFSET = 11;

const SPINE_MAX = BANDS.phase.xs.length;
const EVENT_MAX = BANDS.event.xs.length;
const TERMINAL_MAX = BANDS.outcome.xs.length;
const STATE_MAX = SPINE_MAX + EVENT_MAX + TERMINAL_MAX;

// Node label fit budgets, expressed in the renderer's own text units.
const MAX_LABEL_UNITS = Math.floor((STATE_WIDTH + 6) / 6.2);
const MAX_SUBLABEL_UNITS = Math.floor(availableNodeTextWidth(STATE_WIDTH) / minimumNodeTextWidth('m', 6));
const MAX_TRANSITION_LABEL_UNITS = 30;

const UNSUPPORTED_DIRECTIVES = new Set([
  'classDef', 'class', 'style', 'click', 'link', 'callback', 'accTitle', 'accDescr',
]);

const DEFAULT_TITLE = 'Imported State Diagram';

// --- Diagnostics ---------------------------------------------------------

function diagnostic(code, message, { line, construct, evidence = {}, supportedFixes = [] }) {
  return {
    code,
    severity: 'error',
    message,
    subject: {
      source: 'mermaid-state',
      ...(Number.isInteger(line) ? { line } : {}),
      ...(construct ? { construct } : {}),
    },
    evidence,
    supportedFixes,
  };
}

function failure(diagnostics) {
  return { ok: false, diagnostics };
}

function fail(code, message, options) {
  return failure([diagnostic(code, message, options)]);
}

// --- Untrusted text ------------------------------------------------------

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function codePointName(char) {
  return `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

// Mermaid text may contain anything a text editor can produce. Characters that
// cannot round-trip through JSON and XML are rejected by name rather than
// stripped, because silently rewriting a label changes the diagram's meaning.
function safeText(value, { line, field }) {
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    const unsafe = code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 || code === 0xfeff;
    if (!unsafe) continue;
    return fail(
      'import/state-unsafe-text',
      `The ${field} on line ${line} contains ${codePointName(char)}, which cannot be carried into a JSON artifact or rendered SVG.`,
      {
        line,
        construct: field,
        evidence: { codePoint: codePointName(char), field },
        supportedFixes: [`remove the ${codePointName(char)} character from the ${field} on line ${line}`],
      },
    );
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return fail('import/state-empty-text', `The ${field} on line ${line} is empty.`, {
      line,
      construct: field,
      evidence: { field },
      supportedFixes: [`give the ${field} on line ${line} at least one visible character, or remove the declaration`],
    });
  }
  return { ok: true, text };
}

function checkId(id, line) {
  if (ID_PATTERN.test(id)) return { ok: true, id };
  return fail(
    'import/state-invalid-id',
    `State id "${id}" on line ${line} is not a valid Archify id.`,
    {
      line,
      construct: 'state id',
      evidence: { id, pattern: ID_PATTERN.source },
      supportedFixes: [`rename the state on line ${line} to match ${ID_PATTERN.source}`],
    },
  );
}

// --- Source parsing ------------------------------------------------------

function normalizeSource(source) {
  return String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// `%%` opens a Mermaid comment. A `%%` inside a quoted description is content,
// so quotes are tracked before the comment is stripped.
function stripComment(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === '%' && line[index + 1] === '%') return line.slice(0, index);
  }
  return line;
}

function parseSource(source) {
  const lines = normalizeSource(source).split('\n');
  const model = {
    title: null,
    states: new Map(),
    transitions: [],
    initial: [],
    terminal: [],
    notes: [],
    ignoredDirectives: [],
  };

  let index = 0;
  const contentAt = (position) => stripComment(lines[position] ?? '').trim();

  // Optional Mermaid frontmatter, restricted to `title`.
  while (index < lines.length && contentAt(index) === '') index += 1;
  if (contentAt(index) === '---') {
    const opened = index + 1;
    index += 1;
    let closed = false;
    while (index < lines.length) {
      const line = contentAt(index);
      index += 1;
      if (line === '---') { closed = true; break; }
      if (line === '') continue;
      const match = line.match(/^title\s*:\s*(.+)$/);
      if (!match) {
        return fail(
          'import/state-unsupported-frontmatter',
          `Frontmatter key on line ${index} is outside the supported subset; only "title" is imported.`,
          {
            line: index,
            construct: 'frontmatter',
            evidence: { line: line },
            supportedFixes: [`remove the frontmatter entry on line ${index}, or keep only "title:"`],
          },
        );
      }
      const title = safeText(match[1].replace(/^"|"$/g, ''), { line: index, field: 'frontmatter title' });
      if (!title.ok) return title;
      model.title = title.text;
    }
    if (!closed) {
      return fail('import/state-unterminated-frontmatter', `Frontmatter opened on line ${opened} is never closed with "---".`, {
        line: opened,
        construct: 'frontmatter',
        evidence: { openedAtLine: opened },
        supportedFixes: [`close the frontmatter block opened on line ${opened} with a "---" line`],
      });
    }
  }

  while (index < lines.length && contentAt(index) === '') index += 1;
  const headerLine = index + 1;
  const header = contentAt(index);
  if (!/^stateDiagram(-v2)?$/.test(header)) {
    return fail(
      'import/state-missing-header',
      `Line ${headerLine} must declare "stateDiagram-v2" or "stateDiagram"; found "${header || '(end of file)'}".`,
      {
        line: headerLine,
        construct: 'diagram header',
        evidence: { line: header, expected: ['stateDiagram-v2', 'stateDiagram'] },
        supportedFixes: ['start the diagram with a "stateDiagram-v2" line'],
      },
    );
  }
  index += 1;

  const declare = (id, lineNumber) => {
    const existing = model.states.get(id);
    if (existing) return existing;
    const state = { id, label: null, sublabel: null, choice: false, line: lineNumber, order: model.states.size };
    model.states.set(id, state);
    return state;
  };

  while (index < lines.length) {
    const lineNumber = index + 1;
    const line = contentAt(index);
    index += 1;
    if (line === '') continue;

    if (/^direction\s+(TB|TD|BT|RL|LR)$/.test(line)) {
      model.ignoredDirectives.push(line);
      continue;
    }

    const directive = line.match(/^([A-Za-z]+)\b/);
    if (directive && UNSUPPORTED_DIRECTIVES.has(directive[1])) {
      return fail(
        'import/state-unsupported-directive',
        `Mermaid "${directive[1]}" on line ${lineNumber} is a styling or interaction directive and is outside the imported subset.`,
        {
          line: lineNumber,
          construct: directive[1],
          evidence: { directive: directive[1], line },
          supportedFixes: [`remove the "${directive[1]}" directive on line ${lineNumber}; Archify derives presentation from state kinds`],
        },
      );
    }

    if (line === '--') {
      return fail(
        'import/state-unsupported-concurrency',
        `The concurrency separator "--" on line ${lineNumber} has no lifecycle equivalent; Archify lifecycle states are a single phase rail.`,
        {
          line: lineNumber,
          construct: '--',
          evidence: { line },
          supportedFixes: [`split the concurrent regions around line ${lineNumber} into separate state diagrams and import each one`],
        },
      );
    }

    if (line === '}' || line === '{') {
      return fail(
        'import/state-unsupported-composite',
        `The composite-state brace on line ${lineNumber} has no lifecycle equivalent; Archify does not flatten nested states because the flattening would invent topology.`,
        {
          line: lineNumber,
          construct: 'composite state',
          evidence: { line },
          supportedFixes: [`replace the composite state around line ${lineNumber} with flat states, or import the inner region as its own diagram`],
        },
      );
    }

    if (/^note\b/.test(line)) {
      const note = parseNote(line, lineNumber, lines, index, contentAt);
      if (!note.ok) return note;
      model.notes.push(note.note);
      index = note.nextIndex;
      continue;
    }

    if (/^state\b/.test(line)) {
      const declaration = parseStateDeclaration(line, lineNumber);
      if (!declaration.ok) return declaration;
      const state = declare(declaration.id, lineNumber);
      if (declaration.label !== undefined) {
        if (state.label && state.label !== declaration.label) {
          return fail('import/state-duplicate-description', `State "${state.id}" already has the description "${state.label}"; line ${lineNumber} would replace it.`, {
            line: lineNumber,
            construct: 'state declaration',
            evidence: { state: state.id, existing: state.label, incoming: declaration.label },
            supportedFixes: [`keep one 'state "..." as ${state.id}' declaration`],
          });
        }
        state.label = declaration.label;
      }
      if (declaration.choice) state.choice = true;
      continue;
    }

    if (line.includes('-->')) {
      const transition = parseTransition(line, lineNumber);
      if (!transition.ok) return transition;
      const { from, to, label } = transition;
      if (from === '[*]' && to === '[*]') {
        return fail('import/state-malformed-transition', `Line ${lineNumber} connects the start marker to the end marker without a state.`, {
          line: lineNumber,
          construct: 'transition',
          evidence: { line },
          supportedFixes: [`name a state on line ${lineNumber}, for example "[*] --> Queued"`],
        });
      }
      if (from === '[*]') {
        declare(to, lineNumber);
        model.initial.push({ id: to, line: lineNumber });
        continue;
      }
      if (to === '[*]') {
        declare(from, lineNumber);
        model.terminal.push({ id: from, line: lineNumber });
        continue;
      }
      if (from === to) {
        return fail(
          'import/state-unsupported-self-transition',
          `State "${from}" transitions to itself on line ${lineNumber}; the lifecycle renderer requires at least 32px between transition endpoints, so a self transition cannot be drawn.`,
          {
            line: lineNumber,
            construct: 'self transition',
            evidence: { state: from, line },
            supportedFixes: [`remove the self transition on line ${lineNumber}, or model the repeated work as a second state`],
          },
        );
      }
      declare(from, lineNumber);
      declare(to, lineNumber);
      model.transitions.push({ from, to, label, line: lineNumber });
      continue;
    }

    const description = line.match(/^([^\s:]+)\s*:\s*(.+)$/);
    if (description) {
      const id = checkId(description[1], lineNumber);
      if (!id.ok) return id;
      const label = safeText(description[2], { line: lineNumber, field: `description of state "${description[1]}"` });
      if (!label.ok) return label;
      const state = declare(id.id, lineNumber);
      if (state.sublabel && state.sublabel !== label.text) {
        return fail('import/state-duplicate-description', `State "${state.id}" already has description text; line ${lineNumber} would replace it.`, {
          line: lineNumber,
          construct: 'state description',
          evidence: { state: state.id, existing: state.sublabel, incoming: label.text },
          supportedFixes: [`keep one description line for state "${state.id}"`],
        });
      }
      // `Id : text` is Mermaid's description form. The id stays the identity
      // and the description becomes rendered context, so both survive.
      state.sublabel = label.text;
      continue;
    }

    if (/^[^\s]+$/.test(line)) {
      const id = checkId(line, lineNumber);
      if (!id.ok) return id;
      declare(id.id, lineNumber);
      continue;
    }

    return fail('import/state-unrecognized-line', `Line ${lineNumber} is not part of the imported Mermaid state subset: "${line}".`, {
      line: lineNumber,
      construct: 'statement',
      evidence: { line },
      supportedFixes: [`rewrite line ${lineNumber} as a state declaration, a description, a transition, or a note`],
    });
  }

  return { ok: true, model };
}

function parseStateDeclaration(line, lineNumber) {
  if (/\{$/.test(line)) {
    return fail(
      'import/state-unsupported-composite',
      `Composite state on line ${lineNumber} has no lifecycle equivalent; Archify does not flatten nested states because the flattening would invent topology.`,
      {
        line: lineNumber,
        construct: 'composite state',
        evidence: { line },
        supportedFixes: [`replace the composite state on line ${lineNumber} with flat states, or import the inner region as its own diagram`],
      },
    );
  }

  const annotated = line.match(/^state\s+(\S+)\s*<<\s*([a-zA-Z]+)\s*>>$/);
  if (annotated) {
    const [, rawId, annotation] = annotated;
    const id = checkId(rawId, lineNumber);
    if (!id.ok) return id;
    if (annotation === 'choice') return { ok: true, id: id.id, choice: true };
    if (annotation === 'fork' || annotation === 'join') {
      return fail(
        'import/state-unsupported-fork-join',
        `The <<${annotation}>> pseudo-state on line ${lineNumber} expresses concurrency, which the Archify lifecycle vocabulary does not model.`,
        {
          line: lineNumber,
          construct: `<<${annotation}>>`,
          evidence: { annotation, line },
          supportedFixes: [`remove the <<${annotation}>> state on line ${lineNumber} and connect its branches directly, or import each concurrent branch as its own diagram`],
        },
      );
    }
    return fail(
      'import/state-unsupported-annotation',
      `The <<${annotation}>> annotation on line ${lineNumber} is outside the imported subset; only <<choice>> is mapped.`,
      {
        line: lineNumber,
        construct: `<<${annotation}>>`,
        evidence: { annotation, line },
        supportedFixes: [`remove the <<${annotation}>> annotation on line ${lineNumber}, or replace it with <<choice>>`],
      },
    );
  }

  if (/^state\s+"/.test(line)) {
    const aliased = line.match(/^state\s+"([^"]*)"\s+as\s+(\S+)$/);
    if (!aliased) {
      const quotes = (line.match(/"/g) || []).length;
      if (quotes < 2) {
        return fail('import/state-unclosed-quote', `The quoted description on line ${lineNumber} is never closed.`, {
          line: lineNumber,
          construct: 'quoted description',
          evidence: { line },
          supportedFixes: [`close the quoted description on line ${lineNumber} with a matching double quote`],
        });
      }
      return fail('import/state-malformed-declaration', `Line ${lineNumber} is not a supported state declaration: "${line}".`, {
        line: lineNumber,
        construct: 'state declaration',
        evidence: { line },
        supportedFixes: [`write the declaration on line ${lineNumber} as: state "description" as id`],
      });
    }
    const id = checkId(aliased[2], lineNumber);
    if (!id.ok) return id;
    const label = safeText(aliased[1], { line: lineNumber, field: `description of state "${aliased[2]}"` });
    if (!label.ok) return label;
    return { ok: true, id: id.id, label: label.text };
  }

  const bare = line.match(/^state\s+(\S+)$/);
  if (bare) {
    const id = checkId(bare[1], lineNumber);
    if (!id.ok) return id;
    return { ok: true, id: id.id };
  }

  return fail('import/state-malformed-declaration', `Line ${lineNumber} is not a supported state declaration: "${line}".`, {
    line: lineNumber,
    construct: 'state declaration',
    evidence: { line },
    supportedFixes: [`write the declaration on line ${lineNumber} as: state "description" as id, state id, or state id <<choice>>`],
  });
}

function parseTransition(line, lineNumber) {
  const parts = line.split('-->');
  if (parts.length !== 2) {
    return fail('import/state-malformed-transition', `Line ${lineNumber} chains more than one "-->"; Mermaid state transitions connect exactly two states.`, {
      line: lineNumber,
      construct: 'transition',
      evidence: { line, arrows: parts.length - 1 },
      supportedFixes: [`split line ${lineNumber} into one "source --> target" statement per transition`],
    });
  }
  const from = parts[0].trim();
  const remainder = parts[1].trim();
  const separator = remainder.indexOf(':');
  const rawTarget = (separator === -1 ? remainder : remainder.slice(0, separator)).trim();
  const rawLabel = separator === -1 ? '' : remainder.slice(separator + 1).trim();

  if (!from || !rawTarget) {
    return fail('import/state-malformed-transition', `Line ${lineNumber} is missing the ${from ? 'target' : 'source'} of the transition: "${line}".`, {
      line: lineNumber,
      construct: 'transition',
      evidence: { line, missing: from ? 'target' : 'source' },
      supportedFixes: [`write line ${lineNumber} as "source --> target" with an optional ": guard" label`],
    });
  }

  for (const endpoint of [from, rawTarget]) {
    if (endpoint === '[*]') continue;
    const id = checkId(endpoint, lineNumber);
    if (!id.ok) return id;
  }

  let label;
  if (separator !== -1) {
    const checked = safeText(rawLabel, { line: lineNumber, field: `label of transition "${from} --> ${rawTarget}"` });
    if (!checked.ok) return checked;
    if (textUnits(checked.text) > MAX_TRANSITION_LABEL_UNITS) {
      return fail(
        'import/state-transition-label-too-long',
        `The transition label on line ${lineNumber} needs ${textUnits(checked.text)} text units; the lifecycle corridors carry at most ${MAX_TRANSITION_LABEL_UNITS}.`,
        {
          line: lineNumber,
          construct: 'transition label',
          evidence: { label: checked.text, units: textUnits(checked.text), maxUnits: MAX_TRANSITION_LABEL_UNITS },
          supportedFixes: [`shorten the transition label on line ${lineNumber} to ${MAX_TRANSITION_LABEL_UNITS} text units or fewer`],
        },
      );
    }
    label = checked.text;
  }

  return { ok: true, from, to: rawTarget, label };
}

function parseNote(line, lineNumber, lines, nextIndex, contentAt) {
  if (/^note\s+"/.test(line)) {
    return fail(
      'import/state-unsupported-floating-note',
      `The floating note on line ${lineNumber} is not attached to a state; Archify carries notes as state context only.`,
      {
        line: lineNumber,
        construct: 'floating note',
        evidence: { line },
        supportedFixes: [`attach the note on line ${lineNumber} to a state with "note right of <state>"`],
      },
    );
  }

  const head = line.match(/^note\s+(left|right)\s+of\s+([^\s:]+)\s*(?::\s*(.*))?$/);
  if (!head) {
    return fail('import/state-malformed-note', `Line ${lineNumber} is not a supported note: "${line}".`, {
      line: lineNumber,
      construct: 'note',
      evidence: { line },
      supportedFixes: [`write the note on line ${lineNumber} as "note right of <state>: text"`],
    });
  }

  const target = checkId(head[2], lineNumber);
  if (!target.ok) return target;

  if (head[3] !== undefined && head[3] !== '') {
    const text = safeText(head[3], { line: lineNumber, field: `note on state "${target.id}"` });
    if (!text.ok) return text;
    return { ok: true, note: { target: target.id, text: text.text, line: lineNumber }, nextIndex };
  }

  const body = [];
  let index = nextIndex;
  while (index < lines.length) {
    const current = contentAt(index);
    index += 1;
    if (current === 'end note') {
      const text = safeText(body.join(' '), { line: lineNumber, field: `note on state "${target.id}"` });
      if (!text.ok) return text;
      return { ok: true, note: { target: target.id, text: text.text, line: lineNumber }, nextIndex: index };
    }
    body.push(current);
  }

  return fail('import/state-unterminated-note', `The note opened on line ${lineNumber} is never closed with "end note".`, {
    line: lineNumber,
    construct: 'note',
    evidence: { openedAtLine: lineNumber, line },
    supportedFixes: [`close the note opened on line ${lineNumber} with an "end note" line`],
  });
}

// --- Lifecycle model -----------------------------------------------------

function resolveModel(model, options) {
  const outcomes = options.outcomes instanceof Map ? options.outcomes : new Map();

  for (const note of model.notes) {
    const state = model.states.get(note.target);
    if (!state) {
      return fail('import/state-unknown-note-target', `The note on line ${note.line} points at unknown state "${note.target}".`, {
        line: note.line,
        construct: 'note',
        evidence: { state: note.target },
        supportedFixes: [`declare state "${note.target}" before the note on line ${note.line}, or correct the state name`],
      });
    }
    if (state.sublabel) {
      return fail('import/state-duplicate-note', `State "${note.target}" already carries context text; the note on line ${note.line} would replace it.`, {
        line: note.line,
        construct: 'note',
        evidence: { state: note.target, existing: state.sublabel, incoming: note.text },
        supportedFixes: [`keep one note or one "${note.target} : description" line, not both`],
      });
    }
    state.sublabel = note.text;
  }

  for (const [id] of outcomes) {
    if (model.states.has(id)) continue;
    return fail('import/state-unknown-outcome-target', `Outcome kind requested for unknown state "${id}".`, {
      construct: 'outcome override',
      evidence: { state: id, states: [...model.states.keys()] },
      supportedFixes: [`use one of the imported state ids: ${[...model.states.keys()].join(', ')}`],
    });
  }

  if (model.initial.length === 0) {
    return fail('import/state-missing-initial', 'The diagram never marks an initial state with "[*] --> <state>".', {
      construct: '[*]',
      evidence: { states: [...model.states.keys()] },
      supportedFixes: ['add a "[*] --> <state>" line so the lifecycle has one entry phase'],
    });
  }
  if (model.initial.length > 1) {
    return fail(
      'import/state-multiple-initial',
      `The diagram marks ${model.initial.length} initial states (lines ${model.initial.map((entry) => entry.line).join(', ')}); an Archify lifecycle has exactly one entry phase.`,
      {
        line: model.initial[1].line,
        construct: '[*]',
        evidence: { states: model.initial.map((entry) => entry.id), lines: model.initial.map((entry) => entry.line) },
        supportedFixes: ['keep one "[*] --> <state>" line and import the other entry points as separate diagrams'],
      },
    );
  }
  if (model.states.size < 2) {
    return fail('import/state-too-few-states', `The diagram declares ${model.states.size} state(s); an Archify lifecycle needs at least 2.`, {
      construct: 'states',
      evidence: { states: [...model.states.keys()] },
      supportedFixes: ['declare at least two states before importing'],
    });
  }
  if (model.states.size > STATE_MAX) {
    return fail(
      'import/state-capacity-exceeded',
      `The diagram declares ${model.states.size} states; the lifecycle bands hold at most ${STATE_MAX} (${SPINE_MAX} phases, ${EVENT_MAX} interruptions, ${TERMINAL_MAX} outcomes).`,
      {
        construct: 'states',
        evidence: { band: 'diagram', capacity: STATE_MAX, count: model.states.size, states: [...model.states.keys()] },
        supportedFixes: [`split the diagram into lifecycles of at most ${STATE_MAX} states before importing`],
      },
    );
  }

  return { ok: true, outcomes };
}

// The spine is the longest simple path from the single initial state,
// resolving ties by declaration order and stopping at the phase-band width.
function spineFor(model) {
  const adjacency = new Map([...model.states.keys()].map((id) => [id, []]));
  for (const transition of model.transitions) adjacency.get(transition.from).push(transition.to);

  let best = [];
  const walk = (id, path, seen) => {
    if (path.length > best.length) best = [...path];
    if (path.length >= SPINE_MAX) return;
    for (const next of adjacency.get(id) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      path.push(next);
      walk(next, path, seen);
      path.pop();
      seen.delete(next);
    }
  };
  const start = model.initial[0].id;
  walk(start, [start], new Set([start]));
  return best;
}

function kindFor(state, { startId, terminalIds, outcomes }) {
  if (state.choice) return 'decision';
  if (state.id === startId) return 'start';
  if (terminalIds.has(state.id)) return outcomes.get(state.id) || 'neutral';
  return 'active';
}

function placeStates(model, outcomes) {
  const startId = model.initial[0].id;
  const terminalIds = new Set(model.terminal.map((entry) => entry.id));
  const spine = spineFor(model);
  const spineSet = new Set(spine);

  const rest = [...model.states.values()].filter((state) => !spineSet.has(state.id));
  const events = rest.filter((state) => !terminalIds.has(state.id));
  const terminals = rest.filter((state) => terminalIds.has(state.id));

  for (const [band, entries, capacity] of [['events', events, EVENT_MAX], ['terminal', terminals, TERMINAL_MAX]]) {
    if (entries.length <= capacity) continue;
    return fail(
      'import/state-capacity-exceeded',
      `${entries.length} states map to the ${band} band, which holds ${capacity}: ${entries.map((state) => state.id).join(', ')}.`,
      {
        line: entries[capacity].line,
        construct: `${band} band`,
        evidence: { band, capacity, count: entries.length, states: entries.map((state) => state.id) },
        supportedFixes: [
          `keep at most ${capacity} ${band === 'terminal' ? 'terminal outcomes' : 'off-rail states'} in one lifecycle`,
          'split the state diagram into several lifecycles and import each one',
        ],
      },
    );
  }

  const placements = [];
  const push = (state, bandKey, col, step) => {
    const band = BANDS[bandKey];
    const cx = band.xs[col];
    placements.push({
      state,
      bandKey,
      lane: band.lane,
      col,
      step,
      rect: {
        id: state.id,
        x: cx - STATE_WIDTH / 2,
        y: band.y,
        width: STATE_WIDTH,
        height: band.height,
        cx,
        cy: band.y + band.height / 2,
      },
    });
  };

  spine.forEach((id, position) => push(model.states.get(id), 'phase', position, String(position + 1).padStart(2, '0')));
  events.forEach((state, position) => push(state, 'event', position));
  terminals.forEach((state, position) => push(state, 'outcome', position));

  for (const placement of placements) {
    const state = placement.state;
    const label = state.label ?? state.id;
    if (textUnits(label) > MAX_LABEL_UNITS) {
      return fail(
        'import/state-label-too-long',
        `State "${state.id}" renders the label "${label}" at ${textUnits(label)} text units; a lifecycle state fits ${MAX_LABEL_UNITS}.`,
        {
          line: state.line,
          construct: 'state label',
          evidence: { state: state.id, label, units: textUnits(label), maxUnits: MAX_LABEL_UNITS },
          supportedFixes: [`shorten the description of "${state.id}" to ${MAX_LABEL_UNITS} text units or fewer, for example with: state "short name" as ${state.id}`],
        },
      );
    }
    if (state.sublabel && textUnits(state.sublabel) > MAX_SUBLABEL_UNITS) {
      return fail(
        'import/state-note-too-long',
        `The context text on state "${state.id}" is ${textUnits(state.sublabel)} text units; a lifecycle state fits ${MAX_SUBLABEL_UNITS}.`,
        {
          line: state.line,
          construct: 'state context',
          evidence: { state: state.id, text: state.sublabel, units: textUnits(state.sublabel), maxUnits: MAX_SUBLABEL_UNITS },
          supportedFixes: [`shorten the note or description on "${state.id}" to ${MAX_SUBLABEL_UNITS} text units or fewer`],
        },
      );
    }
    placement.label = label;
    placement.type = kindFor(state, { startId, terminalIds, outcomes });
  }

  return { ok: true, placements, spine, startId, terminalIds };
}

// --- Routing -------------------------------------------------------------

function segmentsOf(points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ start: points[index], end: points[index + 1] });
  }
  return segments;
}

function collinearOverlap(a, b) {
  const vertical = (segment) => segment.start[0] === segment.end[0];
  if (vertical(a) !== vertical(b)) return 0;
  const axis = vertical(a) ? 0 : 1;
  if (a.start[axis] !== b.start[axis]) return 0;
  const span = vertical(a) ? 1 : 0;
  const aRange = [Math.min(a.start[span], a.end[span]), Math.max(a.start[span], a.end[span])];
  const bRange = [Math.min(b.start[span], b.end[span]), Math.max(b.start[span], b.end[span])];
  return Math.max(0, Math.min(aRange[1], bRange[1]) - Math.max(aRange[0], bRange[0]));
}

// A proper crossing is an interior intersection of a horizontal and a vertical
// segment. Touching endpoints are junctions, not crossings, so the comparison
// stays strict on both axes.
function properCrossing(a, b) {
  const horizontal = (segment) => segment.start[1] === segment.end[1];
  if (horizontal(a) === horizontal(b)) return false;
  const [h, v] = horizontal(a) ? [a, b] : [b, a];
  const hRange = [Math.min(h.start[0], h.end[0]), Math.max(h.start[0], h.end[0])];
  const vRange = [Math.min(v.start[1], v.end[1]), Math.max(v.start[1], v.end[1])];
  return v.start[0] > hRange[0] && v.start[0] < hRange[1]
    && h.start[1] > vRange[0] && h.start[1] < vRange[1];
}

// Cost model for one candidate route. Collinear overlap makes two transitions
// look like one line, so it is the heaviest term; crossings are next; bends and
// length only break ties between otherwise equal routes.
function routeCost(points, placedSegments) {
  const segments = segmentsOf(points);
  let cost = 0;
  for (const segment of segments) {
    for (const other of placedSegments) {
      const overlap = collinearOverlap(segment, other);
      // The artifact checker reports two unrelated transitions that share at
      // least 8px of corridor, so the model steps at the same threshold.
      cost += overlap >= 8 ? overlap + 25 : overlap;
      if (properCrossing(segment, other)) cost += 25;
    }
    cost += 0.01 * (Math.abs(segment.end[0] - segment.start[0]) + Math.abs(segment.end[1] - segment.start[1]));
  }
  return cost + 4 * (segments.length - 1);
}

function routeCandidates(from, to) {
  const candidates = [];
  const add = (fromSide, toSide, via) => candidates.push({ fromSide, toSide, via });

  if (from.cy === to.cy) {
    const forward = to.cx > from.cx;
    add(forward ? 'right' : 'left', forward ? 'left' : 'right', []);
  }
  if (from.cx === to.cx) {
    const downward = to.cy > from.cy;
    add(downward ? 'bottom' : 'top', downward ? 'top' : 'bottom', []);
  }

  for (const y of HORIZONTAL_CORRIDORS) {
    add('bottom', 'top', [[from.cx, y], [to.cx, y]]);
    add('top', 'bottom', [[from.cx, y], [to.cx, y]]);
    add('bottom', 'bottom', [[from.cx, y], [to.cx, y]]);
    add('top', 'top', [[from.cx, y], [to.cx, y]]);
  }

  for (const x of VERTICAL_CORRIDORS) {
    for (const fromSide of ['right', 'left']) {
      for (const toSide of ['left', 'right']) add(fromSide, toSide, [[x, from.cy], [x, to.cy]]);
    }
  }

  for (const x of VERTICAL_CORRIDORS) {
    for (const y of HORIZONTAL_CORRIDORS) {
      for (const fromSide of ['right', 'left']) {
        for (const toSide of ['top', 'bottom']) add(fromSide, toSide, [[x, from.cy], [x, y], [to.cx, y]]);
      }
      for (const fromSide of ['bottom', 'top']) {
        for (const toSide of ['right', 'left']) add(fromSide, toSide, [[from.cx, y], [x, y], [x, to.cy]]);
      }
    }
  }

  return candidates;
}

function routePoints(candidate, from, to) {
  const points = [anchor(from, candidate.fromSide), ...candidate.via.map((point) => [...point]), anchor(to, candidate.toSide)];
  const deduped = [points[0]];
  for (const point of points.slice(1)) {
    const previous = deduped[deduped.length - 1];
    if (previous[0] === point[0] && previous[1] === point[1]) continue;
    deduped.push(point);
  }
  return deduped;
}

function routeIsValid(points, candidate, obstacles) {
  if (points.length < 2) return false;
  for (const point of points) {
    if (point[0] < ROUTE_BOUNDS.minX || point[0] > ROUTE_BOUNDS.maxX) return false;
    if (point[1] < ROUTE_BOUNDS.minY || point[1] > ROUTE_BOUNDS.maxY) return false;
  }
  for (const segment of segmentsOf(points)) {
    const horizontal = segment.start[1] === segment.end[1];
    const vertical = segment.start[0] === segment.end[0];
    if (!horizontal && !vertical) return false;
  }
  if (!routeHonorsEndpointSides(points, candidate.fromSide, candidate.toSide)) return false;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) < MIN_ENDPOINT_DISTANCE) return false;
  for (const obstacle of obstacles) {
    for (const segment of segmentsOf(points)) {
      if (segmentIntersectsRect(segment, obstacle, 2)) return false;
    }
  }
  return true;
}

function routeTransitions(model, placements) {
  const rects = new Map(placements.map((placement) => [placement.state.id, placement.rect]));
  const routed = [];
  const placedSegments = [];

  for (const [index, transition] of model.transitions.entries()) {
    const from = rects.get(transition.from);
    const to = rects.get(transition.to);
    const obstacles = placements
      .map((placement) => placement.rect)
      .filter((rect) => rect.id !== transition.from && rect.id !== transition.to);

    let selected = null;
    let bestCost = Infinity;
    for (const candidate of routeCandidates(from, to)) {
      const points = routePoints(candidate, from, to);
      if (!routeIsValid(points, candidate, obstacles)) continue;
      const cost = routeCost(points, placedSegments);
      if (cost >= bestCost) continue;
      selected = { candidate, points };
      bestCost = cost;
    }

    if (!selected) {
      return fail(
        'import/state-route-unplaceable',
        `Transition "${transition.from} --> ${transition.to}" on line ${transition.line} cannot be routed through the lifecycle bands without crossing another state.`,
        {
          line: transition.line,
          construct: 'transition',
          evidence: { from: transition.from, to: transition.to },
          supportedFixes: [
            'reduce the number of off-rail states so the lifecycle bands leave a free corridor',
            'split the state diagram into several lifecycles and import each one',
          ],
        },
      );
    }

    placedSegments.push(...segmentsOf(selected.points));
    routed.push({
      transition,
      index,
      points: selected.points,
      candidate: selected.candidate,
    });
  }

  return { ok: true, routed };
}

function labelRect(label, point) {
  const width = Math.max(32, textUnits(label) * LABEL_UNIT_WIDTH + LABEL_PADDING);
  return {
    x: point[0] - width / 2,
    y: point[1] - LABEL_BASELINE_OFFSET,
    width,
    height: LABEL_HEIGHT,
  };
}

function placeLabels(routed, placements) {
  const stateRects = placements.map((placement) => placement.rect);
  const placedLabels = [];

  for (const entry of routed) {
    const label = entry.transition.label;
    if (!label) continue;
    // A label may sit on its own route — that is how the renderer reads it —
    // but crossing another transition's route is what the artifact checker
    // reports. First pass keeps every other route clear; the second pass falls
    // back to the renderer's own requirement of clearing states and labels.
    const routeSegments = routed.filter((other) => other !== entry).flatMap((other) => segmentsOf(other.points));
    let placed = null;
    for (const routeAware of [true, false]) {
      for (const [labelDx, labelDy] of LABEL_OFFSETS) {
        const point = labelPoint({ labelDx, labelDy }, entry.points);
        const rect = labelRect(label, point);
        if (rect.x < 16 || rect.x + rect.width > VIEW_BOX[0] - 16) continue;
        if (rect.y < 40 || rect.y + rect.height > VIEW_BOX[1] - 96) continue;
        if (stateRects.some((state) => rectsOverlap(rect, state, -2))) continue;
        if (placedLabels.some((other) => rectsOverlap(rect, other, -2))) continue;
        if (routeAware && routeSegments.some((segment) => segmentIntersectsRect(segment, rect, 4))) continue;
        placed = { labelDx, labelDy, rect };
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      return fail(
        'import/state-label-unplaceable',
        `The label "${label}" on line ${entry.transition.line} cannot be placed clear of the lifecycle states and the other transition labels.`,
        {
          line: entry.transition.line,
          construct: 'transition label',
          evidence: { label, from: entry.transition.from, to: entry.transition.to },
          supportedFixes: [
            `shorten the guard label on line ${entry.transition.line}`,
            'move the guard text into a state description so the corridor stays readable',
          ],
        },
      );
    }
    placedLabels.push(placed.rect);
    entry.labelDx = placed.labelDx;
    entry.labelDy = placed.labelDy;
  }

  return { ok: true };
}

// --- IR assembly ---------------------------------------------------------

function buildIr(model, placed, routed, options) {
  const lanes = [];
  for (const lane of ['main', 'events', 'terminal']) {
    if (!placed.placements.some((placement) => placement.lane === lane)) continue;
    lanes.push({ id: lane, label: LANE_LABELS[lane] });
  }

  const states = placed.placements.map((placement) => ({
    id: placement.state.id,
    type: placement.type,
    label: placement.label,
    ...(placement.state.sublabel ? { sublabel: placement.state.sublabel } : {}),
    lane: placement.lane,
    col: placement.col,
    ...(placement.step ? { step: placement.step } : {}),
    ...(placement.bandKey === 'event' ? { width: STATE_WIDTH } : {}),
  }));

  const transitions = routed.map((entry, position) => ({
    id: `t${String(position + 1).padStart(2, '0')}`,
    from: entry.transition.from,
    to: entry.transition.to,
    ...(entry.transition.label ? { label: entry.transition.label } : {}),
    fromSide: entry.candidate.fromSide,
    toSide: entry.candidate.toSide,
    ...(entry.candidate.via.length ? { via: entry.candidate.via } : { route: 'straight' }),
    ...(entry.labelDx ? { labelDx: entry.labelDx } : {}),
    ...(entry.labelDy ? { labelDy: entry.labelDy } : {}),
  }));

  return {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: {
      title: options.title || model.title || DEFAULT_TITLE,
      ...(options.output ? { output: options.output } : {}),
      viewBox: [...VIEW_BOX],
      quality_profile: 'standard',
    },
    lanes,
    states,
    transitions,
  };
}

// --- Public API ----------------------------------------------------------

/**
 * Parse Mermaid state-diagram source into typed Archify lifecycle IR.
 *
 * @param {string} source Mermaid `stateDiagram` / `stateDiagram-v2` text.
 * @param {{title?: string, output?: string, outcomes?: Map<string, 'success'|'failure'>}} [options]
 * @returns {{ok: true, ir: object, model: object} | {ok: false, diagnostics: object[]}}
 */
export function parseStateDiagram(source, options = {}) {
  const parsed = parseSource(source);
  if (!parsed.ok) return parsed;

  const resolved = resolveModel(parsed.model, options);
  if (!resolved.ok) return resolved;

  const placed = placeStates(parsed.model, resolved.outcomes);
  if (!placed.ok) return placed;

  const routes = routeTransitions(parsed.model, placed.placements);
  if (!routes.ok) return routes;

  const labels = placeLabels(routes.routed, placed.placements);
  if (!labels.ok) return labels;

  return {
    ok: true,
    ir: buildIr(parsed.model, placed, routes.routed, options),
    model: { ...parsed.model, startId: placed.startId, terminalIds: [...placed.terminalIds], spine: placed.spine },
  };
}

/**
 * Parse Mermaid state-diagram source and return the IR plus a machine-readable
 * import receipt. This is the entry point used by `archify import state`.
 */
export function importStateDiagram(source, options = {}) {
  const result = parseStateDiagram(source, options);
  if (!result.ok) return result;

  return {
    ok: true,
    ir: result.ir,
    receipt: {
      schemaVersion: 1,
      ok: true,
      command: 'import',
      source: 'mermaid-state',
      target: 'lifecycle',
      states: result.ir.states.length,
      transitions: result.ir.transitions.length,
      lanes: result.ir.lanes.length,
      startStates: [result.model.startId],
      terminalStates: result.model.terminalIds,
      ignoredDirectives: [...result.model.ignoredDirectives],
    },
  };
}
