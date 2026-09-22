// Experimental first-draft preparation. This is not a semantic or delivery validator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const skill = [path.resolve(here, '../../archify'), path.resolve(here, '../archify')]
  .find(p => fs.existsSync(path.join(p, 'renderers/shared/text-fit.mjs')));
if (!skill) throw new Error('Place helper beside the unchanged archify package.');
const { minimumNodeTextWidth } = await import(pathToFileURL(path.join(skill, 'renderers/shared/text-fit.mjs')));
const { textUnits } = await import(pathToFileURL(path.join(skill, 'renderers/shared/utils.mjs')));

const visible = /^(?:\/components\/\d+\/(?:label|sublabel|tag)|\/connections\/\d+\/label|\/boundaries\/\d+\/label|\/cards\/\d+\/(?:title|items\/\d+)|\/meta\/views\/\d+\/(?:label|note))$/;
const pinned = ['via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment'];
const clone = x => JSON.parse(JSON.stringify(x));

function assertJson(x, seen = new Set()) {
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return;
  if (typeof x === 'number' && Number.isFinite(x)) return;
  if (typeof x !== 'object' || seen.has(x)) throw new Error('Only finite, acyclic JSON values are supported.');
  if (!Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) throw new Error('Use plain JSON objects.');
  if (Object.getOwnPropertySymbols(x).length) throw new Error('Symbol keys cannot be retained.');
  seen.add(x);
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) { if (!(i in x)) throw new Error('Sparse array.'); assertJson(x[i], seen); }
  } else for (const v of Object.values(x)) assertJson(v, seen);
  seen.delete(x);
}

