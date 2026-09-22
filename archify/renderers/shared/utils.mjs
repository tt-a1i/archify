import {
  escapeHtml as esc,
  localizeTemplate,
  resolveLocale,
  translateMessage,
  viewerCatalog,
} from './i18n.mjs';

export { esc };

export function renderDefinitions() {
  return `        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>`;
}

const SIGIL_TONE = {
  frontend: 'frontend',
  start: 'frontend',
  backend: 'backend',
  active: 'backend',
  database: 'database',
  success: 'database',
  cloud: 'cloud',
  waiting: 'cloud',
  security: 'security',
  failure: 'security',
  messagebus: 'messagebus',
  external: 'external',
  neutral: 'external',
};

const SIGIL_SHAPE = {
  calendar: `<rect x="2" y="3.5" width="12" height="10.5" rx="2"/><path d="M5 2v3M11 2v3M2 7h12M5 10h2M9 10h2"/>`,
  clock: `<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>`,
  person: `<circle cx="8" cy="4.5" r="2.5"/><path d="M3 14v-2a5 5 0 0 1 10 0v2"/>`,
  briefcase: `<rect x="2" y="5" width="12" height="9" rx="2"/><path d="M5 5V2h6v3M2 9h12M7 9v2h2V9"/>`,
  flag: `<path d="M3 14V2h10l-2 3 2 3H3"/>`,
  moon: `<path d="M13.5 10A6 6 0 0 1 6 2.5 6 6 0 1 0 13.5 10Z"/>`,
  frontend: `<rect x="2" y="3" width="12" height="10" rx="2"/>
            <path d="M2 6.5h12"/>
            <circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/>
            <circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>`,
  backend: `<path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>`,
  database: `<ellipse cx="8" cy="4" rx="5" ry="2"/>
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>`,
  cloud: `<path d="M4.3 12.5h7.3a2.4 2.4 0 0 0 .2-4.8 4 4 0 0 0-7.5-1.3A3.1 3.1 0 0 0 4.3 12.5Z"/>`,
  security: `<path d="M8 2.2 13 4v3.5c0 3.1-1.8 5.4-5 6.5-3.2-1.1-5-3.4-5-6.5V4Z"/>
            <path d="m5.8 8 1.5 1.5 3-3"/>`,
  messagebus: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>
            <circle cx="5" cy="4.5" r="1" class="sigil-fill"/>
            <circle cx="10.5" cy="8" r="1" class="sigil-fill"/>
            <circle cx="7" cy="11.5" r="1" class="sigil-fill"/>`,
  external: `<rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/>
            <path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>`,
  start: `<circle cx="8" cy="8" r="5"/>
            <path d="m7 5.4 3.6 2.6L7 10.6Z" class="sigil-fill"/>`,
  active: `<path d="M2 8h3l1.5-3.5L9 12l1.6-4H14"/>`,
  waiting: `<path d="M4 2.5h8M4 13.5h8M5 3c0 2.8 2 3.2 3 5-1 1.8-3 2.2-3 5M11 3c0 2.8-2 3.2-3 5 1 1.8 3 2.2 3 5"/>`,
  success: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.2 8 1.8 1.8 3.8-4"/>`,
  failure: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6"/>`,
  neutral: `<rect x="3" y="3" width="10" height="10" rx="2"/>
            <circle cx="8" cy="8" r="1.2" class="sigil-fill"/>`,
};

// A quiet, renderer-owned corner symbol (type default or authored icon). It is
// SVG content rather than a
// viewer overlay, so it survives canonical export while adding no focus target,
// accessible name, layout box, or interaction state of its own.
// Shared with label clearance so the reserved rail matches the actual icon.
export const SEMANTIC_SIGIL_INSET = 6;
export const SEMANTIC_SIGIL_SIZE = 11;
export const SEMANTIC_SIGIL_FOOTPRINT = SEMANTIC_SIGIL_INSET + SEMANTIC_SIGIL_SIZE;

