/**
 * Mermaid flowchart/graph importer for Archify.
 *
 * Parses a documented subset of Mermaid `flowchart` / `graph` syntax and
 * produces typed Archify architecture IR.  The importer treats Mermaid as
 * source topology — nodes, edges, labels, and subgraph grouping — and never
 * copies Mermaid layout, styling, or class definitions.
 *
 * Unsupported, ambiguous, or malformed syntax exits with a stable named
 * diagnostic and source location; no node or edge is silently discarded.
 */

// The label-width measurement must match the architecture validator's
// (render-architecture.mjs) so imported cells always fit their labels.
import { textUnits } from '../renderers/shared/utils.mjs';

// --- Types ---------------------------------------------------------------

const NODE_SHAPES = [
  { open: '((', close: '))', type: 'cloud' },
  { open: '[(', close: ')]', type: 'database' },
  { open: '(', close: ')', type: 'backend' },
  { open: '[', close: ']', type: 'backend' },
  { open: '{', close: '}', type: 'security' },
  { open: '>', close: ']', type: 'external' },
  { open: '/', close: '\\', type: 'backend' },
];

const EDGE_PATTERNS = [
  // Mermaid link length is controlled by adding extra repeated characters;
  // the arrowhead at the end stays a single ">".  "--->" and "---->" are
  // still directed "solid" edges, and the same for "===>"/"====>" and
  // dotted "-...->" variants.
  { re: /^==[=]*>/, variant: 'emphasis' },
  { re: /^-\.+->/, variant: 'dashed' },
  { re: /^--[-]*>/, variant: 'solid' },
];

const UNSUPPORTED_KEYWORDS = new Set([
  'classDef', 'class', 'style', 'linkStyle', 'click',
  'interaction', 'default', '%%%', 'accDescr', 'accTitle',
  'flowchart-elk', 'elk',
]);

const LAYOUT = {
  CELL_W: 140,
  CELL_H: 60,
  GAP_X: 80,
  GAP_Y: 80,
  ORIGIN_X: 40,
  ORIGIN_Y: 40,
};

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

// Diagnostics produced while parsing a statement carry columns relative to
// the trimmed line text; shift them back into the source line's coordinates
// so reported locations match the file as written.
function shiftDiagColumns(diagnostic, offset) {
  if (offset === 0) return diagnostic;
  return {
    ...diagnostic,
    subject: { ...diagnostic.subject, column: diagnostic.subject.column + offset },
    evidence: {
      ...diagnostic.evidence,
      source: { ...diagnostic.evidence.source, column: diagnostic.evidence.source.column + offset },
    },
  };
}

// Characters disallowed in XML 1.0 content (complement of #x9 | #xA | #xD |
// [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]).
const XML_INVALID_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uD800-\uDFFF\uFFFE\uFFFF]/u;

function isBlank(text) {
  return /^\s*$/u.test(text);
}

// Validate a piece of user-authored text before it becomes IR. Returns a
// diagnostic if the text is blank/whitespace-only or contains an XML 1.0
// disallowed character; otherwise returns null so the caller can use the text.
function validateLabelText(text, lineNo, startColumn, { code, kind, context }) {
  if (isBlank(text)) {
    return diag(
      code,
      `${kind} has no representable text; ${context} must contain at least one non-whitespace character.`,
      lineNo, startColumn,
      {
        supportedFixes: [`provide a non-empty ${context}`],
      },
    );
  }
  const match = XML_INVALID_CHAR_RE.exec(text);
  if (match) {
    const cp = match[0].codePointAt(0).toString(16).toUpperCase();
    const display = cp.length > 4 ? `U+${cp}` : `U+${cp.padStart(4, '0')}`;
    return diag(
      'import/xml-disallowed-character',
      `${kind} contains ${display}, a character that cannot be represented in the delivered SVG; remove or replace it before importing.`,
      lineNo, startColumn + match.index,
      {
        supportedFixes: [`replace ${display} in the ${context} with a representable character`],
      },
    );
  }
  return null;
}

// A whitespace-delimited operator run ("--", "---", "-.-", "===", "~~~",
// "<--", "o--", …) inside a labeled-arrow text means the match swallowed a
// second statement: "A -- x --- B --> C" would otherwise import as A→C
// labeled "x --- B", silently dropping node B and the open link.  The run
// covers every Mermaid link shaft family — dash ("--"/"---"), dotted
// ("-.-"), thick ("=="), and invisible ("~~"), plus the back-arrow and
// circle/cross endpoint prefixes ("<--", "o--", "x--") — and is anchored at
// the start of the label or after whitespace so embedded hyphens
// ("read-only") and version dots ("v1.2") stay valid; single spaced dashes
// ("a - b") are not operator runs and remain label text.
const EMBEDDED_EDGE_OPERATOR_RE = /(^|\s)([<ox]?-{2,}|-\.+-|={2,}|~{2,})/;

// Validate a labeled-arrow text for an embedded edge-operator run.  Returns
// a diagnostic if found; otherwise null so the caller can use the label.
function checkEdgeLabelOperators(text, lineNo, startColumn) {
  const match = EMBEDDED_EDGE_OPERATOR_RE.exec(text);
  if (!match) return null;
  return diag(
    'import/flowchart-edge-label-operator',
    `Edge label "${text}" contains "${match[2]}", which reads as an edge operator: the text after it would be imported as part of the label and the node it names would be dropped.`,
    lineNo, startColumn + match.index + match[1].length,
    {
      supportedFixes: ['split the statement at the embedded operator onto its own line, or remove the operator run from the label text'],
    },
  );
}

// --- Layout helpers ------------------------------------------------------

