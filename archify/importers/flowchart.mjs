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
  { re: /^===>/, variant: 'emphasis' },
  { re: /^==>/, variant: 'emphasis' },
  { re: /^-\.\.->/, variant: 'dashed' },
  { re: /^-\.->/, variant: 'dashed' },
  { re: /^-->/, variant: 'solid' },
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

    // Skip blank lines and comments.
    if (line === '' || line.startsWith('%%')) continue;

    // First non-comment, non-blank line must declare the diagram type.
    if (diagramType === null) {
      const decl = line.match(/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i);
      if (!decl) {
        diagnostics.push(diag(
          'import/flowchart-missing-declaration',
          'First non-comment line must declare "flowchart" or "graph" with a direction (TB, TD, BT, LR, RL).',
          lineNo, 1,
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
          lineNo, decl[0].length + 1,
          {
            supportedFixes: ['move each statement after "flowchart <direction>" onto its own line'],
          },
        ));
        return { ok: false, diagnostics };
      }
      continue;
    }

    // Check for unsupported keywords.
    const keyword = line.match(/^([A-Za-z]+)\b/);
    if (keyword && UNSUPPORTED_KEYWORDS.has(keyword[1])) {
      diagnostics.push(diag(
        `import/unsupported-keyword-${keyword[1].toLowerCase()}`,
        `Mermaid "${keyword[1]}" is not supported by the Archify flowchart importer. Styling and interaction directives are outside the supported subset.`,
        lineNo, 1,
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
        lineNo, 1,
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
      const rest = subgraphMatch[1].trim();
      let authoredId = null;
      let label = rest;
      const idBracket = rest.match(/^(?:([^\[\]]+?)\s*)?\[(.*)\]$/);
      if (idBracket) {
        authoredId = (idBracket[1] ?? '').trim() || null;
        label = idBracket[2].trim().replace(/^["']|["']$/g, '');
      } else if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
        label = rest.slice(1, -1);
      }
      if (!label) {
        diagnostics.push(diag(
          'import/subgraph-empty-title',
          'Subgraph declaration has an empty title; every region needs a non-empty label.',
          lineNo, 1,
          {
            supportedFixes: ['give the subgraph a title, e.g. "subgraph Frontend"'],
          },
        ));
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
          lineNo, 1,
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
          lineNo, 1,
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
      diagnostics.push(...stmtResult.diagnostics);
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
          lineNo, 1,
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

  const ir = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Imported Flowchart',
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
        // The Viewer anchors straight-route labels at the source port's y
        // minus 10, so a vertical label shifts half a cell toward the target
        // side of the gap to reach the route midpoint (mirrored for BT).
        // Horizontal routes already anchor on the mid row; offsetting them
        // toward the target made labels overlap the target component in
        // layout validation.
        if (!isHorizontal) {
          conn.labelDy = mirrored ? -(LAYOUT.GAP_Y / 2 + 10) : LAYOUT.GAP_Y / 2 + 10;
        } else {
          // A straight horizontal label wider than the gap between its
          // endpoint cells overlaps both components (label rect spans the
          // route midpoint). Move it below the route — half a cell plus label
          // height and margin clears the 60px row — so the import output can
          // pass the advertised validate handoff instead of failing it.
          const fromPos = positions.get(c.from);
          const toPos = positions.get(c.to);
          if (fromPos && toPos && fromPos.pos[1] === toPos.pos[1]) {
            const labelWidth = Math.ceil(textUnits(c.label) * 6.6);
            const gap = toPos.pos[0] > fromPos.pos[0]
              ? toPos.pos[0] - (fromPos.pos[0] + fromPos.size[0])
              : fromPos.pos[0] - (toPos.pos[0] + toPos.size[0]);
            if (labelWidth > gap) {
              conn.labelDy = LAYOUT.CELL_H / 2 + 14 + 10;
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
      const edge = parseEdge(line, pos);
      if (edge) {
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
          label = line.slice(pos + 1, labelEnd).trim();
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

      // Mermaid's open links — solid "---" (and long-arrow forms like "--->")
      // and dotted "-.-" (and longer dotted forms like "-..-") — carry no
      // arrowhead, so remapping them to a directed connection would silently
      // change their meaning.
      const openLink = line.slice(pos).match(/^(---+|-\.(?:\.)*-)/);
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
  // Read the node ID.
  const idMatch = line.slice(pos).match(/^([A-Za-z][A-Za-z0-9_-]*)/);
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
        const text = line.slice(contentStart + 1, quoteEnd).trim();
        if (text) {
          label = text;
          explicit = true;
        }
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
        const text = line.slice(contentStart, closeIdx).trim();
        if (text) {
          label = text;
          explicit = true;
        }
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

function parseEdge(line, pos) {
  for (const pattern of EDGE_PATTERNS) {
    const match = pattern.re.exec(line.slice(pos));
    if (match) {
      return { variant: pattern.variant, nextPos: pos + match[0].length };
    }
  }

  // Check for -- text --> pattern.
  const labeledArrow = line.slice(pos).match(/^--\s+([^>-]+?)\s+-->/);
  if (labeledArrow) {
    return { variant: 'solid', label: labeledArrow[1].trim(), nextPos: pos + labeledArrow[0].length };
  }

  // Check for -. text .-> pattern.
  const dottedLabeled = line.slice(pos).match(/^-\.\s+([^>.]+?)\s+\.->/);
  if (dottedLabeled) {
    return { variant: 'dashed', label: dottedLabeled[1].trim(), nextPos: pos + dottedLabeled[0].length };
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

  // Any nodes not reached by BFS get depth 0.
  for (const id of ids) {
    if (!depth.has(id)) depth.set(id, 0);
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
    const columnX = new Map();
    let accX = ORIGIN_X;
    for (let dc = 0; dc <= maxDepth; dc += 1) {
      columnX.set(dc, accX);
      accX += (columnMax.get(dc) ?? 0) + GAP_X;
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