export function renderSemanticSigil(kind, { x, y, size = SEMANTIC_SIGIL_SIZE, icon } = {}) {
  if (icon === 'none') return '';
  const selected = icon ?? kind;
  const normalized = Object.hasOwn(SIGIL_SHAPE, selected) ? selected : 'neutral';
  const tone = SIGIL_TONE[kind] || 'external';
  const scale = size / 16;
  return `<g aria-hidden="true" data-semantic-sigil="${esc(normalized)}" class="semantic-sigil s-${tone}" transform="translate(${x} ${y}) scale(${scale})">
            ${SIGIL_SHAPE[normalized]}
          </g>`;
}

export function renderCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return `    <!-- Info Cards -->
    <div class="cards">
${list.map((card) => `      <div class="card">
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map((item) => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const SUBTITLE_SLOT_RE = /^([ \t]*)<p class="subtitle">\[Subtitle description\]<\/p>[ \t]*(\r?\n)?/m;
const GUIDED_VIEWS_PLACEHOLDER = '<!-- ARCHIFY:GUIDED_VIEWS_DATA -->';
const SOURCE_EVIDENCE_PLACEHOLDER = '    <!-- ARCHIFY:SOURCE_EVIDENCE_DATA -->';
const INTERNAL_STRUCTURE_PLACEHOLDER = '    <!-- ARCHIFY:INTERNAL_STRUCTURE_DATA -->';
const I18N_PLACEHOLDER = '    <!-- ARCHIFY:I18N_DATA -->';

export const INTERNAL_STRUCTURE_NODE_BYTES = 64 * 1024;
export const INTERNAL_STRUCTURE_MEMBER_BYTES = 256 * 1024;
export const INTERNAL_STRUCTURE_ATLAS_BYTES = 512 * 1024;

const HTML_SPACE_RE = /[\t\n\f\r ]/;
const HTML_RAW_TEXT_ELEMENTS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

function htmlTagEnd(html, start) {
  let state = 'name';
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) {
        quote = '';
        state = 'before-attribute';
      }
      continue;
    }
    if (state === 'name') {
      if (character === '>') return index;
      if (HTML_SPACE_RE.test(character) || character === '/') state = 'before-attribute';
    } else if (state === 'before-attribute') {
      if (character === '>') return index;
      if (!HTML_SPACE_RE.test(character) && character !== '/') state = 'attribute-name';
    } else if (state === 'attribute-name') {
      if (character === '>') return index;
      if (character === '=') state = 'before-value';
      else if (HTML_SPACE_RE.test(character)) state = 'after-attribute-name';
    } else if (state === 'after-attribute-name') {
      if (character === '>') return index;
      if (character === '=') state = 'before-value';
      else if (!HTML_SPACE_RE.test(character)) state = 'attribute-name';
    } else if (state === 'before-value') {
      if (character === '>') return index;
      if (HTML_SPACE_RE.test(character)) continue;
      if (character === '"' || character === "'") quote = character;
      else state = 'unquoted-value';
    } else if (state === 'unquoted-value') {
      if (character === '>') return index;
      if (HTML_SPACE_RE.test(character)) state = 'before-attribute';
    }
  }
  return -1;
}

function decodeHtmlAttributeValue(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
  return value.replace(/&(?:#(?:x([\da-f]+)|(\d+))|([a-z]+));?/gi, (match, hex, decimal, name) => {
    if (name) return Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match;
    const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return '\ufffd';
    }
    return String.fromCodePoint(codePoint);
  });
}