// The architecture renderer measures connection labels with this width so the
// SVG text mask, auto canvas, and layout reports agree. Keep the importer in
// sync so it can pre-position labels that would otherwise clip the left edge.
function connectionLabelWidth(label) {
  return Math.max(30, textUnits(label) * 4.8 + 10);
}

function portCenter(pos, side) {
  const [x, y] = pos.pos;
  const [w, h] = pos.size;
  if (side === 'left') return [x, y + h / 2];
  if (side === 'right') return [x + w, y + h / 2];
  if (side === 'top') return [x + w / 2, y];
  if (side === 'bottom') return [x + w / 2, y + h];
  return [x + w / 2, y + h / 2];
}

function defaultEndpointSides(fromPos, toPos, isHorizontal) {
  if (isHorizontal) {
    return fromPos.pos[0] < toPos.pos[0]
      ? { fromSide: 'right', toSide: 'left' }
      : { fromSide: 'left', toSide: 'right' };
  }
  return fromPos.pos[1] < toPos.pos[1]
    ? { fromSide: 'bottom', toSide: 'top' }
    : { fromSide: 'top', toSide: 'bottom' };
}

// The architecture viewBox is anchored at (0, 0) and only expands to the right
// and bottom. A connection label whose measured rect would start before x = 0
// therefore fails the label-canvas-containment check. Pre-position such labels
// with an explicit labelAt so their left edge stays inside the canvas; the auto
// viewBox will expand right to contain the remainder of the label.
function safeLabelAt(label, fromPos, toPos, isHorizontal, labelDy) {
  const { fromSide, toSide } = defaultEndpointSides(fromPos, toPos, isHorizontal);
  const start = portCenter(fromPos, fromSide);
  const end = portCenter(toPos, toSide);
  const midX = (start[0] + end[0]) / 2;
  const width = connectionLabelWidth(label);
  const leftEdge = midX - width / 2;
  if (leftEdge >= 0) return null;
  const sourcePortY = start[1];
  const ly = sourcePortY - 10 + (labelDy || 0);
  // Shift the label center right until the left edge has a 2px safety margin.
  const safeX = width / 2 + 2;
  return [Math.round(safeX), Math.round(ly)];
}

// The renderer's label rect for an anchor [lx, ly] is [lx - w/2, ly - 10, w, 14].
// The importer mirrors it to detect anchors that still collide with a cell.
function labelRectHitsComponent([lx, ly], width, positions) {
  const [rx, rr, ry, rb] = [lx - width / 2, lx + width / 2, ly - 10, ly + 4];
  for (const p of positions.values()) {
    const [cx, cy] = p.pos;
    const [cw, ch] = p.size;
    if (rx < cx + cw && rr > cx && ry < cy + ch && rb > cy) return true;
  }
  return false;
}

// Clear-lane anchor below the upper endpoint's row: same-row pairs drop below
// both cells; cross-row pairs drop into the inter-row lane below the upper
// cell, which holds route segments but no components in the layered layout.
function laneBelowRow(fromPos, toPos) {
  const [fy, ty] = [fromPos.pos[1], toPos.pos[1]];
  const [fb, tb] = [fy + fromPos.size[1], ty + toPos.size[1]];
  return fy === ty ? Math.max(fb, tb) : Math.min(fb, tb);
}

// --- Parser --------------------------------------------------------------

/**
 * Parse Mermaid flowchart source into Archify architecture IR.
 *
 * @param {string} source — Mermaid flowchart source text.
 * @returns {{ ok: true, ir: object } | { ok: false, diagnostics: array }}
 */
