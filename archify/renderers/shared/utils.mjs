import { renderGridPattern } from './svg-grid.mjs';
import {
  escapeHtml as esc,
  localizeTemplate,
  resolveLocale,
  translateMessage,
  viewerCatalog,
} from './i18n.mjs';

export { esc };

// `extra` appends type-owned definitions (the entity renderer's cardinality
// markers) inside the same <defs>. Callers that pass nothing keep the exact
// bytes the five longer-standing renderers already emit.
export function renderDefinitions(extra = '') {
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
          ${renderGridPattern()}${extra}
        </defs>`;
}

const SIGIL_TONE = {
  frontend: 'frontend',
  start: 'frontend',
  backend: 'backend',
  active: 'frontend',
  database: 'database',
  success: 'backend',
  cloud: 'cloud',
  waiting: 'cloud',
  security: 'security',
  decision: 'database',
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
// The viewer installs a runtime "sources" beacon on the node's top-right
// rail, just left of the brand mark. Layout must reserve the same footprint
// so labels never sit under the badge.
export const SOURCE_BADGE_FOOTPRINT = 38;

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
${card.items.map((item) => `          <li>${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const SUBTITLE_SLOT_RE = /^([ \t]*)<p class="subtitle">\[Subtitle description\]<\/p>[ \t]*(\r?\n)?/m;
const SOURCE_EVIDENCE_PLACEHOLDER = '    <!-- ARCHIFY:SOURCE_EVIDENCE_DATA -->';
const I18N_PLACEHOLDER = '    <!-- ARCHIFY:I18N_DATA -->';

function serializeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

const TEMPLATE_PLACEHOLDERS = [
  '<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">',
  '<title>[PROJECT NAME] Architecture Diagram</title>',
  '<h1>[PROJECT NAME] Architecture</h1>',
  I18N_PLACEHOLDER,
];

export function applyTemplate(template, {
  title,
  subtitle,
  svg,
  cards,
  locale,
  visualPreset = 'classic',
  sourceEvidence = null,
  intervalData = null,
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
  // Function replacers: a literal `$&`, `$'`, `$\`` or `$$` in titles, labels,
  // or rendered SVG must not be interpreted as a replacement pattern.
  const sourceEvidenceJson = serializeScriptJson(sourceEvidence);
  const resolvedLocale = resolveLocale(locale);
  const i18nJson = serializeScriptJson({ locale: resolvedLocale, messages: viewerCatalog(resolvedLocale) });
  const renderedSubtitle = typeof subtitle === 'string' && subtitle.trim()
    ? `<p class="subtitle">${esc(subtitle)}</p>`
    : '';
  const i18nData = `    <script id="archify-i18n-data" type="application/json">${i18nJson}</script>`;
  if (intervalData && !template.includes("<!-- ARCHIFY:INTERVAL_DATA -->")) {
    throw new Error("applyTemplate: interval editing requires the interval data slot");
  }
  return localizeTemplate(template, resolvedLocale)
    .replace(/^[ \t]*<!-- ARCHIFY:INTERVAL_DATA -->/m, () => intervalData
      ? `<script id="archify-interval-data" type="application/json">${serializeScriptJson(intervalData)}</script>`
      : "")
    .replace(I18N_PLACEHOLDER, () => i18nData)
    .replace(TEMPLATE_PLACEHOLDERS[0], () => `<html lang="${esc(resolvedLocale)}" data-theme="dark" data-preset="${esc(visualPreset)}">`)
    .replace(TEMPLATE_PLACEHOLDERS[1], () => `<title>${esc(translateMessage(resolvedLocale, 'page.title', { title }))}</title>`)
    .replace(TEMPLATE_PLACEHOLDERS[2], () => `<h1>${esc(title)}</h1>`)
    .replace(SUBTITLE_SLOT_RE, (_match, indent, newline = '') => renderedSubtitle
      ? `${indent}${renderedSubtitle}${newline}`
      : '')
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cards)
    .replace(SOURCE_EVIDENCE_PLACEHOLDER, () => sourceEvidence
      ? `    <script id="archify-source-evidence-data" type="application/json">${sourceEvidenceJson}</script>`
      : '');
}

export { textUnits } from './text-units.mjs';