function parseHtmlStartTag(startTag) {
  let index = 1;
  if (startTag[index] === '/' || startTag[index] === '!' || startTag[index] === '?') return null;
  const nameStart = index;
  while (index < startTag.length && !HTML_SPACE_RE.test(startTag[index]) && !['/', '>'].includes(startTag[index])) index += 1;
  const tagName = startTag.slice(nameStart, index).toLowerCase();
  if (!tagName) return null;

  const attributes = Object.create(null);
  while (index < startTag.length) {
    while (HTML_SPACE_RE.test(startTag[index] || '')) index += 1;
    if (index >= startTag.length || startTag[index] === '>' || (startTag[index] === '/' && startTag[index + 1] === '>')) break;
    const attributeStart = index;
    while (index < startTag.length
      && !HTML_SPACE_RE.test(startTag[index])
      && !['/', '>', '='].includes(startTag[index])) index += 1;
    const attributeName = startTag.slice(attributeStart, index).toLowerCase();
    if (!attributeName) {
      index += 1;
      continue;
    }
    while (HTML_SPACE_RE.test(startTag[index] || '')) index += 1;
    let value = '';
    if (startTag[index] === '=') {
      index += 1;
      while (HTML_SPACE_RE.test(startTag[index] || '')) index += 1;
      const quote = startTag[index] === '"' || startTag[index] === "'" ? startTag[index++] : '';
      const valueStart = index;
      if (quote) {
        while (index < startTag.length && startTag[index] !== quote) index += 1;
        value = startTag.slice(valueStart, index);
        if (startTag[index] === quote) index += 1;
      } else {
        while (index < startTag.length && !HTML_SPACE_RE.test(startTag[index]) && startTag[index] !== '>') index += 1;
        value = startTag.slice(valueStart, index);
      }
    }
    if (!Object.hasOwn(attributes, attributeName)) {
      attributes[attributeName] = decodeHtmlAttributeValue(value);
    }
  }
  return { tagName, attributes };
}

function rawTextElementEnd(html, tagName, contentStart) {
  if (tagName === 'plaintext') return { contentEnd: html.length, end: html.length, closed: false };
  const closingStart = new RegExp(`<\\/${tagName}(?=[\\t\\n\\f\\r />])`, 'gi');
  closingStart.lastIndex = contentStart;
  let match;
  while ((match = closingStart.exec(html))) {
    const end = htmlTagEnd(html, match.index + 2);
    if (end >= 0) return { contentEnd: match.index, end: end + 1, closed: true };
  }
  return { contentEnd: html.length, end: html.length, closed: false };
}

// Standalone artifacts cannot depend on an installed DOM package. This scanner
// implements the HTML start-tag behavior relevant to inert script discovery:
// case-insensitive tag/attribute names, quoted or unquoted values, character
// references, first-wins duplicate attributes, comments, and raw-text bodies.
export function findHtmlScriptsById(documentHtml, id) {
  const html = String(documentHtml);
  const matches = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const commentEnd = /--!?>/g;
      commentEnd.lastIndex = start + 4;
      const closing = commentEnd.exec(html);
      cursor = closing ? commentEnd.lastIndex : html.length;
      continue;
    }
    const marker = html[start + 1] || '';
    if (!/[a-z]/i.test(marker)) {
      if (marker === '/' && /[a-z]/i.test(html[start + 2] || '')) {
        const end = htmlTagEnd(html, start + 2);
        cursor = end < 0 ? html.length : end + 1;
      } else if (marker === '!' || marker === '?') {
        const end = html.indexOf('>', start + 2);
        cursor = end < 0 ? html.length : end + 1;
      } else cursor = start + 1;
      continue;
    }
    const tagEnd = htmlTagEnd(html, start + 1);
    if (tagEnd < 0) break;
    const parsed = parseHtmlStartTag(html.slice(start, tagEnd + 1));
    if (!parsed) {
      cursor = tagEnd + 1;
      continue;
    }
    if (!HTML_RAW_TEXT_ELEMENTS.has(parsed.tagName)) {
      cursor = tagEnd + 1;
      continue;
    }
    const rawText = rawTextElementEnd(html, parsed.tagName, tagEnd + 1);
    if (parsed.tagName === 'script' && parsed.attributes.id === id) {
      matches.push({
        index: start,
        content: html.slice(tagEnd + 1, rawText.contentEnd),
        attributes: parsed.attributes,
        closed: rawText.closed,
      });
    }
    cursor = rawText.end;
  }
  return matches;
}

function structurePayloadObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

const INTERNAL_STRUCTURE_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const INTERNAL_STRUCTURE_SOURCE_ROLES = new Set(['definition', 'export', 'registration', 'callsite', 'guard', 'test', 'schema', 'documentation']);
const INTERNAL_STRUCTURE_CODE_KINDS = new Set(['directory', 'file', 'class', 'interface', 'type', 'function', 'method']);
const INTERNAL_STRUCTURE_RELATION_KINDS = new Set(['imports', 'calls', 'uses', 'creates', 'reads', 'writes']);
const INTERNAL_STRUCTURE_RELATION_EVIDENCE_ROLES = new Set(['callsite', 'definition', 'guard', 'schema', 'test']);

function structurePayloadAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function structurePayloadKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  structurePayloadAssert(extra === undefined, `${label} contains unexpected property ${JSON.stringify(extra)}.`);
}

function structurePayloadText(value, limit, label) {
  structurePayloadAssert(typeof value === 'string' && value.length > 0 && value.length <= limit,
    `${label} must be a non-empty string no longer than ${limit} characters.`);
}

function validateRenderedStructure(nodeId, structure) {
  const label = `Rendered internal structure node ${JSON.stringify(nodeId)}`;
  structurePayloadKeys(structure, ['sources', 'items', 'relations'], label);
  structurePayloadAssert(Array.isArray(structure.sources) && structure.sources.length > 0 && structure.sources.length <= 64,
    `${label} must contain one to 64 sources.`);
  structurePayloadAssert(Array.isArray(structure.items) && structure.items.length > 0 && structure.items.length <= 64,
    `${label} must contain one to 64 items.`);
  structurePayloadAssert(Array.isArray(structure.relations) && structure.relations.length <= 96,
    `${label} must contain at most 96 relations.`);

  const sources = new Map();
  structure.sources.forEach((source, index) => {
    const at = `${label} source ${index}`;
    structurePayloadObject(source, at);
    structurePayloadKeys(source, ['id', 'role', 'path', 'symbol', 'line', 'endLine', 'label'], at);
    structurePayloadAssert(INTERNAL_STRUCTURE_ID.test(source.id || '') && !sources.has(source.id), `${at} has an invalid or duplicate id.`);
    structurePayloadAssert(INTERNAL_STRUCTURE_SOURCE_ROLES.has(source.role), `${at} has an invalid role.`);
    structurePayloadText(source.path, 240, `${at} path`);
    if (source.symbol !== undefined) structurePayloadText(source.symbol, 200, `${at} symbol`);
    if (source.label !== undefined) structurePayloadText(source.label, 48, `${at} label`);
    if (source.line !== undefined) structurePayloadAssert(Number.isSafeInteger(source.line) && source.line > 0, `${at} line must be a positive integer.`);
    if (source.endLine !== undefined) structurePayloadAssert(Number.isSafeInteger(source.endLine) && source.endLine > 0 && (source.line === undefined || source.endLine >= source.line), `${at} endLine must be at or after line.`);
    sources.set(source.id, source);
  });

  const items = new Map();
  structure.items.forEach((item, index) => {
    const at = `${label} item ${index}`;
    structurePayloadObject(item, at);
    structurePayloadKeys(item, ['id', 'domain', 'kind', 'label', 'summary', 'parent', 'signature', 'valueType', 'sourceRefs'], at);
    structurePayloadAssert(INTERNAL_STRUCTURE_ID.test(item.id || '') && !items.has(item.id), `${at} has an invalid or duplicate id.`);
    const code = item.domain === 'code' && INTERNAL_STRUCTURE_CODE_KINDS.has(item.kind);
    const state = item.domain === 'state' && ['group', 'field'].includes(item.kind);
    structurePayloadAssert(code || state, `${at} has an invalid domain/kind pair.`);
    structurePayloadText(item.label, 80, `${at} label`);
    structurePayloadText(item.summary, 240, `${at} summary`);
    if (item.parent !== undefined) structurePayloadAssert(INTERNAL_STRUCTURE_ID.test(item.parent), `${at} parent is invalid.`);
    if (item.signature !== undefined) {
      structurePayloadAssert(item.domain === 'code', `${at} signature is only valid for code items.`);
      structurePayloadText(item.signature, 200, `${at} signature`);
    }
    if (item.kind === 'field') structurePayloadText(item.valueType, 200, `${at} valueType`);
    else structurePayloadAssert(item.valueType === undefined, `${at} valueType is only valid for fields.`);
    const container = item.kind === 'directory' || item.kind === 'group';
    if (item.sourceRefs !== undefined) {
      structurePayloadAssert(Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0 && item.sourceRefs.length <= 3 && new Set(item.sourceRefs).size === item.sourceRefs.length,
        `${at} sourceRefs must contain one to three unique source ids.`);
      for (const sourceId of item.sourceRefs) structurePayloadAssert(sources.has(sourceId), `${at} references missing source ${JSON.stringify(sourceId)}.`);
    } else structurePayloadAssert(container, `${at} requires sourceRefs.`);
    items.set(item.id, item);
  });

  for (const [itemId, item] of items) {
    if (item.parent !== undefined) {
      const parent = items.get(item.parent);
      structurePayloadAssert(parent && parent.domain === item.domain, `${label} item ${JSON.stringify(itemId)} has a missing or cross-domain parent.`);
    }
    const seen = new Set([itemId]);
    let cursor = item;
    let depth = 0;
    while (cursor.parent !== undefined) {
      structurePayloadAssert(!seen.has(cursor.parent), `${label} item ${JSON.stringify(itemId)} participates in a parent cycle.`);
      seen.add(cursor.parent);
      cursor = items.get(cursor.parent);
      if (!cursor) break;
      depth += 1;
    }
    structurePayloadAssert(depth <= 8, `${label} item ${JSON.stringify(itemId)} exceeds depth 8.`);
  }
  for (const domain of ['code', 'state']) {
    const domainItems = [...items.values()].filter((item) => item.domain === domain);
    structurePayloadAssert(!domainItems.length || domainItems.some((item) => item.parent === undefined), `${label} ${domain} domain has no root.`);
  }

  const relationIds = new Set();
  structure.relations.forEach((relation, index) => {
    const at = `${label} relation ${index}`;
    structurePayloadObject(relation, at);
    structurePayloadKeys(relation, ['id', 'from', 'to', 'kind', 'label', 'sourceRefs'], at);
    structurePayloadAssert(INTERNAL_STRUCTURE_ID.test(relation.id || '') && !relationIds.has(relation.id), `${at} has an invalid or duplicate id.`);
    relationIds.add(relation.id);
    structurePayloadAssert(INTERNAL_STRUCTURE_RELATION_KINDS.has(relation.kind), `${at} has an invalid kind.`);
    const from = items.get(relation.from);
    const to = items.get(relation.to);
    structurePayloadAssert(from && to, `${at} has a missing endpoint.`);
    const validDomains = ['reads', 'writes'].includes(relation.kind)
      ? from.domain === 'code' && to.domain === 'state'
      : from.domain === 'code' && to.domain === 'code';
    structurePayloadAssert(validDomains, `${at} has invalid ${from.domain} to ${to.domain} endpoints for ${relation.kind}.`);
    if (relation.label !== undefined) structurePayloadText(relation.label, 80, `${at} label`);
    structurePayloadAssert(Array.isArray(relation.sourceRefs) && relation.sourceRefs.length > 0 && relation.sourceRefs.length <= 3 && new Set(relation.sourceRefs).size === relation.sourceRefs.length,
      `${at} sourceRefs must contain one to three unique source ids.`);
    const roles = relation.sourceRefs.map((sourceId) => {
      structurePayloadAssert(sources.has(sourceId), `${at} references missing source ${JSON.stringify(sourceId)}.`);
      return sources.get(sourceId).role;
    });
    if (['calls', 'reads', 'writes', 'creates'].includes(relation.kind)) {
      structurePayloadAssert(roles.some((role) => INTERNAL_STRUCTURE_RELATION_EVIDENCE_ROLES.has(role)), `${at} lacks semantic source evidence.`);
    }
  });
}