export function parseFlowchart(source) {
  const lines = source.split('\n');
  const diagnostics = [];

  let direction = null;
  let diagramType = null;
  const components = new Map();
  const connections = [];
  const boundaries = [];
  const subgraphStack = [];
  let subgraphCounter = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum += 1) {
    const rawLine = lines[lineNum];
    const line = rawLine.trim();
    const lineNo = lineNum + 1;
    // Diagnostics produced against `line` count columns from the trimmed
    // start; add this offset back so they point at the source line.
    const indent = rawLine.length - rawLine.trimStart().length;

    // Skip blank lines and comments.
    if (line === '' || line.startsWith('%%')) continue;

    // First non-comment, non-blank line must declare the diagram type.
    if (diagramType === null) {
      const decl = line.match(/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i);
      if (!decl) {
        diagnostics.push(diag(
          'import/flowchart-missing-declaration',
          'First non-comment line must declare "flowchart" or "graph" with a direction (TB, TD, BT, LR, RL).',
          lineNo, indent + 1,
          {
            supportedFixes: ['start the file with a line like "flowchart TD" or "graph LR"'],
          },
        ));
        return { ok: false, diagnostics };
      }
      diagramType = decl[1].toLowerCase();
      direction = decl[2].toUpperCase();
      // A remainder after the direction (Mermaid allows ";" as a statement
      // separator) would be silently dropped here — the declaration regex only
      // matches the "flowchart <direction>" prefix. Dropping it silently loses
      // topology, so reject the line unless only separators/whitespace remain.
      const remainder = line.slice(decl[0].length).replace(/[;\s]+/g, ' ').trim();
      if (remainder) {
        diagnostics.push(diag(
          'import/declaration-remainder',
          `The declaration line contains statements after the direction ("${remainder}"); the importer processes one statement per line, so this topology would be dropped.`,
          lineNo, decl[0].length + indent + 1,
          {
            supportedFixes: ['move each statement after "flowchart <direction>" onto its own line'],
          },
        ));
        return { ok: false, diagnostics };
      }
      continue;
    }

    // Check for unsupported keywords. A keyword only counts when it stands
    // alone — hyphenated node ids like "style-guide" or "click-tracker" begin
    // with a keyword-shaped prefix but are plain identifiers, so the match
    // must be followed by whitespace, a colon ("accTitle:"), or the line end.
    const keyword = line.match(/^([A-Za-z]+)(?=[\s:]|$)/);
    if (keyword && UNSUPPORTED_KEYWORDS.has(keyword[1])) {
      diagnostics.push(diag(
        `import/unsupported-keyword-${keyword[1].toLowerCase()}`,
        `Mermaid "${keyword[1]}" is not supported by the Archify flowchart importer. Styling and interaction directives are outside the supported subset.`,
        lineNo, indent + 1,
        {
          supportedFixes: [`remove the "${keyword[1]}" line; Archify does not import Mermaid styling or interaction directives`],
        },
      ));
      return { ok: false, diagnostics };
    }

    // The "direction" directive is only meaningful with per-region layout,
    // which the importer does not provide; accepting it would invent nodes.
    const dirDirective = line.match(/^direction\s+(TB|TD|BT|LR|RL)\b/i);
    if (dirDirective) {
      diagnostics.push(diag(
        'import/unsupported-direction-directive',
        'Mermaid "direction" is not supported by the Archify flowchart importer; the diagram-level direction applies to all regions.',
        lineNo, indent + 1,
        {
          supportedFixes: ['remove the "direction" line; declare the direction once on the first line, e.g. "flowchart TB"'],
        },
      ));
      return { ok: false, diagnostics };
    }

    // Subgraph start.
    const subgraphMatch = line.match(/^subgraph\s+(.+)$/i);
    if (subgraphMatch) {
      subgraphCounter += 1;
      // Mermaid subgraph declarations carry an optional authored id plus a
      // title: "subgraph Title", "subgraph id [Title]", or
      // 'subgraph id["Title"]'. Parse and store them separately: edges
      // reference the authored id, while the boundary label must be the human
      // title alone — keeping the raw "id [Title]" text as the label both
      // corrupted the emitted topology and hid the authored identity from
      // edge-endpoint resolution below.
      // A trailing ";" terminates the declaration in real-world sources —
      // strip it rather than absorbing it into the boundary title.
      const rest = subgraphMatch[1].replace(/[;\s]+$/, '');
      const restStart = subgraphMatch.index + subgraphMatch[0].indexOf(rest);
      let authoredId = null;
      let label = rest;
      let textStart = restStart;
      const idBracket = rest.match(/^(?:([^\[\]]+?)\s*)?\[(.*)\]$/);
      if (idBracket) {
        authoredId = (idBracket[1] ?? '').trim() || null;
        label = idBracket[2].replace(/^["']|["']$/g, '');
        const bracketOffset = idBracket[0].indexOf('[');
        textStart = restStart + bracketOffset + 1;
        if (idBracket[2].startsWith('"') || idBracket[2].startsWith("'")) {
          textStart += 1;
        }
      } else if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
        label = rest.slice(1, -1);
        textStart = restStart + 1;
      }
      const titleCheck = validateLabelText(
        label, lineNo, textStart + indent + 1,
        { code: 'import/subgraph-empty-title', kind: 'Subgraph title', context: 'boundary title' },
      );
      if (titleCheck) {
        diagnostics.push(titleCheck);
        return { ok: false, diagnostics };
      }
      const id = `sg${subgraphCounter}`;
      const boundary = { kind: 'region', label, wraps: [], authoredId };
      boundaries.push(boundary);
      subgraphStack.push({ id, boundary });
      continue;
    }

    // Subgraph end.
    if (line === 'end') {
      if (subgraphStack.length === 0) {
        diagnostics.push(diag(
          'import/flowchart-unbalanced-end',
          '"end" without a matching "subgraph" declaration.',
          lineNo, indent + 1,
          {
            supportedFixes: ['remove the extra "end" or add a matching "subgraph" before it'],
          },
        ));
        return { ok: false, diagnostics };
      }
      const closing = subgraphStack.pop();
      // A region that wrapped no nodes cannot be represented: the architecture
      // schema requires boundaries[].wraps minItems: 1, so emitting it would
      // produce IR that fails validation while the import reported ok.
      if (closing.boundary.wraps.length === 0) {
        diagnostics.push(diag(
          'import/empty-subgraph',
          `Subgraph "${closing.boundary.label}" contains no nodes; every region must wrap at least one component.`,
          lineNo, indent + 1,
          {
            supportedFixes: [`declare at least one node inside subgraph "${closing.boundary.label}" or remove the empty subgraph`],
          },
        ));
        return { ok: false, diagnostics };
      }
      continue;
    }

    // Parse statement: nodes and/or edges.
    const stmtResult = parseStatement(line, lineNo);
    if (!stmtResult.ok) {
      diagnostics.push(...stmtResult.diagnostics.map((d) => shiftDiagColumns(d, indent)));
      return { ok: false, diagnostics };
    }

    // Register components. A later explicit declaration refines an earlier
    // implicit one (Mermaid uses the latest text); two conflicting explicit
    // declarations are diagnosed instead of silently picking a winner.
    for (const comp of stmtResult.components) {
      const existing = components.get(comp.id);
      if (!existing) {
        components.set(comp.id, comp);
      } else if (comp.explicit && !existing.explicit) {
        existing.label = comp.label;
        existing.type = comp.type;
        existing.explicit = true;
      } else if (comp.explicit && existing.explicit
        && (comp.label !== existing.label || comp.type !== existing.type)) {
        diagnostics.push(diag(
          'import/flowchart-conflicting-node-declaration',
          `Node "${comp.id}" is declared twice with different explicit definitions ("${existing.label}" and "${comp.label}").`,
          lineNo, indent + 1,
          {
            supportedFixes: [`keep a single explicit declaration for node "${comp.id}" with the text it should have`],
          },
        ));
        return { ok: false, diagnostics };
      }
      // Track subgraph membership. Mermaid nodes belong to every enclosing
      // subgraph, so a node inside nested subgraphs is recorded in the wraps
      // list of each ancestor boundary; recording only the innermost region
      // would emit outer boundaries with empty wraps, which the architecture
      // schema rejects (boundaries[].wraps minItems: 1).
      for (const enclosing of subgraphStack) {
        if (!enclosing.boundary.wraps.includes(comp.id)) {
          enclosing.boundary.wraps.push(comp.id);
        }
      }
    }

    // Register connections.
    for (const conn of stmtResult.connections) {
      connections.push(conn);
    }
  }

  // Check for unclosed subgraphs.
  if (subgraphStack.length > 0) {
    const last = subgraphStack[subgraphStack.length - 1];
    diagnostics.push(diag(
      'import/flowchart-unclosed-subgraph',
      `Subgraph "${last.boundary.label}" was opened but never closed with "end".`,
      lines.length, 1,
      {
        supportedFixes: ['add an "end" line after the last statement in the subgraph'],
      },
    ));
    return { ok: false, diagnostics };
  }

  if (diagramType === null) {
    diagnostics.push(diag(
      'import/flowchart-empty-source',
      'No diagram declaration found in the source.',
      1, 1,
      {
        supportedFixes: ['start the file with a line like "flowchart TD"'],
      },
    ));
    return { ok: false, diagnostics };
  }

  // Build the final IR.
  const componentArray = [...components.values()];
  if (componentArray.length === 0) {
    diagnostics.push(diag(
      'import/flowchart-no-components',
      'The flowchart declares no nodes. At least one component is required.',
      1, 1,
      {
        supportedFixes: ['add at least one node definition, e.g. "A[Label]"'],
      },
    ));
    return { ok: false, diagnostics };
  }

  // Validate that all connection endpoints reference declared components.
  for (const conn of connections) {
    if (!components.has(conn.from)) {
      diagnostics.push(diag(
        'import/flowchart-undefined-source',
        `Edge references undefined source node "${conn.from}".`,
        1, 1,
        {
          supportedFixes: [`declare node "${conn.from}" before using it in an edge`],
        },
      ));
    }
    if (!components.has(conn.to)) {
      diagnostics.push(diag(
        'import/flowchart-undefined-target',
        `Edge references undefined target node "${conn.to}".`,
        1, 1,
        {
          supportedFixes: [`declare node "${conn.to}" before using it in an edge`],
        },
      ));
    }
  }

  // An edge endpoint that names a subgraph by its authored identity (id or
  // title) would otherwise be registered as a new implicit component above —
  // a fictitious service invented from the subgraph's name. Mermaid models
  // edges to groups; the architecture subset does not, so reject the edge
  // using only authored identities. The parser's internal synthetic ids
  // (sgN) never leave the parser and are NOT reserved, so an authored node
  // legitimately named "sg1" imports as an ordinary component. An endpoint
  // that is also an explicitly declared node keeps the node: the explicit
  // declaration is the authored identity there, not an invention.
  const subgraphIdentities = new Set();
  for (const boundary of boundaries) {
    subgraphIdentities.add(boundary.label);
    if (boundary.authoredId) subgraphIdentities.add(boundary.authoredId);
  }
  for (const conn of connections) {
    for (const endpoint of [conn.from, conn.to]) {
      const comp = components.get(endpoint);
      if (subgraphIdentities.has(endpoint) && !(comp && comp.explicit)) {
        diagnostics.push(diag(
          'import/edge-references-subgraph',
          `Edge endpoint "${endpoint}" is a subgraph; edges between subgraphs are outside the supported subset.`,
          conn.line ?? 1, 1,
          {
            supportedFixes: [`connect the member nodes of subgraph "${endpoint}" directly instead of the subgraph itself`],
          },
        ));
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  // Auto-layout: assign positions using a layered BFS from source nodes.
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const mirrored = direction === 'RL' || direction === 'BT';
  const positions = computeLayout(componentArray, connections, direction);
  const minRowTop = Math.min(...[...positions.values()].map((p) => p.pos[1]));
  // Staggered lane pins: wide labels that cannot stay on their route drop
  // into the clear lane below the upper endpoint's row; each 18px slot is
  // taken once so several labels never share one rect.
  const laneUse = new Map();

  const ir = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Imported Flowchart',
      output: 'imported-flowchart.html',
    },
    components: componentArray.map((c) => {
      const obj = { id: c.id, type: c.type, label: c.label };
      if (c.sublabel) obj.sublabel = c.sublabel;
      const p = positions.get(c.id);
      if (p) {
        obj.pos = p.pos;
        obj.size = p.size;
      }
      return obj;
    }),
    connections: connections.map((c, i) => {
      const conn = {
        id: `edge-${i + 1}`,
        from: c.from,
        to: c.to,
      };
      if (c.label) {
        conn.label = c.label;
        const fromPos = positions.get(c.from);
        const toPos = positions.get(c.to);
        // The Viewer anchors straight-route labels at the source port's y
        // minus 10, so a vertical label shifts half a cell toward the target
        // side of the gap to reach the route midpoint (mirrored for BT).
        // Horizontal routes already anchor on the mid row; offsetting them
        // toward the target made labels overlap the target component in
        // layout validation.
        if (!isHorizontal) {
          conn.labelDy = mirrored ? -(LAYOUT.GAP_Y / 2 + 10) : LAYOUT.GAP_Y / 2 + 10;
        } else if (fromPos && toPos) {
          const width = connectionLabelWidth(c.label);
          const upperTop = Math.min(fromPos.pos[1], toPos.pos[1]);
          // Pins use guaranteed-clear zones: the strip above the topmost row
          // (no components or routes live above it, and it fits two staggered
          // 18px slots at the default ORIGIN_Y), then staggered slots in the
          // lane below the upper endpoint's row.
          const pin = (x, preferTop) => {
            let y;
            if (preferTop && boundaries.length === 0) {
              const slot = laneUse.get('top') || 0;
              if (slot < 2) {
                laneUse.set('top', slot + 1);
                y = minRowTop - 28 + slot * 18;
              }
            }
            if (y === undefined) {
              const laneTop = laneBelowRow(fromPos, toPos);
              const slot = laneUse.get(laneTop) || 0;
              laneUse.set(laneTop, slot + 1);
              y = laneTop + 14 + slot * 18;
            }
            conn.labelAt = [Math.round(Math.max(x, width / 2 + 2)), Math.round(y)];
          };
          if (fromPos.pos[1] === toPos.pos[1]) {
            // Same-row labels stay on the route inside the (layout-widened)
            // column gap.  Pin into a clear zone only when the edge spans
            // further than the adjacent-column gap or a midpoint rect still
            // reaches a cell — e.g. another node stranded mid-gap.  The
            // renderer's label rect is [lx - w/2, ly - 10, w, 14].
            const [left, right] = toPos.pos[0] > fromPos.pos[0] ? [fromPos, toPos] : [toPos, fromPos];
            const gap = right.pos[0] - (left.pos[0] + left.size[0]);
            const gapMidX = (left.pos[0] + left.size[0] + right.pos[0]) / 2;
            const anchorY = left.pos[1] + left.size[1] / 2 - 10;
            if (width > gap || labelRectHitsComponent([gapMidX, anchorY], width, positions)) {
              pin(gapMidX, left.pos[1] === minRowTop);
            }
          } else if (Math.ceil(textUnits(c.label) * 6.6) > LAYOUT.GAP_X) {
            // Cross-row: the default anchor rides the route and can dip into
            // the target row's band; a label wider than the corridor then
            // reaches a cell.  Pin it in a clear zone, centered on the facing
            // ports.
            const { fromSide, toSide } = defaultEndpointSides(fromPos, toPos, true);
            const midX = (portCenter(fromPos, fromSide)[0] + portCenter(toPos, toSide)[0]) / 2;
            pin(midX, upperTop === minRowTop);
          }
        }
        // Edge labels wider than the available left margin can clip the viewBox
        // left edge because the auto canvas only expands right/bottom. Use an
        // explicit labelAt when the default placement would overflow.
        if (fromPos && toPos && !conn.labelAt) {
          const labelAt = safeLabelAt(c.label, fromPos, toPos, isHorizontal, conn.labelDy || 0);
          if (labelAt) {
            // The clamp keeps the source row's anchor height, so a label wide
            // enough to need it can still overlap the cells it now spans. If
            // the clamped rect reaches a component, drop the anchor into the
            // clear lane below the upper row instead of emitting geometry
            // that fails the validate handoff.
            if (labelRectHitsComponent(labelAt, connectionLabelWidth(c.label), positions)) {
              const laneTop = laneBelowRow(fromPos, toPos);
              const slot = laneUse.get(laneTop) || 0;
              laneUse.set(laneTop, slot + 1);
              conn.labelAt = [labelAt[0], laneTop + 14 + slot * 18];
            } else {
              conn.labelAt = labelAt;
            }
          }
        }
      }
      if (c.variant && c.variant !== 'solid') conn.variant = c.variant;
      return conn;
    }),
  };

  if (boundaries.length > 0) {
    ir.boundaries = boundaries.map((b) => ({
      kind: 'region',
      label: b.label,
      wraps: b.wraps,
    }));
  }

  return { ok: true, ir };
}

// --- Statement parser ---------------------------------------------------

// Merge a component occurrence into a statement's local component list with
// the same precedence rules the cross-statement merge applies: a later
// explicit declaration refines an earlier implicit one, and two conflicting
// explicit declarations are a conflict diagnostic instead of a silent
// first-occurrence win. Returns the conflict diagnostic, if any.
function mergeStatementComponent(components, comp, lineNo) {
  const existing = components.find((c) => c.id === comp.id);
  if (!existing) {
    components.push(comp);
    return null;
  }
  if (comp.explicit && !existing.explicit) {
    existing.label = comp.label;
    existing.type = comp.type;
    existing.explicit = true;
    return null;
  }
  if (comp.explicit && existing.explicit
    && (comp.label !== existing.label || comp.type !== existing.type)) {
    return diag(
      'import/flowchart-conflicting-node-declaration',
      `Node "${comp.id}" is declared twice with different explicit definitions ("${existing.label}" and "${comp.label}").`,
      lineNo, 1,
      {
        supportedFixes: [`keep a single explicit declaration for node "${comp.id}" with the text it should have`],
      },
    );
  }
  return null;
}

function parseStatement(line, lineNo) {
  const components = [];
  const connections = [];
  let pos = 0;
  let lastNode = null;

  while (pos < line.length) {
    // Skip whitespace.
    while (pos < line.length && /\s/.test(line[pos])) pos += 1;
    if (pos >= line.length) break;

    // Try to parse an edge first (if we already have a lastNode).
    if (lastNode !== null) {
      const edge = parseEdge(line, pos, lineNo);
      if (edge) {
        if (edge.ok === false) return { ok: false, diagnostics: edge.diagnostics };
        pos = edge.nextPos;
        // After the edge, try to parse a label.
        while (pos < line.length && /\s/.test(line[pos])) pos += 1;

        let label = edge.label || null;
        if (!label && pos < line.length && line[pos] === '|') {
          const labelEnd = line.indexOf('|', pos + 1);
          if (labelEnd === -1) {
            return {
              ok: false,
              diagnostics: [diag(
                'import/flowchart-unclosed-edge-label',
                'Edge label opened with "|" but never closed.',
                lineNo, pos + 1,
                { supportedFixes: ['close the edge label with a trailing "|"'] },
              )],
            };
          }
          const rawLabel = line.slice(pos + 1, labelEnd);
          // Mermaid wraps literal label text in double quotes inside `|...|`
          // (`-->|"a-->b"|` renders `a-->b`); the quotes delimit the text, so
          // they are not part of the delivered label.  Validate the inner
          // text so |""| still reads as an empty label.
          const unquoted = rawLabel.length >= 2 && rawLabel.startsWith('"') && rawLabel.endsWith('"')
            ? rawLabel.slice(1, -1)
            : rawLabel;
          const labelCheck = validateLabelText(
            unquoted, lineNo, pos + 2 + (unquoted === rawLabel ? 0 : 1),
            { code: 'import/flowchart-empty-edge-label', kind: 'Edge label', context: 'relationship label' },
          );
          if (labelCheck) return { ok: false, diagnostics: [labelCheck] };
          label = unquoted;
          pos = labelEnd + 1;
          while (pos < line.length && /\s/.test(line[pos])) pos += 1;
        }

        // Now parse the target node.
        const target = parseNode(line, pos, lineNo);
        if (!target.ok) return target;
        pos = target.nextPos;

        const targetConflict = mergeStatementComponent(components, target.node, lineNo);
        if (targetConflict) return { ok: false, diagnostics: [targetConflict] };

        connections.push({
          from: lastNode,
          to: target.node.id,
          label,
          variant: edge.variant,
          line: lineNo,
        });
        lastNode = target.node.id;
        continue;
      }

      // Mermaid's open links — solid "---" / "----" and dotted "-.-" /
      // "-..-" — carry no arrowhead, so remapping them to a directed
      // connection would silently change their meaning.  The negative
      // lookaheads keep long directed arrows like "--->" and "-...->" out of
      // the open-link match; those are handled by parseEdge first.
      const openLink = line.slice(pos).match(/^(---+(?![->])|-\.+-(?![-.>]))/);
      if (openLink) {
        return {
          ok: false,
          diagnostics: [diag(
            'import/unsupported-edge-syntax',
            `Mermaid open link "${openLink[1]}" carries no arrowhead and is not supported: Archify connections always carry an arrowhead, so this edge cannot be imported without changing its meaning.`,
            lineNo, pos + 1,
            {
              supportedFixes: ['use "-->" for a directed edge, "-.->" for a dotted edge, or "==>" for an emphasized edge'],
            },
          )],
        };
      }

      // Mermaid also separates statements with ";". The declaration line
      // already rejects ";"-joined statements (import/declaration-remainder),
      // so a ";" where an edge or continuation was expected gets the same
      // treatment under its own diagnostic instead of a misleading
      // "expected an edge operator" message.
      if (line[pos] === ';') {
        const rest = line.slice(pos + 1).replace(/^[\s;]+/, '').trim();
        return {
          ok: false,
          diagnostics: [diag(
            'import/unsupported-statement-separator',
            rest
              ? `Statements are separated by ";" ("${rest}" follows), but the importer processes one statement per line, so the topology after the separator would be dropped.`
              : 'The statement ends with a Mermaid ";" separator; the importer processes one statement per line, so a trailing separator is not supported.',
            lineNo, pos + 1,
            {
              supportedFixes: ['remove the ";" or put each statement on its own line'],
            },
          )],
        };
      }

      // A node directly after a completed `a --> b` on the same line would
      // import as a disconnected component, silently dropping the edge the
      // author most likely meant. Mermaid separates statements with newlines
      // or semicolons, so bare adjacency is diagnosed instead.
      return {
        ok: false,
        diagnostics: [diag(
          'import/flowchart-expected-edge',
          `Expected an edge operator after node "${lastNode}" but found "${line.slice(pos, pos + 20).trim()}".`,
          lineNo, pos + 1,
          {
            supportedFixes: ['connect the nodes with "-->", "-.->", or "==>", or declare each node on its own line'],
          },
        )],
      };
    }

    // Parse a node.
    const nodeResult = parseNode(line, pos, lineNo);
    if (!nodeResult.ok) return nodeResult;
    pos = nodeResult.nextPos;

    const nodeConflict = mergeStatementComponent(components, nodeResult.node, lineNo);
    if (nodeConflict) return { ok: false, diagnostics: [nodeConflict] };

    lastNode = nodeResult.node.id;
  }

  return { ok: true, components, connections };
}

function parseNode(line, pos, lineNo) {
  // Read the node ID.  Hyphens are allowed, but a hyphen that is the start
  // of an edge operator (-->, -...->, ====>, ---, -.-, etc.) must not be
  // consumed into the ID; otherwise unspaced edges like "A-->B" are parsed
  // as a node id "A--" followed by an unclosed shape.
  const idMatch = line.slice(pos).match(/^([A-Za-z](?:[A-Za-z0-9_]|-(?![-.=>]))*)/);
  if (!idMatch) {
    return {
      ok: false,
      diagnostics: [diag(
        'import/flowchart-invalid-node-id',
        `Expected a node identifier at this position but found "${line.slice(pos, pos + 20).trim()}".`,
        lineNo, pos + 1,
        { supportedFixes: ['use an identifier starting with a letter, containing only letters, digits, hyphens, or underscores'] },
      )],
    };
  }
  const id = idMatch[1];
  pos += id.length;

  // Check for a shape/label definition.
  let label = id;
  let type = 'backend';
  let explicit = false;

  for (const shape of NODE_SHAPES) {
    if (line.slice(pos).startsWith(shape.open)) {
      const contentStart = pos + shape.open.length;
      let closeIdx;

      // Handle quoted labels: B["text with ] inside"]
      if (line[contentStart] === '"') {
        const quoteEnd = line.indexOf('"', contentStart + 1);
        if (quoteEnd === -1) {
          return {
            ok: false,
            diagnostics: [diag(
              'import/flowchart-unclosed-quote',
              `Node "${id}" has an open quote but no closing quote.`,
              lineNo, contentStart + 1,
              { supportedFixes: ['close the quoted label with a trailing "'] },
            )],
          };
        }
        // After the closing quote, expect the shape close.
        const afterQuote = quoteEnd + 1;
        if (!line.slice(afterQuote).startsWith(shape.close)) {
          return {
            ok: false,
            diagnostics: [diag(
              'import/flowchart-unclosed-node-shape',
              `Node "${id}" has an open shape "${shape.open}" but no closing "${shape.close}" after the quoted label.`,
              lineNo, afterQuote + 1,
              { supportedFixes: [`close the shape with "${shape.close}" after the quoted label`] },
            )],
          };
        }
        const text = line.slice(contentStart + 1, quoteEnd);
        const textCheck = validateLabelText(
          text, lineNo, contentStart + 2,
          { code: 'import/flowchart-empty-label', kind: `Node "${id}" label`, context: 'component label' },
        );
        if (textCheck) return { ok: false, diagnostics: [textCheck] };
        label = text;
        explicit = true;
        type = shape.type;
        pos = afterQuote + shape.close.length;
      } else {
        closeIdx = line.indexOf(shape.close, contentStart);
        if (closeIdx === -1) {
          return {
            ok: false,
            diagnostics: [diag(
              'import/flowchart-unclosed-node-shape',
              `Node "${id}" has an open shape "${shape.open}" but no closing "${shape.close}".`,
              lineNo, pos + 1,
              { supportedFixes: [`close the shape with "${shape.close}"`] },
            )],
          };
        }
        const text = line.slice(contentStart, closeIdx);
        const textCheck = validateLabelText(
          text, lineNo, contentStart + 1,
          { code: 'import/flowchart-empty-label', kind: `Node "${id}" label`, context: 'component label' },
        );
        if (textCheck) return { ok: false, diagnostics: [textCheck] };
        label = text;
        explicit = true;
        type = shape.type;
        pos = closeIdx + shape.close.length;
      }
      break;
    }
  }

  return {
    ok: true,
    node: { id, type, label, explicit },
    nextPos: pos,
  };
}

function parseEdge(line, pos, lineNo) {
  for (const pattern of EDGE_PATTERNS) {
    const match = pattern.re.exec(line.slice(pos));
    if (match) {
      return { ok: true, variant: pattern.variant, nextPos: pos + match[0].length };
    }
  }

  // Check for -- text --> pattern.  The label may contain hyphens ("read-only")
  // and the arrow may carry extra dashes ("-- text ---->"), matching the
  // documented longer-arrow rule; only ">" is excluded so the terminator
  // itself can never be absorbed into the label.
  const labeledArrow = line.slice(pos).match(/^--\s+([^>]+?)\s+--+>/d);
  if (labeledArrow) {
    const label = labeledArrow[1];
    const labelStart = pos + labeledArrow.indices[1][0] + 1;
    const operatorCheck = checkEdgeLabelOperators(label, lineNo, labelStart);
    if (operatorCheck) return { ok: false, diagnostics: [operatorCheck] };
    const labelCheck = validateLabelText(
      label, lineNo, labelStart,
      { code: 'import/flowchart-empty-edge-label', kind: 'Edge label', context: 'relationship label' },
    );
    if (labelCheck) return { ok: false, diagnostics: [labelCheck] };
    return { ok: true, variant: 'solid', label, labelStart, nextPos: pos + labeledArrow[0].length };
  }

  // Check for -. text .-> pattern.  Same label freedom as the solid form —
  // dots and hyphens inside the text ("v1.2", "read-only") are fine; only the
  // ">" of the ".->" terminator is excluded.
  const dottedLabeled = line.slice(pos).match(/^-\.\s+([^>]+?)\s+\.->/d);
  if (dottedLabeled) {
    const label = dottedLabeled[1];
    const labelStart = pos + dottedLabeled.indices[1][0] + 1;
    const operatorCheck = checkEdgeLabelOperators(label, lineNo, labelStart);
    if (operatorCheck) return { ok: false, diagnostics: [operatorCheck] };
    const labelCheck = validateLabelText(
      label, lineNo, labelStart,
      { code: 'import/flowchart-empty-edge-label', kind: 'Edge label', context: 'relationship label' },
    );
    if (labelCheck) return { ok: false, diagnostics: [labelCheck] };
    return { ok: true, variant: 'dashed', label, labelStart, nextPos: pos + dottedLabeled[0].length };
  }

  return null;
}

// --- Auto-layout ---------------------------------------------------------

function computeLayout(components, connections, direction) {
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const { CELL_W, CELL_H, GAP_X, GAP_Y, ORIGIN_X, ORIGIN_Y } = LAYOUT;

  // Label-aware cell sizing: the architecture validator rejects any component
  // whose measured label (textUnits(label) * 6.6) is wider than the component
  // plus 8px, so a fixed 140px cell fails the validation handoff for long
  // labels. Size every cell at least wide enough for its preserved label
  // (+4px measurement margin), then advance columns/rows by the measured
  // widths so no two cells overlap.

  // Build adjacency and compute in-degree.
  const ids = components.map((c) => c.id);
  const inDegree = new Map(ids.map((id) => [id, 0]));
  for (const conn of connections) {
    inDegree.set(conn.to, (inDegree.get(conn.to) || 0) + 1);
  }

  // BFS from source nodes (in-degree 0) to assign depth layers. First
  // assignment wins: relaxing an already-layered node via a cycle or back
  // edge (the previous longest-path relaxation) relocates it to a deeper
  // column without re-queuing it, which strands unrelated nodes on the same
  // row between a straight route's endpoints — A --> B; B --> C; C --> B put
  // C between A and B, and the straight A --> B route then crossed C's cell
  // (clean-flow/edge-through-node) even though the import reported ok.
  const depth = new Map();
  const queue = ids.filter((id) => (inDegree.get(id) || 0) === 0);
  for (const id of queue) depth.set(id, 0);

  let head = 0;
  const drain = () => {
    while (head < queue.length) {
      const current = queue[head++];
      const currentDepth = depth.get(current);
      for (const conn of connections) {
        if (conn.from === current && !depth.has(conn.to)) {
          depth.set(conn.to, currentDepth + 1);
          queue.push(conn.to);
        }
      }
    }
  };
  drain();
  // A source-less cycle (every node has an incoming edge — "A --> B" plus
  // "B --> A") leaves the seed queue empty, which would drop the whole
  // component into depth 0 and run the cycle's edges across rows instead of
  // along the declared layout axis. Seed a BFS from the first unvisited node
  // in declaration order and drain, until every component is layered.
  for (const id of ids) {
    if (!depth.has(id)) {
      depth.set(id, 0);
      queue.push(id);
      drain();
    }
  }

  // Group nodes by depth layer.
  const layers = new Map();
  for (const id of ids) {
    const d = depth.get(id);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(id);
  }

  const maxDepth = Math.max(...depth.values());
  // RL/BT mirror the depth axis so the declared direction is preserved.
  const mirrorDepth = direction === 'RL' || direction === 'BT';
  const positions = new Map();
  const widths = new Map(components.map((c) => [c.id, Math.max(
    CELL_W,
    Math.ceil(textUnits(c.label) * 6.6 - 8) + 4,
  )]));

  if (isHorizontal) {
    // LR/RL: depth = column, index within layer = row. Columns advance by the
    // widest cell in the column so a widened label never overlaps the column
    // to its right.
    const columnMax = new Map();
    for (const [d, layerIds] of layers) {
      const dCoord = mirrorDepth ? maxDepth - d : d;
      columnMax.set(dCoord, Math.max(
        columnMax.get(dCoord) ?? 0,
        ...layerIds.map((id) => widths.get(id)),
      ));
    }
    // Same-row edges carry their label inside the gap between adjacent
    // columns.  A label wider than the default GAP_X would overlap its
    // endpoint cells — and relative offsets cannot promise clearance on bent
    // routes — so widen that column boundary until the measured label rect
    // (plus an 8px margin) fits on the route, the way Mermaid draws it.
    const rowIndexById = new Map();
    for (const [, layerIds] of layers) {
      for (let i = 0; i < layerIds.length; i += 1) rowIndexById.set(layerIds[i], i);
    }
    const gapAfter = new Map();
    for (const conn of connections) {
      if (!conn.label) continue;
      const df = depth.get(conn.from);
      const dt = depth.get(conn.to);
      if (df === undefined || dt === undefined) continue;
      if (Math.abs(df - dt) !== 1) continue;
      if (rowIndexById.get(conn.from) !== rowIndexById.get(conn.to)) continue;
      const needed = connectionLabelWidth(conn.label) + 8;
      const lo = Math.min(df, dt);
      gapAfter.set(lo, Math.max(gapAfter.get(lo) ?? 0, needed));
    }
    const columnX = new Map();
    let accX = ORIGIN_X;
    for (let dc = 0; dc <= maxDepth; dc += 1) {
      columnX.set(dc, accX);
      const boundaryIndex = mirrorDepth ? maxDepth - dc - 1 : dc;
      accX += (columnMax.get(dc) ?? 0) + Math.max(GAP_X, gapAfter.get(boundaryIndex) ?? 0);
    }
    for (const [d, layerIds] of layers) {
      const dCoord = mirrorDepth ? maxDepth - d : d;
      for (let i = 0; i < layerIds.length; i++) {
        positions.set(layerIds[i], {
          pos: [columnX.get(dCoord), ORIGIN_Y + i * (CELL_H + GAP_Y)],
          size: [widths.get(layerIds[i]), CELL_H],
        });
      }
    }
    return positions;
  }

  // TD/BT: depth = row, index within layer = column. Each visual row advances
  // by the actual cell widths so widened labels never overlap the next cell.
  for (const [d, layerIds] of layers) {
    const dCoord = mirrorDepth ? maxDepth - d : d;
    let rowX = ORIGIN_X;
    for (let i = 0; i < layerIds.length; i++) {
      const id = layerIds[i];
      positions.set(id, {
        pos: [rowX, ORIGIN_Y + dCoord * (CELL_H + GAP_Y)],
        size: [widths.get(id), CELL_H],
      });
      rowX += widths.get(id) + GAP_X;
    }
  }

  return positions;
}

// --- Public API for CLI --------------------------------------------------

/**
 * Parse a Mermaid flowchart file and return either typed IR or diagnostics.
 * This is the function called by the CLI `import` command.
 */
export function importFlowchart(source) {
  const result = parseFlowchart(source);
  if (!result.ok) return result;

  return {
    ok: true,
    ir: result.ir,
    receipt: {
      schemaVersion: 1,
      command: 'import',
      source: 'mermaid-flowchart',
      ok: true,
      components: result.ir.components.length,
      connections: result.ir.connections.length,
      ...(result.ir.boundaries ? { boundaries: result.ir.boundaries.length } : {}),
    },
  };
}