export function nodeSize(c) {
  for (const key of ['label', 'sublabel', 'tag']) if (c[key] !== undefined && typeof c[key] !== 'string') throw new Error(`Invalid ${key}.`);
  const own = c.size ?? [0, 0];
  if (!Array.isArray(own) || own.length !== 2 || !own.every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid size.');
  return [Math.ceil(Math.max(144, own[0], textUnits(c.label ?? '') * 6.6 + 16,
    minimumNodeTextWidth(c.sublabel ?? '', 9) + 8, minimumNodeTextWidth(c.tag ?? '', 7) + 8)),
    Math.max(72, own[1], c.tag ? 84 : 72)];
}

export function edgeGap(label = '') {
  if (typeof label !== 'string') throw new Error('Invalid edge label.');
  return Math.ceil(textUnits(label) * 6.5 + 21);
}

export function checkCoverage(draft, coverage, requirements) {
  if (!Array.isArray(requirements) || !requirements.length || requirements.some(x => typeof x !== 'string' || !x.trim())) throw new Error('Supply the original task required clauses.');
  if (!Array.isArray(coverage) || coverage.length !== requirements.length) throw new Error('Map every original required clause exactly once.');
  const seen = new Set();
  return coverage.map(entry => {
    if (!Number.isInteger(entry?.clause) || entry.clause < 1 || entry.clause > requirements.length || seen.has(entry.clause)) throw new Error('Invalid or duplicate clause index.');
    seen.add(entry.clause);
    if (!Array.isArray(entry.anchors) || !entry.anchors.length) throw new Error('Every clause needs visible content anchors.');
    const anchors = entry.anchors.map(pointer => {
      if (typeof pointer !== 'string' || !visible.test(pointer)) throw new Error(`Not a visible text pointer: ${pointer}`);
      const value = pointer.slice(1).split('/').reduce((node, key) => node?.[key], draft);
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing visible text: ${pointer}`);
      return { pointer, text: value };
    });
    return { clause: entry.clause, requirement: requirements[entry.clause - 1], anchors };
  });
}

export function semanticProjection(draft) {
  const value = clone(draft);
  delete value.layout;
  if (value.meta) delete value.meta.viewBox;
  for (const c of value.components ?? []) for (const key of ['row', 'col', 'pos', 'size']) delete c[key];
  return value;
}

export function prepare(draft, { coverage, requirements, gapX = 112, gapY = 112 } = {}) {
  assertJson(draft);
  if (draft.schema_version !== 1 || draft.diagram_type !== 'architecture' || !draft.meta || !Array.isArray(draft.components) || !draft.components.length || !Array.isArray(draft.connections)) throw new Error('Supply complete Architecture content.');
  if (draft.layout || draft.meta.viewBox) throw new Error('Author row/col positions without layout or a fixed viewBox.');
  if (![gapX, gapY].every(n => Number.isFinite(n) && n >= 64 && n <= 1000)) throw new Error('Clear gaps must be finite and between 64 and 1000.');
  const mapped = checkCoverage(draft, coverage, requirements);
  const cells = new Set(), ids = new Map();
  for (const c of draft.components) {
    if (typeof c.id !== 'string' || !c.id || ids.has(c.id)) throw new Error('Unique component IDs required.');
    if (![c.row, c.col].every(n => Number.isInteger(n) && n >= 0 && n <= 50)) throw new Error(`Author row and col in 0..50 for ${c.id}.`);
    if (c.pos !== undefined) throw new Error('Use row/col before geometry; explicit positions are not silently replaced.');
    const key = `${c.row},${c.col}`;
    if (cells.has(key)) throw new Error(`Shared cell ${key}.`);
    cells.add(key); ids.set(c.id, c);
  }
  for (const e of draft.connections) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error('Missing relationship endpoint.');
    if (pinned.some(key => e[key] !== undefined)) throw new Error('Initial plan requires automatic routes; preserve explicit controls in ordinary authoring.');
  }
  const rows = [...new Set(draft.components.map(c => c.row))].sort((a,b) => a-b);
  const cols = [...new Set(draft.components.map(c => c.col))].sort((a,b) => a-b);
  const widths = cols.map(col => Math.max(...draft.components.filter(c => c.col === col).map(c => nodeSize(c)[0])));
  const heights = rows.map(row => Math.max(...draft.components.filter(c => c.row === row).map(c => nodeSize(c)[1])));
  const gaps = cols.slice(1).map(() => gapX);
  for (const e of draft.connections) {
    const from = ids.get(e.from), to = ids.get(e.to);
    const a = cols.indexOf(from.col), b = cols.indexOf(to.col);
    if (from.row === to.row && Math.abs(a-b) === 1) gaps[Math.min(a,b)] = Math.max(gaps[Math.min(a,b)], edgeGap(e.label) + 24);
  }
  const pad = Math.max(40, ...(draft.boundaries ?? []).map(b => Number.isFinite(b.pad) ? b.pad : 28));
  const origin = pad + 32;
  const xs = cols.map((_,i) => origin + widths.slice(0,i).reduce((a,b)=>a+b,0) + gaps.slice(0,i).reduce((a,b)=>a+b,0));
  const ys = rows.map((_,i) => origin + heights.slice(0,i).reduce((a,b)=>a+b,0) + gapY*i);
  const result = clone(draft);
  for (const c of result.components) {
    const col = cols.indexOf(c.col), row = rows.indexOf(c.row);
    c.size = nodeSize(c);
    c.pos = [Math.round(xs[col] + (widths[col] - c.size[0])/2), Math.round(ys[row] + (heights[row] - c.size[1])/2)];
    delete c.row; delete c.col;
  }
  if (JSON.stringify(semanticProjection(draft)) !== JSON.stringify(semanticProjection(result))) throw new Error('Semantic projection changed.');
  const boxWidth = xs.at(-1) + widths.at(-1) + origin;
  return { diagram: result, receipt: {
    coverage: mapped, semanticProjectionUnchanged: true,
    semanticTruthVerified: false, sourceEntailmentVerified: false, layoutVerified: false,
    nodeOnlyWidthEstimate: boxWidth,
    conservativeProjectedSublabelPx: 9 * Math.min(1, 930 / boxWidth),
    columnWidths: widths, clearColumnGaps: gaps,
    note: 'Dimensions and visible anchors only. Routes, labels and boundaries may extend the final bounds. Original showcase finalize and independent review remain required.',
  } };
}

export function writeDraft(file, draft, options) {
  const prepared = prepare(draft, options);
  const root = fs.realpathSync(process.cwd());
  const output = path.join(root, 'output');
  const target = path.resolve(root, file);
  if (!target.startsWith(output + path.sep)) throw new Error('Initial candidates must be written inside this workspace output/.');
  let parent = path.dirname(target);
  while (parent !== root) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Output ancestors must not be symlinks.');
    const next = path.dirname(parent);
    if (next === parent) throw new Error('Output escaped workspace.');
    parent = next;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Initial writes are exclusive: do not overwrite an existing source, symlink or hard-link alias.
  fs.writeFileSync(target, `${JSON.stringify(prepared.diagram, null, 2)}\n`, { flag: 'wx' });
  return prepared.receipt;
}