export function parseInternalStructurePayload(encoded) {
  const bytes = Buffer.byteLength(encoded);
  if (bytes > INTERNAL_STRUCTURE_MEMBER_BYTES) {
    throw new Error(`Rendered internal structure payload is ${bytes} UTF-8 bytes; limit ${INTERNAL_STRUCTURE_MEMBER_BYTES}.`);
  }
  if (/[<>&]/.test(encoded)) {
    throw new Error('Rendered internal structure payload must use HTML-safe JSON escaping.');
  }
  const chunks = JSON.parse(encoded);
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.some((chunk) => typeof chunk !== 'string')) {
    throw new Error('Rendered internal structure payload must be a non-empty JSON array of string chunks.');
  }
  const payload = structurePayloadObject(JSON.parse(chunks.join('')), 'Rendered internal structure payload');
  structurePayloadKeys(payload, ['schemaVersion', 'nodes'], 'Rendered internal structure payload');
  if (payload.schemaVersion !== 1) throw new Error('Rendered internal structure payload must use schemaVersion 1.');
  const nodes = structurePayloadObject(payload.nodes, 'Rendered internal structure nodes');
  const entries = Object.entries(nodes);
  if (entries.length === 0) throw new Error('Rendered internal structure nodes must not be empty.');

  let itemCount = 0;
  let relationCount = 0;
  let sourceCount = 0;
  for (const [nodeId, candidate] of entries) {
    structurePayloadAssert(INTERNAL_STRUCTURE_ID.test(nodeId), `Rendered internal structure node id ${JSON.stringify(nodeId)} is invalid.`);
    const structure = structurePayloadObject(candidate, `Rendered internal structure node ${JSON.stringify(nodeId)}`);
    const nodeBytes = Buffer.byteLength(serializeScriptJson(structure));
    if (nodeBytes > INTERNAL_STRUCTURE_NODE_BYTES) {
      throw new Error(`Rendered internal structure node ${JSON.stringify(nodeId)} is ${nodeBytes} UTF-8 bytes; limit ${INTERNAL_STRUCTURE_NODE_BYTES}.`);
    }
    validateRenderedStructure(nodeId, structure);
    sourceCount += structure.sources.length;
    itemCount += structure.items.length;
    relationCount += structure.relations.length;
  }
  return { payload, nodeCount: entries.length, itemCount, relationCount, sourceCount, bytes };
}

