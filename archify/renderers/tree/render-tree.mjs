import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray, roundedPath, routePointsValue } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: tree, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'tree',
  defaultExample: 'payment-platform.tree.json',
  argv: cliArgs,
});
const locale = tree.meta.locale;
const direction = tree.layout?.direction === 'right' ? 'right' : 'down';
const down = direction === 'down';

const layout = {
  margin: 32,
  top: 64,
  // Sibling gap and generation gap. A downward tree needs room under each
  // parent for its toggle and the elbow; a rightward one needs room beside it.
  gapX: tree.layout?.gapX ?? (direction === 'down' ? 28 : 48),
  gapY: tree.layout?.gapY ?? (direction === 'down' ? 56 : 18),
  nodeW: tree.layout?.nodeW ?? 140,
  nodeMaxW: tree.layout?.nodeMaxW ?? (direction === 'down' ? 220 : 200),
  padX: 14,
  padY: 12,
  labelFont: 13,
  labelLine: 17,
  sublabelFont: 11,
  sublabelLine: 14,
  rootLabelFont: 14.5,
  toggleR: 9,
};

// ---- Structure -----------------------------------------------------------------
// The hierarchy is exactly what the author declared: one root, and every other
// node names its parent. Nothing is inferred, so a missing parent, a cycle, or
// a second root is refused rather than silently attached somewhere.
function validateStructure() {
  const problems = [];
  const details = [];
  const fail = (code, message, subject, evidence, supportedFixes) => {
    problems.push(message);
    details.push({ code, severity: 'error', message, subject: { diagramType: 'tree', ...subject }, evidence, supportedFixes });
  };
  const nodes = asArray(tree.nodes);
  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    if (byId.has(node.id)) {
      fail('tree/duplicate-id', `Node id "${node.id}" is declared twice.`, { path: `/nodes/${index}/id` }, { id: node.id }, ['Give every node a unique id.']);
    }
    byId.set(node.id, node);
  }
  for (const [index, node] of nodes.entries()) {
    if (node.parent !== undefined && !byId.has(node.parent)) {
      fail('tree/missing-parent', `Node "${node.id}" names parent "${node.parent}", which is not declared.`,
        { path: `/nodes/${index}/parent`, nodeId: node.id }, { parent: node.parent },
        [`Declare a node with id "${node.parent}".`, 'Point parent at an existing node.', 'Remove parent to make this the root.']);
    }
  }
  const roots = nodes.filter((node) => node.parent === undefined);
  if (roots.length !== 1) {
    fail('tree/root-count', roots.length
      ? `A tree has one root, but ${roots.length} nodes have no parent: ${roots.map((node) => `"${node.id}"`).join(', ')}.`
      : 'A tree has one root, but every node names a parent.',
    { path: '/nodes' }, { roots: roots.map((node) => node.id) },
    roots.length ? ['Give all but one of these nodes a parent.', 'Add a single root that the top-level nodes name as parent.'] : ['Remove parent from the root node.']);
  }
  // Walk each node's parent chain. With one root and every parent declared,
  // the only way a node can fail to reach the root is a cycle in its chain,
  // which also accounts for every node hanging beneath that cycle.
  const reported = new Set();
  for (const [index, node] of nodes.entries()) {
    const chain = [];
    let current = node;
    while (current && current.parent !== undefined && !chain.includes(current.id)) {
      chain.push(current.id);
      current = byId.get(current.parent);
    }
    if (current && chain.includes(current.id)) {
      const cycle = chain.slice(chain.indexOf(current.id));
      const key = [...cycle].sort().join('|');
      if (!reported.has(key)) {
        reported.add(key);
        fail('tree/cycle', `Parent links form a cycle: ${[...cycle, cycle[0]].map((id) => `"${id}"`).join(' -> ')}.`,
          { path: `/nodes/${index}/parent`, nodeId: node.id }, { cycle },
          ['Point one node in the cycle at a parent outside it.']);
      }
    }
  }
  if (problems.length) {
    throwDiagnosticProblems('Tree structure validation failed', problems, { code: 'tree/structure', subject: { diagramType: 'tree' }, diagnostics: details });
  }
  return { byId, root: roots[0] };
}

const { root: authoredRoot } = validateStructure();

const childrenOf = new Map(asArray(tree.nodes).map((node) => [node.id, []]));
for (const node of asArray(tree.nodes)) if (node.parent !== undefined) childrenOf.get(node.parent).push(node.id);