export function serializeScriptJson(value, space) {
  return JSON.stringify(value, null, space)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

export function serializeChunkedScriptJson(value, maxLineBytes = 8000) {
  const serialized = serializeScriptJson(value);
  const chunks = [];
  let offset = 0;
  while (offset < serialized.length) {
    let low = 1;
    let high = serialized.length - offset;
    let accepted = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = serializeScriptJson(serialized.slice(offset, offset + middle));
      if (Buffer.byteLength(`  ${candidate},`) <= maxLineBytes) {
        accepted = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (!accepted) throw new Error('serializeChunkedScriptJson: maxLineBytes is too small');
    chunks.push(serialized.slice(offset, offset + accepted));
    offset += accepted;
  }
  if (!chunks.length) chunks.push(serialized);
  return `[\n${chunks.map((chunk) => `  ${serializeScriptJson(chunk)}`).join(',\n')}\n]`;
}

// Budget diagnostics point at the first authored structure whose inclusion crosses
// the limit. Computing prefixes only on the rejected path keeps normal delivery
// linear while preserving the exact bytes used by the emitted member payload.
export function findInternalStructureBudgetContributor(components, nodes, {
  baseBytes = 0,
  limit,
} = {}) {
  const prefixNodes = Object.create(null);
  for (const [componentIndex, component] of (components || []).entries()) {
    if (!component || !Object.hasOwn(nodes || {}, component.id)) continue;
    prefixNodes[component.id] = nodes[component.id];
    const memberBytes = Buffer.byteLength(serializeChunkedScriptJson({
      schemaVersion: 1,
      nodes: prefixNodes,
    }));
    if (baseBytes + memberBytes > limit) {
      return {
        component,
        componentIndex,
      };
    }
  }
  return null;
}

const TEMPLATE_PLACEHOLDERS = [
  '<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">',
  '<title>[PROJECT NAME] Architecture Diagram</title>',
  '<h1>[PROJECT NAME] Architecture</h1>',
  GUIDED_VIEWS_PLACEHOLDER,
];

export function applyTemplate(template, {
  title,
  subtitle,
  svg,
  cards,
  locale,
  visualPreset = 'classic',
  guidedViews = [],
  sourceEvidence = null,
  internalStructure = null,
  atlasContext = null,
}) {
  if (!SVG_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:SVG_SLOT sentinel');
  }
  if (!CARDS_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:CARDS_SLOT sentinel');
  }
  if (!SUBTITLE_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing subtitle placeholder');
  }
  for (const ph of TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(ph)) {
      throw new Error(`applyTemplate: template missing placeholder ${JSON.stringify(ph)}`);
    }
  }
  // Keep existing custom templates compatible when evidence is not requested.
  // Silently dropping verified evidence would be misleading, so the new slot
  // becomes mandatory only for the opt-in evidence path.
  if (sourceEvidence && !template.includes(SOURCE_EVIDENCE_PLACEHOLDER)) {
    throw new Error(`applyTemplate: repository evidence requires placeholder ${JSON.stringify(SOURCE_EVIDENCE_PLACEHOLDER)}`);
  }
  if (internalStructure && !template.includes(INTERNAL_STRUCTURE_PLACEHOLDER)) {
    throw new Error(`applyTemplate: internal structure requires placeholder ${JSON.stringify(INTERNAL_STRUCTURE_PLACEHOLDER)}`);
  }
  // Function replacers: a literal `$&`, `$'`, `$\`` or `$$` in titles, labels,
  // or rendered SVG must not be interpreted as a replacement pattern.
  const guidedViewsJson = serializeScriptJson(guidedViews);
  const sourceEvidenceJson = serializeScriptJson(sourceEvidence);
  const resolvedLocale = resolveLocale(locale);
  const i18nJson = serializeScriptJson({ locale: resolvedLocale, messages: viewerCatalog(resolvedLocale) });
  const renderedSubtitle = typeof subtitle === 'string' && subtitle.trim()
    ? `<p class="subtitle">${esc(subtitle)}</p>`
    : '';
  const i18nData = `    <script id="archify-i18n-data" type="application/json">${i18nJson}</script>`;
  const localizedTemplate = localizeTemplate(template, resolvedLocale);
  const templateWithI18n = localizedTemplate.includes(I18N_PLACEHOLDER)
    ? localizedTemplate.replace(I18N_PLACEHOLDER, () => i18nData)
    : localizedTemplate.replace(GUIDED_VIEWS_PLACEHOLDER, () => `${i18nData}\n    ${GUIDED_VIEWS_PLACEHOLDER}`);
  return templateWithI18n
    .replace('<!-- ARCHIFY:ATLAS_CONTEXT -->', () => atlasContext
      ? `<script id="archify-atlas-context" type="application/json">${serializeScriptJson(atlasContext)}</script>`
      : '')
    .replace(TEMPLATE_PLACEHOLDERS[0], () => `<html lang="${esc(resolvedLocale)}" data-theme="dark" data-preset="${esc(visualPreset)}">`)
    .replace(TEMPLATE_PLACEHOLDERS[1], () => `<title>${esc(translateMessage(resolvedLocale, 'page.title', { title }))}</title>`)
    .replace(TEMPLATE_PLACEHOLDERS[2], () => `<h1>${esc(title)}</h1>`)
    .replace(SUBTITLE_SLOT_RE, (_match, indent, newline = '') => renderedSubtitle
      ? `${indent}${renderedSubtitle}${newline}`
      : '')
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cards)
    .replace(GUIDED_VIEWS_PLACEHOLDER, () => `<script id="archify-guided-views-data" type="application/json">${guidedViewsJson}</script>`)
    .replace(SOURCE_EVIDENCE_PLACEHOLDER, () => sourceEvidence
      ? `    <script id="archify-source-evidence-data" type="application/json">${sourceEvidenceJson}</script>`
      : '')
    .replace(INTERNAL_STRUCTURE_PLACEHOLDER, () => internalStructure
      ? `    <script id="archify-internal-structure-data" type="application/json">${internalStructure.encoded}</script>`
      : '');
}