// ---- Measurement ---------------------------------------------------------------
// Labels wrap at word boundaries (CJK at any character) inside a bounded box,
// so a long name grows the node downward instead of overflowing or being cut.
const ADVANCE = nodeTextFit.widthFactor;

function wrapText(text, font, maxWidth) {
  const limit = Math.max(4, Math.floor(maxWidth / (font * ADVANCE)));
  if (textUnits(text) <= limit) return [text];
  const tokens = String(text).match(/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+\s*|\s+/g) || [text];
  const lines = [];
  let current = '';
  for (const token of tokens) {
    if (textUnits((current + token).trimEnd()) <= limit) {
      current += token;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    current = token.trimStart();
    while (textUnits(current.trimEnd()) > limit) {
      const chars = Array.from(current);
      let cut = 0;
      for (let units = 0; cut < chars.length && units + textUnits(chars[cut]) <= limit; cut += 1) units += textUnits(chars[cut]);
      lines.push(chars.slice(0, Math.max(1, cut)).join(''));
      current = chars.slice(Math.max(1, cut)).join('');
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

const depthOf = new Map();
(function assignDepth(id, depth) {
  depthOf.set(id, depth);
  for (const child of childrenOf.get(id)) assignDepth(child, depth + 1);
}(authoredRoot.id, 0));

// Compact leaf runs (going down only): three or more consecutive leaf
// children of one parent are stacked as an indented list under it instead of
// being spread across the row. A wide fan of leaves is what makes a real
// hierarchy (a repository, a capability map) far wider than any screen; a list
// keeps it readable at the same scale. Shorter runs and every branch keep the
// classic row layout.
const STACK_MIN = 3;
const STACK_GAP = 10;
const stackOf = new Map();
const groupsOf = new Map();
for (const [id, children] of childrenOf) {
  const groups = [];
  let run = [];
  const flush = () => {
    if (down && run.length >= STACK_MIN) groups.push({ stack: run });
    else for (const child of run) groups.push({ single: child });
    run = [];
  };
  for (const child of children) {
    if (childrenOf.get(child).length) {
      flush();
      groups.push({ single: child });
    } else run.push(child);
  }
  flush();
  // A list that is a parent's only child group drops its spine from inside
  // the parent's box, clear of the rounded corner; one beside other children
  // hangs off the shared crossbar.
  for (const group of groups) {
    if (!group.stack) continue;
    group.spineOffset = groups.length === 1 ? 22 : 12;
    group.indent = group.spineOffset + 16;
  }
  groupsOf.set(id, groups);
  for (const group of groups) if (group.stack) for (const child of group.stack) stackOf.set(child, group);
}

// Width: a label wraps only when it must, and then at the narrowest width
// that keeps the same number of lines, so a long name becomes a balanced
// two-line box instead of one wide box beside narrow siblings.
const measured = new Map(asArray(tree.nodes).map((node) => {
  const isRoot = node.id === authoredRoot.id;
  const labelFont = isRoot ? layout.rootLabelFont : layout.labelFont;
  const labelAdvance = labelFont * ADVANCE * 1.06;
  // Text wraps between words, never inside one: the longest single word may
  // widen a node past nodeMaxW (up to half again), and only a word longer
  // than that is split.
  const longestWord = Math.max(...String(node.label).split(/\s+/).map((word) => textUnits(word) * labelAdvance));
  const floor = Math.max(layout.nodeW, Math.ceil(longestWord + layout.padX * 2 + 2));
  const cap = Math.ceil(Math.min(layout.nodeMaxW * 1.5, Math.max(floor, layout.nodeMaxW)));
  const linesAt = (width) => ({
    label: wrapText(node.label, labelFont * 1.06, width - layout.padX * 2),
    sublabel: node.sublabel ? wrapText(node.sublabel, layout.sublabelFont, width - layout.padX * 2) : [],
  });
  const natural = Math.ceil(Math.max(textUnits(node.label) * labelAdvance, node.sublabel ? textUnits(node.sublabel) * layout.sublabelFont * ADVANCE : 0) + layout.padX * 2 + 2);
  // A stacked list shares one width anyway, so its entries are not balanced.
  const stacked = stackOf.has(node.id);
  let width = Math.min(cap, Math.max(floor, natural));
  const target = linesAt(width);
  for (let candidate = floor; !stacked && candidate < width; candidate += 4) {
    const lines = linesAt(candidate);
    if (lines.label.length <= target.label.length && lines.sublabel.length <= target.sublabel.length) {
      width = candidate;
      break;
    }
  }
  const { label: labelLines, sublabel: sublabelLines } = linesAt(width);
  const contentHeight = labelLines.length * layout.labelLine + (sublabelLines.length ? 4 + sublabelLines.length * layout.sublabelLine : 0);
  // Verified source badges occupy the top-right 18px of a card. Give sourced
  // nodes a separate header so centred and wrapped labels never sit under it;
  // diagrams without sources retain their existing geometry.
  const evidenceHeader = sourceEvidence?.nodes?.[node.id]?.length ? 18 : 0;
  return [node.id, { ...node, isRoot, labelFont, labelLines, sublabelLines, width, height: Math.ceil(layout.padY * 2 + evidenceHeader + contentHeight), contentHeight, evidenceHeader, depth: depthOf.get(node.id), stacked }];
}));

// A stacked run reads as one list: one width, one row height.
for (const group of new Set(stackOf.values())) {
  const members = group.stack.map((id) => measured.get(id));
  group.width = Math.max(...members.map((node) => node.width));
  group.rowH = Math.max(...members.map((node) => node.height));
  for (const node of members) measured.set(node.id, { ...node, width: group.width, height: group.rowH });
}

// ---- Layout --------------------------------------------------------------------
// Every generation shares one band (a row going down, a column going right),
// sized by its largest node, so siblings and cousins line up. Along the other
// axis each subtree owns a contiguous span: leaves are laid out in order and a
// parent is centred over its children. A stacked run hangs from its parent's
// band and owns its own span, so it never meets a cousin. Positions never
// depend on collapse state, so expanding or collapsing a branch leaves every
// visible node where the reader last saw it.
const breadthSize = (node) => (down ? node.width : node.height);
const depthSize = (node) => (down ? node.height : node.width);
const breadthGap = down ? layout.gapX : layout.gapY;
const depthGap = down ? layout.gapY : layout.gapX;

const maxDepth = Math.max(...[...measured.values()].map((node) => node.depth));
const bandSize = Array.from({ length: maxDepth + 1 }, () => 0);
for (const node of measured.values()) if (!node.stacked) bandSize[node.depth] = Math.max(bandSize[node.depth], depthSize(node));
const bandStart = [];
bandSize.reduce((offset, size, depth) => {
  bandStart[depth] = offset;
  return offset + size + depthGap;
}, down ? layout.top : layout.margin);

// Nodes of one generation share their band's size along the depth axis (the
// same height going down, the same width going right), so a generation reads
// as one even row or column instead of a ragged one.
for (const [id, node] of measured) {
  if (node.stacked) continue;
  measured.set(id, down ? { ...node, height: bandSize[node.depth] } : { ...node, width: bandSize[node.depth] });
}

const groupSpan = (group) => (group.stack ? group.indent + group.width : span.get(group.single));
const groupsSpan = (groups) => groups.reduce((sum, group, index) => sum + groupSpan(group) + (index ? breadthGap : 0), 0);
const span = new Map();
(function measureSpan(id) {
  for (const child of childrenOf.get(id)) measureSpan(child);
  span.set(id, Math.max(breadthSize(measured.get(id)), groupsSpan(groupsOf.get(id))));
}(authoredRoot.id));

const placed = new Map();
// Where a group meets its parent's crossbar: a single child at its centre, a
// stacked run at its spine.
const attachOf = (group) => (group.stack ? group.spine : centerOf(group.single));
(function place(id, start) {
  const node = measured.get(id);
  const groups = groupsOf.get(id);
  // A parent whose only children are one stacked run sits at the run's left
  // edge, with the spine dropping straight out of it.
  const onlyStack = groups.length === 1 && groups[0].stack;
  let cursor = onlyStack ? start : start + (span.get(id) - groupsSpan(groups)) / 2;
  for (const group of groups) {
    if (group.stack) {
      group.spine = cursor + group.spineOffset;
      let y = bandStart[node.depth + 1];
      for (const child of group.stack) {
        const leaf = measured.get(child);
        placed.set(child, { ...leaf, x: Math.round(cursor + group.indent), y: Math.round(y) });
        y += leaf.height + STACK_GAP;
      }
    } else place(group.single, cursor);
    cursor += groupSpan(group) + breadthGap;
  }
  let center = groups.length ? (attachOf(groups[0]) + attachOf(groups.at(-1))) / 2 : start + span.get(id) / 2;
  // A middle child a few px off the midpoint would put a small jog in the
  // stem; the parent sits exactly over it instead.
  const half = breadthSize(node) / 2;
  const middle = groups.slice(1, -1).map(attachOf)
    .find((attach) => Math.abs(attach - center) < 24 && attach - half >= start && attach + half <= start + span.get(id));
  if (middle !== undefined) center = middle;
  const breadth = onlyStack ? start : center - breadthSize(node) / 2;
  // A row going down centres each node in its band; a column going right
  // left-aligns them so every link into the column has the same stub.
  const depth = bandStart[node.depth] + (down ? (bandSize[node.depth] - depthSize(node)) / 2 : 0);
  const [x, y] = down ? [breadth, depth] : [depth, breadth];
  placed.set(id, { ...node, x: Math.round(x), y: Math.round(y), toggleAt: onlyStack ? Math.round(groups[0].spine) : null });
}(authoredRoot.id, down ? layout.margin : layout.top));

function centerOf(id) {
  const node = placed.get(id);
  return down ? node.x + node.width / 2 : node.y + node.height / 2;
}

const all = asArray(tree.nodes).map((node) => placed.get(node.id));
const viewBox = Array.isArray(tree.meta?.viewBox) ? tree.meta.viewBox : [
  Math.max(320, Math.ceil(Math.max(...all.map((node) => node.x + node.width)) + layout.margin + (down ? 0 : layout.toggleR + 4))),
  Math.max(240, Math.ceil(Math.max(...all.map((node) => node.y + node.height)) + layout.margin + (down ? layout.toggleR + 4 : 0))),
];

// ---- Edges ---------------------------------------------------------------------
// One elbow per parent-child link: out of the parent's toggle side, across at
// the midpoint of the generation gap, and into the child. Siblings share the
// stem and the crossbar, which is how a containment tree is read. A stacked
// child is reached along its run's spine and enters from the left.
function edgeStart(parent) {
  if (!down) return [parent.x + parent.width, parent.y + parent.height / 2];
  return [parent.toggleAt ?? parent.x + parent.width / 2, parent.y + parent.height];
}
function edgePoints(parent, child) {
  const start = edgeStart(parent);
  if (down && child.stacked) {
    const spine = stackOf.get(child.id).spine;
    const end = [child.x, child.y + child.height / 2];
    if (parent.toggleAt !== null) return [start, [spine, end[1]], end];
    const midY = bandStart[child.depth] - depthGap / 2;
    return [start, [start[0], midY], [spine, midY], [spine, end[1]], end];
  }
  if (down) {
    const end = [child.x + child.width / 2, child.y];
    const midY = bandStart[child.depth] - depthGap / 2;
    // Rounded parent/child centres can differ by ~1px and draw a useless
    // elbow. Snap near-aligned stems to a shared x so they stay straight.
    if (Math.abs(start[0] - end[0]) < 2) {
      const x = Math.round((start[0] + end[0]) / 2);
      return [[x, start[1]], [x, end[1]]];
    }
    return [start, [start[0], midY], [end[0], midY], end];
  }
  const end = [child.x, child.y + child.height / 2];
  const midX = bandStart[child.depth] - depthGap / 2;
  if (Math.abs(start[1] - end[1]) < 2) {
    const y = Math.round((start[1] + end[1]) / 2);
    return [[start[0], y], [end[0], y]];
  }
  return [start, [midX, start[1]], [midX, end[1]], end];
}

const edges = all.filter((node) => node.parent !== undefined).map((node, index) => ({
  from: node.parent,
  to: node.id,
  index,
  points: edgePoints(placed.get(node.parent), node),
}));

function ancestorsOf(id) {
  const chain = [];
  for (let current = placed.get(id); current?.parent !== undefined; current = placed.get(current.parent)) chain.push(current.parent);
  return chain;
}

function descendantCount(id) {
  return childrenOf.get(id).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

// ---- Canvas checks -------------------------------------------------------------
{
  const problems = [];
  if (Array.isArray(tree.meta?.viewBox)) {
    for (const node of all) {
      if (node.x + node.width + layout.margin / 2 > viewBox[0] || node.y + node.height + layout.margin / 2 > viewBox[1]) {
        problems.push(`Node "${node.id}" lies outside the authored meta.viewBox ${viewBox.join('x')} — remove meta.viewBox or enlarge it.`);
      }
    }
  }
  if (problems.length) throwDiagnosticProblems('Tree layout validation failed', problems, { code: 'layout/constraint', subject: { diagramType: 'tree' } });
}

function buildLayoutReport() {
  return {
    diagram_type: 'tree',
    direction,
    viewBox,
    nodes: all.map((node) => ({ id: node.id, parent: node.parent ?? null, depth: node.depth, x: node.x, y: node.y, width: node.width, height: node.height, lines: node.labelLines.length, stacked: node.stacked })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, points: edge.points })),
  };
}

// ---- Rendering -----------------------------------------------------------------
function treeAttrs(id) {
  const ancestors = ancestorsOf(id);
  return ancestors.length ? ` data-tree-ancestors="${esc(ancestors.join(' '))}"` : '';
}

function renderNode(node) {
  const leaf = !childrenOf.get(node.id).length;
  const tone = node.isRoot ? 'frontend' : leaf ? 'external' : 'backend';
  const context = i18nText(locale, node.isRoot ? 'node.context.tree.root' : childrenOf.get(node.id).length ? 'node.context.tree.branch' : 'node.context.tree.leaf');
  const passport = { kind: tone, sublabel: node.sublabel, context };
  // A stacked list reads left-aligned, like a directory listing; a node in a
  // row is centred under its link.
  const cx = node.stacked ? node.x + layout.padX : node.x + node.width / 2;
  const anchor = node.stacked ? 'start' : 'middle';
  let y = node.y + node.evidenceHeader + (node.height - node.evidenceHeader - node.contentHeight) / 2;
  const label = node.labelLines.map((line) => {
    y += layout.labelLine;
    return `<tspan x="${cx}" y="${y - 4.5}">${esc(line)}</tspan>`;
  }).join('');
  y += node.sublabelLines.length ? 4 : 0;
  const sublabel = node.sublabelLines.map((line) => {
    y += layout.sublabelLine;
    return `<tspan x="${cx}" y="${y - 3.5}">${esc(line)}</tspan>`;
  }).join('');
  // A collapsed branch shows a stacked card behind it, so the hidden subtree
  // stays visible as "there is more here" even before the badge is read.
  const stack = childrenOf.get(node.id).length
    ? `<rect data-tree-stack="" x="${node.x + 5}" y="${node.y + 5}" width="${node.width}" height="${node.height}" rx="8" class="tree-stack-${tone}" stroke-width="1.2"/>`
    : '';
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, locale)} data-tree-depth="${node.depth}"${treeAttrs(node.id)}>
          ${focusNodeTitle(node.label, passport)}
          ${stack}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" class="c-${tone}${leaf ? ' tree-leaf' : ''}"${animateAttr(tree.meta, 'node', node.depth)} stroke-width="${node.isRoot ? 1.8 : 1.3}"/>
          <text data-node-label="" x="${cx}" class="t-primary" font-size="${node.labelFont}" font-weight="${node.isRoot ? 750 : leaf ? 600 : 700}" text-anchor="${anchor}">${label}</text>
          ${sublabel ? `<text data-detail="context" x="${cx}" class="t-muted" font-size="${layout.sublabelFont}" text-anchor="${anchor}">${sublabel}</text>` : ''}
        </g>`;
}

// The toggle is a separate control after its node, not nested inside it, so a
// keyboard reader meets "node, then its branch control" and each has one role.
function renderToggle(node) {
  const children = childrenOf.get(node.id);
  if (!children.length) return '';
  const [cx, cy] = edgeStart(node);
  const hidden = descendantCount(node.id);
  const collapse = i18nText(locale, 'tree.toggle.collapse', { label: node.label, count: hidden });
  const expand = i18nText(locale, 'tree.toggle.expand', { label: node.label, count: hidden });
  const r = layout.toggleR;
  return `        <g data-tree-toggle="${esc(node.id)}" data-tree-count="${hidden}"${treeAttrs(node.id)}${node.collapsed ? ' data-tree-initially-collapsed=""' : ''} data-tree-label-collapse="${esc(collapse)}" data-tree-label-expand="${esc(expand)}" role="button" tabindex="0" aria-expanded="true" aria-label="${esc(collapse)}">
          <circle cx="${cx}" cy="${cy}" r="${r + 6}" class="tree-toggle-hit"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" class="tree-toggle-disc" stroke-width="1.4"/>
          <path class="tree-toggle-glyph" d="M ${cx - 4} ${cy} H ${cx + 4}" stroke-width="1.6" stroke-linecap="round"/>
          <path class="tree-toggle-glyph tree-toggle-plus" d="M ${cx} ${cy - 4} V ${cy + 4}" stroke-width="1.6" stroke-linecap="round"/>
          <g class="tree-toggle-count">
            <rect x="${cx + r + 3}" y="${cy - 7.5}" width="${String(hidden).length * 6.2 + 11}" height="15" rx="7.5" class="tree-count-pill"/>
            <text x="${cx + r + 3 + (String(hidden).length * 6.2 + 11) / 2}" y="${cy + 3.6}" class="t-primary" font-size="10" font-weight="700" text-anchor="middle">${hidden}</text>
          </g>
        </g>`;
}

function renderEdge(edge) {
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, undefined, edge.index)}${treeAttrs(edge.to)} data-composition-points="${routePointsValue(edge.points)}" d="${roundedPath(edge.points, 8)}" class="a-default tree-edge"${animateAttr(tree.meta, 'edge', placed.get(edge.to).depth)} stroke-width="1.5"/>`;
}

function renderSvg() {
  const readerFit = tree.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height" data-reader-min-text="7.5"';
  const expandAll = esc(i18nText(locale, 'tree.expandAll'));
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(tree.meta)} data-tree-ui="" data-tree-direction="${direction}"${readerFit}>
${svgAccessibleText(tree.meta, 'tree')}
${renderDefinitions()}
        <style>
          svg[data-tree-ui] .tree-edge { stroke-linejoin: round; stroke-linecap: round; }
          svg[data-tree-ui] .tree-leaf { fill: var(--mask); stroke: var(--lane-stroke); }
          svg[data-tree-ui] [data-tree-stack] { display: none; fill: var(--mask); }
          svg[data-tree-ui] .tree-stack-frontend { stroke: var(--frontend-stroke); }
          svg[data-tree-ui] .tree-stack-backend { stroke: var(--backend-stroke); }
          svg[data-tree-ui] [data-tree-collapsed] [data-tree-stack] { display: inline; }
          svg[data-tree-ui] [data-tree-hidden] { display: none; }
          svg[data-tree-ui] .tree-toggle-hit { fill: transparent; }
          svg[data-tree-ui] .tree-toggle-disc { fill: var(--mask); stroke: var(--arrow); }
          svg[data-tree-ui] .tree-toggle-glyph { stroke: var(--text); fill: none; }
          svg[data-tree-ui] .tree-toggle-count { display: none; }
          svg[data-tree-ui] .tree-count-pill { fill: var(--mask); stroke: var(--arrow); stroke-width: 1; }
          svg[data-tree-ui] [data-tree-toggle] { cursor: pointer; outline: none; }
          svg[data-tree-ui] [data-tree-toggle][aria-expanded="true"] .tree-toggle-plus { display: none; }
          svg[data-tree-ui] [data-tree-toggle][aria-expanded="false"] .tree-toggle-count { display: inline; }
          svg[data-tree-ui] [data-tree-toggle]:hover .tree-toggle-disc,
          svg[data-tree-ui] [data-tree-toggle]:focus-visible .tree-toggle-disc { stroke: var(--arrow-emphasis); stroke-width: 2.4; }
          svg[data-tree-ui] [data-tree-expand-all] { cursor: pointer; outline: none; }
          svg[data-tree-ui] [data-tree-expand-all] rect { fill: var(--mask); stroke: var(--lane-stroke); }
          svg[data-tree-ui] [data-tree-expand-all]:is(:hover, :focus-visible) rect { stroke: var(--arrow-emphasis); stroke-width: 2; }
          svg[data-tree-ui]:not([data-tree-any-collapsed]) [data-tree-expand-all] { display: none; }
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Containment links -->
${edges.map(renderEdge).join('\n')}

        <!-- Nodes -->
${all.map(renderNode).join('\n')}

        <!-- Branch toggles -->
${all.map(renderToggle).filter(Boolean).join('\n')}

        <!-- Expand all (shown only while a branch is collapsed) -->
        <g data-tree-expand-all="" role="button" tabindex="0" aria-label="${expandAll}">
          <rect x="${layout.margin}" y="18" width="${Math.ceil(textUnits(expandAll) * 10.5 * ADVANCE + 24)}" height="24" rx="12" stroke-width="1.2"/>
          <text x="${layout.margin + 12}" y="34" class="t-primary" font-size="10.5" font-weight="650">${expandAll}</text>
        </g>
      </svg>`;
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'tree',
  meta: tree.meta,
  svg: renderSvg(),
  cards: tree.cards,
  sourceEvidence,
});