// CJK and other wide/fullwidth glyphs render at roughly twice the advance
// width of ASCII in the monospace stacks the template uses. Keep halfwidth
// forms (notably U+FF61–U+FF9F Katakana) out of this set. The explicit ranges
// also cover vertical punctuation and supplementary East Asian scripts that
// literal glyph ranges made difficult to audit.
// Code points that take two columns of advance width: East Asian Wide and
// Fullwidth per UAX #11, tracking Unicode 17.0. That takes in the BMP symbols
// carrying emoji presentation (U+2705, U+2B50, U+26A1, U+231B, ...), which
// render at the same square advance as the supplementary-plane emoji already
// listed here, and Hangul Jamo Extended-A. Two boundary calls worth naming:
// Unicode 16.0 reclassified the trigrams (U+2630-U+2637) and the monogram /
// digram symbols (U+268A-U+268F) from Neutral to Wide, so both are in; and
// Hangul Jamo Extended-A stops at U+A97C, its last assigned jamo, because
// U+A97D-U+A97F are unassigned, and unassigned code points outside the CJK
// ranges UAX #11 names default to Neutral rather than Wide. Spelled out as
// ranges because V8 has no \p{East_Asian_Width=W} property escape.
const FULLWIDTH_RE = /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2630-\u2637\u2648-\u2653\u267F\u268A-\u268F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{18DFF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

// Variation selectors contribute no separate unit. This is a conservative
// width estimate, not a measurement of the selected glyph: its actual advance
// depends on the font and presentation (Unicode UAX #11).
// VS16 requests emoji presentation, so reserve two units for the sequence.
// VS15 retains the base's width estimate; forcing every text-presentation
// sequence to one unit undercounts wide bases, including CJK characters whose
// font ignores that selector. Neutral bases remain one unit. Some selected
// text glyphs can be narrower than this estimate; prefer extra space to overflow.
const VARIATION_SELECTOR_FIRST = 0xfe00;
const VARIATION_SELECTOR_LAST = 0xfe0f;
const VARIATION_SELECTOR_EMOJI = 0xfe0f;

export function textUnits(text) {
  const chars = Array.from(String(text ?? ''));
  let units = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const codePoint = chars[i].codePointAt(0);
    if (codePoint >= VARIATION_SELECTOR_FIRST && codePoint <= VARIATION_SELECTOR_LAST) continue;
    const next = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : -1;
    if (next === VARIATION_SELECTOR_EMOJI) units += 2;
    else units += FULLWIDTH_RE.test(chars[i]) ? 2 : 1;
  }
  return units;
}
